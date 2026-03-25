import { cachedFetch } from '../lib/kv-cache.js';

export async function onRequestGet(context) {
  const today = new Date().toISOString().slice(0, 10);

  const { data, status } = await cachedFetch(
    context.env,
    `asteroids:${today}`,
    3600, // 60 min — DEMO_KEY allows 50 req/day
    async () => {
      const params = new URLSearchParams({
        start_date: today,
        end_date: today,
        api_key: 'DEMO_KEY',
      });

      const res = await fetch(
        `https://api.nasa.gov/neo/rest/v1/feed?${params}`
      );
      if (!res.ok) throw new Error(`NeoWs ${res.status}`);
      const raw = await res.json();

      // Normalize: extract today's objects into a flat list
      const todayObjects = raw.near_earth_objects?.[today] || [];

      return todayObjects
        .map((neo) => ({
          name: neo.name,
          id: neo.id,
          diameterMinKm:
            neo.estimated_diameter?.kilometers?.estimated_diameter_min ?? null,
          diameterMaxKm:
            neo.estimated_diameter?.kilometers?.estimated_diameter_max ?? null,
          isPotentiallyHazardous: neo.is_potentially_hazardous_asteroid,
          closeApproach: neo.close_approach_data?.[0]
            ? {
                date: neo.close_approach_data[0].close_approach_date_full,
                velocityKmS: parseFloat(
                  neo.close_approach_data[0].relative_velocity
                    ?.kilometers_per_second
                ),
                missDistanceKm: parseFloat(
                  neo.close_approach_data[0].miss_distance?.kilometers
                ),
                missDistanceAU: parseFloat(
                  neo.close_approach_data[0].miss_distance?.astronomical
                ),
              }
            : null,
        }))
        .sort(
          (a, b) =>
            (a.closeApproach?.missDistanceKm ?? Infinity) -
            (b.closeApproach?.missDistanceKm ?? Infinity)
        );
    }
  );

  return Response.json(data, {
    headers: { 'X-Cache': status },
  });
}
