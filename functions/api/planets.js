import { cachedFetch } from '../lib/kv-cache.js';

// Planet barycenter IDs for JPL Horizons
const PLANETS = [
  { id: '1', name: 'Mercury' },
  { id: '2', name: 'Venus' },
  { id: '3', name: 'Earth' },
  { id: '4', name: 'Mars' },
  { id: '5', name: 'Jupiter' },
  { id: '6', name: 'Saturn' },
  { id: '7', name: 'Uranus' },
  { id: '8', name: 'Neptune' },
];

async function fetchHorizons(command, startDate, stopDate) {
  const params = new URLSearchParams({
    format: 'json',
    COMMAND: `'${command}'`,
    EPHEM_TYPE: 'VECTORS',
    CENTER: "'500@10'", // heliocentric
    START_TIME: `'${startDate}'`,
    STOP_TIME: `'${stopDate}'`,
    STEP_SIZE: "'1 d'",
  });

  const res = await fetch(`https://ssd.jpl.nasa.gov/api/horizons.api?${params}`);
  if (!res.ok) throw new Error(`Horizons ${res.status}`);
  return res.json();
}

// Extract XYZ from Horizons text-based result
function parseVectors(horizonsData) {
  const result = horizonsData.result || '';
  const soeIdx = result.indexOf('$$SOE');
  const eoeIdx = result.indexOf('$$EOE');
  if (soeIdx === -1 || eoeIdx === -1) return null;

  const dataBlock = result.slice(soeIdx + 5, eoeIdx).trim();
  const lines = dataBlock.split('\n').map(l => l.trim()).filter(Boolean);

  // Horizons vector format: lines contain X, Y, Z values (in km)
  // Format varies but typically: X= val Y= val Z= val
  for (const line of lines) {
    const xMatch = line.match(/X\s*=\s*([+-]?\d+\.\d+E[+-]?\d+)/);
    const yMatch = line.match(/Y\s*=\s*([+-]?\d+\.\d+E[+-]?\d+)/);
    const zMatch = line.match(/Z\s*=\s*([+-]?\d+\.\d+E[+-]?\d+)/);
    if (xMatch && yMatch && zMatch) {
      // Convert km to AU (1 AU = 149597870.7 km)
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
    `planets:${today}`,
    3600, // 60 min
    async () => {
      // Fetch all planets in parallel (8 requests, within 6-conn limit with queuing)
      const results = await Promise.allSettled(
        PLANETS.map(async (planet) => {
          const raw = await fetchHorizons(planet.id, today, tomorrow);
          const pos = parseVectors(raw);
          return {
            name: planet.name,
            id: planet.id,
            position: pos, // { x, y, z } in AU, heliocentric
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
