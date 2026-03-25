import { fetchAPI, fetchAll, getLocation } from './api.js';
import { getMoonIllumination } from './moon.js';

// --- Observation Window ---

/**
 * Compute the observation window (civil twilight end → astronomical dawn)
 * from sunset/sunrise times. Returns { start, end } as hour indices.
 */
function getObservationWindow(sunriseISO, sunsetISO) {
  const sunset = new Date(sunsetISO);
  const sunrise = new Date(sunriseISO);

  // Civil twilight ends ~30 min after sunset
  const twilightEnd = new Date(sunset.getTime() + 30 * 60000);
  // Astronomical dawn ~90 min before sunrise
  const astDawn = new Date(sunrise.getTime() - 90 * 60000);

  return {
    start: twilightEnd,
    end: astDawn,
  };
}

/**
 * Filter hourly weather data to the observation window.
 * Returns array of { time, cloudCover, precip, temp, visibility, ... }
 */
function getWindowHours(weather) {
  const times = weather.hourly.time;
  const today = new Date();
  const todayIdx = today.getDate() === new Date(times[0]).getDate() ? 0 : 1;

  // Use today's sunset and tomorrow's sunrise (or today/tomorrow from daily)
  const sunset = weather.daily.sunset[todayIdx] || weather.daily.sunset[0];
  const sunrise = weather.daily.sunrise[todayIdx + 1] || weather.daily.sunrise[1] || weather.daily.sunrise[0];

  const window = getObservationWindow(sunrise, sunset);
  const hours = [];

  for (let i = 0; i < times.length; i++) {
    const t = new Date(times[i]);
    if (t >= window.start && t <= window.end) {
      hours.push({
        time: t,
        hour: t.getHours(),
        cloudCover: weather.hourly.cloud_cover[i],
        cloudCoverLow: weather.hourly.cloud_cover_low[i],
        cloudCoverMid: weather.hourly.cloud_cover_mid[i],
        cloudCoverHigh: weather.hourly.cloud_cover_high[i],
        precip: weather.hourly.precipitation_probability[i],
        temp: weather.hourly.temperature[i],
        visibility: weather.hourly.visibility[i],
      });
    }
  }

  return hours;
}

// --- Go/No-Go Logic ---

function computeGoNoGo(windowHours, moonIllumination) {
  if (!windowHours.length) {
    return { status: 'nogo', reason: 'No observation window data' };
  }

  // Worst hour in window (conservative)
  const worstCloud = Math.max(...windowHours.map(h => h.cloudCover));
  const worstPrecip = Math.max(...windowHours.map(h => h.precip));
  const moonPct = moonIllumination * 100;

  if (worstCloud < 15 && moonPct < 20 && worstPrecip < 10) {
    return { status: 'go', reason: 'Dark Skies Tonight' };
  }
  if (worstCloud < 40 && moonPct < 50 && worstPrecip < 30) {
    return { status: 'maybe', reason: 'Partial Conditions' };
  }
  return { status: 'nogo', reason: 'Poor Conditions' };
}

// --- Rendering ---

function renderGoNoGo(result, stale) {
  const container = document.getElementById('go-nogo');
  const labels = { go: 'GO', maybe: 'MAYBE', nogo: 'NO-GO' };

  container.innerHTML = `
    <div class="go-nogo-badge" data-status="${result.status}">
      ${labels[result.status]}
    </div>
    <div class="go-nogo-subtitle">
      ${result.reason}
      ${stale ? '<span class="stale-indicator">stale data</span>' : ''}
    </div>
  `;
}

function renderTimeline(windowHours) {
  const container = document.getElementById('timeline');

  if (!windowHours.length) {
    container.innerHTML = '<div class="error-placeholder">No observation window tonight</div>';
    return;
  }

  container.innerHTML = windowHours.map(h => {
    const cloudClass = h.cloudCover < 15 ? 'good' : h.cloudCover < 40 ? 'ok' : 'bad';
    const timeStr = `${String(h.hour).padStart(2, '0')}:00`;

    return `
      <div class="hour-card">
        <div class="hour-time">${timeStr}</div>
        <div class="hour-value hour-value--${cloudClass}">${h.cloudCover}%</div>
        <div class="hour-label">clouds</div>
        <div class="hour-value" style="font-size:0.8125rem; margin-top:0.375rem">${h.precip}%</div>
        <div class="hour-label">precip</div>
        <div class="hour-label" style="margin-top:0.375rem">${h.temp}°C</div>
      </div>
    `;
  }).join('');
}

function renderMoon(moonData) {
  const container = document.getElementById('moon-display');
  const pct = Math.round(moonData.illumination * 100);

  // CSS crescent: shift the overlay circle based on phase
  // phase 0 = new (fully covered), 0.5 = full (fully exposed)
  const offset = (moonData.phase < 0.5)
    ? -24 + moonData.phase * 96   // waxing: -24 to +24
    : 24 - (moonData.phase - 0.5) * 96; // waning: +24 to -24

  container.innerHTML = `
    <div class="moon-icon" aria-hidden="true">
      <div style="
        position: absolute; top: -1px;
        width: 48px; height: 50px;
        border-radius: 50%;
        background: var(--bg-surface);
        left: ${offset}px;
      "></div>
    </div>
    <div class="moon-info">
      <div class="moon-phase-name">${moonData.phaseName}</div>
      <div class="moon-detail">${pct}% illuminated</div>
    </div>
  `;
}

function renderPlanets(planets) {
  const container = document.getElementById('planets');

  if (!planets || !planets.length) {
    container.innerHTML = '<div class="error-placeholder">No planet data available</div>';
    return;
  }

  // Show planets with their distance from Sun
  // (Full topocentric visibility would need a separate Horizons query)
  const visible = planets.filter(p => p.name !== 'Earth' && p.position);

  if (!visible.length) {
    container.innerHTML = '<div class="error-placeholder">No planets resolved</div>';
    return;
  }

  container.innerHTML = `
    <ul class="planet-list">
      ${visible.map(p => {
        const dist = Math.sqrt(p.position.x ** 2 + p.position.y ** 2 + p.position.z ** 2);
        return `
          <li class="planet-item">
            <span class="planet-name">${p.name}</span>
            <span class="planet-direction">${dist.toFixed(2)} AU</span>
          </li>
        `;
      }).join('')}
    </ul>
  `;
}

function renderError(elementId, message) {
  const el = document.getElementById(elementId);
  if (el) {
    el.innerHTML = `<div class="error-placeholder">${message}</div>`;
  }
}

// --- Main ---

async function init() {
  // Moon phase — computed client-side, instant
  const moon = getMoonIllumination(new Date());
  renderMoon(moon);

  // Get browser location (falls back to null → Worker uses Dornbirn default)
  const loc = await getLocation();
  const locationEl = document.querySelector('.location');
  if (loc) {
    locationEl.textContent = `${loc.lat.toFixed(1)}°N ${Math.abs(loc.lon).toFixed(1)}°${loc.lon >= 0 ? 'E' : 'W'}`;
  }

  // Build weather endpoint with location params
  const weatherEp = loc ? `weather?lat=${loc.lat}&lon=${loc.lon}` : 'weather';

  // Fetch weather and planets in parallel
  const [weatherResult, planetsResult] = await Promise.allSettled([
    fetchAPI(weatherEp),
    fetchAPI('planets'),
  ]);

  // Weather + Go/No-Go
  if (weatherResult.status === 'fulfilled') {
    const { data, stale } = weatherResult.value;
    const windowHours = getWindowHours(data);
    const goNoGo = computeGoNoGo(windowHours, moon.illumination);
    renderGoNoGo(goNoGo, stale);
    renderTimeline(windowHours);
  } else {
    renderError('go-nogo', `Weather unavailable: ${weatherResult.reason?.message}`);
    renderError('timeline', 'Weather data unavailable');
  }

  // Planets
  if (planetsResult.status === 'fulfilled') {
    renderPlanets(planetsResult.value.data);
  } else {
    renderError('planets', `Planets unavailable: ${planetsResult.reason?.message}`);
  }
}

init();
