/**
 * Moon phase calculation — adapted from SunCalc by Vladimir Agafonkin.
 * BSD-2-Clause license. ~50 lines, no dependencies.
 *
 * All calculations use UTC to avoid timezone-related date shifts.
 */

const RAD = Math.PI / 180;
const DAY_MS = 86400000;
const J1970 = 2440588;
const J2000 = 2451545;

function toJulian(date) {
  return date.valueOf() / DAY_MS - 0.5 + J1970;
}

function toDays(date) {
  return toJulian(date) - J2000;
}

function sunCoords(d) {
  const M = RAD * (357.5291 + 0.98560028 * d); // solar mean anomaly
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + RAD * 282.9372 + Math.PI; // ecliptic longitude
  return { l: L };
}

function moonCoords(d) {
  const L = RAD * (218.316 + 13.176396 * d);
  const M = RAD * (134.963 + 13.064993 * d);
  const F = RAD * (93.272 + 13.229350 * d);

  const l = L + RAD * 6.289 * Math.sin(M);   // longitude
  const b = RAD * 5.128 * Math.sin(F);        // latitude
  const dt = 385001 - 20905 * Math.cos(M);    // distance in km

  return {
    ra: Math.atan2(Math.sin(l) * Math.cos(RAD * 23.4397) - Math.tan(b) * Math.sin(RAD * 23.4397), Math.cos(l)),
    dec: Math.asin(Math.sin(b) * Math.cos(RAD * 23.4397) + Math.cos(b) * Math.sin(RAD * 23.4397) * Math.sin(l)),
    dist: dt,
  };
}

/**
 * Get moon illumination data for a given date.
 * @param {Date} date
 * @returns {{ illumination: number, phase: number, phaseName: string }}
 */
export function getMoonIllumination(date) {
  const d = toDays(date || new Date());
  const s = sunCoords(d);
  const m = moonCoords(d);

  const phi = Math.acos(
    Math.sin(s.l) * Math.sin(m.dec) +
    Math.cos(s.l) * Math.cos(m.dec) * Math.cos(m.ra - s.l)
  );
  const inc = Math.atan2(
    149598000 * Math.sin(phi), // Sun-Earth distance in km (approx)
    m.dist - 149598000 * Math.cos(phi)
  );

  // Illumination fraction: 0 = new moon, 1 = full moon
  const illumination = (1 + Math.cos(inc)) / 2;

  // Phase: 0=new, 0.25=first quarter, 0.5=full, 0.75=last quarter
  const angle = Math.atan2(
    Math.cos(s.l) * Math.sin(m.ra - s.l),
    Math.sin(s.l) * Math.cos(m.dec) - Math.cos(s.l) * Math.sin(m.dec) * Math.cos(m.ra - s.l)
  );
  const phase = 0.5 + 0.5 * inc * (angle < 0 ? -1 : 1) / Math.PI;

  return {
    illumination: Math.round(illumination * 1000) / 1000,
    phase: Math.round(phase * 1000) / 1000,
    phaseName: getPhaseName(phase),
  };
}

function getPhaseName(phase) {
  if (phase < 0.0625) return 'New Moon';
  if (phase < 0.1875) return 'Waxing Crescent';
  if (phase < 0.3125) return 'First Quarter';
  if (phase < 0.4375) return 'Waxing Gibbous';
  if (phase < 0.5625) return 'Full Moon';
  if (phase < 0.6875) return 'Waning Gibbous';
  if (phase < 0.8125) return 'Last Quarter';
  if (phase < 0.9375) return 'Waning Crescent';
  return 'New Moon';
}
