# Feelify v2 — Full-Stack Music Analytics & Computer Vision Mood Engine 🎵📊👁️

Feelify v2 is an advanced, production-grade web platform that bridges consumer audio telemetry, browser-native biometrics, and automation frameworks. Leveraging the official **Spotify Web API**, **OAuth 2.0**, and client-side **Computer Vision models**, the application evaluates live facial geometry and user sentiment data to dynamically construct highly personalized listening profiles and playlist remediations.

---

## 🚀 Key Features & Engineering Milestones

- **Computer Vision Facial Emotion Recognition:** Integrated real-time, browser-native facial land-marking models to parse facial coordinate changes, instantly predicting primary user affect states (e.g., Happy, Sad, Angry, Chill) via automated webcam evaluation.
- **Dual-Branch Mood Remediation Framework:** Architected an adaptive curation controller. When a negative valence state (like **Sad**) is identified, the engine dynamically triggers separate, simultaneous curation algorithms:
  - _The Mirror Branch (Validation):_ Generates reflective, down-tempo compositions matching the immediate affective profile.
  - _The Catalyst Branch (Elevation):_ Programmatically builds a "Mood Booster" track sequence using high-energy, high-valence metrics to gently elevate user mood.
- **Bulletproof OAuth 2.0 & Token Lifecycles:** Configured an asynchronous token rotation loop using secure server-side cookies, executing silent token refreshes via backend middleware to optimize session continuity.
- **Algorithmic Profiling & Telemetry Extraction:** Evaluates long-term, mid-term, and real-time listening datasets (`user-top-read`, `user-read-recently-played`) to render client-side analytical dashboards mapping data-driven listening trends.
- **Distributed Customer Support Automation:** Created an decoupled email service utilizing **Nodemailer** with custom SMTP relays, generating isolated runtime tracking IDs and multi-party secure validation receipts.

---

## 🛠️ System Architecture & Data Pipeline

[ Client Webcam ] ──(Facial Geometry)──> [ Client-Side Vision Model ]
│
(JSON Mood Vector)
▼
[ Spotify Web API ] <──(OAuth 2.0 Tokens)──> [ Express Backend Router ]
│ │
(Track Telemetry) ▼
│ [ MongoDB / Mongoose ]
└──────> [ Dual-Branch Engine ] ──> (Upsert Profiles)
├── Mirror Array
└── Catalyst Array

### Technical Stack Summary

- **Backend Framework:** Node.js (v18+) & Express.js (Modular route structures, secure cookie parsing, RESTful API architecture)
- **Database Layer:** MongoDB & Mongoose Object-Data Mapper (Dynamic schemaless upserts via `findOneAndUpdate` minimizing document overhead)
- **Biometrics Core:** Client-side Web Camera canvas processing streams mapped to specialized facial coordinate classifiers.
- **Third-Party Ecosystem:** `spotify-web-api-node` SDK, Nodemailer SMTP relay engines.

---

## 📸 Core Visual Interfaces

|                         Interactive User Dashboard                         |                             Biometric Face & Emotion Detection                              |
| :------------------------------------------------------------------------: | :-----------------------------------------------------------------------------------------: |
| <img src="screenshots/dashboard.png" width="400" alt="Feelify Dashboard"/> | <img src="screenshots/face-detection.png" width="400" alt="Facial Biometrics Tracking UI"/> |

|                        Multi-Engine Emotion Analytics                         |                         Dynamic Dual-Playlist Generator                         |
| :---------------------------------------------------------------------------: | :-----------------------------------------------------------------------------: |
| <img src="screenshots/chart.png" width="400" alt="Analytical Charts Engine"/> | <img src="screenshots/playlist.png" width="400" alt="Dynamic Curation Output"/> |

---

## ⚙️ Local Development Setup

Ensure you have **Node.js** and **MongoDB** installed in your system environment.

### 1. Dependency Initialization

```bash
node server.js
git clone [https://github.com/Enes-Topcu/Feelify.git](https://github.com/Enes-Topcu/Feelify.git)
cd Feelify
npm install
```
