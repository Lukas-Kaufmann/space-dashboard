import { cachedFetch } from '../lib/kv-cache.js';

const LAT = 47.4125;
const LON = 9.7417;

export async function onRequestGet(context) {
  const today = new Date().toISOString().slice(0, 10);

  const { data, status } = await cachedFetch(
    context.env,
    `weather:${today}`,
    1800, // 30 min
    async () => {
      const params = new URLSearchParams({
        latitude: LAT,
        longitude: LON,
        hourly: [
          'cloud_cover', 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high',
          'visibility', 'precipitation_probability', 'temperature_2m', 'weather_code',
        ].join(','),
        daily: 'sunrise,sunset',
        timezone: 'Europe/Vienna',
        forecast_days: '2',
      });

      const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
      if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
      const raw = await res.json();

      // Normalize to stable schema
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
        location: { latitude: LAT, longitude: LON },
      };
    }
  );

  return Response.json(data, {
    headers: { 'X-Cache': status },
  });
}
