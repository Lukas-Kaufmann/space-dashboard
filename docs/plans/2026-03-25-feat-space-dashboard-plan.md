---
title: "feat: Space Dashboard — Stargazer + Cosmic Overview"
type: feat
status: completed
date: 2026-03-25
origin: docs/brainstorms/2026-03-25-space-dashboard-brainstorm.md
---

# Space Dashboard — Stargazer + Cosmic Overview

## Enhancement Summary

**Deepened on:** 2026-03-25
**Sections enhanced:** 12
**Research agents used:** Performance Oracle, Security Sentinel,
Architecture Strategist, Frontend Race Conditions Reviewer,
Code Simplicity Reviewer, Three.js Best Practices Researcher,
Cloudflare Pages Functions Researcher, Frontend Design Researcher

### Key Improvements

1. **Shared cache module** with two-key stale-while-revalidate pattern
   (KV deletes expired keys — single-key SWR doesn't work)
2. **Scene readiness gate** pattern to prevent race conditions between
   Three.js init and parallel data fetches
3. **Content Security Policy + SRI** for CDN-loaded Three.js
4. **Design system** — mission-control aesthetic with specific palette,
   typography (Outfit + IBM Plex Mono), and component patterns
5. **Middleware** for CORS and error handling via `_middleware.js`
6. **Workers 6-connection limit** on free tier — affects batched
   Horizons queries

### New Considerations Discovered

- KV `expirationTtl` **deletes** expired keys — stale-while-revalidate
  needs a two-key pattern (data key + freshness sentinel)
- Workers free tier has a **6 simultaneous outbound connection** limit —
  batching 10 Horizons queries will queue
- CSS2DRenderer labels need `pointer-events: none` or they block
  OrbitControls drag events
- NeoWs `DEMO_KEY` rate limits (50/day) are tighter than expected —
  increase TTL to 60 min
- `Promise.allSettled()` over `Promise.all()` everywhere — partial
  data is better than total failure

---

## Overview

Two-view personal space dashboard hosted entirely on Cloudflare free tier:

1. **Stargazer** — Local weather/sky conditions for stargazing tonight
   in Dornbirn, Austria. Go/No-Go indicator + weather details + visible
   planets + moon phase.
2. **Cosmic Overview** — 3D navigable solar system (Three.js) showing
   spacecraft positions, near-Earth asteroids, and space weather status.

All APIs are free and require no authentication. Frontend is vanilla
JS + HTML with Three.js loaded via import map. Cloudflare Workers
(Pages Functions) proxy all external APIs with KV caching.

(See brainstorm: `docs/brainstorms/2026-03-25-space-dashboard-brainstorm.md`)

## Technical Approach

### Architecture

```
space-dashboard/
├── wrangler.toml                 # Pages + KV config
├── package.json                  # wrangler dev dependency
├── public/                       # Static site (pages_build_output_dir)
│   ├── index.html                # Landing / view switcher
│   ├── _headers                  # CSP + security headers
│   ├── css/
│   │   └── style.css             # Global dark theme + design system
│   ├── js/
│   │   ├── stargazer.js          # Stargazer view logic
│   │   ├── cosmic.js             # Cosmic overview + Three.js
│   │   ├── moon.js               # Moon phase algorithm (SunCalc-based)
│   │   └── api.js                # Shared fetch helpers, error handling
│   ├── stargazer/
│   │   └── index.html            # Stargazer view page
│   └── cosmic/
│       └── index.html            # Cosmic overview page
├── functions/                    # Pages Functions (auto-routed Workers)
│   ├── api/
│   │   ├── _middleware.js        # CORS + error handling for all /api/*
│   │   ├── weather.js            # → /api/weather (Open-Meteo proxy)
│   │   ├── planets.js            # → /api/planets (JPL Horizons)
│   │   ├── spacecraft.js         # → /api/spacecraft (JPL Horizons)
│   │   ├── asteroids.js          # → /api/asteroids (NASA NeoWs)
│   │   └── space-weather.js      # → /api/space-weather (NOAA DONKI)
│   └── lib/
│       └── kv-cache.js           # Shared cache-through module
```

### Research Insights: Architecture

**Shared cache module (critical).** The cache-through pattern is
duplicated across 5 endpoint files. Extract to `functions/lib/kv-cache.js`.
Pages Functions support ES module imports from outside `functions/`
via relative paths.

**KV stale-while-revalidate needs two keys.** KV's `expirationTtl`
**deletes** the key after expiry — you cannot read an expired key.
For true SWR, use a two-key pattern:

```js
// functions/lib/kv-cache.js
export async function cachedFetch(env, key, ttlSeconds, fetchFn) {
  // Check freshness sentinel
  const isFresh = await env.CACHE.get(`fresh:${key}`);
  if (isFresh) {
    const data = await env.CACHE.get(`data:${key}`);
    if (data) return { data: JSON.parse(data), status: 'HIT' };
  }

  try {
    const fresh = await fetchFn();
    const json = JSON.stringify(fresh);
    // Store data with long TTL (or no expiry)
    await env.CACHE.put(`data:${key}`, json, { expirationTtl: 86400 });
    // Store freshness sentinel with short TTL
    await env.CACHE.put(`fresh:${key}`, '1', { expirationTtl: ttlSeconds });
    return { data: fresh, status: 'MISS' };
  } catch (err) {
    // Upstream failed — serve stale data if available
    const stale = await env.CACHE.get(`data:${key}`);
    if (stale) return { data: JSON.parse(stale), status: 'STALE' };
    throw err;
  }
}
```

**Note:** Two-key pattern doubles KV writes. Budget becomes ~480/day
for single user on 30-min TTL. Still within 1,000/day free limit.

**Middleware for CORS + error handling.** Use `functions/api/_middleware.js`
to handle CORS preflight and wrap errors consistently:

```js
// functions/api/_middleware.js
async function corsHandler(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }
  const response = await context.next();
  response.headers.set('Access-Control-Allow-Origin', '*');
  return response;
}

async function errorHandler(context) {
  try {
    return await context.next();
  } catch (err) {
    return Response.json(
      { error: err.message },
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

export const onRequest = [errorHandler, corsHandler];
```

**Note on CORS:** Since the frontend and Functions share the same
Cloudflare Pages origin, CORS headers may not be needed (same-origin
requests). The middleware is a safety net for local dev
(`localhost:8788` → Functions).

**Normalize upstream responses.** Each Worker should transform upstream
API data into a stable schema. If NASA changes a field name, fix one
Worker, not the frontend.

### wrangler.toml

```toml
name = "space-dashboard"
pages_build_output_dir = "./public"
compatibility_date = "2026-03-01"

[[kv_namespaces]]
binding = "CACHE"
id = "<created-at-deploy-time>"
```

### Routing: Separate Pages (Not SPA)

Each view is a separate HTML page under its own directory. `index.html`
serves as a landing/switcher that links to `/stargazer/` and `/cosmic/`.
This avoids managing Three.js lifecycle on view toggle and keeps each
page's JS payload focused.

- `/` — Landing with links to both views
- `/stargazer/` — Stargazer view (lightweight JS)
- `/cosmic/` — Cosmic overview (Three.js, heavier)

Browser back/forward works naturally. No client-side routing needed.

### Security Headers

Add a `_headers` file in the `public/` directory:

```
/*
  Content-Security-Policy: default-src 'none'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
```

### Research Insights: Security

- **SRI for Three.js CDN.** Add `integrity` attributes to the import
  map script tag or self-host the bundle. SRI is the most effective
  control against CDN supply chain attacks.
- **Validate upstream responses** before writing to KV — check HTTP
  status (only cache 2xx) and verify expected top-level keys exist.
- **No user input** in the entire app — SSRF, XSS, and injection
  risks are negligible by design. Workers proxy hardcoded URLs with
  hardcoded params. No request data reaches upstream.
- **DEMO_KEY** for NeoWs is used server-side only (Worker), never
  exposed to the browser.

## API Integration Details

### Open-Meteo (Weather)

**Worker endpoint:** `/api/weather`
**Upstream:**
```
https://api.open-meteo.com/v1/forecast
  ?latitude=47.4125&longitude=9.7417
  &hourly=cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,
          visibility,precipitation_probability,temperature_2m,
          weather_code
  &daily=sunrise,sunset
  &timezone=Europe/Vienna
  &forecast_days=2
```

**Cache TTL:** 30 min
**Cache key:** `weather:YYYY-MM-DD`

### JPL Horizons (Planets + Spacecraft)

**Worker endpoints:** `/api/planets`, `/api/spacecraft`

**Upstream (per target):**
```
https://ssd.jpl.nasa.gov/api/horizons.api
  ?format=json
  &COMMAND='<ID>'
  &EPHEM_TYPE=VECTORS
  &CENTER='500@10'         # Heliocentric (Cosmic Overview)
  &START_TIME='<today>'
  &STOP_TIME='<tomorrow>'
  &STEP_SIZE='1 d'
```

**Spacecraft NAIF IDs:**

| Spacecraft | COMMAND | Default |
|---|---|---|
| JWST | `-170` | Yes |
| Voyager 1 | `-31` | Yes |
| Voyager 2 | `-32` | Yes |
| New Horizons | `-98` | Yes |
| Parker Solar Probe | `-96` | Yes |
| Juno | `-61` | Yes |
| Curiosity | `-76` | No (toggle) |
| Perseverance | `-168` | No (toggle) |
| BepiColombo | `-121` | No (toggle) |
| Lucy | `-49` | No (toggle) |

**Planet barycenters:** Mercury=1, Venus=2, Earth=3, Mars=4,
Jupiter=5, Saturn=6, Uranus=7, Neptune=8

**Cache TTL:** 60 min (orbital positions don't change perceptibly)
**Cache key:** `spacecraft:YYYY-MM-DD` / `planets:YYYY-MM-DD`

### Research Insights: Horizons Batching

**Workers free tier: 6 simultaneous outbound connections.** If the
spacecraft endpoint fires 10 parallel fetch() calls via `Promise.all()`,
the runtime queues extras — 6 run concurrently, remaining 4 start as
slots free up. This works but adds latency.

**Recommendations:**
- Batch planets (8) and spacecraft (6-10) into separate endpoints to
  stay within 6-connection limit per invocation
- Use `Promise.allSettled()` — if one Horizons query fails, return
  partial results for the rest
- Cache the **transformed/reduced** result in KV, not raw responses.
  Only needed fields: name, x, y, z, distance from Sun, distance
  from Earth
- Parse only minimum fields — regex extraction on Horizons text is
  cheaper than full JSON parse. Helps stay under 10ms CPU.

**Coordinate note:** Cosmic Overview uses heliocentric XYZ from
Horizons. For Stargazer planet visibility, use Horizons with
`CENTER='coord@399'` and `COORD_TYPE='GEODETIC'` to get topocentric
alt/az directly.

### NASA NeoWs (Asteroids)

**Worker endpoint:** `/api/asteroids`
**Upstream:**
```
https://api.nasa.gov/neo/rest/v1/feed
  ?start_date=<today>
  &end_date=<today>
  &api_key=DEMO_KEY
```

**Cache TTL:** 60 min (increased from 30 min — see below)

**Rate limit:** `DEMO_KEY` = 30 req/hr, 50 req/day. With 60-min TTL,
max 24 cache misses/day — safely within limit with margin for retries.

**Response processing:** Worker extracts and returns:
- Name, estimated diameter (min/max km), relative velocity (km/s),
  miss distance (km and AU), is_potentially_hazardous flag
- Sorted by miss distance (closest first)

### Research Insights: NeoWs Budget

The original 30-min TTL was too aggressive for `DEMO_KEY` limits.
60-min TTL cuts API calls to 24/day, halves KV writes, and asteroid
data doesn't change within an hour. If DEMO_KEY limits ever bite,
get a free NASA API key from api.nasa.gov — raises limit to
1,000 req/hr.

### NOAA DONKI (Space Weather)

**Worker endpoint:** `/api/space-weather`
**Upstream (combined):**
- Geomagnetic storms: `https://kauai.ccmc.gsfc.nasa.gov/DONKI/WS/get/GST?startDate=<7-days-ago>&endDate=<today>`
- Solar flares: `https://kauai.ccmc.gsfc.nasa.gov/DONKI/WS/get/FLR?startDate=<7-days-ago>&endDate=<today>`

**Cache TTL:** 30 min
**Cache key:** `space-weather:YYYY-MM-DD`

**Response processing:** Worker extracts latest Kp index value,
recent flare events (class, time), and returns a combined payload.

## Design System

### Aesthetic Direction

**Mission control retro-futurism.** Dense data, deliberate restraint,
atmosphere through subtle texture. The Go/No-Go badge should feel
like a hardware status indicator, not a web component.

### Color Palette

```css
:root {
  /* Backgrounds — not pure black, space has depth */
  --bg-void:        #0a0e17;
  --bg-surface:     #111827;
  --bg-elevated:    #1a2332;

  /* Text — warm-shifted off-white */
  --text-primary:   #e2e8f0;
  --text-secondary: #8896ab;
  --text-muted:     #4a5568;

  /* Status colors */
  --go:             #22c55e;
  --maybe:          #f59e0b;
  --nogo:           #ef4444;

  /* Kp scale */
  --kp-low:         #22c55e;
  --kp-mid:         #eab308;
  --kp-high:        #dc2626;

  /* Accent — interactive elements */
  --accent:         #38bdf8;
  --accent-dim:     #1e3a5f;

  /* Utility */
  --border:         #1e293b;
  --glow-sun:       #fbbf24;
}
```

90% dark grays + off-white. Color reserved exclusively for status
and interaction. Add a subtle radial gradient on body for depth:

```css
body::before {
  content: '';
  position: fixed;
  inset: 0;
  background: radial-gradient(
    ellipse at 20% 10%,
    rgba(56, 189, 248, 0.03) 0%,
    transparent 60%
  );
  pointer-events: none;
}
```

### Typography

- **Display / headings:** "Outfit" — geometric sans, technical feel
- **Body / data:** "IBM Plex Mono" — mission-control monospace
- Load both from Google Fonts

```css
h1, h2, h3, .badge-label {
  font-family: "Outfit", system-ui, sans-serif;
}
body, .data-value, code {
  font-family: "IBM Plex Mono", "Courier New", monospace;
}
```

### Panel Pattern

All data panels share a card style:

```css
.panel {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 1.25rem;
}
```

### Cosmic Overview Overlays

Floating panels over the 3D canvas with translucent backdrop:

```css
.overlay-panel {
  position: fixed;
  background: rgba(10, 14, 23, 0.85);
  backdrop-filter: blur(12px);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 1rem;
  z-index: 10;
}
```

Collapsible on mobile (`aria-expanded` toggle) so they don't
obscure the 3D view.

## Stargazer View — Design

### "Tonight" Definition

The observation window = **civil twilight end → astronomical dawn**.
Open-Meteo returns hourly data. The Worker also fetches `sunrise` and
`sunset` from the daily endpoint. The frontend:

1. Computes twilight times from sunset/sunrise (civil twilight ≈
   sunset + 30 min, astronomical dawn ≈ sunrise - 90 min)
2. Filters hourly forecasts to the observation window
3. Uses the **worst hour** in the window for Go/No-Go (conservative —
   if any hour is bad, the indicator reflects that)
4. Displays hour-by-hour breakdown so the user can find the best window

### Go/No-Go Logic

```
cloud_cover = total cloud_cover (worst hour in window)
moon_illum  = client-side SunCalc calculation
precip      = precipitation_probability (worst hour)

GO     → cloud_cover < 15% AND moon_illum < 20% AND precip < 10%
MAYBE  → cloud_cover < 40% AND moon_illum < 50% AND precip < 30%
NO-GO  → everything else
```

**Cloud cover:** Use total `cloud_cover` for the primary indicator.
Display low/mid/high breakdown as supplementary detail.

**Visibility:** Display as a data point but not in Go/No-Go logic.

### Go/No-Go Badge

Large, centered status badge styled as a hardware indicator:

```css
.go-nogo-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem 2rem;
  border-radius: 6px;
  font-family: "Outfit", system-ui, sans-serif;
  font-size: 3.5rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  border: 2px solid;
}

.go-nogo-badge[data-status="go"] {
  color: var(--go);
  border-color: var(--go);
  background: rgba(34, 197, 94, 0.08);
  box-shadow: 0 0 20px rgba(34, 197, 94, 0.15),
              inset 0 0 20px rgba(34, 197, 94, 0.05);
}

/* LED dot before text */
.go-nogo-badge::before {
  content: '';
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 8px currentColor;
}
```

Text labels are prominent (not color-only) for accessibility.

### Layout

Single-column on mobile, two-column grid on wider screens.
Badge anchors the top, centered. Data panels below.

### Data Panels

1. **Weather Timeline** — Horizontal scroll container with hourly
   cards showing cloud cover %, precipitation %, temperature,
   visibility. `scroll-snap-type: x mandatory` for mobile.
2. **Moon** — Phase name, illumination %, rise/set times, CSS
   crescent icon (two overlapping circles, no image needed)
3. **Visible Planets** — List of planets above the horizon tonight
   with approximate direction (compass), magnitude

### Moon Phase (Client-Side)

Vendor the SunCalc moon illumination algorithm (~2KB). Returns:
- `illumination` (0.0–1.0) — used in Go/No-Go
- `phase` (0.0–1.0) — used for phase name/icon
- Moon rise/set can be computed from SunCalc as well

**Important:** Use `Date.UTC()` explicitly — local timezone can
shift the date and cause phase to be off by up to one day.

## Cosmic Overview — Design

### Three.js Setup

```html
<script type="importmap">
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.module.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.172.0/examples/jsm/"
  }
}
</script>
```

Components: Scene, PerspectiveCamera, WebGLRenderer, OrbitControls,
CSS2DRenderer (for labels).

**Preload Three.js** in `<head>` to cut first-paint delay:

```html
<link rel="modulepreload"
      href="https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.module.js">
```

### Scale Problem & Solution

**Logarithmic distance scale.** The solar system spans ~160 AU
(Voyager 1) while inner planets are within 1.5 AU.

```js
function auToScene(au, sceneRadius = 100) {
  const logMin = Math.log10(0.3);   // inner bound
  const logMax = Math.log10(200);   // outer bound (past Voyager)
  const t = (Math.log10(Math.max(au, 0.3)) - logMin) / (logMax - logMin);
  return t * sceneRadius;
}
// Mercury ~15, Earth ~27, Jupiter ~58, Neptune ~82, Voyager 1 ~93
```

A UI note explains "distances are logarithmic."

### Scene Elements

- **Sun** — Glowing sphere at origin (emissive material + point light)
- **Planets** — Color-coded spheres at scaled positions, sized for
  visibility (not to scale). Use `SphereGeometry(r, 32, 16)` — low
  segment count is fine at dashboard scale.
- **Spacecraft** — Distinct markers (diamonds or custom sprites) with
  label showing name + distance from Earth
- **Asteroids** — Small markers for today's close approaches, sized
  by estimated diameter
- **Orbit paths** — `BufferGeometry` + `Line` (not TubeGeometry).
  Set `matrixAutoUpdate = false` since orbits are static.

### Research Insights: Scene Optimization

- **Reuse materials.** One `MeshStandardMaterial` per visual style,
  shared across planets of similar appearance.
- **One PointLight + ambient** is sufficient.
- **Track draw calls:** `renderer.info.render.calls` — target < 50.
- **On-demand rendering:** Use OrbitControls `change` event to
  trigger renders. Stop the animation loop after 1-2s of inactivity
  to save battery/CPU:

```js
let needsRender = true;
controls.addEventListener('change', () => { needsRender = true; });

renderer.setAnimationLoop(() => {
  if (needsRender) {
    controls.update();
    renderer.render(scene, camera);
    needsRender = false;
  }
});
```

### Interaction

- **OrbitControls** — Zoom, pan, rotate via mouse/touch

```js
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 5;
controls.maxDistance = 200;
controls.rotateSpeed = 0.5;
controls.touches = {
  ONE: THREE.TOUCH.ROTATE,
  TWO: THREE.TOUCH.DOLLY_ROTATE  // no pan — solar system is centered
};
```

- **Click/tap object** — Raycaster with `pointerup` event (works for
  both mouse and touch). Drag-vs-click discrimination by comparing
  pointer positions:

```js
let downPos = new THREE.Vector2();
canvas.addEventListener('pointerdown', (e) => {
  getPointerPos(e); downPos.copy(pointer);
});
canvas.addEventListener('pointerup', (e) => {
  getPointerPos(e);
  if (pointer.distanceTo(downPos) < 0.02) {
    // Click, not drag — raycast and show info panel
  }
});
```

- **Spacecraft toggles** — Collapsible overlay panel (top-right)
  with checkboxes. Defaults checked for the 6 curated spacecraft.
  State saved to `localStorage`.

- **Labels** — CSS2DRenderer labels on all visible objects.
  **Must set `pointer-events: none`** on label elements or they
  block OrbitControls drag events. If labels need to be clickable,
  use `pointer-events: auto` + `stopPropagation()`.

### Space Weather Panel

Overlay panel (bottom-left) showing:
- **Kp Index** — Current value (0-9) with color indicator
  (green 0-3, yellow 4-5, red 6+)
- **Solar Flares** — Recent events with class (C/M/X) and time
- **Aurora probability** — If Kp ≥ 5, display aurora alert

### Loading State

Show a centered "Loading Solar System..." message with a subtle
CSS animation. Canvas hidden until scene is initialized and first
data is plotted.

### WebGL Fallback

If `WebGLRenderingContext` is not available:
- Display a text-based fallback: table of spacecraft/planet positions
  and distances
- Same data, just not 3D

## Frontend Race Condition Guards

### Scene Readiness Gate (Critical)

Three.js init and data fetches should start in parallel, but
plotting must wait for the scene to be ready:

```js
const sceneReady = new Promise(resolve => {
  // Three.js init...
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(75, aspect, 0.1, 1000);
  resolve();
});

const dataPromises = [
  fetch('/api/spacecraft').then(r => r.json()),
  fetch('/api/planets').then(r => r.json()),
  // ...
];

// Each plotter waits for scene, then plots
Promise.allSettled([
  sceneReady.then(() => dataPromises[0]).then(plotSpacecraft),
  sceneReady.then(() => dataPromises[1]).then(plotPlanets),
  // ...
]);
```

### Click Handler During Loading

Attach `.userData` to meshes **before** `scene.add()`. Guard the
click handler:

```js
if (!obj.userData?.ready) return;
```

### Spacecraft Toggle During Fetch

When plotting spacecraft, read the **current** checkbox state.
If mesh doesn't exist yet when toggle fires, do nothing —
`plotSpacecraft()` will check the checkbox when it runs.

### Window Resize During Init

Guard the resize handler:

```js
function onResize() {
  if (!renderer || !camera) return;
  // ...
}
```

Or register the listener only after init completes.

### Background Tab Handling

Use `renderer.setAnimationLoop()` (auto-pauses in background tabs)
+ Visibility API for explicit control:

```js
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    renderer.setAnimationLoop(null);
    clock.stop();
  } else {
    clock.start();
    clock.getDelta(); // flush accumulated delta
    renderer.setAnimationLoop(animate);
  }
});
```

### Stargazer: Partial Fetch Failure

Use `Promise.allSettled()`. Render each section independently.
Show inline error for failed sections. **Never compute Go/No-Go
unless all required inputs arrived** (weather + moon phase).

## Error Handling Strategy

**Principle:** Serve stale cache on upstream failure. Show partial
data rather than a blank screen.

- **Worker level:** Two-key KV pattern ensures stale data is
  always available even after TTL expires. If no cache exists at
  all, return `{ error: "..." }` with 502 status.
- **Frontend level:** Check for error responses per API. Render
  available data. Show a subtle "data may be outdated" indicator
  on stale responses (check `X-Cache: STALE` header). Show
  "unavailable" placeholder for failed endpoints — never a blank
  screen.
- **Upstream validation:** Only cache 2xx responses. Verify expected
  top-level keys exist before writing to KV.

## Cloudflare Free Tier Budget

### KV Writes (1,000/day limit — tightest constraint)

With two-key SWR pattern (2 writes per cache miss) and mixed TTLs:
- Weather (30 min): 48 misses × 2 = 96 writes
- Planets (60 min): 24 × 2 = 48 writes
- Spacecraft (60 min): 24 × 2 = 48 writes
- Asteroids (60 min): 24 × 2 = 48 writes
- Space weather (30 min): 48 × 2 = 96 writes
- **Total: ~336 writes/day** for a single active user (24h)

Safe for 1-2 concurrent users. If usage grows, extend all TTLs
to 60 min.

### Worker Requests (100,000/day)

Personal dashboard — nowhere near this limit.

### KV Reads (100,000/day)

Not a concern.

### NeoWs API (50 req/day with DEMO_KEY)

60-min TTL = max 24 requests/day. Safe.

## Accessibility

- Semantic HTML throughout (headings, lists, tables, ARIA landmarks)
- Go/No-Go indicator: text labels alongside color (not color-only)
- Cosmic Overview: text-based summary alongside 3D canvas for screen
  readers (`aria-hidden="true"` on canvas)
- Keyboard navigation: view switcher and spacecraft toggles are
  focusable, standard tab order
- `prefers-reduced-motion`: stop animation loop, disable damping
- Focus ring: `outline: 2px solid var(--accent)` on `:focus-visible`
- High contrast: dark theme with sufficient contrast ratios (WCAG AA)

## Implementation Phases

### Phase 1: Project Scaffold + Worker Proxy

Set up the Cloudflare project structure and get data flowing.

- [x] `git init`, `.gitignore`, `package.json` (wrangler dependency)
- [x] `wrangler.toml` with KV binding
- [x] `functions/lib/kv-cache.js` — Shared two-key SWR cache module
- [x] `functions/api/_middleware.js` — CORS + error handling
- [x] `functions/api/weather.js` — Open-Meteo proxy
- [x] `functions/api/asteroids.js` — NeoWs proxy (60-min TTL)
- [x] `functions/api/space-weather.js` — DONKI proxy
- [x] `functions/api/spacecraft.js` — JPL Horizons proxy (batched, ≤6 concurrent)
- [x] `functions/api/planets.js` — JPL Horizons proxy (8 planets)
- [x] `public/index.html` — Minimal landing page with view links
- [x] `public/_headers` — CSP + security headers
- [x] Verify all endpoints with `wrangler pages dev`

**Deliverable:** All API endpoints returning cached data locally.

### Phase 2: Stargazer View

Build the weather/sky conditions view.

- [x] `public/css/style.css` — Design system (palette, typography, panels)
- [x] `public/stargazer/index.html` — Page structure, dark theme
- [x] `public/js/moon.js` — SunCalc moon phase algorithm (UTC-based)
- [x] `public/js/api.js` — Shared fetch helpers with `Promise.allSettled()`
- [x] `public/js/stargazer.js` — Fetch weather, compute Go/No-Go
- [x] Go/No-Go badge (LED dot, glow, text label)
- [x] Weather timeline (horizontal scroll, hourly cards)
- [x] Moon phase display (CSS crescent, illumination %, phase name)
- [x] Visible planets list
- [x] Error states (stale indicator, failed endpoint placeholders)
- [x] Responsive layout (mobile-first for outdoor checks)

**Deliverable:** Fully functional Stargazer page.

### Phase 3: Cosmic Overview

Build the 3D solar system view.

- [x] `public/cosmic/index.html` — Canvas + overlay panels + modulepreload
- [x] `public/js/cosmic.js` — Three.js scene setup
- [x] Scene readiness gate pattern (parallel fetch + scene init)
- [x] Sun, planets with orbit paths (BufferGeometry Lines)
- [x] Log-scale distance mapping (`auToScene()`)
- [x] Spacecraft markers from API data (default 6)
- [x] Asteroid markers from NeoWs data
- [x] CSS2DRenderer labels (`pointer-events: none`)
- [x] OrbitControls (damping, no pan, `DOLLY_ROTATE` for touch)
- [x] On-demand rendering (render only on camera change)
- [x] Click/tap interaction → info panel (drag-vs-click discrimination)
- [x] Spacecraft toggle panel with localStorage persistence
- [x] Space weather overlay (Kp index, flares)
- [x] Loading state
- [x] WebGL fallback (text table)
- [x] Background tab handling (Visibility API)
- [x] `prefers-reduced-motion` handling

**Deliverable:** Fully functional Cosmic Overview page.

### Phase 4: Polish + Deploy

- [x] Landing page (`index.html`) — styled view switcher
- [x] CSS refinement (consistent panel styles, responsive breakpoints)
- [x] Responsive testing (mobile, tablet, desktop)
- [x] Accessibility pass (keyboard nav, focus rings, contrast check)
- [x] Create KV namespace: `wrangler kv namespace create CACHE`
- [x] Deploy: `wrangler pages deploy`
- [x] Verify all endpoints and views in production

**Deliverable:** Live dashboard at `<project>.pages.dev`.

## Simplification Notes

The simplicity reviewer flagged several items as optional for a
personal dashboard. These are noted here for scope management:

- **WebGL fallback** — build it only if you care about phone browsers
  that lack WebGL (rare in 2026). Skip for MVP.
- **Spacecraft toggles** — can start with hardcoded defaults, add
  toggles when you actually want to customize.
- **Hour-by-hour timeline** — could start with tonight's summary
  (worst-case cloud cover, temperature range). Add hourly detail later.
- **Orbit path ellipses** — nice-to-have. Planet dots with labels are
  sufficient for MVP.
- **Aurora alert** — Dornbirn is at 47°N, aurora is rare. A Kp badge
  is sufficient.

**Recommendation:** Ship phases 1-3 with reduced scope, add polish
items only when the core is running.

## Sources & References

### Origin

- **Brainstorm document:** [docs/brainstorms/2026-03-25-space-dashboard-brainstorm.md](docs/brainstorms/2026-03-25-space-dashboard-brainstorm.md)
  — Key decisions: zero-auth APIs, vanilla JS, Three.js, Worker + KV
  cache, NOAA DONKI, dark mode only, hardcoded Dornbirn

### API Documentation

- Open-Meteo: https://open-meteo.com/en/docs
- JPL Horizons: https://ssd-api.jpl.nasa.gov/doc/horizons.html
- NASA NeoWs: https://api.nasa.gov/ (NeoWs section)
- NOAA DONKI: https://ccmc.gsfc.nasa.gov/tools/DONKI/

### Cloudflare

- Pages Functions: https://developers.cloudflare.com/pages/functions/
- Pages Functions routing: https://developers.cloudflare.com/pages/functions/routing/
- Pages Functions middleware: https://developers.cloudflare.com/pages/functions/middleware/
- Pages Functions module support: https://developers.cloudflare.com/pages/functions/module-support/
- KV: https://developers.cloudflare.com/kv/get-started/
- Workers limits: https://developers.cloudflare.com/workers/platform/limits/
- KV limits: https://developers.cloudflare.com/kv/platform/limits/
- Wrangler config for Pages: https://developers.cloudflare.com/pages/functions/wrangler-configuration/

### Three.js

- Fundamentals: https://threejs.org/manual/#en/fundamentals
- CSS2DRenderer: https://threejs.org/docs/pages/CSS2DRenderer.html
- OrbitControls: https://threejs.org/docs/#examples/en/controls/OrbitControls
- Import maps: https://sbcode.net/threejs/importmap/
- Scene optimization: https://discoverthreejs.com/tips-and-tricks/

### Libraries

- SunCalc (moon algorithm reference): https://github.com/mourner/suncalc

### Design References

- Log-scale solar system: https://www.johndcook.com/blog/2018/04/05/solar-system-on-log-scale/
- Three.js solar system examples: https://github.com/sanderblue/solar-system-threejs
