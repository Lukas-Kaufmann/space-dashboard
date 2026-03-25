import { cachedFetch } from '../lib/kv-cache.js';

const DEFAULT_LAT = 47.4;
const DEFAULT_LON = 9.7;

// Round to 1 decimal (~11km) for cache grouping
function roundCoord(v) {
  return Math.round(parseFloat(v) * 10) / 10;
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const lat = roundCoord(url.searchParams.get('lat') ?? DEFAULT_LAT);
  const lon = roundCoord(url.searchParams.get('lon') ?? DEFAULT_LON);

  // Validate ranges
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180 || isNaN(lat) || isNaN(lon)) {
    return Response.json({ error: 'Invalid coordinates' }, { status: 400 });
  }

  const today = new Date().toISOString().slice(0, 10);

  const { data, status } = await cachedFetch(
    context.env,
    `weather:${lat}:${lon}:${today}`,
    1800, // 30 min
    async () => {
      const params = new URLSearchParams({
        latitude: lat,
        longitude: lon,
        hourly: [
          'cloud_cover', 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high',
          'visibility', 'precipitation_probability', 'temperature_2m', 'weather_code',
        ].join(','),
        daily: 'sunrise,sunset',
        timezone: 'auto',
        forecast_days: '2',
      });

      const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
      if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
      const raw = await res.json();

      return {
        hourly: {
          time: raw.hourly.time,
          cloud_cover: raw.hourly.cloud_cover,
          cloud_cover_low: raw.hourly.cloud_cover_low,
          cloud_cover_mid: raw.hourly.cloud_cover_mid,
          cloud_cover_high: raw.hourly.cloud_cover_high,
          visibility: raw.hourly.visibility,
          precipitation_probability: raw.hourly.precipitation_probability,
          temperature: raw.hourly.temperature_2m,
          weather_code: raw.hourly.weather_code,
        },
        daily: {
          sunrise: raw.daily.sunrise,
          sunset: raw.daily.sunset,
        },
        location: { latitude: lat, longitude: lon },
      };
    }
  );

  return Response.json(data, {
    headers: { 'X-Cache': status },
  });
}
