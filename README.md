# Space Dashboard

Personal space dashboard hosted on Cloudflare Pages (free tier). Two views:

- **Stargazer** — Tonight's stargazing conditions: Go/No-Go indicator, hourly cloud cover, moon phase, visible planets, active meteor showers. Uses browser geolocation (falls back to Dornbirn, Austria).
- **Cosmic Overview** — 3D navigable solar system built with Three.js. Shows real-time spacecraft positions (JWST, Voyager 1/2, New Horizons, Parker Solar Probe, Juno), near-Earth asteroids, and space weather (Kp index, solar flares).

Live at: https://space-dashboard-ciz.pages.dev/

## Data Sources

All free, no API keys required.

| Data | Source |
|---|---|
| Weather & cloud cover | [Open-Meteo](https://open-meteo.com/) |
| Planet positions | Keplerian orbital elements (computed, no API) |
| Spacecraft positions | [JPL Horizons](https://ssd.jpl.nasa.gov/horizons/) |
| Near-Earth asteroids | [NASA NeoWs](https://api.nasa.gov/) |
| Space weather (Kp, flares) | [NOAA DONKI](https://ccmc.gsfc.nasa.gov/tools/DONKI/) |
| Moon phase | SunCalc algorithm (client-side) |
| Meteor showers | IMO annual calendar (hardcoded) |

## Setup

```bash
git clone https://github.com/Lukas-Kaufmann/space-dashboard.git
cd space-dashboard
npm install
npm run dev
```

Dev server runs at `http://localhost:8788`. Local KV is simulated automatically.

## Deploy

Requires a Cloudflare account (free tier is sufficient).

```bash
# 1. Authenticate (one-time)
npx wrangler login

# 2. Create the Pages project (one-time)
npx wrangler pages project create space-dashboard --production-branch main

# 3. Create the KV namespace (one-time)
npx wrangler kv namespace create CACHE
# Copy the returned ID into wrangler.toml

# 4. Deploy
npm run deploy
```

Subsequent deploys only need `npm run deploy`.

## Stack

- **Frontend:** Vanilla JS, no framework, no build step
- **3D:** Three.js via CDN import map
- **Backend:** Cloudflare Pages Functions (Workers)
- **Cache:** Cloudflare KV with stale-while-revalidate
- **Design:** Dark mode, Outfit + IBM Plex Mono fonts
