/* ============================================================
   report-live-chart.js — renders the small 3D bar chart inside
   #reportLivePanel (the "Live Performance" box in the top-right of
   report.html's header, next to the brand title).

   A separate ES module from report.js (a plain classic script) purely
   because this needs Three.js — reuses the exact same self-hosted vendor
   copy loader-bridge.js and brand-orbit.js already load from
   ./assets/vendor/, so there's nothing new to install or host.

   Decoupled from report.js via a CustomEvent ('brxdge:report-ready',
   dispatched by initLivePanel() in report.js once it has real numbers —
   see that file) rather than a direct function call, since a classic
   script and a module script don't share a top-level scope for one to
   just call a function on the other. report.js re-dispatches this event
   every time it refreshes the roster (about every 45s while the tab is
   visible), so the chart rebuilds itself with whatever's current — this
   file has no polling or fetching of its own to do.
   ============================================================ */
import * as THREE from './assets/vendor/three.module.min.js';

let scene, camera, renderer, barGroup, mount;
let rafId = null;
let spinT = 0;

function ensureScene(){
  if(renderer) return true;
  mount = document.getElementById('rlpCanvasWrap');
  if(!mount) return false;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(38, 1, 0.1, 50);
  camera.position.set(2.6, 2.3, 4.6);
  camera.lookAt(0, 0.4, 0);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  mount.innerHTML = '';
  mount.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.05);
  key.position.set(3, 5, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffffff, 0.35);
  rim.position.set(-3, 2, -3);
  scene.add(rim);

  barGroup = new THREE.Group();
  scene.add(barGroup);

  fitSize();
  window.addEventListener('resize', fitSize);
  return true;
}

function fitSize(){
  if(!mount || !renderer) return;
  const w = mount.clientWidth || 260;
  const h = mount.clientHeight || 130;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function disposeBars(){
  barGroup.children.forEach(mesh => {
    mesh.geometry.dispose();
    mesh.material.dispose();
  });
  while(barGroup.children.length) barGroup.remove(barGroup.children[0]);
}

// Rebuilds the bars from scratch on every metrics update (at most every
// ~45s — see report.js) rather than animating individual bars between
// datasets — simpler, and a platform mix changing height slightly every
// 45s doesn't need a tween to read clearly.
function buildBars(metrics){
  disposeBars();

  const bars = (metrics && metrics.bars || []).slice(0, 6);
  if(!bars.length) return;

  const maxVal = Math.max(...bars.map(b => b.value), 1);
  const count = bars.length;
  const spacing = 0.64;
  const barSize = 0.42;
  const maxHeight = 2.1;
  const startX = -((count - 1) * spacing) / 2;

  bars.forEach((bar, i) => {
    const h = Math.max(0.14, (bar.value / maxVal) * maxHeight);
    const geo = new THREE.BoxGeometry(barSize, h, barSize);
    // Bars arrive pre-sorted descending (see computeLiveMetrics() in
    // report.js), so index 0 is always the lead platform — it gets the
    // brightest shade, fading toward graphite for the rest, so the chart
    // reads at a glance instead of competing evenly for attention.
    const shade = 0.88 - (i / Math.max(count - 1, 1)) * 0.5;
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(shade, shade, shade),
      roughness: 0.45,
      metalness: 0.12,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(startX + i * spacing, h / 2, 0);
    barGroup.add(mesh);
  });

  // Re-aim the camera at the actual average bar height so a short dataset
  // (one or two platforms) doesn't look like it's floating in an
  // otherwise-empty frame.
  const avgHeight = bars.reduce((sum, b) => sum + Math.max(0.14, (b.value / maxVal) * maxHeight), 0) / count;
  camera.lookAt(0, avgHeight / 2, 0);
}

function animate(){
  rafId = requestAnimationFrame(animate);
  // A slow back-and-forth sweep rather than a full continuous spin — a
  // small panel spinning nonstop next to a headline reads as distracting,
  // not "alive." This just reads as a gentle 3D presence.
  spinT += 0.006;
  if(barGroup) barGroup.rotation.y = Math.sin(spinT) * 0.45;
  renderer.render(scene, camera);
}

function renderMetrics(metrics){
  if(!ensureScene()) return;
  fitSize();
  buildBars(metrics);
  if(!rafId) animate();
}

window.addEventListener('brxdge:report-ready', (e) => renderMetrics(e.detail));
