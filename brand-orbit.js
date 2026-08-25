/* =========================================================
   BRXDGE ANIMATED 3D MARK
   The site's kinetic signature visual — a twin lattice-truss arch bridge
   (trussed arch + railed deck + hangers + end-bearing blocks, matching
   the client's reference bridge artwork), the same motif as the flat
   bridge-cable mark used everywhere else on this site (nav logo,
   loader, about section, footer), rebuilt in polished chrome as a real
   3D object turning slowly above the hero headline like a piece on
   display. It's also a real, keyboard-operable <button> (see
   index.html) — clicking/Enter/Space stops the turntable, lets the
   bridge come apart piece by piece as every strut drops away and
   fades, and that teardown itself carries the visitor down to the
   next section — a slow, deliberate handoff rather than a quick cut.

   - Self-hosted three.js (assets/vendor/three.module.min.js) — no
     external CDN dependency, so this works offline and never
     depends on a third-party host being reachable.
   - A hand-built PMREM "studio" environment (a dark room + a bright
     near-white panel + a subtle cool-gray panel + a point light) is
     baked once at startup so the chrome picks up believable mirror
     reflection bands without needing an external HDRI file.
   - Pauses the render loop while the hero is scrolled out of view
     (IntersectionObserver) and renders a single static frame under
     prefers-reduced-motion — same conventions already used
     throughout script.js/style.css for every other animation here.
     The click-to-cross interaction still works under reduced motion;
     it just skips straight to the scroll instead of the teardown.
   - If WebGL or the module import ever fails (old browser, GPU
     blocked, file:// instead of a local server), the canvas is
     swapped for the flat SVG bridge mark so the hero never breaks.
========================================================= */
import * as THREE from './assets/vendor/three.module.min.js';

(function initBrandOrbitMark(){
  const mount = document.getElementById('heroOrbitMark');
  const canvas = document.getElementById('heroOrbitCanvas');
  if (!mount || !canvas) return;

  function showFallback(){
    mount.classList.add('orbit-fallback');
  }

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  } catch (e) {
    showFallback();
    return;
  }
  if (!renderer) { showFallback(); return; }

  // The scene/environment/PMREM setup below is the heavy part (baking a
  // studio reflection map, building geometry). Deferred to an idle moment
  // rather than running immediately at module-eval time, so it can never
  // compete with the loader's setInterval countdown or the hero's own
  // entrance transitions for main-thread time on a slower device.
  if ('requestIdleCallback' in window) {
    requestIdleCallback(setup, { timeout: 1500 });
  } else {
    setTimeout(setup, 150);
  }

  function setup(){
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  camera.position.set(0, 0.35, 7.2);
  camera.lookAt(0, -0.05, 0);

  // Self-contained studio-style environment (dark room + a bright
  // near-white panel + a subtle cool-gray panel + a point light), baked
  // into a PMREM texture — a high-contrast, mostly-neutral setup so the
  // metal reads as polished mirror chrome (bright white highlight bands
  // against near-black reflection pockets) rather than picking up strong
  // color casts.
  function buildEnvironmentScene(){
    const envScene = new THREE.Scene();
    const geometry = new THREE.BoxGeometry();
    geometry.deleteAttribute('uv');
    const room = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ side: THREE.BackSide, color: 0x050505 }));
    room.scale.set(20, 20, 20);
    envScene.add(room);

    const mainLight = new THREE.PointLight(0xffffff, 60, 28, 2);
    mainLight.position.set(3, 6, 3);
    envScene.add(mainLight);

    const bright = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    bright.position.set(-8, 3, -4);
    bright.rotation.y = Math.PI / 3;
    envScene.add(bright);

    const coolGray = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), new THREE.MeshBasicMaterial({ color: 0xb9c4d4 }));
    coolGray.position.set(8, -2, 4);
    coolGray.rotation.y = -Math.PI / 3;
    envScene.add(coolGray);

    const soft = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), new THREE.MeshBasicMaterial({ color: 0xf2f4f8 }));
    soft.position.set(0, 8, -6);
    soft.rotation.x = Math.PI / 2.4;
    envScene.add(soft);

    return envScene;
  }

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(buildEnvironmentScene(), 0.04).texture;

  // Polished chrome/platinum metal — near-white with very low roughness
  // for sharp mirror-like reflections, matching the site's existing
  // chrome/steel identity (the --chrome text-clip gradient, brand-mark
  // fills, etc.) instead of standing apart as a separate accent color.
  const chromeMat = new THREE.MeshPhysicalMaterial({
    color: 0xf0f1f3,
    metalness: 1,
    roughness: 0.1,
    clearcoat: 0.5,
    clearcoatRoughness: 0.08,
    envMapIntensity: 1.6,
  });

  // Slightly higher roughness than the struts/arches — a large flat panel
  // at strut-level mirror polish would blow out into a single bright glare
  // slab under the key/rim lights instead of reading as a deck surface.
  // Still the same chrome family (same base color, still metal), just
  // softened so the panel's own subtle reflections stay legible.
  const deckMat = chromeMat.clone();
  deckMat.roughness = 0.34;
  deckMat.clearcoat = 0.25;

  // A strut is a cylinder stretched and oriented between two points — used
  // for every straight member (truss chords/diagonals, hangers, rail
  // posts). All struts share ONE unit cylinder geometry (radius 1, height
  // 1, scaled per-instance) rather than each baking its own — the lattice
  // truss arches below need well over a hundred of these, so reusing a
  // single buffer keeps geometry/GPU-upload cost from scaling with strut
  // count; only the transform differs per piece.
  const UNIT_CYL = new THREE.CylinderGeometry(1, 1, 1, 10, 1);
  const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
  function makeStrut(p1, p2, radius, mat){
    const dir = new THREE.Vector3().subVectors(p2, p1);
    const len = Math.max(dir.length(), 0.0001);
    const mesh = new THREE.Mesh(UNIT_CYL, mat || chromeMat);
    mesh.scale.set(radius, len, radius);
    mesh.position.copy(p1).add(p2).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    return mesh;
  }

  // Twin lattice-truss arches (front + back — a bowstring/lenticular truss
  // bridge, matching the site's reference bridge artwork) with a railed
  // deck slung below on vertical hangers and chunky end-bearing blocks
  // where each arch springs from the deck. Same twin-arch-plus-deck
  // silhouette as the flat SVG bridge mark used elsewhere on the site,
  // just built as an actual trussed 3D structure instead of a smooth tube.
  function buildBridge(){
    const bridge = new THREE.Group();
    const half = 1.7, peak = 1.05, baseY = -0.15, deckY = -0.65, depth = 0.55;
    const archSegs = 12; // truss bays per arch (real strut count now, not just tube smoothness)
    const trussDepth = 0.16; // perpendicular thickness of the lattice band

    function archOuter(t, z){
      return new THREE.Vector3(t * half, peak * (1 - t * t) + baseY, z);
    }
    // Perpendicular to the arch's tangent (half, -2*peak*t), pointing
    // inward/downward through the truss band, so the inner chord traces a
    // curve offset a constant distance inside the outer one.
    function archNormal(t){
      const nx = -2 * peak * t, ny = -half;
      const len = Math.hypot(nx, ny) || 1;
      return { x: nx / len, y: ny / len };
    }
    function archInner(t, z){
      const o = archOuter(t, z);
      const n = archNormal(t);
      return new THREE.Vector3(o.x + n.x * trussDepth, o.y + n.y * trussDepth, z);
    }

    // Outer + inner chord, X-braced between them every bay — the lattice
    // look, replacing the old single smooth tube.
    [depth, -depth].forEach((z) => {
      const outerPts = [], innerPts = [];
      for (let i = 0; i <= archSegs; i++){
        const t = -1 + (2 * i / archSegs);
        outerPts.push(archOuter(t, z));
        innerPts.push(archInner(t, z));
      }
      for (let i = 0; i < archSegs; i++){
        bridge.add(makeStrut(outerPts[i], outerPts[i + 1], 0.048));  // top chord
        bridge.add(makeStrut(innerPts[i], innerPts[i + 1], 0.042));  // bottom chord
        bridge.add(makeStrut(outerPts[i], innerPts[i + 1], 0.024));  // diagonal \
        bridge.add(makeStrut(innerPts[i], outerPts[i + 1], 0.024));  // diagonal /
      }
    });

    // Chunky end-bearing blocks where each arch springs from the deck — a
    // solid abutment instead of the arch tapering off to a bare point.
    function makeEndBlock(x){
      const w = 0.22, h = 0.34, d = depth * 2 + 0.14;
      const mesh = new THREE.Mesh(UNIT_BOX, deckMat);
      mesh.scale.set(w, h, d);
      mesh.position.set(x, deckY + h / 2 - 0.06, 0);
      return mesh;
    }
    [-half * 1.05, half * 1.05].forEach((x) => bridge.add(makeEndBlock(x)));

    // Vertical hangers suspending the deck from each arch's outer chord
    const hangerXs = [-1.4, -0.85, -0.3, 0.3, 0.85, 1.4];
    [depth, -depth].forEach((z) => {
      hangerXs.forEach((x) => {
        bridge.add(makeStrut(archOuter(x / half, z), new THREE.Vector3(x, deckY, z), 0.022));
      });
    });

    // Flat deck plate — a real, solid roadway surface. Its top face sits
    // flush with the railing posts below, so the railing reads as rising
    // straight up from the edge of a continuous deck.
    {
      const deckLength = half * 2 * 1.03;
      const deckSpan = depth * 2;
      const deckThickness = 0.09;
      const deckMesh = new THREE.Mesh(UNIT_BOX, deckMat);
      deckMesh.scale.set(deckLength, deckThickness, deckSpan);
      deckMesh.position.set(0, deckY - deckThickness / 2 - 0.01, 0);
      bridge.add(deckMesh);
    }

    // Deck-edge railing — a top rail plus evenly spaced vertical balusters
    // along each side, replacing the old bare curb-rail strut with an
    // actual guardrail matching the reference artwork's railed deck.
    {
      const railTopY = deckY + 0.15;
      const balusterXs = [-1.55, -1.05, -0.55, -0.05, 0.45, 0.95, 1.45];
      [depth, -depth].forEach((z) => {
        bridge.add(makeStrut(
          new THREE.Vector3(-half * 1.03, railTopY, z),
          new THREE.Vector3(half * 1.03, railTopY, z),
          0.026
        ));
        balusterXs.forEach((x) => {
          bridge.add(makeStrut(
            new THREE.Vector3(x, deckY, z),
            new THREE.Vector3(x, railTopY, z),
            0.014
          ));
        });
      });
    }

    return bridge;
  }

  // "rig" is the group that actually spins — keeping the bridge itself as
  // a separate child makes it simple to re-tilt/re-scale the whole thing
  // later without touching the turntable rotation logic below.
  const rig = new THREE.Group();
  const bridge = buildBridge();
  rig.add(bridge);
  rig.rotation.set(0.12, -0.5, 0);
  scene.add(rig);

  // Every strut/arch/beam gets its own cloned material so its opacity can
  // fade independently once the teardown starts below — with the single
  // shared chromeMat, fading one piece would fade every piece at once.
  // originPos/originQuat are captured here (before anything ever moves)
  // so the whole bridge can be put back together after a click.
  const pieces = bridge.children.map((mesh) => {
    mesh.material = mesh.material.clone();
    mesh.material.transparent = true;
    return {
      mesh,
      originPos: mesh.position.clone(),
      originQuat: mesh.quaternion.clone(),
      delay: 0,
      fallMs: 0,
      driftX: 0,
      driftZ: 0,
      spinAxis: new THREE.Vector3(),
      spinSpeed: 0,
    };
  });

  // Stagger + motion for each piece is rolled once at startup (not
  // re-randomized per click) so the teardown looks the same, deliberate
  // way every time. Delay is biased left-to-right across the span of the
  // bridge, so it reads as the structure letting go from one end rather
  // than every piece vanishing simultaneously.
  const TEAR_SPAN_MS = 900;   // spread of stagger start times, left to right
  const FALL_MS_MIN = 1200;
  const FALL_MS_MAX = 1900;
  {
    const xs = pieces.map((p) => p.originPos.x);
    const minX = Math.min.apply(null, xs);
    const maxX = Math.max.apply(null, xs);
    const xRange = Math.max(maxX - minX, 0.001);
    pieces.forEach((p) => {
      const xt = (p.originPos.x - minX) / xRange; // 0 = left end, 1 = right end
      p.delay = xt * TEAR_SPAN_MS + Math.random() * 320;
      p.fallMs = FALL_MS_MIN + Math.random() * (FALL_MS_MAX - FALL_MS_MIN);
      p.driftX = (Math.random() - 0.5) * 1.4;
      p.driftZ = (Math.random() - 0.5) * 1.1;
      p.spinAxis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      p.spinSpeed = (Math.random() - 0.5) * 3.2;
    });
  }
  const SEQUENCE_MS = TEAR_SPAN_MS + FALL_MS_MAX + 320; // worst-case last piece finishing
  const SCROLL_AT_MS = 2000; // start the scroll while the last few pieces are still fading, so the handoff feels continuous
  const RESET_AT_MS = SEQUENCE_MS + 300;

  const keyLight = new THREE.DirectionalLight(0xffffff, 2.1);
  keyLight.position.set(4, 5, 6);
  const rimLight = new THREE.DirectionalLight(0xcfdcee, 0.9);
  rimLight.position.set(-5, -2, -4);
  const fillLight = new THREE.HemisphereLight(0xf5f6fa, 0x0b0b0d, 0.45);
  scene.add(keyLight, rimLight, fillLight);

  function fitSize(){
    const rect = mount.getBoundingClientRect();
    const w = Math.max(Math.round(rect.width), 120);
    const h = Math.max(Math.round(rect.height), 80);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  fitSize();

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(fitSize, 150);
  });

  // Only spend GPU/CPU cycles rotating and re-rendering while the mark
  // is actually on screen.
  let visible = true;
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => { visible = entry.isIntersecting; });
    }, { threshold: 0.01 });
    io.observe(mount);
  }

  renderer.render(scene, camera); // first paint, before the loop/reduced-motion branch
  mount.classList.add('is-ready');

  // ---------------- CLICK-TO-CROSS INTERACTION ----------------
  // The mark is a real <button> (see index.html), so this fires on click,
  // Enter, and Space for free. Full sequence:
  //   1. The turntable stops dead where it is — no ramp, no flourish —
  //      so the structure holds still and the teardown reads clearly.
  //   2. Every individual piece (every truss chord segment and diagonal in
  //      both lattice arches, all 12 hangers, both end-bearing blocks, the
  //      flat deck plate, and every railing post) lets go on its own
  //      staggered delay biased left-to-right, then falls under a
  //      gentle gravity curve, drifting slightly and tumbling as it
  //      fades out — the bridge comes apart piece by piece rather than
  //      bursting all at once.
  //   3. The smooth-scroll to the next section starts once most of the
  //      bridge has already fallen away, so the disassembly itself is
  //      the transition — slow and continuous, not a fast cut.
  //   4. Every piece is quietly put back at its resting position,
  //      rotation and full opacity afterwards, so the bridge is whole
  //      again if the visitor scrolls back up to the hero.
  const AMBIENT_SPEED = 0.28;
  let launching = false;
  let tearing = false;
  let tearStart = 0;

  function goToNextSection(){
    // Targets "what-we-do" rather than the old "services" id — after the
    // hero/"BRIDGING CREATORS" section swap, "services" no longer exists
    // as an id, and landing here on the bridge-mark section itself (now
    // directly below the hero) would just scroll the visitor back to
    // content they've already seen. "what-we-do" is the next new content
    // on the page, so crossing the bridge still carries them forward.
    if (typeof window.scrollToSection === 'function') {
      window.scrollToSection('what-we-do');
    } else {
      const el = document.getElementById('what-we-do');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  // Advances every piece to where it should be at `elapsed` ms into the
  // teardown. Pieces whose delay hasn't been reached yet simply sit at
  // rest — nothing moves until its own turn comes.
  function updateTeardown(elapsed){
    pieces.forEach((p) => {
      const local = elapsed - p.delay;
      if (local <= 0) {
        p.mesh.position.copy(p.originPos);
        p.mesh.quaternion.copy(p.originQuat);
        p.mesh.material.opacity = 1;
        return;
      }
      const t = Math.min(local / p.fallMs, 1);
      const fallDist = 2.6 * t * t; // quadratic — starts slow, accelerates like real gravity
      p.mesh.position.set(
        p.originPos.x + p.driftX * t,
        p.originPos.y - fallDist,
        p.originPos.z + p.driftZ * t
      );
      p.mesh.quaternion.copy(p.originQuat);
      p.mesh.rotateOnWorldAxis(p.spinAxis, p.spinSpeed * t);
      // Fully solid while it detaches, then eases out over the back half
      // of the fall — reads as "drop, then dissolve" rather than melting
      // away in place.
      p.mesh.material.opacity = t < 0.55 ? 1 : 1 - ((t - 0.55) / 0.45);
    });
  }

  function resetPieces(){
    pieces.forEach((p) => {
      p.mesh.position.copy(p.originPos);
      p.mesh.quaternion.copy(p.originQuat);
      p.mesh.material.opacity = 1;
    });
  }

  function launchBridge(){
    if (launching) return;
    launching = true;

    if (reduceMotion) {
      // Skip the teardown spectacle entirely and just take them there.
      goToNextSection();
      launching = false;
      return;
    }

    mount.classList.add('is-launching');
    tearing = true;
    tearStart = performance.now();

    setTimeout(goToNextSection, SCROLL_AT_MS);
    setTimeout(() => {
      tearing = false;
      resetPieces();
      mount.classList.remove('is-launching');
      launching = false;
    }, RESET_AT_MS);
  }

  mount.addEventListener('click', launchBridge);

  if (reduceMotion) {
    return; // a single settled frame, no rotation loop
  }

  // A bridge has a clear "up" — unlike the twin-ring version this
  // replaced, it turns like a piece on a display turntable (Y-axis only)
  // rather than tumbling on multiple axes, so the deck never flips.
  let last = performance.now();
  function tick(now){
    requestAnimationFrame(tick);
    if (!visible) { last = now; return; }
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (tearing) {
      updateTeardown(now - tearStart);
    } else {
      rig.rotation.y += dt * AMBIENT_SPEED;
    }
    renderer.render(scene, camera);
  }
  requestAnimationFrame(tick);
  } // end setup()
})();
