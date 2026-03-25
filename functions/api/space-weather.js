import { cachedFetch } from '../lib/kv-cache.js';

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

export async function onRequestGet(context) {
  const today = new Date();
  const weekAgo = new Date(today.getTime() - 7 * 86400000);

  const { data, status } = await cachedFetch(
    context.env,
    `space-weather:${formatDate(today)}`,
    1800, // 30 min
    async () => {
      const dateRange = `startDate=${formatDate(weekAgo)}&endDate=${formatDate(today)}`;
      const baseUrl = 'https://kauai.ccmc.gsfc.nasa.gov/DONKI/WS/get';

      // Fetch geomagnetic storms and solar flares in parallel
      const [gstRes, flrRes] = await Promise.allSettled([
        fetch(`${baseUrl}/GST?${dateRange}`),
        fetch(`${baseUrl}/FLR?${dateRange}`),
      ]);

      // Parse geomagnetic storms for Kp index
      let kpIndex = null;
      let kpTime = null;
      if (gstRes.status === 'fulfilled' && gstRes.value.ok) {
        const storms = await gstRes.value.json();
        // Find the most recent Kp reading
        for (const storm of storms.reverse()) {
          if (storm.allKpIndex?.length) {
            const latest = storm.allKpIndex[storm.allKpIndex.length - 1];
            kpIndex = latest.kpIndex;
            kpTime = latest.observedTime;
            break;
          }
        }
      }

      // Parse solar flares
      let flares = [];
      if (flrRes.status === 'fulfilled' && flrRes.value.ok) {
        const rawFlares = await flrRes.value.json();
        flares = rawFlares
          .slice(-10) // last 10 events
          .map((f) => ({
            flrID: f.flrID,
            classType: f.classType,
            beginTime: f.beginTime,
            peakTime: f.peakTime,
            sourceLocation: f.sourceLocation,
          }))
          .reverse(); // most recent first
      }

      return {
        kp: {
          index: kpIndex,
          observedTime: kpTime,
          level:
            kpIndex === null
              ? 'unknown'
              : kpIndex <= 3
                ? 'low'
                : kpIndex <= 5
                  ? 'mid'
                  : 'high',
        },
        flares,
        fetchedAt: today.toISOString(),
      };
    }
  );

  return Response.json(data, {
    headers: { 'X-Cache': status },
  });
}
