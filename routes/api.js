// routes/api.js - ESKİ SAĞLAM YAPI + 2 PLAYLIST ÖZELLİĞİ + GÜNCEL STATS
const express = require('express');
const router = express.Router();
const SpotifyWebApi = require('spotify-web-api-node');
const nodemailer = require('nodemailer');
const User = require('../models/User');
const Playlist = require('../models/Playlist');

// --- İZİNLER (Kişisel verileri çekmek için ŞART) ---
const SCOPES = [
    'user-read-private',
    'user-read-email',
    'playlist-read-private',
    'playlist-read-collaborative',
    'playlist-modify-public',
    'playlist-modify-private',
    'user-top-read', // En çok dinlenenleri çekmek için
    'user-read-recently-played' // Son dinlenenleri almak için
];

// --- TOKEN YÖNETİMİ ---
async function getSpotifyClient(req, res) {
    if (!req.cookies.spotify_user_id) return null;
    const user = await User.findOne({ 'spotifyData.spotifyUserId': req.cookies.spotify_user_id });
    if (!user) return null;

    const spotifyApi = new SpotifyWebApi({
        clientId: process.env.SPOTIPY_CLIENT_ID,
        clientSecret: process.env.SPOTIPY_CLIENT_SECRET,
        redirectUri: process.env.SPOTIPY_REDIRECT_URI
    });

    spotifyApi.setAccessToken(user.spotifyData.accessToken);
    spotifyApi.setRefreshToken(user.spotifyData.refreshToken);

    if (new Date() > user.spotifyData.expiresAt) {
        try {
            const data = await spotifyApi.refreshAccessToken();
            spotifyApi.setAccessToken(data.body['access_token']);
            user.spotifyData.accessToken = data.body['access_token'];
            user.spotifyData.expiresAt = new Date(Date.now() + 3600 * 1000);
            await user.save();
        } catch (err) { 
        // This bypasses the terminal and forces the real error onto your browser screen
        res.status(500).send(`
            <div style="font-family: Arial, sans-serif; padding: 30px; max-width: 800px; margin: 20px auto; color: #721c24; background-color: #f8d7da; border: 1px solid #f5c6cb; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                <h2 style="margin-top: 0;">❌ Spotify Authentication Failed</h2>
                <p><strong>Simple Message:</strong> ${err.message || 'None'}</p>
                <p><strong>HTTP Status:</strong> ${err.statusCode || 'N/A'}</p>
                
                <h3 style="margin-bottom: 5px;">🔧 Full Technical Breakdown:</h3>
                <pre style="background: #ffffff; padding: 15px; border: 1px solid #e3a7ad; border-radius: 4px; overflow-x: auto; font-family: monospace; font-size: 14px; color: #333;">${JSON.stringify(err, Object.getOwnPropertyNames(err), 2)}</pre>
                
                <p style="margin-top: 15px; font-size: 13px; color: #666;">Copy and paste the text inside the white box above to fix this instantly.</p>
            </div>
        `); 
    }
    }
    return { api: spotifyApi, user: user };
}

// --- LOGIN (İzinleri Almak İçin) ---
// --- CALLBACK ---
router.get('/', async (req, res) => {
    const code = req.query.code;
    // Note: I fixed this redirect to point to /login instead of /api/login
    if (!code) return res.redirect('/login'); 

    const spotifyApi = new SpotifyWebApi({
        clientId: process.env.SPOTIPY_CLIENT_ID,
        clientSecret: process.env.SPOTIPY_CLIENT_SECRET,
        redirectUri: process.env.SPOTIPY_REDIRECT_URI
    });

    try {
        const data = await spotifyApi.authorizationCodeGrant(code);
        spotifyApi.setAccessToken(data.body['access_token']);
        const me = await spotifyApi.getMe();

        await User.findOneAndUpdate(
            { 'spotifyData.spotifyUserId': me.body.id },
            {
                username: me.body.display_name,
                email: me.body.email,
                image: me.body.images?.[0]?.url,
                spotifyData: {
                    spotifyUserId: me.body.id,
                    accessToken: data.body['access_token'],
                    refreshToken: data.body['refresh_token'],
                    expiresAt: new Date(Date.now() + 3600 * 1000)
                }
            },
            { upsert: true, new: true }
        );

        res.cookie('spotify_user_id', me.body.id, { maxAge: 3600000, path: '/' });
        res.cookie('access_token', data.body['access_token'], { maxAge: 3600000, path: '/' });
        res.redirect('/');
    } catch (err) { 
        // Extract the hidden Spotify JSON error
        const realError = err.body ? err.body : err.message;
        
        console.error("🔴 REAL SPOTIFY ERROR:", realError);

        res.status(500).send(`
            <div style="font-family: monospace; padding: 20px; background: #222; color: #ff5555; border-radius: 8px;">
                <h2>❌ Callback Failed</h2>
                <p>Here is the exact reason Spotify rejected the request:</p>
                <pre style="background: #111; padding: 15px; border-radius: 4px; color: #00ff00;">${JSON.stringify(realError, null, 2)}</pre>
            </div>
        `);
    }
});
// --- PROFILE ---
router.get('/me', async (req, res) => {
    const client = await getSpotifyClient(req, res);
    if (!client) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const me = await client.api.getMe();
        res.json({ username: me.body.display_name, image: me.body.images?.[0]?.url || null, email: me.body.email });
    } catch (e) { res.json({ username: 'User', image: null, email: null }); }
});

// --- USER PLAYLISTS ---
router.get('/my-playlists', async (req, res) => {
    const client = await getSpotifyClient(req, res);
    if (!client) return res.json([]); 
    try {
        const data = await client.api.getUserPlaylists({ limit: 50 });
        res.json(data.body.items);
    } catch (e) { res.json([]); }
});

// --- YARDIMCI FONKSİYON: ARAMA İLE PLAYLIST OLUŞTURMA ---
// İyileştirmeler: Deduplicatior, Popüler Şarkılar, Kişiselleştirme
async function createPlaylistFromSearch(client, moodName, keywords, originalText) {
    let myArtists = [];
    try {
        // En çok dinlenenleri al (short_term = Son 4 Hafta)
        const topArtists = await client.api.getMyTopArtists({ limit: 10, time_range: 'short_term' });
        myArtists = topArtists.body.items.map(a => a.name);
    } catch (e) {
        console.log("Artist verisi çekilemedi.");
    }

    // Eğer sanatçı yoksa varsayılanlar
    if (myArtists.length === 0) myArtists = ["The Weeknd", "Coldplay", "Arctic Monkeys", "Duman"];

    let finalTracks = [];
    const seenTrackIds = new Set(); // DEDUPLICATION BY ID
    const seenNormalized = new Set(); // DEDUPLICATION BY normalized title+artist (avoid slowed/remix duplicates)
    myArtists.sort(() => 0.5 - Math.random()); // Karıştır

    // 1. Senin sanatçılarını kullanarak arama yap (Kişiselleştirme)
    for (let artist of myArtists.slice(0, 5)) {
        const keyword = keywords[Math.floor(Math.random() * keywords.length)];
        try {
            // Örn: artist:Duman sad
            const res = await client.api.searchTracks(`artist:"${artist}" ${keyword}`, { limit: 3 });
            if (res.body.tracks.items.length > 0) {
                // Aynı şarkıyı veya versiyonunu tekrar eklemeyelim
                res.body.tracks.items.forEach(track => {
                    const primaryArtist = track.artists && track.artists[0] ? track.artists[0].name : '';
                    const normalize = (s) => s.toLowerCase()
                        .replace(/\(.+?\)/g, '') // remove parentheses
                        .replace(/\[.+?\]/g, '') // remove brackets
                        .replace(/-(?:.*)$/g, '') // remove after dash
                        .replace(/remix|slowed|edit|version|live|acoustic|instrumental|karaoke|radio edit/gi, '')
                        .replace(/[^a-z0-9 ]/g, ' ')
                        .replace(/\s+/g, ' ').trim();
                    const normKey = `${normalize(track.name)}|${normalize(primaryArtist)}`;
                    if (!seenTrackIds.has(track.id) && !seenNormalized.has(normKey)) {
                        seenTrackIds.add(track.id);
                        seenNormalized.add(normKey);
                        finalTracks.push(track);
                    }
                });
            }
            else {
                // Bulamazsa sadece sanatçıyı ara
                const fallback = await client.api.searchTracks(`artist:"${artist}"`, { limit: 1 });
                if (fallback.body.tracks.items.length > 0) {
                    const track = fallback.body.tracks.items[0];
                    const primaryArtist = track.artists && track.artists[0] ? track.artists[0].name : '';
                    const normalize = (s) => s.toLowerCase()
                        .replace(/\(.+?\)/g, '')
                        .replace(/\[.+?\]/g, '')
                        .replace(/-(?:.*)$/g, '')
                        .replace(/remix|slowed|edit|version|live|acoustic|instrumental|karaoke|radio edit/gi, '')
                        .replace(/[^a-z0-9 ]/g, ' ')
                        .replace(/\s+/g, ' ').trim();
                    const normKey = `${normalize(track.name)}|${normalize(primaryArtist)}`;
                    if (!seenTrackIds.has(track.id) && !seenNormalized.has(normKey)) {
                        seenTrackIds.add(track.id);
                        seenNormalized.add(normKey);
                        finalTracks.push(track);
                    }
                }
            }
        } catch (e) {}
    }

    // 2. Popüler/Trending Şarkılar Ekle (Duyguya göre)
    try {
        const trendingSearches = [`${keywords[0]} trending`, `top ${keywords[0]} songs`, `${keywords[1] || keywords[0]} hits`];
        for (let searchTerm of trendingSearches) {
            if (finalTracks.length >= 30) break; // Limit to prevent too many songs
            const trendRes = await client.api.searchTracks(searchTerm, { limit: 5 });
            if (trendRes.body.tracks.items.length > 0) {
                trendRes.body.tracks.items.forEach(track => {
                    const primaryArtist = track.artists && track.artists[0] ? track.artists[0].name : '';
                    const normalize = (s) => s.toLowerCase()
                        .replace(/\(.+?\)/g, '')
                        .replace(/\[.+?\]/g, '')
                        .replace(/-(?:.*)$/g, '')
                        .replace(/remix|slowed|edit|version|live|acoustic|instrumental|karaoke|radio edit/gi, '')
                        .replace(/[^a-z0-9 ]/g, ' ')
                        .replace(/\s+/g, ' ').trim();
                    const normKey = `${normalize(track.name)}|${normalize(primaryArtist)}`;
                    if (!seenTrackIds.has(track.id) && !seenNormalized.has(normKey) && finalTracks.length < 30) {
                        seenTrackIds.add(track.id);
                        seenNormalized.add(normKey);
                        finalTracks.push(track);
                    }
                });
            }
        }
    } catch (e) {
        console.log("Trending tracks error:", e);
    }

    // 3. Eğer hala yetmezse genel arama yap (Tamamlayıcı)
    if(finalTracks.length < 15) {
        try {
            const gen = await client.api.searchTracks(`${keywords[0]} hits`, { limit: 15 });
            if(gen.body.tracks) {
                gen.body.tracks.items.forEach(track => {
                    const primaryArtist = track.artists && track.artists[0] ? track.artists[0].name : '';
                    const normalize = (s) => s.toLowerCase()
                        .replace(/\(.+?\)/g, '')
                        .replace(/\[.+?\]/g, '')
                        .replace(/-(?:.*)$/g, '')
                        .replace(/remix|slowed|edit|version|live|acoustic|instrumental|karaoke|radio edit/gi, '')
                        .replace(/[^a-z0-9 ]/g, ' ')
                        .replace(/\s+/g, ' ').trim();
                    const normKey = `${normalize(track.name)}|${normalize(primaryArtist)}`;
                    if (!seenTrackIds.has(track.id) && !seenNormalized.has(normKey) && finalTracks.length < 30) {
                        seenTrackIds.add(track.id);
                        seenNormalized.add(normKey);
                        finalTracks.push(track);
                    }
                });
            }
        } catch (e) {}
    }

    const trackUris = finalTracks.map(t => t.uri);
    if (trackUris.length === 0) return null;

    // Playlist Oluştur
    const me = await client.api.getMe();
    const playlist = await client.api.createPlaylist(me.body.id, { 
        name: `Feelify: ${moodName}`, 
        description: `Mood: ${originalText} | Generated by Feelify AI`, 
        public: true 
    });
    
    // Şarkıları ekle (50 şarkı limitine dikkat et)
    const chunkedTracks = [];
    for (let i = 0; i < trackUris.length; i += 50) {
        chunkedTracks.push(trackUris.slice(i, i + 50));
    }
    for (let chunk of chunkedTracks) {
        await client.api.addTracksToPlaylist(playlist.body.id, chunk);
    }

    // DB Kayıt
    const newPlaylist = new Playlist({
        userId: client.user._id,
        playlistName: `Feelify: ${moodName}`,
        spotifyPlaylistId: playlist.body.id,
        tracks: finalTracks.map(t => ({ trackName: t.name, artistName: t.artists[0].name, spotifyTrackId: t.id })),
        aiAnalysis: { 
            sourceMood: originalText, 
            dominantGenres: [moodName],
            trackCount: finalTracks.length
        }
    });
    await newPlaylist.save();

    return {
        name: moodName,
        url: playlist.body.external_urls.spotify,
        image: playlist.body.images?.[0]?.url || null,
        trackCount: finalTracks.length
    };
}

// --- GENERATE MELODY (2 PLAYLIST DESTEKLİ) ---
router.post('/generate-melody', async (req, res) => {
    const { feeling_text } = req.body;
    const client = await getSpotifyClient(req, res);
    if (!client) return res.status(401).json({ success: false, error: 'Session closed' });

    try {
        const text = feeling_text.toLowerCase();
        let configs = [];
        
    if (text.includes('a-a-a-a') || text.includes('lvbel') || text.includes('c5')) {
    try {
        const lvbelTracks = await client.api.searchTracks('artist:Lvbel C5', { limit: 10 });
        const trackUris = lvbelTracks.body.tracks.items.map(t => t.uri);
        
        const me = await client.api.getMe();
        const playlist = await client.api.createPlaylist(me.body.id, { 
            name: "Feelify: BABA GELDİ (Lvbel C5 Special)", 
            description: "A-A-A-A! Feelify özel Lvbel C5 playlisti.", 
            public: true 
        });
        
        await client.api.addTracksToPlaylist(playlist.body.id, trackUris);
        
        return res.json({ 
            success: true, 
            playlist_url: playlist.body.external_urls.spotify, 
            mood: "BABA GELDİ" 
        });
    } catch (e) {
        console.error("Lvbel C5 Error:", e);
    }
}

        // MANTIK: Kötü hissediyorsa 2 tane, İyi hissediyorsa 1 tane
        if (text.includes('sad') || text.includes('üzgün') || text.includes('bad') || text.includes('cry') || text.includes('depress')) {
            // 1. Ayna (Hüzünlü)
            configs.push({ name: "Sad Vibes 🌧️", keywords: ["acoustic", "sad", "slow", "piano"] });
            // 2. İlaç (Mutlu)
            configs.push({ name: "Mood Booster 🚀", keywords: ["happy", "upbeat", "dance", "energy"] });
        }
        else if (text.includes('angry') || text.includes('kızgın')) {
            configs.push({ name: "Release Anger 🔥", keywords: ["metal", "rock", "hard"] });
            configs.push({ name: "Calm Down 🍃", keywords: ["chill", "ambient", "calm"] });
        }
        else {
            // Pozitif / Normal
            let name = "Daily Mix";
            let keywords = ["best", "hits"];
            
            if (text.includes('happy') || text.includes('mutlu')) { name = "Happy Hits"; keywords = ["pop", "summer", "party"]; }
            else if (text.includes('chill')) { name = "Chill Mode"; keywords = ["lofi", "jazz", "chill"]; }
            
            configs.push({ name: name, keywords: keywords });
        }

        const results = [];
        for (let conf of configs) {
            // Helper fonksiyonu çağır
            const result = await createPlaylistFromSearch(client, conf.name, conf.keywords, feeling_text);
            if (result) results.push(result);
        }

        if (results.length === 0) return res.status(400).json({ success: false, error: "No tracks found." });

        // Frontend'e array (dizi) dönüyoruz
        res.json({ success: true, playlists: results });

    } catch (error) { 
        console.error(error);
        res.status(500).json({ success: false, error: "Error occurred." });
    }
});

// --- STATS (GÜNCEL: short_term) ---
router.get('/stats', async (req, res) => {
    const client = await getSpotifyClient(req, res);
    if (!client) return res.status(401).json({ error: 'Unauthorized' });
    try {
        // short_term = Son 4 Hafta
        const tracks = await client.api.getMyTopTracks({ limit: 10, time_range: 'short_term' });
        const artists = await client.api.getMyTopArtists({ limit: 10, time_range: 'short_term' });
        res.json({ tracks: tracks.body.items, artists: artists.body.items });
    } catch (e) { res.status(500).json({ error: 'No data' }); }
});

// --- YENİ: EMOTION ANALYSIS (Duygusal Şarkıları Analiz Et) ---
router.get('/emotion-analysis', async (req, res) => {
    const client = await getSpotifyClient(req, res);
    if (!client) return res.status(401).json({ error: 'Unauthorized' });
    
    try {
        // Use user's recently played tracks (recent listening) instead of aggregated long-term stats
        const recently = await client.api.getMyRecentlyPlayedTracks({ limit: 50 });
        const items = recently.body.items || [];
        const trackList = items.map(it => it.track).filter(Boolean);
        
        if (trackList.length === 0) {
            return res.json({ emotionData: [], genreData: [], message: 'No recent tracks' });
        }
        
        // Collect distinct artist ids to fetch genres
        const artistIds = [...new Set(trackList.map(t => t.artists?.[0]?.id).filter(Boolean))];
        let artistGenres = {};
        try {
            for (let i = 0; i < artistIds.length; i += 50) {
                const slice = artistIds.slice(i, i + 50);
                const artistsRes = await client.api.getArtists(slice);
                artistsRes.body.artists.forEach(a => {
                    artistGenres[a.id] = (a.genres && a.genres.length > 0) ? a.genres[0] : null;
                });
            }
        } catch (e) {
            // If artist genre fetch fails, we'll fallback to name heuristics
            console.log('Artist genres fetch failed:', e.message || e);
        }

        const emotionMap = {};
        const genreMap = {};

        const normalizeName = (s) => (s || '').toLowerCase();

        trackList.forEach((track) => {
            const trackNameLower = normalizeName(track.name + ' ' + (track.artists?.[0]?.name || ''));

            let emotion = '😎 Cool';
            if (trackNameLower.includes('sad') || trackNameLower.includes('cry') || trackNameLower.includes('rain') || trackNameLower.includes('blue')) {
                emotion = '😢 Sad & Calm';
            } else if (trackNameLower.includes('happy') || trackNameLower.includes('joy') || trackNameLower.includes('love') || trackNameLower.includes('smile')) {
                emotion = '🎉 Happy & Energetic';
            } else if (trackNameLower.includes('chill') || trackNameLower.includes('relax') || trackNameLower.includes('peace') || trackNameLower.includes('calm')) {
                emotion = '😌 Chill';
            } else if (trackNameLower.includes('night') || trackNameLower.includes('dark') || trackNameLower.includes('cold')) {
                emotion = '😤 Sad & Energetic';
            } else if (trackNameLower.includes('energy') || trackNameLower.includes('run') || trackNameLower.includes('party') || trackNameLower.includes('dance')) {
                emotion = '😊 Happy & Relaxed';
            }

            emotionMap[emotion] = (emotionMap[emotion] || 0) + 1;

            // Determine genre preferentially from artist genres
            const primaryArtistId = track.artists?.[0]?.id;
            let genre = null;
            if (primaryArtistId && artistGenres[primaryArtistId]) {
                genre = artistGenres[primaryArtistId];
            }

            if (!genre) {
                // fallback to heuristics from track name
                if (trackNameLower.includes('rock') || trackNameLower.includes('metal')) genre = 'Rock';
                else if (trackNameLower.includes('hip') || trackNameLower.includes('rap')) genre = 'Hip-Hop';
                else if (trackNameLower.includes('jazz')) genre = 'Jazz';
                else if (trackNameLower.includes('electronic') || trackNameLower.includes('edm')) genre = 'Electronic';
                else if (trackNameLower.includes('indie')) genre = 'Indie';
                else genre = 'Pop';
            }

            // artistGenres entry may be an array or string; ensure string
            if (Array.isArray(genre)) genre = genre[0] || 'Pop';
            genre = (genre || 'Pop').charAt(0).toUpperCase() + (genre || 'pop').slice(1);

            genreMap[genre] = (genreMap[genre] || 0) + 1;
        });

        const emotionData = Object.entries(emotionMap).map(([emotion, count]) => ({
            label: emotion,
            value: count,
            percentage: ((count / trackList.length) * 100).toFixed(1)
        })).sort((a, b) => b.value - a.value);

        const genreData = Object.entries(genreMap).map(([genre, count]) => ({
            label: genre,
            value: count,
            percentage: ((count / trackList.length) * 100).toFixed(1)
        })).sort((a, b) => b.value - a.value).slice(0, 10);

        res.json({ emotionData, genreData, totalTracks: trackList.length });
    } catch (e) {
        console.error('Emotion analysis error:', e);
        // If Spotify returns insufficient scope, inform client to re-login
        if (e && e.statusCode === 403 && e.body && e.body.error && typeof e.body.error.message === 'string' && e.body.error.message.toLowerCase().includes('insufficient')) {
            return res.status(403).json({ error: 'insufficient_scope', message: 'Please re-login to grant recently-played permission.' });
        }
        res.status(500).json({ error: 'Analysis failed' });
    }
});

// --- SUPPORT MAIL ---
router.post('/send-support', async (req, res) => {
    const { userEmail, message } = req.body;
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: 'feelify22@gmail.com', pass: process.env.EMAIL_PASS }
    });
    const ticketId = Math.floor(1000 + Math.random() * 9000);

    try {
        await transporter.sendMail({
            from: `"${userEmail}" <feelify22@gmail.com>`, to: 'feelify22@gmail.com', replyTo: userEmail,
            subject: `🚨 [TICKET #${ticketId}] Support: ${userEmail}`,
            text: `User: ${userEmail}\nMessage:\n${message}\nTicket ID: ${ticketId}`
        });
        await transporter.sendMail({
            from: `"Feelify Support" <feelify22@gmail.com>`, to: userEmail,
            subject: `Ticket Received! [#${ticketId}]`,
            html: `<h3>Hi!</h3><p>We received your ticket #${ticketId}.</p><p>Message: ${message}</p>`
        });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false }); }
});

module.exports = router;