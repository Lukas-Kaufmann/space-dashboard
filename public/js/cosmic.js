import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { fetchAll } from './api.js';

// === Constants ===

const SCENE_RADIUS = 100;
const AU = 149597870.7; // km

// Planet visual properties
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

// Known semi-major axes for orbit rings (AU)
const ORBIT_RADII = {
  Mercury: 0.387, Venus: 0.723, Earth: 1.0, Mars: 1.524,
  Jupiter: 5.203, Saturn: 9.537, Uranus: 19.19, Neptune: 30.07,
};

// === Log Scale ===

function auToScene(au) {
  const logMin = Math.log10(0.2);
  const logMax = Math.log10(250);
  const clamped = Math.max(au, 0.2);
  const t = (Math.log10(clamped) - logMin) / (logMax - logMin);
  return t * SCENE_RADIUS;
}

function posToScene(pos) {
  if (!pos) return null;
  const dist = Math.sqrt(pos.x ** 2 + pos.y ** 2 + pos.z ** 2);
  if (dist < 0.001) return new THREE.Vector3(0, 0, 0);
  const scale = auToScene(dist) / dist;
  // Y and Z swapped: Horizons uses ecliptic plane (XY), Three.js Y is up
  return new THREE.Vector3(pos.x * scale, pos.z * scale, -pos.y * scale);
}

// === WebGL Check ===

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

// === Main ===

async function init() {
  if (!hasWebGL()) {
    showFallback();
    return;
  }

  // --- Three.js Setup ---
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

  // CSS2D label renderer
  const labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.domElement.style.position = 'fixed';
  labelRenderer.domElement.style.top = '0';
  labelRenderer.domElement.style.left = '0';
  labelRenderer.domElement.style.pointerEvents = 'none';
  labelRenderer.domElement.style.zIndex = '5';
  document.body.appendChild(labelRenderer.domElement);

  // Controls
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 3;
  controls.maxDistance = 180;
  controls.rotateSpeed = 0.5;
  controls.enablePan = false;
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };

  // Lighting
  const ambientLight = new THREE.AmbientLight(0x404040, 0.5);
  scene.add(ambientLight);

  // --- Sun ---
  const sunGeo = new THREE.SphereGeometry(1.5, 32, 16);
  const sunMat = new THREE.MeshBasicMaterial({
    color: 0xfbbf24,
    emissive: 0xfbbf24,
  });
  const sun = new THREE.Mesh(sunGeo, sunMat);
  sun.userData = { type: 'star', name: 'Sun', ready: true };
  scene.add(sun);

  const sunLight = new THREE.PointLight(0xffffff, 1.5, 300);
  scene.add(sunLight);

  addLabel(scene, sun, 'Sun');

  // --- Orbit Paths ---
  for (const [name, radiusAU] of Object.entries(ORBIT_RADII)) {
    const r = auToScene(radiusAU);
    const points = [];
    for (let i = 0; i <= 128; i++) {
      const angle = (i / 128) * Math.PI * 2;
      points.push(new THREE.Vector3(Math.cos(angle) * r, 0, Math.sin(angle) * r));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({
      color: 0x444466, transparent: true, opacity: 0.3,
    });
    const line = new THREE.Line(geo, mat);
    line.matrixAutoUpdate = false;
    line.updateMatrix();
    scene.add(line);
  }

  // --- Raycaster for click/tap ---
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const clickables = [];
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

    // Only treat as click if pointer barely moved (not drag)
    if (pointer.distanceTo(pointerDownPos) < 0.02) {
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(clickables);
      if (hits.length > 0) {
        const obj = hits[0].object;
        if (obj.userData?.ready) {
          showInfoPanel(obj.userData);
        }
      } else {
        hideInfoPanel();
      }
    }
  });

  // --- On-demand rendering ---
  let needsRender = true;
  controls.addEventListener('change', () => { needsRender = true; });

  function render() {
    controls.update();
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
    needsRender = false;
  }

  renderer.setAnimationLoop(() => {
    if (needsRender) render();
  });

  // --- Resize ---
  window.addEventListener('resize', () => {
    if (!renderer || !camera) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    labelRenderer.setSize(window.innerWidth, window.innerHeight);
    needsRender = true;
  });

  // --- Visibility API ---
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      renderer.setAnimationLoop(null);
    } else {
      needsRender = true;
      renderer.setAnimationLoop(() => {
        if (needsRender) render();
      });
    }
  });

  // Scene is ready — now fetch data
  const sceneReady = true;
  const loading = document.getElementById('loading');

  // --- Fetch all data in parallel ---
  const results = await fetchAll(['planets', 'spacecraft', 'asteroids', 'space-weather']);

  // --- Plot Planets ---
  if (results.planets.data) {
    for (const planet of results.planets.data) {
      if (!planet.position || planet.name === 'Earth') {
        // Still plot Earth but with a highlight
      }
      const vis = PLANET_DATA[planet.name];
      if (!vis) continue;

      const scenePos = posToScene(planet.position);
      if (!scenePos) continue;

      const geo = new THREE.SphereGeometry(vis.size, 32, 16);
      const mat = new THREE.MeshStandardMaterial({ color: vis.color, roughness: 0.7 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(scenePos);

      const dist = Math.sqrt(
        planet.position.x ** 2 + planet.position.y ** 2 + planet.position.z ** 2
      );

      mesh.userData = {
        type: 'planet',
        name: planet.name,
        distanceFromSunAU: dist.toFixed(3),
        ready: true,
      };

      scene.add(mesh);
      clickables.push(mesh);
      addLabel(scene, mesh, planet.name);
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

      let mesh = null;
      let label = null;

      if (scenePos) {
        // Diamond marker for spacecraft
        const geo = new THREE.OctahedronGeometry(0.35);
        const mat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
        mesh = new THREE.Mesh(geo, mat);
        mesh.position.copy(scenePos);
        mesh.visible = isOn;

        mesh.userData = {
          type: 'spacecraft',
          name: craft.name,
          distanceFromSunAU: craft.distanceFromSunAU?.toFixed(3) || '?',
          ready: true,
        };

        scene.add(mesh);
        clickables.push(mesh);
        label = addLabel(scene, mesh, craft.name);
      }

      // Toggle checkbox
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
        needsRender = true;
      });
      lbl.appendChild(cb);
      lbl.appendChild(document.createTextNode(craft.name));
      toggleContainer.appendChild(lbl);
    }
  }

  // --- Plot Asteroids ---
  if (results.asteroids.data) {
    // Show up to 10 closest asteroids
    const asteroids = results.asteroids.data.slice(0, 10);
    for (const neo of asteroids) {
      if (!neo.closeApproach) continue;

      // Approximate position: place near Earth at miss distance
      // (NeoWs doesn't give XYZ, just miss distance)
      // Place them in a ring around Earth's position
      const earthData = results.planets.data?.find(p => p.name === 'Earth');
      if (!earthData?.position) continue;

      const earthScene = posToScene(earthData.position);
      if (!earthScene) continue;

      // Scatter around Earth at a small offset
      const angle = Math.random() * Math.PI * 2;
      const offset = 1 + Math.random() * 2;
      const pos = new THREE.Vector3(
        earthScene.x + Math.cos(angle) * offset,
        earthScene.y + (Math.random() - 0.5) * offset,
        earthScene.z + Math.sin(angle) * offset
      );

      const size = Math.max(0.1, Math.min(0.3, (neo.diameterMaxKm || 0.1) * 2));
      const geo = new THREE.SphereGeometry(size, 8, 8);
      const color = neo.isPotentiallyHazardous ? 0xef4444 : 0x9e9e9e;
      const mat = new THREE.MeshBasicMaterial({ color });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(pos);

      mesh.userData = {
        type: 'asteroid',
        name: neo.name,
        diameterKm: neo.diameterMaxKm ? `${neo.diameterMinKm?.toFixed(3)}–${neo.diameterMaxKm.toFixed(3)}` : '?',
        missDistanceKm: neo.closeApproach.missDistanceKm
          ? Math.round(neo.closeApproach.missDistanceKm).toLocaleString()
          : '?',
        missDistanceAU: neo.closeApproach.missDistanceAU?.toFixed(4) || '?',
        velocityKmS: neo.closeApproach.velocityKmS?.toFixed(1) || '?',
        hazardous: neo.isPotentiallyHazardous ? 'Yes' : 'No',
        ready: true,
      };

      scene.add(mesh);
      clickables.push(mesh);
    }
  }

  // --- Space Weather ---
  renderSpaceWeather(results['space-weather']);

  // --- Update SR summary ---
  updateSRSummary(results);

  // --- Hide loading ---
  loading.classList.add('hidden');
  needsRender = true;
}

// === Helpers ===

function addLabel(scene, parent, text) {
  const div = document.createElement('div');
  div.className = 'label-2d';
  div.textContent = text;
  const label = new CSS2DObject(div);
  label.position.set(0, 1.2, 0);
  parent.add(label);
  return label;
}

function showInfoPanel(data) {
  const panel = document.getElementById('info-panel');
  const content = document.getElementById('info-content');

  let html = `<div class="object-name">${data.name}</div><dl>`;
  html += `<dt>Type</dt><dd>${data.type}</dd>`;

  if (data.distanceFromSunAU) {
    html += `<dt>Distance from Sun</dt><dd>${data.distanceFromSunAU} AU</dd>`;
  }
  if (data.diameterKm) {
    html += `<dt>Diameter</dt><dd>${data.diameterKm} km</dd>`;
  }
  if (data.missDistanceKm) {
    html += `<dt>Miss Distance</dt><dd>${data.missDistanceKm} km</dd>`;
  }
  if (data.missDistanceAU) {
    html += `<dt>Miss Distance</dt><dd>${data.missDistanceAU} AU</dd>`;
  }
  if (data.velocityKmS) {
    html += `<dt>Velocity</dt><dd>${data.velocityKmS} km/s</dd>`;
  }
  if (data.hazardous) {
    html += `<dt>Hazardous</dt><dd>${data.hazardous}</dd>`;
  }

  html += '</dl>';
  content.innerHTML = html;
  panel.style.display = '';
}

function hideInfoPanel() {
  document.getElementById('info-panel').style.display = 'none';
}

function renderSpaceWeather(result) {
  const container = document.getElementById('space-weather-content');

  if (!result?.data) {
    container.innerHTML = '<div class="error-placeholder">Space weather unavailable</div>';
    return;
  }

  const { kp, flares } = result.data;

  let html = '';

  // Kp Index
  html += '<div style="margin-bottom:0.75rem;">';
  html += '<div style="color:var(--text-secondary);font-size:0.6875rem;">Kp Index</div>';
  if (kp.index !== null) {
    html += `<span class="kp-value" data-level="${kp.level}">${kp.index}</span>`;
    if (kp.index >= 5) {
      html += '<div style="color:var(--maybe);font-size:0.6875rem;margin-top:0.25rem;">Aurora possible</div>';
    }
  } else {
    html += '<span style="color:var(--text-muted);">No recent data</span>';
  }
  html += '</div>';

  // Recent flares
  if (flares?.length) {
    html += '<div style="color:var(--text-secondary);font-size:0.6875rem;margin-bottom:0.375rem;">Recent Flares</div>';
    for (const flare of flares.slice(0, 3)) {
      const time = flare.peakTime
        ? new Date(flare.peakTime).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
        : '';
      html += `<div style="font-size:0.75rem;margin-bottom:0.125rem;">
        <strong>${flare.classType || '?'}</strong> ${time}
      </div>`;
    }
  } else {
    html += '<div style="color:var(--text-muted);font-size:0.75rem;">No recent solar flares</div>';
  }

  if (result.stale) {
    html += '<span class="stale-indicator" style="margin-top:0.5rem;">stale data</span>';
  }

  container.innerHTML = html;
}

function updateSRSummary(results) {
  const el = document.getElementById('sr-summary');
  const parts = [];

  if (results.planets.data) {
    parts.push(`${results.planets.data.length} planets plotted`);
  }
  if (results.spacecraft.data) {
    parts.push(`${results.spacecraft.data.filter(s => s.defaultOn).length} spacecraft shown`);
  }
  if (results.asteroids.data) {
    parts.push(`${results.asteroids.data.length} near-Earth asteroids today`);
  }

  el.textContent = parts.length
    ? `Solar system loaded: ${parts.join(', ')}.`
    : 'Solar system data loading failed.';
}

// --- Spacecraft toggle persistence ---

function loadToggles() {
  try {
    return JSON.parse(localStorage.getItem('spacecraft-toggles') || '{}');
  } catch { return {}; }
}

function saveToggles() {
  const toggles = {};
  document.querySelectorAll('#spacecraft-toggles input[type="checkbox"]').forEach(cb => {
    toggles[cb.dataset.craftId] = cb.checked;
  });
  localStorage.setItem('spacecraft-toggles', JSON.stringify(toggles));
}

// --- WebGL Fallback ---

async function showFallback() {
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('canvas').style.display = 'none';
  document.getElementById('fallback').style.display = '';

  const results = await fetchAll(['planets', 'spacecraft', 'asteroids', 'space-weather']);
  const content = document.getElementById('fallback-content');

  let html = '';

  if (results.planets.data) {
    html += '<h2 style="margin:1rem 0 0.5rem;">Planets</h2>';
    html += '<table class="panel" style="width:100%;border-collapse:collapse;">';
    html += '<tr><th style="text-align:left;padding:0.5rem;">Name</th><th style="text-align:right;padding:0.5rem;">Distance (AU)</th></tr>';
    for (const p of results.planets.data) {
      if (!p.position) continue;
      const dist = Math.sqrt(p.position.x ** 2 + p.position.y ** 2 + p.position.z ** 2);
      html += `<tr><td style="padding:0.375rem 0.5rem;">${p.name}</td><td style="text-align:right;padding:0.375rem 0.5rem;">${dist.toFixed(3)}</td></tr>`;
    }
    html += '</table>';
  }

  if (results.spacecraft.data) {
    html += '<h2 style="margin:1rem 0 0.5rem;">Spacecraft</h2>';
    html += '<table class="panel" style="width:100%;border-collapse:collapse;">';
    html += '<tr><th style="text-align:left;padding:0.5rem;">Name</th><th style="text-align:right;padding:0.5rem;">Distance (AU)</th></tr>';
    for (const s of results.spacecraft.data) {
      html += `<tr><td style="padding:0.375rem 0.5rem;">${s.name}</td><td style="text-align:right;padding:0.375rem 0.5rem;">${s.distanceFromSunAU?.toFixed(3) || '?'}</td></tr>`;
    }
    html += '</table>';
  }

  content.innerHTML = html;
}

// --- Go ---
init();
