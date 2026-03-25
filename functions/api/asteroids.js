import { cachedFetch } from '../lib/kv-cache.js';

export async function onRequestGet(context) {
  const today = new Date().toISOString().slice(0, 10);

  const { data, status } = await cachedFetch(
    context.env,
    `asteroids:${today}`,
    3600, // 60 min
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

      const todayObjects = raw.near_earth_objects?.[today] || [];

      // Sort by miss distance, take top 5 for detail lookups
      const sorted = todayObjects
        .filter(n => n.close_approach_data?.[0])
        .sort((a, b) =>
          parseFloat(a.close_approach_data[0].miss_distance?.kilometers || Infinity) -
          parseFloat(b.close_approach_data[0].miss_distance?.kilometers || Infinity)
        )
        .slice(0, 5);

      // Fetch individual NEO details for orbital elements (sequential, 5 calls)
      const results = [];
      for (const neo of sorted) {
        const base = {
          name: neo.name,
          id: neo.id,
          diameterMinKm:
            neo.estimated_diameter?.kilometers?.estimated_diameter_min ?? null,
          diameterMaxKm:
            neo.estimated_diameter?.kilometers?.estimated_diameter_max ?? null,
          isPotentiallyHazardous: neo.is_potentially_hazardous_asteroid,
          closeApproach: {
            date: neo.close_approach_data[0].close_approach_date_full,
            velocityKmS: parseFloat(
              neo.close_approach_data[0].relative_velocity?.kilometers_per_second
            ),
            missDistanceKm: parseFloat(
              neo.close_approach_data[0].miss_distance?.kilometers
            ),
            missDistanceAU: parseFloat(
              neo.close_approach_data[0].miss_distance?.astronomical
            ),
          },
          orbit: null,
        };

        try {
          const detailRes = await fetch(
            `https://api.nasa.gov/neo/rest/v1/neo/${neo.id}?api_key=DEMO_KEY`
          );
          if (detailRes.ok) {
            const detail = await detailRes.json();
            const od = detail.orbital_data;
            if (od?.semi_major_axis) {
              base.orbit = {
                a: parseFloat(od.semi_major_axis),
                e: parseFloat(od.eccentricity),
                I: parseFloat(od.inclination),
                O: parseFloat(od.ascending_node_longitude),
                w: parseFloat(od.perihelion_argument),
                M: parseFloat(od.mean_anomaly),
                period: parseFloat(od.orbital_period),
                epoch: parseFloat(od.epoch_osculation),
              };
            }
          }
        } catch {
          // Detail fetch failed — proceed without orbital data
        }

        results.push(base);
      }

      return results;
    }
  );

  return Response.json(data, {
    headers: { 'X-Cache': status },
  });
}
