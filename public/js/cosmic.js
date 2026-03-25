import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { fetchAll } from './api.js';

// === Constants ===

const SCENE_RADIUS = 100;
const DEG = Math.PI / 180;
const textureLoader = new THREE.TextureLoader();

const PLANET_DATA = {
  Mercury:  { color: 0x9e9e9e, size: 0.4, texture: '/textures/mercury.jpg' },
  Venus:    { color: 0xe8cda0, size: 0.6, texture: '/textures/venus.jpg' },
  Earth:    { color: 0x4a90d9, size: 0.65, texture: '/textures/earth.jpg' },
  Mars:     { color: 0xc1440e, size: 0.5, texture: '/textures/mars.jpg' },
  Jupiter:  { color: 0xc88b3a, size: 1.2, texture: '/textures/jupiter.jpg' },
  Saturn:   { color: 0xead6a6, size: 1.0, texture: '/textures/saturn.jpg' },
  Uranus:   { color: 0x73c2d9, size: 0.8, texture: '/textures/uranus.jpg' },
  Neptune:  { color: 0x3f54ba, size: 0.8, texture: '/textures/neptune.jpg' },
};

// Major moons: distance from parent (km), orbital period (days), size (scene units)
const MOONS = {
  Earth:   [{ name: 'Moon',      dist: 384400,  period: 27.322,  size: 0.2,  texture: '/textures/moon.jpg' }],
  Mars:    [{ name: 'Phobos',    dist: 9377,    period: 0.319,   size: 0.06 },
            { name: 'Deimos',    dist: 23460,   period: 1.262,   size: 0.05 }],
  Jupiter: [{ name: 'Io',        dist: 421700,  period: 1.769,   size: 0.15 },
            { name: 'Europa',    dist: 671100,  period: 3.551,   size: 0.13 },
            { name: 'Ganymede',  dist: 1070400, period: 7.155,   size: 0.18 },
            { name: 'Callisto',  dist: 1882700, period: 16.689,  size: 0.16 }],
  Saturn:  [{ name: 'Titan',     dist: 1221870, period: 15.945,  size: 0.17 },
            { name: 'Enceladus', dist: 238020,  period: 1.370,   size: 0.06 },
            { name: 'Mimas',     dist: 185520,  period: 0.942,   size: 0.05 },
            { name: 'Rhea',      dist: 527108,  period: 4.518,   size: 0.08 }],
  Uranus:  [{ name: 'Titania',   dist: 436300,  period: 8.706,   size: 0.08 },
            { name: 'Oberon',    dist: 583500,  period: 13.463,  size: 0.08 }],
  Neptune: [{ name: 'Triton',    dist: 354800,  period: 5.877,   size: 0.1  }],
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

// === Scale ===

let useLogScale = true;

function auToScene(au) {
  if (useLogScale) {
    const logMin = Math.log10(0.2);
    const logMax = Math.log10(250);
    return ((Math.log10(Math.max(au, 0.2)) - logMin) / (logMax - logMin)) * SCENE_RADIUS;
  }
  return Math.min(au * 3, SCENE_RADIUS);
}

function posToScene(pos) {
  if (!pos) return null;
  const dist = Math.sqrt(pos.x ** 2 + pos.y ** 2 + pos.z ** 2);
  if (dist < 0.001) return new THREE.Vector3(0, 0, 0);
  const s = auToScene(dist) / dist;
  return new THREE.Vector3(pos.x * s, pos.z * s, -pos.y * s);
}

// === Keplerian Computation ===

function computePlanetPos(name, date) {
  const el = ELEMENTS[name];
  if (!el) return null;
  const T = (date.getTime() - Date.UTC(2000, 0, 1, 12, 0, 0)) / (365.25 * 86400000 * 100);
  const a = el.a + el.da * T, e = el.e + el.de * T;
  const I = (el.I + el.dI * T) * DEG, L = (el.L + el.dL * T) * DEG;
  const wp = (el.w + el.dw * T) * DEG, O = (el.O + el.dO * T) * DEG;
  const w = wp - O;
  let M = ((L - wp) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
  let E = M;
  for (let i = 0; i < 10; i++) { const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E)); E -= dE; if (Math.abs(dE) < 1e-10) break; }
  const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cosO = Math.cos(O), sinO = Math.sin(O), cosI = Math.cos(I), sinI = Math.sin(I), cosw = Math.cos(w), sinw = Math.sin(w);
  return {
    x: (cosO * cosw - sinO * sinw * cosI) * xp + (-cosO * sinw - sinO * cosw * cosI) * yp,
    y: (sinO * cosw + cosO * sinw * cosI) * xp + (-sinO * sinw + cosO * cosw * cosI) * yp,
    z: (sinw * sinI) * xp + (cosw * sinI) * yp,
  };
}

function computeNeoPos(orbit, date) {
  const { a, e, I: Id, O: Od, w: wd, M: M0d, period, epoch } = orbit;
  const jd = date.getTime() / 86400000 + 2440587.5;
  const n = 360 / period;
  let M = ((M0d + n * (jd - epoch)) * DEG % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
  let E = M;
  for (let i = 0; i < 10; i++) { const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E)); E -= dE; if (Math.abs(dE) < 1e-10) break; }
  const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const I = Id * DEG, O = Od * DEG, w = wd * DEG;
  const cosO = Math.cos(O), sinO = Math.sin(O), cosI = Math.cos(I), sinI = Math.sin(I), cosw = Math.cos(w), sinw = Math.sin(w);
  return {
    x: (cosO * cosw - sinO * sinw * cosI) * xp + (-cosO * sinw - sinO * cosw * cosI) * yp,
    y: (sinO * cosw + cosO * sinw * cosI) * xp + (-sinO * sinw + cosO * cosw * cosI) * yp,
    z: (sinw * sinI) * xp + (cosw * sinI) * yp,
  };
}

// === Trajectory Lines ===

function computeTrajectoryPoints(positionFn, periodDays, steps = 128) {
  const now = Date.now();
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const date = new Date(now + (i / steps) * periodDays * 86400000);
    const sp = posToScene(positionFn(date));
    if (sp) pts.push(sp);
  }
  return pts;
}

function makeTrajectoryLine(points, color, opacity) {
  if (points.length < 2) return null;
  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity })
  );
}

// === Texture Loading ===

function loadPlanetMaterial(vis) {
  const emissive = new THREE.Color(vis.color).multiplyScalar(0.15);
  const mat = new THREE.MeshStandardMaterial({
    color: vis.color, emissive, emissiveIntensity: 1.0, roughness: 0.8, metalness: 0.1,
  });
  if (vis.texture) {
    textureLoader.load(vis.texture, (tex) => {
      mat.map = tex;
      mat.needsUpdate = true;
    });
  }
  return mat;
}

function loadMoonMaterial(moon) {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xbbbbbb, emissive: 0x222222, roughness: 0.9,
  });
  if (moon.texture) {
    textureLoader.load(moon.texture, (tex) => {
      mat.map = tex;
      mat.needsUpdate = true;
    });
  }
  return mat;
}

// === Moon orbital position ===
// Exaggerated distance from parent (actual km → scene offset)
function moonSceneOffset(moon, parentSize) {
  // Normalize distances: closest moon gets offset ~1.5× parent size,
  // farthest gets ~4× parent size. Use sqrt for compression.
  const base = parentSize + 0.5;
  const spread = Math.sqrt(moon.dist / 500000) * 1.5;
  const r = base + spread;

  // Compute angle from orbital period and current time
  const daysSinceEpoch = Date.now() / 86400000;
  const angle = ((daysSinceEpoch % moon.period) / moon.period) * Math.PI * 2;

  return new THREE.Vector3(
    Math.cos(angle) * r,
    Math.sin(angle) * 0.1 * r, // slight inclination
    Math.sin(angle) * r
  );
}

// === Camera Animation ===

function animateCameraTo(camera, controls, targetPos, renderState, duration = 800) {
  const startPos = camera.position.clone();
  const startTarget = controls.target.clone();
  const dist = Math.max(3, targetPos.length() * 0.25);
  const endPos = targetPos.clone().add(new THREE.Vector3(dist * 0.5, dist * 0.4, dist * 0.5));
  const startTime = performance.now();
  function step() {
    const t = Math.min((performance.now() - startTime) / duration, 1);
    const ease = 1 - Math.pow(1 - t, 3);
    camera.position.lerpVectors(startPos, endPos, ease);
    controls.target.lerpVectors(startTarget, targetPos, ease);
    controls.update();
    renderState.value = true;
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function hasWebGL() {
  try { return !!(document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl')); }
  catch { return false; }
}

// === Main ===

async function init() {
  if (!hasWebGL()) { showFallback(); return; }

  const canvas = document.getElementById('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0e17);

  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
  camera.position.set(0, 40, 60);

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.domElement.style.cssText = 'position:fixed;top:0;left:0;pointer-events:none;z-index:5';
  document.body.appendChild(labelRenderer.domElement);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 1;
  controls.maxDistance = 500;
  controls.rotateSpeed = 0.5;
  controls.enablePan = false;
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };

  scene.add(new THREE.AmbientLight(0x8090a0, 1.5));
  scene.add(new THREE.PointLight(0xffffff, 2.0, 0));

  // Sun
  const sun = new THREE.Mesh(
    new THREE.SphereGeometry(1.5, 32, 16),
    new THREE.MeshBasicMaterial({ color: 0xfbbf24 })
  );
  sun.userData = { type: 'star', name: 'Sun', ready: true };
  scene.add(sun);
  addLabel(scene, sun, 'Sun');

  const R = { value: true }; // render flag

  // === State ===
  // Bodies: each has { mesh, getAUPos() } so scale toggle always works
  const allBodies = [];
  const trajectories = [];
  const clickables = [sun];
  const bodyMeshes = { Sun: sun };

  // === Raycaster ===
  const raycaster = new THREE.Raycaster();
  const ptr = new THREE.Vector2(), ptrDown = new THREE.Vector2();

  canvas.addEventListener('pointerdown', (e) => {
    const r = canvas.getBoundingClientRect();
    ptrDown.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  });
  canvas.addEventListener('pointerup', (e) => {
    const r = canvas.getBoundingClientRect();
    ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    if (ptr.distanceTo(ptrDown) < 0.02) {
      raycaster.setFromCamera(ptr, camera);
      const hits = raycaster.intersectObjects(clickables);
      if (hits.length && hits[0].object.userData?.ready)
        showInfoPanel(hits[0].object.userData, () => animateCameraTo(camera, controls, hits[0].object.position, R));
      else hideInfoPanel();
    }
  });

  // === Render loop ===
  controls.addEventListener('change', () => { R.value = true; });
  function render() { controls.update(); renderer.render(scene, camera); labelRenderer.render(scene, camera); R.value = false; }
  renderer.setAnimationLoop(() => { if (R.value) render(); });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    labelRenderer.setSize(window.innerWidth, window.innerHeight);
    R.value = true;
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) renderer.setAnimationLoop(null);
    else { R.value = true; renderer.setAnimationLoop(() => { if (R.value) render(); }); }
  });

  // === Rebuild all positions on scale change ===
  function rebuildAll() {
    for (const b of allBodies) {
      const sp = posToScene(b.getAUPos());
      if (sp) b.mesh.position.copy(sp);
    }
    for (const t of trajectories) {
      const pts = t.getPoints();
      t.line.geometry.dispose();
      t.line.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    }
    R.value = true;
  }

  // === Fetch data ===
  const loading = document.getElementById('loading');
  const results = await fetchAll(['planets', 'spacecraft', 'asteroids', 'space-weather']);

  // === Planets + Trajectories + Moons ===
  if (results.planets.data) {
    for (const planet of results.planets.data) {
      const vis = PLANET_DATA[planet.name];
      if (!vis || !planet.position) continue;
      const scenePos = posToScene(planet.position);
      if (!scenePos) continue;

      // Trajectory
      const trajFn = (date) => computePlanetPos(planet.name, date);
      const period = ORBITAL_PERIODS[planet.name] || 365;
      const trajPts = computeTrajectoryPoints(trajFn, period);
      const trajLine = makeTrajectoryLine(trajPts, vis.color, 0.5);
      if (trajLine) {
        scene.add(trajLine);
        trajectories.push({ line: trajLine, type: 'planet', getPoints: () => computeTrajectoryPoints(trajFn, period) });
      }

      // Planet mesh with real texture
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(vis.size, 32, 16), loadPlanetMaterial(vis));
      mesh.position.copy(scenePos);
      const dist = Math.sqrt(planet.position.x ** 2 + planet.position.y ** 2 + planet.position.z ** 2);
      mesh.userData = { type: 'planet', name: planet.name, distanceFromSunAU: dist.toFixed(3), ready: true };
      scene.add(mesh);
      clickables.push(mesh);
      bodyMeshes[planet.name] = mesh;
      addLabel(scene, mesh, planet.name);
      allBodies.push({ mesh, getAUPos: () => planet.position });

      // Moons
      const moons = MOONS[planet.name];
      if (moons) {
        for (const moonDef of moons) {
          const offset = moonSceneOffset(moonDef, vis.size);
          const moonMesh = new THREE.Mesh(
            new THREE.SphereGeometry(moonDef.size, 16, 8),
            loadMoonMaterial(moonDef)
          );
          moonMesh.position.copy(scenePos).add(offset);
          moonMesh.userData = {
            type: 'moon', name: moonDef.name,
            parent: planet.name,
            orbitalPeriod: moonDef.period.toFixed(2) + ' days',
            ready: true,
          };
          scene.add(moonMesh);
          clickables.push(moonMesh);
          bodyMeshes[moonDef.name] = moonMesh;
          addLabel(scene, moonMesh, moonDef.name);

          // Moon repositions with parent on scale change
          allBodies.push({
            mesh: moonMesh,
            getAUPos: () => {
              // Parent position + tiny offset (moons are too close in AU to separate)
              const pp = planet.position;
              const off = moonSceneOffset(moonDef, vis.size);
              // Return parent AU pos — the offset is applied in scene space
              return pp;
            },
            sceneOffset: () => moonSceneOffset(moonDef, vis.size),
          });
        }
      }
    }
  }

  // Override rebuild to handle moon offsets
  function rebuildAllWithMoons() {
    for (const b of allBodies) {
      const sp = posToScene(b.getAUPos());
      if (!sp) continue;
      if (b.sceneOffset) {
        sp.add(b.sceneOffset());
      }
      b.mesh.position.copy(sp);
    }
    for (const t of trajectories) {
      const pts = t.getPoints();
      t.line.geometry.dispose();
      t.line.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    }
    R.value = true;
  }

  // === Spacecraft ===
  if (results.spacecraft.data) {
    const saved = loadToggles();
    const container = document.getElementById('spacecraft-toggles');
    container.innerHTML = '';
    for (const craft of results.spacecraft.data) {
      const isOn = saved[craft.id] ?? craft.defaultOn;
      const sp = craft.position ? posToScene(craft.position) : null;
      let mesh = null, label = null;
      if (sp) {
        mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.35), new THREE.MeshBasicMaterial({ color: 0x38bdf8 }));
        mesh.position.copy(sp);
        mesh.visible = isOn;
        mesh.userData = { type: 'spacecraft', name: craft.name, distanceFromSunAU: craft.distanceFromSunAU?.toFixed(3) || '?', ready: true };
        scene.add(mesh);
        clickables.push(mesh);
        bodyMeshes[craft.name] = mesh;
        label = addLabel(scene, mesh, craft.name);
        const rawPos = craft.position;
        allBodies.push({ mesh, getAUPos: () => rawPos });
      }
      const lbl = document.createElement('label');
      lbl.className = 'spacecraft-label';
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = isOn; cb.dataset.craftId = craft.id;
      cb.addEventListener('change', () => {
        if (mesh) mesh.visible = cb.checked;
        if (label) label.visible = cb.checked;
        saveToggles(); R.value = true;
      });
      lbl.appendChild(cb);
      lbl.appendChild(document.createTextNode(craft.name));
      container.appendChild(lbl);
    }
  }

  // === Asteroids ===
  if (results.asteroids.data) {
    for (const neo of results.asteroids.data) {
      // Compute position from orbital elements (preferred) or skip
      let auPos = null;
      if (neo.orbit) {
        auPos = computeNeoPos(neo.orbit, new Date());
      }
      if (!auPos) continue;

      const sp = posToScene(auPos);
      if (!sp) continue;

      // Trajectory
      const orbitCopy = neo.orbit;
      const trajPts = computeTrajectoryPoints((d) => computeNeoPos(orbitCopy, d), orbitCopy.period);
      const trajLine = makeTrajectoryLine(trajPts, 0xef4444, 0.4);
      if (trajLine) {
        scene.add(trajLine);
        trajectories.push({
          line: trajLine, type: 'asteroid',
          getPoints: () => computeTrajectoryPoints((d) => computeNeoPos(orbitCopy, d), orbitCopy.period),
        });
      }

      const size = Math.max(0.04, Math.min(0.12, (neo.diameterMaxKm || 0.05) * 0.3));
      const color = neo.isPotentiallyHazardous ? 0xef4444 : 0xaaaaaa;
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(size, 8, 8), new THREE.MeshBasicMaterial({ color }));
      mesh.position.copy(sp);
      mesh.userData = {
        type: 'asteroid', name: neo.name,
        diameterKm: neo.diameterMaxKm ? `${neo.diameterMinKm?.toFixed(3)}–${neo.diameterMaxKm.toFixed(3)}` : '?',
        missDistanceKm: neo.closeApproach?.missDistanceKm ? Math.round(neo.closeApproach.missDistanceKm).toLocaleString() : '?',
        missDistanceAU: neo.closeApproach?.missDistanceAU?.toFixed(4) || '?',
        velocityKmS: neo.closeApproach?.velocityKmS?.toFixed(1) || '?',
        hazardous: neo.isPotentiallyHazardous ? 'Yes' : 'No',
        ready: true,
      };
      scene.add(mesh);
      clickables.push(mesh);
      bodyMeshes[neo.name] = mesh;

      // Store orbit for scale rebuild — recompute fresh position each time
      const orbitRef = neo.orbit;
      allBodies.push({ mesh, getAUPos: () => computeNeoPos(orbitRef, new Date()) });
    }
  }

  // === UI ===
  buildFocusDropdown(bodyMeshes, camera, controls, R);
  buildDisplayControls(trajectories, rebuildAllWithMoons, R, clickables);
  renderSpaceWeather(results['space-weather']);
  updateSRSummary(results);

  document.getElementById('spacecraft-toggle-btn')?.addEventListener('click', function () {
    const p = this.parentElement;
    p.setAttribute('aria-expanded', p.getAttribute('aria-expanded') === 'true' ? 'false' : 'true');
  });

  loading.classList.add('hidden');
  R.value = true;
}

// === UI Helpers ===

function addLabel(scene, parent, text) {
  const div = document.createElement('div');
  div.className = 'label-2d';
  div.textContent = text;
  const l = new CSS2DObject(div);
  l.position.set(0, 1.2, 0);
  parent.add(l);
  return l;
}

function showInfoPanel(data, onFocus) {
  const panel = document.getElementById('info-panel');
  const content = document.getElementById('info-content');
  let h = `<div class="object-name">${data.name}</div><dl>`;
  h += `<dt>Type</dt><dd>${data.type}</dd>`;
  if (data.parent) h += `<dt>Orbits</dt><dd>${data.parent}</dd>`;
  if (data.orbitalPeriod) h += `<dt>Period</dt><dd>${data.orbitalPeriod}</dd>`;
  if (data.distanceFromSunAU) h += `<dt>From Sun</dt><dd>${data.distanceFromSunAU} AU</dd>`;
  if (data.diameterKm) h += `<dt>Diameter</dt><dd>${data.diameterKm} km</dd>`;
  if (data.missDistanceKm) h += `<dt>Miss Dist</dt><dd>${data.missDistanceKm} km</dd>`;
  if (data.missDistanceAU) h += `<dt>Miss Dist</dt><dd>${data.missDistanceAU} AU</dd>`;
  if (data.velocityKmS) h += `<dt>Velocity</dt><dd>${data.velocityKmS} km/s</dd>`;
  if (data.hazardous) h += `<dt>Hazardous</dt><dd>${data.hazardous}</dd>`;
  h += '</dl><button class="focus-btn" id="focus-btn">Focus</button>';
  content.innerHTML = h;
  panel.style.display = '';
  document.getElementById('focus-btn').onclick = onFocus;
}

function hideInfoPanel() { document.getElementById('info-panel').style.display = 'none'; }

function buildFocusDropdown(meshes, camera, controls, R) {
  const container = document.getElementById('focus-select-container');
  const sel = document.createElement('select');
  sel.className = 'focus-select';
  sel.innerHTML = '<option value="">Center on…</option>';
  const groups = { Stars: [], Planets: [], Moons: [], Spacecraft: [], Asteroids: [] };
  for (const [name, mesh] of Object.entries(meshes)) {
    const t = mesh.userData?.type || 'planet';
    (groups[t === 'star' ? 'Stars' : t === 'planet' ? 'Planets' : t === 'moon' ? 'Moons' : t === 'spacecraft' ? 'Spacecraft' : 'Asteroids']).push(name);
  }
  for (const [g, names] of Object.entries(groups)) {
    if (!names.length) continue;
    const og = document.createElement('optgroup');
    og.label = g;
    for (const n of names) { const o = document.createElement('option'); o.value = n; o.textContent = n; og.appendChild(o); }
    sel.appendChild(og);
  }
  sel.addEventListener('change', () => {
    const m = meshes[sel.value];
    if (m) { animateCameraTo(camera, controls, m.position, R); sel.value = ''; }
  });
  container.appendChild(sel);
}

function buildDisplayControls(trajectories, rebuild, R, clickables) {
  const c = document.getElementById('display-controls');
  if (!c) return;
  c.innerHTML = `
    <label class="spacecraft-label"><input type="checkbox" id="scale-toggle" ${useLogScale ? 'checked' : ''}> Log scale</label>
    <label class="spacecraft-label"><input type="checkbox" id="traj-planets" checked> Planet orbits</label>
    <label class="spacecraft-label"><input type="checkbox" id="traj-asteroids" checked> Asteroid orbits</label>
    <label class="spacecraft-label"><input type="checkbox" id="show-asteroids" checked> Asteroids</label>
    <label class="spacecraft-label"><input type="checkbox" id="show-moons" checked> Moons</label>
  `;
  document.getElementById('scale-toggle').addEventListener('change', (e) => { useLogScale = e.target.checked; rebuild(); });
  document.getElementById('traj-planets').addEventListener('change', (e) => { trajectories.filter(t => t.type === 'planet').forEach(t => t.line.visible = e.target.checked); R.value = true; });
  document.getElementById('traj-asteroids').addEventListener('change', (e) => { trajectories.filter(t => t.type === 'asteroid').forEach(t => t.line.visible = e.target.checked); R.value = true; });
  document.getElementById('show-asteroids').addEventListener('change', (e) => {
    clickables.filter(m => m.userData?.type === 'asteroid').forEach(m => m.visible = e.target.checked);
    trajectories.filter(t => t.type === 'asteroid').forEach(t => t.line.visible = e.target.checked && document.getElementById('traj-asteroids').checked);
    R.value = true;
  });
  document.getElementById('show-moons').addEventListener('change', (e) => {
    clickables.filter(m => m.userData?.type === 'moon').forEach(m => { m.visible = e.target.checked; m.children.forEach(c => c.visible = e.target.checked); });
    R.value = true;
  });
}

function renderSpaceWeather(result) {
  const c = document.getElementById('space-weather-content');
  if (!result?.data) { c.innerHTML = '<div class="error-placeholder">Space weather unavailable</div>'; return; }
  const { kp, flares } = result.data;
  let h = '<div style="margin-bottom:0.75rem"><div style="color:var(--text-secondary);font-size:0.6875rem">Kp Index</div>';
  if (kp.index !== null) {
    h += `<span class="kp-value" data-level="${kp.level}">${kp.index}</span>`;
    if (kp.index >= 5) h += '<div style="color:var(--maybe);font-size:0.6875rem;margin-top:0.25rem">Aurora possible</div>';
  } else h += '<span style="color:var(--text-muted)">No recent data</span>';
  h += '</div>';
  if (flares?.length) {
    h += '<div style="color:var(--text-secondary);font-size:0.6875rem;margin-bottom:0.375rem">Recent Flares</div>';
    for (const f of flares.slice(0, 3)) {
      const t = f.peakTime ? new Date(f.peakTime).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
      h += `<div style="font-size:0.75rem;margin-bottom:0.125rem"><strong>${f.classType || '?'}</strong> ${t}</div>`;
    }
  } else h += '<div style="color:var(--text-muted);font-size:0.75rem">No recent solar flares</div>';
  if (result.stale) h += '<span class="stale-indicator" style="margin-top:0.5rem">stale data</span>';
  c.innerHTML = h;
}

function updateSRSummary(results) {
  const el = document.getElementById('sr-summary');
  const p = [];
  if (results.planets.data) p.push(`${results.planets.data.length} planets`);
  if (results.spacecraft.data) p.push(`${results.spacecraft.data.filter(s => s.defaultOn).length} spacecraft`);
  if (results.asteroids.data) p.push(`${results.asteroids.data.length} asteroids`);
  el.textContent = p.length ? `Solar system: ${p.join(', ')}.` : 'Data loading failed.';
}

function loadToggles() { try { return JSON.parse(localStorage.getItem('spacecraft-toggles') || '{}'); } catch { return {}; } }
function saveToggles() {
  const t = {};
  document.querySelectorAll('#spacecraft-toggles input[type="checkbox"]').forEach(cb => { t[cb.dataset.craftId] = cb.checked; });
  localStorage.setItem('spacecraft-toggles', JSON.stringify(t));
}

async function showFallback() {
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('canvas').style.display = 'none';
  document.getElementById('fallback').style.display = '';
  const r = await fetchAll(['planets', 'spacecraft', 'asteroids', 'space-weather']);
  let h = '';
  if (r.planets.data) {
    h += '<h2 style="margin:1rem 0 0.5rem">Planets</h2><table class="panel" style="width:100%;border-collapse:collapse"><tr><th style="text-align:left;padding:0.5rem">Name</th><th style="text-align:right;padding:0.5rem">Distance (AU)</th></tr>';
    for (const p of r.planets.data) { if (!p.position) continue; const d = Math.sqrt(p.position.x**2+p.position.y**2+p.position.z**2); h += `<tr><td style="padding:0.375rem 0.5rem">${p.name}</td><td style="text-align:right;padding:0.375rem 0.5rem">${d.toFixed(3)}</td></tr>`; }
    h += '</table>';
  }
  document.getElementById('fallback-content').innerHTML = h;
}

init();
