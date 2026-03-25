/**
 * Planet positions computed from Keplerian orbital elements (J2000 epoch).
 * Accurate to ~1° for visualization purposes — no external API needed.
 *
 * Source: NASA JPL approximate positions of planets
 * https://ssd.jpl.nasa.gov/planets/approx_pos.html
 */

const DEG = Math.PI / 180;

// Orbital elements at J2000 and their rates per century
const ELEMENTS = {
  Mercury: { a: 0.38709927, e: 0.20563593, I: 7.00497902, L: 252.25032350, w: 77.45779628, O: 48.33076593, da: 0.00000037, de: 0.00001906, dI: -0.00594749, dL: 149472.67411175, dw: 0.16047689, dO: -0.12534081 },
  Venus:   { a: 0.72333566, e: 0.00677672, I: 3.39467605, L: 181.97909950, w: 131.60246718, O: 76.67984255, da: 0.00000390, de: -0.00004107, dI: -0.00078890, dL: 58517.81538729, dw: 0.00268329, dO: -0.27769418 },
  Earth:   { a: 1.00000261, e: 0.01671123, I: -0.00001531, L: 100.46457166, w: 102.93768193, O: 0.0, da: 0.00000562, de: -0.00004392, dI: -0.01294668, dL: 35999.37244981, dw: 0.32327364, dO: 0.0 },
  Mars:    { a: 1.52371034, e: 0.09339410, I: 1.84969142, L: -4.55343205, w: -23.94362959, O: 49.55953891, da: 0.00001847, de: 0.00007882, dI: -0.00813131, dL: 19140.30268499, dw: 0.44441088, dO: -0.29257343 },
  Jupiter: { a: 5.20288700, e: 0.04838624, I: 1.30439695, L: 34.39644051, w: 14.72847983, O: 100.47390909, da: -0.00011607, de: -0.00013253, dI: -0.00183714, dL: 3034.74612775, dw: 0.21252668, dO: 0.20469106 },
  Saturn:  { a: 9.53667594, e: 0.05386179, I: 2.48599187, L: 49.95424423, w: 92.59887831, O: 113.66242448, da: -0.00125060, de: -0.00050991, dI: 0.00193609, dL: 1222.49362201, dw: -0.41897216, dO: -0.28867794 },
  Uranus:  { a: 19.18916464, e: 0.04725744, I: 0.77263783, L: 313.23810451, w: 170.95427630, O: 74.01692503, da: -0.00196176, de: -0.00004397, dI: -0.00242939, dL: 428.48202785, dw: 0.40805281, dO: 0.04240589 },
  Neptune: { a: 30.06992276, e: 0.00859048, I: 1.77004347, L: -55.12002969, w: 44.96476227, O: 131.78422574, da: 0.00026291, de: 0.00005105, dI: 0.00035372, dL: 218.45945325, dw: -0.32241464, dO: -0.00508664 },
};

function computePosition(name, date) {
  const el = ELEMENTS[name];
  if (!el) return null;

  // Centuries since J2000
  const T = (date.getTime() - Date.UTC(2000, 0, 1, 12, 0, 0)) / (365.25 * 86400000 * 100);

  const a = el.a + el.da * T;
  const e = el.e + el.de * T;
  const I = (el.I + el.dI * T) * DEG;
  const L = (el.L + el.dL * T) * DEG;
  const wp = (el.w + el.dw * T) * DEG;
  const O = (el.O + el.dO * T) * DEG;

  const w = wp - O;
  let M = L - wp;
  M = M % (2 * Math.PI);
  if (M > Math.PI) M -= 2 * Math.PI;
  if (M < -Math.PI) M += 2 * Math.PI;

  // Kepler's equation via Newton's method
  let E = M;
  for (let i = 0; i < 10; i++) {
    const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-10) break;
  }

  // Orbital plane coords
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);

  // Rotate to ecliptic J2000
  const cosO = Math.cos(O), sinO = Math.sin(O);
  const cosI = Math.cos(I), sinI = Math.sin(I);
  const cosw = Math.cos(w), sinw = Math.sin(w);

  const x = (cosO * cosw - sinO * sinw * cosI) * xp + (-cosO * sinw - sinO * cosw * cosI) * yp;
  const y = (sinO * cosw + cosO * sinw * cosI) * xp + (-sinO * sinw + cosO * cosw * cosI) * yp;
  const z = (sinw * sinI) * xp + (cosw * sinI) * yp;

  return { x, y, z };
}

export async function onRequestGet() {
  const now = new Date();

  const planets = Object.keys(ELEMENTS).map(name => ({
    name,
    id: name.toLowerCase(),
    position: computePosition(name, now),
  }));

  return Response.json(planets, {
    headers: { 'Content-Type': 'application/json' },
  });
}
