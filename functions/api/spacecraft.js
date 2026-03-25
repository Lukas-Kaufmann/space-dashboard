import { cachedFetch } from '../lib/kv-cache.js';

// NAIF IDs for spacecraft tracked by JPL Horizons
const SPACECRAFT = [
  { id: '-170', name: 'JWST', defaultOn: true, fallbackAU: 1.01 },
  { id: '-31', name: 'Voyager 1', defaultOn: true, fallbackAU: 163 },
  { id: '-32', name: 'Voyager 2', defaultOn: true, fallbackAU: 137 },
  { id: '-98', name: 'New Horizons', defaultOn: true, fallbackAU: 60 },
  { id: '-96', name: 'Parker Solar Probe', defaultOn: true, fallbackAU: 0.2 },
  { id: '-61', name: 'Juno', defaultOn: true, fallbackAU: 5.2 },
  { id: '-76', name: 'Curiosity', defaultOn: false, fallbackAU: 1.52 },
  { id: '-168', name: 'Perseverance', defaultOn: false, fallbackAU: 1.52 },
  { id: '-121', name: 'BepiColombo', defaultOn: false, fallbackAU: 0.39 },
  { id: '-49', name: 'Lucy', defaultOn: false, fallbackAU: 3.5 },
];

async function fetchHorizons(command, startDate, stopDate) {
  const qs = [
    `format=json`,
    `COMMAND=%27${command}%27`,
    `EPHEM_TYPE=VECTORS`,
    `CENTER=%27500%4010%27`,
    `START_TIME=%27${startDate}%27`,
    `STOP_TIME=%27${stopDate}%27`,
    `STEP_SIZE=%271%20d%27`,
  ].join('&');

  const res = await fetch(`https://ssd.jpl.nasa.gov/api/horizons.api?${qs}`);
  if (!res.ok) throw new Error(`Horizons ${res.status}`);
  return res.json();
}

function parseVectors(horizonsData) {
  const result = horizonsData.result || '';
  const soeIdx = result.indexOf('$$SOE');
  const eoeIdx = result.indexOf('$$EOE');
  if (soeIdx === -1 || eoeIdx === -1) return null;

  const dataBlock = result.slice(soeIdx + 5, eoeIdx);
  const xMatch = dataBlock.match(/X\s*=\s*([+-]?\d+\.\d+E[+-]?\d+)/);
  const yMatch = dataBlock.match(/Y\s*=\s*([+-]?\d+\.\d+E[+-]?\d+)/);
  const zMatch = dataBlock.match(/Z\s*=\s*([+-]?\d+\.\d+E[+-]?\d+)/);

  if (!xMatch || !yMatch || !zMatch) return null;

  const KM_PER_AU = 149597870.7;
  return {
    x: parseFloat(xMatch[1]) / KM_PER_AU,
    y: parseFloat(yMatch[1]) / KM_PER_AU,
    z: parseFloat(zMatch[1]) / KM_PER_AU,
  };
}

// Generate a pseudo-random but deterministic position at a given distance
function fallbackPosition(name, distAU) {
  // Simple hash of name for consistent angle
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  }
  const angle = (Math.abs(hash) % 360) * (Math.PI / 180);
  const tilt = ((Math.abs(hash >> 8) % 30) - 15) * (Math.PI / 180);
  return {
    x: distAU * Math.cos(angle) * Math.cos(tilt),
    y: distAU * Math.sin(angle) * Math.cos(tilt),
    z: distAU * Math.sin(tilt),
  };
}

export async function onRequestGet(context) {
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  const { data, status } = await cachedFetch(
    context.env,
    `spacecraft:${today}`,
    3600,
    async () => {
      const results = [];
      // Fetch sequentially to avoid connection limits
      for (const craft of SPACECRAFT) {
        let pos = null;
        try {
          const raw = await fetchHorizons(craft.id, today, tomorrow);
          pos = parseVectors(raw);
        } catch {
          // Horizons fetch failed (common in local dev) — use fallback
          pos = fallbackPosition(craft.name, craft.fallbackAU);
        }
        results.push({
          name: craft.name,
          id: craft.id,
          defaultOn: craft.defaultOn,
          position: pos,
          distanceFromSunAU: pos
            ? Math.sqrt(pos.x ** 2 + pos.y ** 2 + pos.z ** 2)
            : craft.fallbackAU,
          approximate: pos === null ? false : true,
        });
      }
      return results;
    }
  );

  return Response.json(data, {
    headers: { 'X-Cache': status },
  });
}
