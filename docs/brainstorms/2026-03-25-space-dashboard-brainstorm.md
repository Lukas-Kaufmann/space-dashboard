# Space Dashboard Brainstorm

**Date:** 2026-03-25
**Status:** Ready for planning

## What We're Building

A two-view space dashboard hosted entirely on Cloudflare's free tier:

1. **Stargazer View** — Local weather/sky conditions for stargazing
   tonight in Dornbirn, Austria. Go/No-Go indicator.
2. **Cosmic Overview** — 3D navigable solar system showing spacecraft
   positions, asteroid flybys, and space weather.

## Why This Approach

### Zero-auth API stack
No API keys anywhere. Simpler deployment, no secrets management,
no rate limit concerns with key rotation.

### Vanilla JS + Three.js
No framework overhead. Static HTML/CSS/JS deployed to Cloudflare
Pages. Three.js for the 3D solar system — it's the standard for
this kind of visualization and worth the bundle size.

### On-demand Worker with KV cache
Cloudflare Worker proxies all external APIs with KV-cached responses
(TTL ~15-30 min). Avoids CORS issues, keeps API patterns private,
stays well within free tier limits.

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| API keys | None (zero-auth only) | Moon phase computed locally, planets via JPL Horizons |
| Frontend | Vanilla JS + HTML | No build step needed, simple Cloudflare Pages deploy |
| 3D library | Three.js | Full orbit controls, camera animation, labels |
| Data layer | Worker + KV cache (on-demand) | Simple, fast after first load, stays in free tier |
| Space weather | NOAA DONKI | Reliable, documented, free, no auth |
| Moon phase | Client-side algorithm | Well-known computation, no API needed |

## Architecture

```
Cloudflare Pages (static site)
  ├── index.html (view switcher)
  ├── stargazer/ (View 1 - weather + sky conditions)
  └── cosmic/    (View 2 - Three.js solar system)

Cloudflare Worker (API proxy + cache)
  ├── /api/weather     → Open-Meteo (cloud cover, visibility, precip)
  ├── /api/planets     → JPL Horizons (planet positions)
  ├── /api/spacecraft  → JPL Horizons (JWST, Voyager 1, etc.)
  ├── /api/asteroids   → NASA NeoWs (near-Earth objects)
  ├── /api/space-weather → NOAA DONKI (Kp index, solar flares)
  └── /api/moon-phase  → (or computed client-side)

Cloudflare KV (response cache)
  └── Keyed by endpoint + date, TTL 15-30 min
```

## API Sources

### View 1: Stargazer
- **Open-Meteo** — cloud cover (low/mid/high), visibility,
  precipitation probability. Dornbirn coords: 47.4125, 9.7417
- **Moon phase** — computed client-side using standard algorithms
- **Planet visibility** — JPL Horizons positions endpoint

### View 2: Cosmic Overview
- **JPL Horizons** — Cartesian XYZ for spacecraft (JWST, Voyager 1/2,
  Mars rovers, New Horizons) and planets
- **NASA NeoWs** — near-Earth asteroids: diameter, velocity, miss distance
- **NOAA DONKI** — Kp index, solar flare events, CME data

## Go/No-Go Logic (Stargazer View)

```
IF cloud_cover < 15%
   AND moon_illumination < 20%
   AND precipitation_probability < 10%
THEN → "GO: Dark Skies Tonight" (green)
ELIF cloud_cover < 40%
   AND moon_illumination < 50%
THEN → "MAYBE: Partial Conditions" (amber)
ELSE → "NO-GO: Poor Conditions" (red)
```

## Cloudflare Free Tier Constraints

- **Workers:** 100K requests/day, 10ms CPU time per invocation
- **KV:** 100K reads/day, 1K writes/day, 1GB storage
- **Pages:** Unlimited static requests, 500 builds/month
- **D1:** Not needed — KV suffices for cache

## Resolved Questions

1. **Spacecraft to track** — Curated defaults (JWST, Voyager 1,
   Voyager 2, New Horizons, Parker Solar Probe, Juno) with toggles
   to add/remove from a broader list (~10 options).
2. **Location** — Hardcoded to Dornbirn (47.4125, 9.7417). Personal
   dashboard, no location picker needed.
3. **Theme** — Dark mode only. Fits the space aesthetic, simpler CSS.
