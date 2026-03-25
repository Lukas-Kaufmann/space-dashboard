# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Personal space dashboard on Cloudflare Pages (free tier). Two views:
- **Stargazer** (`/stargazer/`) — local weather, Go/No-Go for stargazing, moon phase, planets, meteor showers
- **Cosmic Overview** (`/cosmic/`) — 3D navigable solar system (Three.js) with spacecraft, asteroids, space weather

## Commands

```bash
npm run dev       # Local dev server (wrangler pages dev) — serves on localhost:8788
npm run deploy    # Deploy to Cloudflare Pages
```

The global `CLOUDFLARE_API_TOKEN` env var is for a different account.
Use `CLOUDFLARE_API_TOKEN= npx wrangler <command>` or source the project `.env`
to use the OAuth login instead.

Local dev uses Miniflare with simulated KV. State persists in `.wrangler/state/`.
Delete `.wrangler/` to clear the local cache.

## Architecture

**No build step.** Static HTML/CSS/JS in `public/` served by Cloudflare Pages.
API proxy via Pages Functions in `functions/` (auto-routed by file path).

### Frontend (`public/`)

- Vanilla JS (ES modules), no framework
- Three.js loaded via CDN import map (pinned version) — only on `/cosmic/`
- Fonts: Outfit (headings) + IBM Plex Mono (body) from Google Fonts
- Single shared CSS file (`css/style.css`) with CSS custom properties

### Workers (`functions/`)

Pages Functions — each file in `functions/api/` maps to a `/api/<name>` route.

- `_middleware.js` — CORS + error handling for all `/api/*` routes
- `lib/kv-cache.js` — shared two-key stale-while-revalidate cache pattern
  (KV deletes expired keys, so we use `data:<key>` + `fresh:<key>` sentinel)
- All endpoints use `cachedFetch()` from `lib/kv-cache.js`

### Data sources (all free, no auth)

| Endpoint | Source | Notes |
|---|---|---|
| `/api/weather` | Open-Meteo | Accepts `?lat=&lon=`, coords rounded to 0.1° for cache key |
| `/api/planets` | Keplerian elements (computed) | No API call — J2000 orbital elements, ~1° accuracy |
| `/api/spacecraft` | JPL Horizons | Falls back to approximate positions when Horizons is unreachable |
| `/api/asteroids` | NASA NeoWs | Uses `DEMO_KEY` (50 req/day), 60-min cache TTL |
| `/api/space-weather` | NOAA DONKI | Kp index + solar flares, 30-min cache TTL |

### Known issue: JPL Horizons + local dev

`ssd.jpl.nasa.gov` is unreachable from workerd/Miniflare (TLS incompatibility).
Spacecraft endpoint uses fallback positions locally. Works on Cloudflare's edge.

## Key conventions

- **CSP header** in `public/_headers` includes a SHA256 hash for the inline
  import map on `/cosmic/`. If you change the import map content, recompute:
  `echo -n '<content>' | openssl sha256 -binary | openssl base64`
- Two-key KV cache: each write costs 2 KV operations (data + sentinel).
  Budget ~336 writes/day on free tier (1,000 limit).
- Meteor shower calendar (`stargazer.js`) is hardcoded annually — update
  dates if needed for accuracy beyond ~1 day.
- `timezone: 'auto'` in weather requests — Open-Meteo infers from coordinates.
