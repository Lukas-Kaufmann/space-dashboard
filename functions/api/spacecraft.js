import { cachedFetch } from '../lib/kv-cache.js';

// NAIF IDs for spacecraft tracked by JPL Horizons
const SPACECRAFT = [
  { id: '-170', name: 'JWST', defaultOn: true },
  { id: '-31', name: 'Voyager 1', defaultOn: true },
  { id: '-32', name: 'Voyager 2', defaultOn: true },
  { id: '-98', name: 'New Horizons', defaultOn: true },
  { id: '-96', name: 'Parker Solar Probe', defaultOn: true },
  { id: '-61', name: 'Juno', defaultOn: true },
  { id: '-76', name: 'Curiosity', defaultOn: false },
  { id: '-168', name: 'Perseverance', defaultOn: false },
  { id: '-121', name: 'BepiColombo', defaultOn: false },
  { id: '-49', name: 'Lucy', defaultOn: false },
];

async function fetchHorizons(command, startDate, stopDate) {
  const params = new URLSearchParams({
    format: 'json',
    COMMAND: `'${command}'`,
    EPHEM_TYPE: 'VECTORS',
    CENTER: "'500@10'",
    START_TIME: `'${startDate}'`,
    STOP_TIME: `'${stopDate}'`,
    STEP_SIZE: "'1 d'",
  });

  const res = await fetch(`https://ssd.jpl.nasa.gov/api/horizons.api?${params}`);
  if (!res.ok) throw new Error(`Horizons ${res.status}`);
  return res.json();
}

function parseVectors(horizonsData) {
  const result = horizonsData.result || '';
  const soeIdx = result.indexOf('$$SOE');
  const eoeIdx = result.indexOf('$$EOE');
  if (soeIdx === -1 || eoeIdx === -1) return null;

  const dataBlock = result.slice(soeIdx + 5, eoeIdx).trim();
  const lines = dataBlock.split('\n').map(l => l.trim()).filter(Boolean);

  for (const line of lines) {
    const xMatch = line.match(/X\s*=\s*([+-]?\d+\.\d+E[+-]?\d+)/);
    const yMatch = line.match(/Y\s*=\s*([+-]?\d+\.\d+E[+-]?\d+)/);
    const zMatch = line.match(/Z\s*=\s*([+-]?\d+\.\d+E[+-]?\d+)/);
    if (xMatch && yMatch && zMatch) {
      const AU = 149597870.7;
      return {
        x: parseFloat(xMatch[1]) / AU,
        y: parseFloat(yMatch[1]) / AU,
        z: parseFloat(zMatch[1]) / AU,
      };
    }
  }
  return null;
}

export async function onRequestGet(context) {
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  const { data, status } = await cachedFetch(
    context.env,
    `spacecraft:${today}`,
    3600, // 60 min
    async () => {
      // Fetch all spacecraft in parallel
      // Workers free tier: 6 simultaneous connections, extras queue
      const results = await Promise.allSettled(
        SPACECRAFT.map(async (craft) => {
          const raw = await fetchHorizons(craft.id, today, tomorrow);
          const pos = parseVectors(raw);

          // Compute distance from Earth (Earth is planet 3)
          let distanceFromEarthAU = null;
          if (pos) {
            // We'd need Earth's position too — approximate from known ~1 AU
            // More accurate: compare with Earth's vector from /api/planets
            const dx = pos.x - 0; // rough: Earth at ~1 AU on X
            const dy = pos.y;
            const dz = pos.z;
            distanceFromEarthAU = Math.sqrt(dx * dx + dy * dy + dz * dz);
          }

          return {
            name: craft.name,
            id: craft.id,
            defaultOn: craft.defaultOn,
            position: pos,
            distanceFromSunAU: pos
              ? Math.sqrt(pos.x ** 2 + pos.y ** 2 + pos.z ** 2)
              : null,
          };
        })
      );

      return results
        .filter(r => r.status === 'fulfilled')
        .map(r => r.value);
    }
  );

  return Response.json(data, {
    headers: { 'X-Cache': status },
  });
}
