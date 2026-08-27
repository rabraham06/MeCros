# MeCros

A full-stack fitness and nutrition tracking web app — workouts, macros, personal records, and AI-powered meal analysis.

**Live at [mecros.org](https://mecros.org)**

---

## About

MeCros is a personal fitness tracker built from scratch. Users can log workouts, track sets and personal records, monitor daily nutrition, and get AI-estimated macros from plain-text meal descriptions. All data is scoped per user with JWT-based authentication.

---

## Features

- Workout logging with set tracking
- Dynamic personal records from workout history
- Daily macro & fiber goal tracking
- AI meal analyzer via Claude API
- Mifflin-St Jeor BMR goal calculation
- Per-user custom exercise library
- EST timezone-aware daily resets
- Responsive dark-mode UI

---

## Tech Stack

| Layer | Tools |
|---|---|
| Backend | Node.js · Express |
| Database | SQLite · better-sqlite3 |
| Frontend | Vanilla JS · HTML · CSS |
| AI | Anthropic Claude API |
| Auth | bcrypt · JWT tokens |
| Hosting | Railway · Cloudflare DNS |

---

## Getting Started

### Prerequisites
- Node.js 18+
- An [Anthropic API key](https://console.anthropic.com)

### Installation

```bash
git clone https://github.com/rabraham06/mecros.git
cd mecros
npm install


Deployment

MeCros is deployed on Railway with a persistent volume mounted at /var/data/gymtracker.db. Set DB_PATH=/var/data/gymtracker.db and ANTHROPIC_API_KEY in your Railway environment variables.

DNS is managed through Cloudflare with a CNAME pointing to the Railway deployment. Static assets are served with Cache-Control: no-cache to prevent Cloudflare from serving stale JS/CSS.

Project Structure
mecros/
├── server.js        # Express API, routes, auth middleware
├── database.js      # SQLite schema, migrations, seed data
├── public/
│   ├── index.html   # Main app shell
│   ├── app.js       # Frontend logic (IIFE module pattern)
│   ├── style.css    # All styles
│   ├── login.html   # Auth page
│   └── setup.html   # Onboarding flow
└── .env             # Local secrets (never committed)

Built by Rohan Abraham · 2026
