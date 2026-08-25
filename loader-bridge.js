/* =========================================================
   BRXDGE LOADER MARK — 3D bridge, rotate + assemble entrance
   The loader's brand mark used to be a flat SVG bridge that drew its arc
   and popped its hangers in via CSS. This is the real 3D twin-arch bridge
   (same geometry family as the hero's #heroOrbitMark) instead, doing a
   single, unrepeatable "super incredible" entrance every time the site
   loads: every strut, arch, rail, hanger, cross-brace and deck plate
   starts scattered and invisible around the finished bridge's shape,
   then flies inward — spinning, staggered left-to-right — while the
   whole rig turns fast on a turntable that spins down to a calm, steady
   rotation right as the last piece locks into place. It's the exact
   mirror of the hero mark's click-to-cross teardown (pieces converging
   instead of falling apart), just built independently here rather than
   shared with brand-orbit.js.

   Deliberately NOT a shared module with brand-orbit.js:
   - This scene is short-lived (a few seconds, once, ever) where the hero
     scene is continuous and visibility-gated for the life of the page.
     Keeping them fully independent means this scene's teardown/disposal
     can never race with or interfere with the hero scene's setup, which
     starts around the very same moment.
   - Like brand-orbit.js, the heavy part (building the ~20 separate
     arch/rail/hanger/brace/deck meshes and rendering the first frame) is
     deferred off the module's initial synchronous execution. This turned
     out to matter A LOT here specifically: running it synchronously at
     module-eval time was blocking script.js's loader countdown from
     ticking at all until it finished — freezing the percent counter and
     the whole page for as long as that setup took, especially on
     software-rendered WebGL. Deferring keeps that cost from ever
     competing with the loader's own setInterval for the main thread —
     worst case on a slow device, the loader plays out against the flat
     SVG fallback a little longer before the canvas swaps in, which is
     exactly the graceful-degradation path .loader-mark-fallback already
     exists for. script.js's own countdown is also driven off elapsed
     wall-clock time rather than a flat per-tick counter specifically so
     it can't be stretched out by a stall anywhere else on the page — see
     the comment there. No PMREM bake here either (see below) — between
     the two, this mark is meaningfully cheaper to stand up than the
     hero's.

   Timing is hardcoded to match script.js's loader countdown exactly (see
   the comments there): the mark's CSS .show class lands at 150ms, the
   percent count finishes at 4000ms, and the loader is fully gone from
   the DOM by ~6500ms (slowed down + given a slower expand exit per a
   client revision). This module keeps its own render loop alive a
   little past that (RENDER_LIFETIME_MS) and then disposes its GPU
   resources — the scene is never needed again once the loader unmounts.

   Same self-hosted-three.js / hand-built PMREM studio environment / SVG
   fallback-on-WebGL-failure conventions as brand-orbit.js throughout.
========================================================= */
import * as THREE from './assets/vendor/three.module.min.js';

(function initLoaderBridgeMark(){
  const mount = document.getElementById('loaderMark');
  const canvas = document.getElementById('loaderCanvas');
  if (!mount || !canvas) return;

  let renderer;
  try {
    // antialias off: MSAA is disproportionately expensive on software/
    // low-power WebGL fallback paths, and even at this mark's doubled
    // ~220px on-screen size (client revision) the difference stays subtle.
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false });
  } catch (e) {
    return; // flat SVG fallback stays visible — nothing else to do
  }
  if (!renderer) return;

  // Deferred off the module's synchronous execution — see the header
  // comment. A much shorter timeout than brand-orbit.js's (which can
  // afford to wait up to 1500ms, since the hero mark is hidden behind
  // the loader the whole time anyway): the loader itself is only on
  // screen for ~6.5s total, so this needs to fire fast.
  if ('requestIdleCallback' in window) {
    requestIdleCallback(setup, { timeout: 60 });
  } else {
    setTimeout(setup, 0);
  }

  function setup(){
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  camera.position.set(0, 0.3, 6.4);
  camera.lookAt(0, -0.05, 0);

  // No PMREM-baked environment here, unlike the hero mark — baking a
  // studio reflection map is a multi-pass render in its own right, and
  // on top of the geometry below it was the single biggest contributor
  // to this module's setup cost (the hero mark can absorb that cost
  // because its setup is fully decoupled from anything time-sensitive;
  // this one isn't). A brighter, more directional light rig below makes
  // up the difference with bold specular highlights instead of full
  // environment reflections — plenty convincing at the ~220px this mark
  // renders at for its few seconds on screen.
  const chromeMat = new THREE.MeshPhysicalMaterial({
    color: 0xf0f1f3,
    metalness: 1,
    roughness: 0.1,
    clearcoat: 0.5,
    clearcoatRoughness: 0.08,
    envMapIntensity: 1.6,
  });
  const deckMat = chromeMat.clone();
  deckMat.roughness = 0.34;
  deckMat.clearcoat = 0.25;

  // Fewer radial/tube segments than the hero mark's buildBridge() uses —
  // even at this mark's doubled ~220px on-screen size the extra smoothness
  // stays close to invisible for the few seconds it's up; cutting it
  // substantially reduces the
  // triangle count (and first-render shader/rasterization cost) across
  // the ~20 separate meshes below.
  function makeStrut(p1, p2, radius){
    const dir = new THREE.Vector3().subVectors(p2, p1);
    const len = dir.length();
    const geo = new THREE.CylinderGeometry(radius, radius, len, 6, 1);
    const mesh = new THREE.Mesh(geo, chromeMat);
    mesh.position.copy(p1).add(p2).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    return mesh;
  }

  // Same twin-arch silhouette as the hero mark's buildBridge(), at a
  // lower poly count (see the makeStrut comment above) and with fewer
  // hangers (6 per side instead of 8) — still reads clearly as the same
  // bridge motif at this size, with meaningfully less to render.
  function buildBridge(){
    const bridge = new THREE.Group();
    const half = 1.7, peak = 1.05, baseY = -0.15, deckY = -0.65, depth = 0.55;
    const archSegs = 24;

    function archPoint(t, z){
      return new THREE.Vector3(t * half, peak * (1 - t * t) + baseY, z);
    }

    [depth, -depth].forEach((z) => {
      const pts = [];
      for (let i = 0; i <= archSegs; i++){
        pts.push(archPoint(-1 + (2 * i / archSegs), z));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      const geo = new THREE.TubeGeometry(curve, 36, 0.055, 6, false);
      bridge.add(new THREE.Mesh(geo, chromeMat));
    });

    [depth, -depth].forEach((z) => {
      bridge.add(makeStrut(
        new THREE.Vector3(-half * 1.03, deckY, z),
        new THREE.Vector3(half * 1.03, deckY, z),
        0.045
      ));
    });

    const hangerXs = [-1.3, -0.75, -0.25, 0.25, 0.75, 1.3];
    [depth, -depth].forEach((z) => {
      hangerXs.forEach((x) => {
        bridge.add(makeStrut(archPoint(x / half, z), new THREE.Vector3(x, deckY, z), 0.022));
      });
    });

    [-1.2, -0.4, 0.4, 1.2].forEach((x) => {
      const t = x / half;
      bridge.add(makeStrut(archPoint(t, depth), archPoint(t, -depth), 0.028));
    });

    {
      const deckLength = half * 2 * 1.03;
      const deckSpan = depth * 2;
      const deckThickness = 0.09;
      const deckGeo = new THREE.BoxGeometry(deckLength, deckThickness, deckSpan);
      const deckMesh = new THREE.Mesh(deckGeo, deckMat);
      deckMesh.position.set(0, deckY - deckThickness / 2 - 0.01, 0);
      bridge.add(deckMesh);
    }

    return bridge;
  }

  const rig = new THREE.Group();
  const bridge = buildBridge();
  rig.add(bridge);
  rig.rotation.set(0.12, -0.5, 0);
  scene.add(rig);

  // Without an environment map, the light rig carries the whole "polished
  // chrome" read on its own — brighter and busier than the hero mark's
  // (a third, cooler accent light added below) so the specular highlights
  // alone do the job full PMREM reflections would otherwise do.
  const keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
  keyLight.position.set(4, 5, 6);
  const rimLight = new THREE.DirectionalLight(0xcfdcee, 1.6);
  rimLight.position.set(-5, -2, -4);
  const accentLight = new THREE.DirectionalLight(0xdfe6f2, 1.3);
  accentLight.position.set(-2, 4, -5);
  const fillLight = new THREE.HemisphereLight(0xf5f6fa, 0x0b0b0d, 0.6);
  scene.add(keyLight, rimLight, accentLight, fillLight);

  function fitSize(){
    const rect = mount.getBoundingClientRect();
    const w = Math.max(Math.round(rect.width), 60);
    const h = Math.max(Math.round(rect.height), 60);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  // No resize listener here on purpose — the loader is on screen for
  // only a few seconds total, so a mid-load viewport resize (rotating a
  // phone, say) isn't worth the extra listener/cleanup bookkeeping the
  // long-lived hero mark needs. fitSize() runs once, up front.
  fitSize();

  // ---------------- ROTATE + ASSEMBLE ENTRANCE ----------------
  // Every piece (both arches, both deck rails, all 12 hangers, the 4
  // cross-braces, the flat deck plate) starts scattered around the
  // bridge's finished shape and invisible, then flies inward to its
  // resting position/rotation on a staggered per-piece timeline — the
  // literal reverse of the hero mark's click-to-cross teardown, which
  // this borrows its fall/opacity/quaternion math from.
  const pieces = bridge.children.map((mesh) => {
    mesh.material = mesh.material.clone();
    mesh.material.transparent = true;
    const restPos = mesh.position.clone();
    const restQuat = mesh.quaternion.clone();

    // Scattered starting point: a random offset from rest, well outside
    // the bridge's own silhouette, plus a fully random starting spin so
    // each piece visibly tumbles into alignment as it arrives.
    const scatterDir = new THREE.Vector3(
      (Math.random() - 0.5) * 2,
      (Math.random() - 0.5) * 2,
      (Math.random() - 0.5) * 2
    ).normalize();
    const scatterRadius = 1.7 + Math.random() * 1.7;
    const fromPos = restPos.clone().add(scatterDir.multiplyScalar(scatterRadius));
    const fromQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2
    ));

    return { mesh, restPos, restQuat, fromPos, fromQuat, delay: 0, flyMs: 0 };
  });

  // Staggered left-to-right, mirroring the hero teardown's own left-to-
  // right bias (there: the structure lets go from one end; here: it
  // builds itself the same direction). Slowed down a little (client
  // revision) from the original 1100/650/1000 so the assembly reads as
  // more deliberate rather than a quick snap-together.
  const ASSEMBLE_SPAN_MS = 1500;
  const FLY_MS_MIN = 900;
  const FLY_MS_MAX = 1400;
  {
    const xs = pieces.map((p) => p.restPos.x);
    const minX = Math.min.apply(null, xs);
    const maxX = Math.max.apply(null, xs);
    const xRange = Math.max(maxX - minX, 0.001);
    pieces.forEach((p) => {
      const xt = (p.restPos.x - minX) / xRange;
      p.delay = xt * ASSEMBLE_SPAN_MS + Math.random() * 260;
      p.flyMs = FLY_MS_MIN + Math.random() * (FLY_MS_MAX - FLY_MS_MIN);
    });
  }
  const lastPieceDoneMs = Math.max.apply(null, pieces.map((p) => p.delay + p.flyMs));

  // Pieces stay scattered/invisible until this many ms in — synced to
  // script.js's own setTimeout(() => loaderMark.classList.add('show'),
  // 150) so the assembly starts exactly as the mark's drop-in reveals
  // it, rather than mid-flight and already partway assembled.
  const START_DELAY_MS = 150;

  // Turntable: spins fast through the assembly (a visible "whirl" the
  // pieces are flying out of) and decays down to the hero mark's own
  // calm ambient speed right as the last piece locks in — the "combine
  // rotation and assembling" ask, as one continuous motion rather than
  // two separate effects layered on top of each other.
  const SPIN_AMBIENT = 0.28;
  const SPIN_BURST = 6.2;
  const SPIN_DECAY_MS = Math.max(lastPieceDoneMs, 900);

  function easeOutCubic(t){ return 1 - Math.pow(1 - t, 3); }

  function setPiecesToRest(){
    pieces.forEach((p) => {
      p.mesh.position.copy(p.restPos);
      p.mesh.quaternion.copy(p.restQuat);
      p.mesh.material.opacity = 1;
    });
  }

  function setPiecesToScattered(){
    pieces.forEach((p) => {
      p.mesh.position.copy(p.fromPos);
      p.mesh.quaternion.copy(p.fromQuat);
      p.mesh.material.opacity = 0;
    });
  }

  // Advances every piece to where it should be at `elapsed` ms since the
  // scene first rendered. Mirrors updateTeardown() in brand-orbit.js,
  // just interpolating scattered -> rest instead of rest -> fallen.
  function updateAssemble(elapsed){
    const local0 = elapsed - START_DELAY_MS;
    pieces.forEach((p) => {
      const local = local0 - p.delay;
      if (local <= 0) {
        p.mesh.position.copy(p.fromPos);
        p.mesh.quaternion.copy(p.fromQuat);
        p.mesh.material.opacity = 0;
        return;
      }
      const t = Math.min(local / p.flyMs, 1);
      const e = easeOutCubic(t);
      p.mesh.position.lerpVectors(p.fromPos, p.restPos, e);
      p.mesh.quaternion.copy(p.fromQuat).slerp(p.restQuat, e);
      // Materializes quickly once it starts moving, rather than fading
      // in gradually across the whole flight — reads as each piece
      // snapping into existence as it joins the structure.
      p.mesh.material.opacity = Math.min(t / 0.22, 1);
    });
  }

  renderer.render(scene, camera); // first paint, before the loop/reduced-motion branch
  mount.classList.add('is-ready');

  if (reduceMotion) {
    // No flight, no spin — just the finished bridge, once.
    setPiecesToRest();
    renderer.render(scene, camera);
    return;
  }

  setPiecesToScattered();

  const RENDER_LIFETIME_MS = 6800; // covers script.js's full ~6500ms loader lifecycle (slowed + slower expand exit), plus a small buffer
  let disposed = false;
  const start = performance.now();
  let rafId;

  function tick(now){
    if (disposed) return;
    rafId = requestAnimationFrame(tick);
    const elapsed = now - start;
    const dt = Math.min((now - (tick.last || now)) / 1000, 0.05);
    tick.last = now;

    if (elapsed < START_DELAY_MS + lastPieceDoneMs) {
      updateAssemble(elapsed);
    }
    const spinT = Math.max(0, 1 - elapsed / SPIN_DECAY_MS);
    rig.rotation.y += dt * (SPIN_AMBIENT + SPIN_BURST * spinT * spinT);

    renderer.render(scene, camera);

    if (elapsed >= RENDER_LIFETIME_MS) {
      disposed = true;
      cancelAnimationFrame(rafId);
      renderer.dispose();
    }
  }
  rafId = requestAnimationFrame(tick);
  } // end setup()
})();
