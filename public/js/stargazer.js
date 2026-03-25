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

// --- Meteor Showers ---
// Annual calendar of major showers (IMO data, recurs yearly)
// Dates are month-day only; year is applied at runtime.
const SHOWERS = [
  { name: 'Quadrantids',     peak: [1, 4],   start: [1, 1],   end: [1, 6],   zhr: 120, velocity: 41, parent: '2003 EH1' },
  { name: 'Lyrids',          peak: [4, 22],  start: [4, 14],  end: [4, 30],  zhr: 18,  velocity: 49, parent: 'C/1861 G1 (Thatcher)' },
  { name: 'η Aquariids',     peak: [5, 6],   start: [4, 19],  end: [5, 28],  zhr: 50,  velocity: 66, parent: '1P/Halley' },
  { name: 'δ Aquariids',     peak: [7, 30],  start: [7, 12],  end: [8, 23],  zhr: 25,  velocity: 41, parent: '96P/Machholz' },
  { name: 'Perseids',        peak: [8, 12],  start: [7, 17],  end: [8, 24],  zhr: 100, velocity: 59, parent: '109P/Swift-Tuttle' },
  { name: 'Draconids',       peak: [10, 8],  start: [10, 6],  end: [10, 10], zhr: 10,  velocity: 20, parent: '21P/Giacobini-Zinner' },
  { name: 'Orionids',        peak: [10, 21], start: [10, 2],  end: [11, 7],  zhr: 20,  velocity: 66, parent: '1P/Halley' },
  { name: 'Taurids South',   peak: [10, 10], start: [9, 10],  end: [11, 20], zhr: 5,   velocity: 27, parent: '2P/Encke' },
  { name: 'Taurids North',   peak: [11, 12], start: [10, 20], end: [12, 10], zhr: 5,   velocity: 29, parent: '2P/Encke' },
  { name: 'Leonids',         peak: [11, 17], start: [11, 6],  end: [11, 30], zhr: 15,  velocity: 71, parent: '55P/Tempel-Tuttle' },
  { name: 'Geminids',        peak: [12, 14], start: [12, 4],  end: [12, 20], zhr: 150, velocity: 35, parent: '3200 Phaethon' },
  { name: 'Ursids',          peak: [12, 22], start: [12, 17], end: [12, 26], zhr: 10,  velocity: 33, parent: '8P/Tuttle' },
];

function getMeteorShowers(date) {
  const year = date.getFullYear();
  const now = date.getTime();

  return SHOWERS.map(s => {
    const peakDate = new Date(year, s.peak[0] - 1, s.peak[1]);
    const startDate = new Date(year, s.start[0] - 1, s.start[1]);
    const endDate = new Date(year, s.end[0] - 1, s.end[1], 23, 59);

    const isActive = now >= startDate.getTime() && now <= endDate.getTime();
    const daysUntilPeak = Math.round((peakDate.getTime() - now) / 86400000);

    return { ...s, peakDate, startDate, endDate, isActive, daysUntilPeak };
  })
    .filter(s => s.isActive || (s.daysUntilPeak > 0 && s.daysUntilPeak <= 30))
    .sort((a, b) => a.daysUntilPeak - b.daysUntilPeak);
}

function renderMeteorShowers(showers) {
  const container = document.getElementById('meteors');
  if (!showers.length) {
    container.innerHTML = '<div class="error-placeholder">No active or upcoming showers</div>';
    return;
  }

  container.innerHTML = `
    <ul class="planet-list">
      ${showers.map(s => {
        const peakStr = s.peakDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        let badge = '';
        if (s.isActive && Math.abs(s.daysUntilPeak) <= 1) {
          badge = '<span style="color:var(--go);font-weight:600;font-size:0.6875rem;"> PEAK</span>';
        } else if (s.isActive) {
          badge = '<span style="color:var(--maybe);font-size:0.6875rem;"> active</span>';
        } else {
          badge = `<span style="color:var(--text-muted);font-size:0.6875rem;"> in ${s.daysUntilPeak}d</span>`;
        }

        return `
          <li class="planet-item">
            <span>
              <span class="planet-name">${s.name}</span>${badge}
            </span>
            <span class="planet-direction" title="Peak: ${peakStr}, ${s.velocity} km/s, parent: ${s.parent}">
              ZHR ${s.zhr} · ${peakStr}
            </span>
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

  // Meteor showers — computed client-side from annual calendar
  renderMeteorShowers(getMeteorShowers(new Date()));
}

init();
