import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { fetchAll } from './api.js';

// === Constants ===

const SCENE_RADIUS = 100;
const DEG = Math.PI / 180;

const PLANET_DATA = {
  Mercury:  { color: 0x9e9e9e, size: 0.4 },
  Venus:    { color: 0xe8cda0, size: 0.6 },
  Earth:    { color: 0x4a90d9, size: 0.65 },
  Mars:     { color: 0xc1440e, size: 0.5 },
  Jupiter:  { color: 0xc88b3a, size: 1.2 },
  Saturn:   { color: 0xead6a6, size: 1.0 },
  Uranus:   { color: 0x73c2d9, size: 0.8 },
  Neptune:  { color: 0x3f54ba, size: 0.8 },
};

// Keplerian elements (J2000) for planet trajectory computation
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

const ORBITAL_PERIODS = {
  Mercury: 88, Venus: 225, Earth: 365, Mars: 687,
  Jupiter: 4333, Saturn: 10759, Uranus: 30687, Neptune: 60190,
};

// === Scale Functions ===

let useLogScale = true;

function auToScene(au) {
  if (useLogScale) {
    const logMin = Math.log10(0.2);
    const logMax = Math.log10(250);
    const t = (Math.log10(Math.max(au, 0.2)) - logMin) / (logMax - logMin);
    return t * SCENE_RADIUS;
  }
  // Linear: 1 AU = 3 scene units, capped at SCENE_RADIUS
  return Math.min(au * 3, SCENE_RADIUS);
}

function posToScene(pos) {
  if (!pos) return null;
  const dist = Math.sqrt(pos.x ** 2 + pos.y ** 2 + pos.z ** 2);
  if (dist < 0.001) return new THREE.Vector3(0, 0, 0);
  const scale = auToScene(dist) / dist;
  return new THREE.Vector3(pos.x * scale, pos.z * scale, -pos.y * scale);
}

// === Keplerian Computation ===

function computeKeplerianPosition(name, date) {
  const el = ELEMENTS[name];
  if (!el) return null;
  const T = (date.getTime() - Date.UTC(2000, 0, 1, 12, 0, 0)) / (365.25 * 86400000 * 100);
  const a = el.a + el.da * T;
  const e = el.e + el.de * T;
  const I = (el.I + el.dI * T) * DEG;
  const L = (el.L + el.dL * T) * DEG;
  const wp = (el.w + el.dw * T) * DEG;
  const O = (el.O + el.dO * T) * DEG;
  const w = wp - O;
  let M = L - wp;
  M = ((M % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
  let E = M;
  for (let i = 0; i < 10; i++) {
    const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-10) break;
  }
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cosO = Math.cos(O), sinO = Math.sin(O);
  const cosI = Math.cos(I), sinI = Math.sin(I);
  const cosw = Math.cos(w), sinw = Math.sin(w);
  return {
    x: (cosO * cosw - sinO * sinw * cosI) * xp + (-cosO * sinw - sinO * cosw * cosI) * yp,
    y: (sinO * cosw + cosO * sinw * cosI) * xp + (-sinO * sinw + cosO * cosw * cosI) * yp,
    z: (sinw * sinI) * xp + (cosw * sinI) * yp,
  };
}

// Compute position from NeoWs-style orbital elements
// (epoch-based, not century-rate-based like planets)
function computeNeoPosition(orbit, date) {
  const { a, e, I: Ideg, O: Odeg, w: wdeg, M: M0deg, period, epoch } = orbit;
  // Days since epoch (Julian date)
  const jd = date.getTime() / 86400000 + 2440587.5;
  const daysSinceEpoch = jd - epoch;
  // Mean motion (deg/day)
  const n = 360 / period;
  // Current mean anomaly
  let M = (M0deg + n * daysSinceEpoch) * DEG;
  M = ((M % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
  // Kepler's equation
  let E = M;
  for (let i = 0; i < 10; i++) {
    const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-10) break;
  }
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const I = Ideg * DEG, O = Odeg * DEG, w = wdeg * DEG;
  const cosO = Math.cos(O), sinO = Math.sin(O);
  const cosI = Math.cos(I), sinI = Math.sin(I);
  const cosw = Math.cos(w), sinw = Math.sin(w);
  return {
    x: (cosO * cosw - sinO * sinw * cosI) * xp + (-cosO * sinw - sinO * cosw * cosI) * yp,
    y: (sinO * cosw + cosO * sinw * cosI) * xp + (-sinO * sinw + cosO * cosw * cosI) * yp,
    z: (sinw * sinI) * xp + (cosw * sinI) * yp,
  };
}

// === Trajectory Lines ===

function computePlanetTrajectory(name, steps = 128) {
  const period = ORBITAL_PERIODS[name];
  if (!period) return [];
  const now = Date.now();
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const date = new Date(now + (i / steps) * period * 86400000);
    const pos = computeKeplerianPosition(name, date);
    const sp = posToScene(pos);
    if (sp) points.push(sp);
  }
  return points;
}

function computeNeoTrajectory(orbit, steps = 128) {
  if (!orbit) return [];
  const now = Date.now();
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const date = new Date(now + (i / steps) * orbit.period * 86400000);
    const pos = computeNeoPosition(orbit, date);
    const sp = posToScene(pos);
    if (sp) points.push(sp);
  }
  return points;
}

function createTrajectoryLine(points, color, opacity = 0.25) {
  if (points.length < 2) return null;
  const geo = new THREE.BufferGeometry().setFromPoints(points);
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
  const line = new THREE.Line(geo, mat);
  return line;
}

// === WebGL Check ===

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

// === Camera Animation ===

function animateCameraTo(camera, controls, targetPos, renderState, duration = 800) {
  const startPos = camera.position.clone();
  const startTarget = controls.target.clone();
  const dist = Math.max(5, targetPos.length() * 0.3);
  const endPos = targetPos.clone().add(new THREE.Vector3(dist * 0.5, dist * 0.4, dist * 0.5));
  const endTarget = targetPos.clone();
  const startTime = performance.now();

  function step() {
    const t = Math.min((performance.now() - startTime) / duration, 1);
    const ease = 1 - Math.pow(1 - t, 3);
    camera.position.lerpVectors(startPos, endPos, ease);
    controls.target.lerpVectors(startTarget, endTarget, ease);
    controls.update();
    renderState.value = true;
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// === Main ===

async function init() {
  if (!hasWebGL()) {
    showFallback();
    return;
  }

  const canvas = document.getElementById('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0e17);

  const camera = new THREE.PerspectiveCamera(
    60, window.innerWidth / window.innerHeight, 0.1, 2000
  );
  camera.position.set(0, 40, 60);

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.domElement.style.position = 'fixed';
  labelRenderer.domElement.style.top = '0';
  labelRenderer.domElement.style.left = '0';
  labelRenderer.domElement.style.pointerEvents = 'none';
  labelRenderer.domElement.style.zIndex = '5';
  document.body.appendChild(labelRenderer.domElement);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 1;
  controls.maxDistance = 500;
  controls.rotateSpeed = 0.5;
  controls.enablePan = false;
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };

  scene.add(new THREE.AmbientLight(0x404040, 0.5));

  // --- Sun ---
  const sunGeo = new THREE.SphereGeometry(1.5, 32, 16);
  const sun = new THREE.Mesh(sunGeo, new THREE.MeshBasicMaterial({ color: 0xfbbf24 }));
  sun.userData = { type: 'star', name: 'Sun', ready: true };
  scene.add(sun);
  scene.add(new THREE.PointLight(0xffffff, 1.5, 300));
  addLabel(scene, sun, 'Sun');

  const renderState = { value: true };

  // --- Collections for scale rebuild ---
  // Each entry: { mesh, rawPos (AU xyz), label?, trajectoryLine?, trajectoryData }
  const bodies = [];
  const trajectoryLines = []; // { line, type: 'planet'|'asteroid', points() }
  const clickables = [sun];
  const bodyMeshes = { Sun: sun };

  // --- Raycaster ---
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let pointerDownPos = new THREE.Vector2();

  canvas.addEventListener('pointerdown', (e) => {
    const rect = canvas.getBoundingClientRect();
    pointerDownPos.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
  });

  canvas.addEventListener('pointerup', (e) => {
    const rect = canvas.getBoundingClientRect();
    pointer.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    if (pointer.distanceTo(pointerDownPos) < 0.02) {
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(clickables);
      if (hits.length > 0 && hits[0].object.userData?.ready) {
        showInfoPanel(hits[0].object.userData, () => {
          animateCameraTo(camera, controls, hits[0].object.position, renderState);
        });
      } else {
        hideInfoPanel();
      }
    }
  });

  // --- Rendering ---
  controls.addEventListener('change', () => { renderState.value = true; });

  function render() {
    controls.update();
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
    renderState.value = false;
  }

  renderer.setAnimationLoop(() => { if (renderState.value) render(); });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    labelRenderer.setSize(window.innerWidth, window.innerHeight);
    renderState.value = true;
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      renderer.setAnimationLoop(null);
    } else {
      renderState.value = true;
      renderer.setAnimationLoop(() => { if (renderState.value) render(); });
    }
  });

  // === Rebuild positions (called on scale toggle) ===
  function rebuildPositions() {
    for (const b of bodies) {
      const sp = posToScene(b.rawPos);
      if (sp) b.mesh.position.copy(sp);
    }
    // Rebuild all trajectory lines
    for (const t of trajectoryLines) {
      const pts = t.computePoints();
      const posAttr = t.line.geometry.getAttribute('position');
      if (posAttr && posAttr.count === pts.length) {
        for (let i = 0; i < pts.length; i++) {
          posAttr.setXYZ(i, pts[i].x, pts[i].y, pts[i].z);
        }
        posAttr.needsUpdate = true;
      } else {
        // Rebuild geometry
        t.line.geometry.dispose();
        t.line.geometry = new THREE.BufferGeometry().setFromPoints(pts);
      }
    }
    renderState.value = true;
  }

  // --- Fetch data ---
  const loading = document.getElementById('loading');
  const results = await fetchAll(['planets', 'spacecraft', 'asteroids', 'space-weather']);

  // --- Plot Planets + Trajectories ---
  if (results.planets.data) {
    for (const planet of results.planets.data) {
      const vis = PLANET_DATA[planet.name];
      if (!vis || !planet.position) continue;

      const scenePos = posToScene(planet.position);
      if (!scenePos) continue;

      // Trajectory
      const trajPoints = computePlanetTrajectory(planet.name);
      const trajLine = createTrajectoryLine(trajPoints, vis.color, 0.25);
      if (trajLine) {
        scene.add(trajLine);
        trajectoryLines.push({
          line: trajLine,
          type: 'planet',
          computePoints: () => computePlanetTrajectory(planet.name),
        });
      }

      // Sphere
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(vis.size, 32, 16),
        new THREE.MeshStandardMaterial({ color: vis.color, roughness: 0.7 })
      );
      mesh.position.copy(scenePos);
      const dist = Math.sqrt(planet.position.x ** 2 + planet.position.y ** 2 + planet.position.z ** 2);
      mesh.userData = { type: 'planet', name: planet.name, distanceFromSunAU: dist.toFixed(3), ready: true };

      scene.add(mesh);
      clickables.push(mesh);
      bodyMeshes[planet.name] = mesh;
      addLabel(scene, mesh, planet.name);
      bodies.push({ mesh, rawPos: planet.position });
    }
  }

  // --- Plot Spacecraft ---
  if (results.spacecraft.data) {
    const savedToggles = loadToggles();
    const toggleContainer = document.getElementById('spacecraft-toggles');
    toggleContainer.innerHTML = '';

    for (const craft of results.spacecraft.data) {
      const isOn = savedToggles[craft.id] ?? craft.defaultOn;
      const scenePos = craft.position ? posToScene(craft.position) : null;
      let mesh = null, label = null;

      if (scenePos) {
        mesh = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.35),
          new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
        );
        mesh.position.copy(scenePos);
        mesh.visible = isOn;
        mesh.userData = {
          type: 'spacecraft', name: craft.name,
          distanceFromSunAU: craft.distanceFromSunAU?.toFixed(3) || '?',
          ready: true,
        };
        scene.add(mesh);
        clickables.push(mesh);
        bodyMeshes[craft.name] = mesh;
        label = addLabel(scene, mesh, craft.name);
        bodies.push({ mesh, rawPos: craft.position });
      }

      const lbl = document.createElement('label');
      lbl.className = 'spacecraft-label';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = isOn;
      cb.dataset.craftId = craft.id;
      cb.addEventListener('change', () => {
        if (mesh) mesh.visible = cb.checked;
        if (label) label.visible = cb.checked;
        saveToggles();
        renderState.value = true;
      });
      lbl.appendChild(cb);
      lbl.appendChild(document.createTextNode(craft.name));
      toggleContainer.appendChild(lbl);
    }
  }

  // --- Plot Asteroids + Trajectories ---
  if (results.asteroids.data) {
    for (const neo of results.asteroids.data) {
      let pos, rawPos;

      if (neo.orbit) {
        // Compute actual position from orbital elements
        const auPos = computeNeoPosition(neo.orbit, new Date());
        rawPos = auPos;
        pos = posToScene(auPos);
      } else if (neo.closeApproach) {
        // Fallback: place near Earth
        const earthData = results.planets.data?.find(p => p.name === 'Earth');
        if (!earthData?.position) continue;
        const earthScene = posToScene(earthData.position);
        if (!earthScene) continue;
        const angle = Math.random() * Math.PI * 2;
        const offset = 1 + Math.random() * 2;
        pos = new THREE.Vector3(
          earthScene.x + Math.cos(angle) * offset,
          earthScene.y + (Math.random() - 0.5) * offset,
          earthScene.z + Math.sin(angle) * offset
        );
        rawPos = null;
      } else {
        continue;
      }

      if (!pos) continue;

      // Trajectory from orbital elements
      if (neo.orbit) {
        const trajPoints = computeNeoTrajectory(neo.orbit);
        const trajLine = createTrajectoryLine(trajPoints, 0xef4444, 0.15);
        if (trajLine) {
          scene.add(trajLine);
          trajectoryLines.push({
            line: trajLine,
            type: 'asteroid',
            computePoints: () => computeNeoTrajectory(neo.orbit),
          });
        }
      }

      const size = Math.max(0.1, Math.min(0.3, (neo.diameterMaxKm || 0.1) * 2));
      const color = neo.isPotentiallyHazardous ? 0xef4444 : 0x9e9e9e;
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(size, 8, 8),
        new THREE.MeshBasicMaterial({ color })
      );
      mesh.position.copy(pos);

      mesh.userData = {
        type: 'asteroid', name: neo.name,
        diameterKm: neo.diameterMaxKm ? `${neo.diameterMinKm?.toFixed(3)}–${neo.diameterMaxKm.toFixed(3)}` : '?',
        missDistanceKm: neo.closeApproach?.missDistanceKm
          ? Math.round(neo.closeApproach.missDistanceKm).toLocaleString() : '?',
        missDistanceAU: neo.closeApproach?.missDistanceAU?.toFixed(4) || '?',
        velocityKmS: neo.closeApproach?.velocityKmS?.toFixed(1) || '?',
        hazardous: neo.isPotentiallyHazardous ? 'Yes' : 'No',
        ready: true,
      };

      scene.add(mesh);
      clickables.push(mesh);
      bodyMeshes[neo.name] = mesh;
      if (rawPos) bodies.push({ mesh, rawPos });
    }
  }

  // --- Build UI Controls ---
  buildFocusDropdown(bodyMeshes, camera, controls, renderState);
  buildDisplayControls(trajectoryLines, rebuildPositions, renderState);

  // --- Space Weather ---
  renderSpaceWeather(results['space-weather']);
  updateSRSummary(results);

  // --- Spacecraft panel toggle ---
  const toggleBtn = document.getElementById('spacecraft-toggle-btn');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      const panel = toggleBtn.parentElement;
      panel.setAttribute('aria-expanded',
        panel.getAttribute('aria-expanded') === 'true' ? 'false' : 'true');
    });
  }

  loading.classList.add('hidden');
  renderState.value = true;
}

// === UI Builders ===

function addLabel(scene, parent, text) {
  const div = document.createElement('div');
  div.className = 'label-2d';
  div.textContent = text;
  const label = new CSS2DObject(div);
  label.position.set(0, 1.2, 0);
  parent.add(label);
  return label;
}

function showInfoPanel(data, onFocus) {
  const panel = document.getElementById('info-panel');
  const content = document.getElementById('info-content');
  let html = `<div class="object-name">${data.name}</div><dl>`;
  html += `<dt>Type</dt><dd>${data.type}</dd>`;
  if (data.distanceFromSunAU) html += `<dt>Distance from Sun</dt><dd>${data.distanceFromSunAU} AU</dd>`;
  if (data.diameterKm) html += `<dt>Diameter</dt><dd>${data.diameterKm} km</dd>`;
  if (data.missDistanceKm) html += `<dt>Miss Distance</dt><dd>${data.missDistanceKm} km</dd>`;
  if (data.missDistanceAU) html += `<dt>Miss Distance</dt><dd>${data.missDistanceAU} AU</dd>`;
  if (data.velocityKmS) html += `<dt>Velocity</dt><dd>${data.velocityKmS} km/s</dd>`;
  if (data.hazardous) html += `<dt>Hazardous</dt><dd>${data.hazardous}</dd>`;
  html += '</dl><button class="focus-btn" id="focus-btn">Focus</button>';
  content.innerHTML = html;
  panel.style.display = '';
  document.getElementById('focus-btn').addEventListener('click', () => { if (onFocus) onFocus(); });
}

function hideInfoPanel() {
  document.getElementById('info-panel').style.display = 'none';
}

function buildFocusDropdown(bodyMeshes, camera, controls, renderState) {
  const container = document.getElementById('focus-select-container');
  const select = document.createElement('select');
  select.className = 'focus-select';

  const defaultOpt = document.createElement('option');
  defaultOpt.value = '';
  defaultOpt.textContent = 'Center on…';
  select.appendChild(defaultOpt);

  const groups = { Stars: [], Planets: [], Spacecraft: [], Asteroids: [] };
  for (const [name, mesh] of Object.entries(bodyMeshes)) {
    const type = mesh.userData?.type || 'planet';
    const group = type === 'star' ? 'Stars' : type === 'planet' ? 'Planets'
      : type === 'spacecraft' ? 'Spacecraft' : 'Asteroids';
    groups[group].push(name);
  }

  for (const [groupName, names] of Object.entries(groups)) {
    if (!names.length) continue;
    const optgroup = document.createElement('optgroup');
    optgroup.label = groupName;
    for (const name of names) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      optgroup.appendChild(opt);
    }
    select.appendChild(optgroup);
  }

  select.addEventListener('change', () => {
    const mesh = bodyMeshes[select.value];
    if (mesh) {
      animateCameraTo(camera, controls, mesh.position, renderState);
      select.value = '';
    }
  });

  container.appendChild(select);
}

function buildDisplayControls(trajectoryLines, rebuildPositions, renderState) {
  const container = document.getElementById('display-controls');
  if (!container) return;

  let html = '';

  // Scale toggle
  html += `<label class="spacecraft-label">
    <input type="checkbox" id="scale-toggle" ${useLogScale ? 'checked' : ''}>
    Log scale
  </label>`;

  // Trajectory toggles
  html += `<label class="spacecraft-label">
    <input type="checkbox" id="traj-planets" checked>
    Planet orbits
  </label>`;
  html += `<label class="spacecraft-label">
    <input type="checkbox" id="traj-asteroids" checked>
    Asteroid orbits
  </label>`;

  container.innerHTML = html;

  // Scale toggle handler
  document.getElementById('scale-toggle').addEventListener('change', (e) => {
    useLogScale = e.target.checked;
    rebuildPositions();
  });

  // Trajectory toggle handlers
  document.getElementById('traj-planets').addEventListener('change', (e) => {
    for (const t of trajectoryLines) {
      if (t.type === 'planet') t.line.visible = e.target.checked;
    }
    renderState.value = true;
  });

  document.getElementById('traj-asteroids').addEventListener('change', (e) => {
    for (const t of trajectoryLines) {
      if (t.type === 'asteroid') t.line.visible = e.target.checked;
    }
    renderState.value = true;
  });
}

function renderSpaceWeather(result) {
  const container = document.getElementById('space-weather-content');
  if (!result?.data) {
    container.innerHTML = '<div class="error-placeholder">Space weather unavailable</div>';
    return;
  }
  const { kp, flares } = result.data;
  let html = '<div style="margin-bottom:0.75rem;">';
  html += '<div style="color:var(--text-secondary);font-size:0.6875rem;">Kp Index</div>';
  if (kp.index !== null) {
    html += `<span class="kp-value" data-level="${kp.level}">${kp.index}</span>`;
    if (kp.index >= 5) html += '<div style="color:var(--maybe);font-size:0.6875rem;margin-top:0.25rem;">Aurora possible</div>';
  } else {
    html += '<span style="color:var(--text-muted);">No recent data</span>';
  }
  html += '</div>';
  if (flares?.length) {
    html += '<div style="color:var(--text-secondary);font-size:0.6875rem;margin-bottom:0.375rem;">Recent Flares</div>';
    for (const flare of flares.slice(0, 3)) {
      const time = flare.peakTime
        ? new Date(flare.peakTime).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
        : '';
      html += `<div style="font-size:0.75rem;margin-bottom:0.125rem;"><strong>${flare.classType || '?'}</strong> ${time}</div>`;
    }
  } else {
    html += '<div style="color:var(--text-muted);font-size:0.75rem;">No recent solar flares</div>';
  }
  if (result.stale) html += '<span class="stale-indicator" style="margin-top:0.5rem;">stale data</span>';
  container.innerHTML = html;
}

function updateSRSummary(results) {
  const el = document.getElementById('sr-summary');
  const parts = [];
  if (results.planets.data) parts.push(`${results.planets.data.length} planets`);
  if (results.spacecraft.data) parts.push(`${results.spacecraft.data.filter(s => s.defaultOn).length} spacecraft`);
  if (results.asteroids.data) parts.push(`${results.asteroids.data.length} near-Earth asteroids`);
  el.textContent = parts.length ? `Solar system loaded: ${parts.join(', ')}.` : 'Solar system data loading failed.';
}

function loadToggles() {
  try { return JSON.parse(localStorage.getItem('spacecraft-toggles') || '{}'); }
  catch { return {}; }
}

function saveToggles() {
  const toggles = {};
  document.querySelectorAll('#spacecraft-toggles input[type="checkbox"]').forEach(cb => {
    toggles[cb.dataset.craftId] = cb.checked;
  });
  localStorage.setItem('spacecraft-toggles', JSON.stringify(toggles));
}

async function showFallback() {
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('canvas').style.display = 'none';
  document.getElementById('fallback').style.display = '';
  const results = await fetchAll(['planets', 'spacecraft', 'asteroids', 'space-weather']);
  const content = document.getElementById('fallback-content');
  let html = '';
  if (results.planets.data) {
    html += '<h2 style="margin:1rem 0 0.5rem;">Planets</h2><table class="panel" style="width:100%;border-collapse:collapse;">';
    html += '<tr><th style="text-align:left;padding:0.5rem;">Name</th><th style="text-align:right;padding:0.5rem;">Distance (AU)</th></tr>';
    for (const p of results.planets.data) {
      if (!p.position) continue;
      const dist = Math.sqrt(p.position.x ** 2 + p.position.y ** 2 + p.position.z ** 2);
      html += `<tr><td style="padding:0.375rem 0.5rem;">${p.name}</td><td style="text-align:right;padding:0.375rem 0.5rem;">${dist.toFixed(3)}</td></tr>`;
    }
    html += '</table>';
  }
  if (results.spacecraft.data) {
    html += '<h2 style="margin:1rem 0 0.5rem;">Spacecraft</h2><table class="panel" style="width:100%;border-collapse:collapse;">';
    html += '<tr><th style="text-align:left;padding:0.5rem;">Name</th><th style="text-align:right;padding:0.5rem;">Distance (AU)</th></tr>';
    for (const s of results.spacecraft.data) {
      html += `<tr><td style="padding:0.375rem 0.5rem;">${s.name}</td><td style="text-align:right;padding:0.375rem 0.5rem;">${s.distanceFromSunAU?.toFixed(3) || '?'}</td></tr>`;
    }
    html += '</table>';
  }
  content.innerHTML = html;
}

init();
