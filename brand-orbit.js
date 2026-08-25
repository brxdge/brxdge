/* =========================================================
   BRXDGE ANIMATED 3D MARK
   The site's kinetic signature visual — a twin-arch suspension bridge
   (arch + hangers + deck + cross-bracing), the same motif as the flat
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

// Client revision: this used to be a one-off IIFE hardcoded to the hero's
// #heroOrbitMark/#heroOrbitCanvas pair. Turned into a reusable function so
// the same chrome bridge mark can also sit in the full roster overlay's
// footer as a purely decorative centerpiece — same geometry/materials/
// ambient turntable rotation, just mounted on a second, independent
// mount+canvas pair with its own renderer/scene (so each only costs GPU
// cycles while it's actually the one in view — see the IntersectionObserver
// pause below, unchanged). `opts.interactive` (default true) gates the
// click-to-cross teardown-and-scroll interaction: the footer instance
// passes false so it's a still, non-clickable mark that never fires
// launchBridge() / goToNextSection() — nothing happens on click, and it
// never sends the visitor back up to the hero or anywhere else.
function initBrandOrbitMark(mountId, canvasId, opts){
  opts = opts || {};
  const interactive = opts.interactive !== false;
  const mount = document.getElementById(mountId);
  const canvas = document.getElementById(canvasId);
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

  // A strut is a cylinder stretched and oriented between two points —
  // used for every straight member (deck rails, hangers, cross-braces,
  // guardrail posts, lattice bracing, deck stringers). radialSegs is
  // configurable per call so thick, prominent members (rails, hangers)
  // stay smooth while thin secondary members (lattice, posts) stay cheap.
  function makeStrut(p1, p2, radius, radialSegs){
    const dir = new THREE.Vector3().subVectors(p2, p1);
    const len = dir.length();
    const geo = new THREE.CylinderGeometry(radius, radius, len, radialSegs || 10, 1);
    const mesh = new THREE.Mesh(geo, chromeMat);
    mesh.position.copy(p1).add(p2).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    return mesh;
  }

  // Minimal hand-rolled geometry merge (position + normal + index only —
  // nothing here ever needs UVs, none of these materials carry a texture
  // map) so a whole family of small parts — a truss's lattice, a
  // guardrail's posts, every rivet plate — can be baked into one static
  // BufferGeometry and drawn in a single call instead of one draw call per
  // strut. No BufferGeometryUtils dependency: that addon isn't part of the
  // self-hosted three.module.min.js core build this site uses.
  function mergeGeoms(geoms){
    let totalVerts = 0, totalIndices = 0;
    geoms.forEach((g) => {
      totalVerts += g.attributes.position.count;
      totalIndices += g.index ? g.index.count : g.attributes.position.count;
    });
    const positions = new Float32Array(totalVerts * 3);
    const normals = new Float32Array(totalVerts * 3);
    const IndexArray = totalVerts > 65535 ? Uint32Array : Uint16Array;
    const indices = new IndexArray(totalIndices);
    let vOff = 0, iOff = 0;
    geoms.forEach((g) => {
      const count = g.attributes.position.count;
      positions.set(g.attributes.position.array, vOff * 3);
      if (g.attributes.normal) normals.set(g.attributes.normal.array, vOff * 3);
      if (g.index) {
        const idx = g.index.array;
        for (let i = 0; i < idx.length; i++) indices[iOff + i] = idx[i] + vOff;
        iOff += idx.length;
      } else {
        for (let i = 0; i < count; i++) indices[iOff + i] = i + vOff;
        iOff += count;
      }
      vOff += count;
    });
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    merged.setIndex(new THREE.BufferAttribute(indices, 1));
    return merged;
  }

  // Bakes a throwaway mesh's transform directly into its geometry's
  // vertices, then discards the mesh — lets a batch of pre-positioned
  // geometries for mergeGeoms() be built out of ordinary makeStrut()/
  // primitive calls instead of hand-rolled vertex math for every lattice
  // diagonal, post and rivet.
  function bakedGeo(mesh){
    mesh.updateMatrix();
    const g = mesh.geometry.clone();
    g.applyMatrix4(mesh.matrix);
    mesh.geometry.dispose();
    return g;
  }

  // Merges a batch of baked geometries into one mesh, then re-centers the
  // merged geometry on its own bounding-box center and moves that offset
  // onto the mesh's position — so the result behaves exactly like every
  // other top-level piece below (mesh.position sits at the piece's own
  // center). That's what lets the click-to-cross teardown spin and drop a
  // whole merged chunk (a lattice, a guardrail) as one rigid piece around
  // its own middle instead of around the bridge's origin.
  function mergedMesh(geoBits, material){
    const g = mergeGeoms(geoBits);
    geoBits.forEach((geo) => geo.dispose());
    g.computeBoundingBox();
    const center = new THREE.Vector3();
    g.boundingBox.getCenter(center);
    g.translate(-center.x, -center.y, -center.z);
    const mesh = new THREE.Mesh(g, material);
    mesh.position.copy(center);
    return mesh;
  }

  // Secondary steel tone — a shade cooler/darker than the main chromeMat
  // and a touch rougher, so lattice bracing and stringers read as
  // structural steel sitting *behind* the polished outer chords/rails
  // instead of the whole rig fusing into one flat silver mass.
  const steelMat = chromeMat.clone();
  steelMat.color = new THREE.Color(0xd6d9dd);
  steelMat.roughness = 0.24;
  steelMat.clearcoat = 0.2;
  steelMat.envMapIntensity = 1.3;

  // Bearing-plate tone for the arch-foot anchors — same neutral family as
  // deckMat, just darker/more matte, reading as a cast fitting rather than
  // more polished tube.
  const anchorMat = deckMat.clone();
  anchorMat.color = new THREE.Color(0xc7cad0);
  anchorMat.roughness = 0.42;

  // Small, extra-glossy highlight material for the rivet/gusset nodes at
  // every joint — shinier than everything else so each one catches a
  // sharp point of specular light as the rig turns, the same way real
  // bolted steel connections do.
  const rivetMat = chromeMat.clone();
  rivetMat.roughness = 0.04;
  rivetMat.clearcoat = 0.7;

  // Deck-marking tone — a dark, mostly non-metallic groove color for the
  // centerline and expansion joints, distinct enough from deckMat to read
  // as a shadowed seam without introducing a brand-breaking accent color.
  const markMat = new THREE.MeshPhysicalMaterial({
    color: 0x26282d,
    metalness: 0.35,
    roughness: 0.6,
    clearcoat: 0.1,
    envMapIntensity: 0.8,
  });

  // Twin lenticular-truss arches (front + back, like a real box-arch/
  // bowstring bridge — Sydney Harbour Bridge, New River Gorge) connected
  // by cross bracing, with a deck slung below on vertical hangers. Same
  // silhouette as the flat SVG bridge mark used elsewhere on the site (arc
  // + hangers dropping to a roadway), now built as a genuine triangulated
  // 3D structure — each arch is a pair of laced chords (not one tube), the
  // arches are wind-braced with real X diagonals, the deck has a proper
  // guardrail with posts, and every joint gets a small rivet-plate
  // highlight — instead of a smooth outline that read flat from most
  // angles.
  function buildBridge(){
    const bridge = new THREE.Group();
    const half = 1.7, peak = 1.05, baseY = -0.15, deckY = -0.65, depth = 0.55;
    const archSegs = 64;
    const trussDepth = 0.24;   // max separation between an arch's two chords, at the crown
    const LATTICE_BAYS = 15;   // lacing triangles along each arch
    const hangerXs = [-1.4, -1.0, -0.6, -0.2, 0.2, 0.6, 1.0, 1.4];
    const crossTs = [-1.2, -0.4, 0.4, 1.2].map((x) => x / half);

    // Outer chord — the main silhouette curve, unchanged from before.
    function archPoint(t, z){
      return new THREE.Vector3(t * half, peak * (1 - t * t) + baseY, z);
    }
    // Inner chord — sits directly below the outer one, separated by an
    // amount that's zero at the springing (t = ±1, so the two chords meet
    // with no gap to bridge at the foot) and largest at the crown: the
    // classic lens-shaped truss-arch silhouette, rather than a single flat
    // tube.
    function archPointInner(t, z){
      const p = archPoint(t, z);
      p.y -= trussDepth * (1 - t * t);
      return p;
    }
    function tubeAlong(pointFn, z, radius, radialSegs){
      const pts = [];
      for (let i = 0; i <= archSegs; i++) pts.push(pointFn(-1 + (2 * i / archSegs), z));
      const curve = new THREE.CatmullRomCurve3(pts);
      return new THREE.TubeGeometry(curve, archSegs * 2, radius, radialSegs, false);
    }

    [depth, -depth].forEach((z) => {
      // Outer + inner chords
      bridge.add(new THREE.Mesh(tubeAlong(archPoint, z, 0.062, 12), chromeMat));
      bridge.add(new THREE.Mesh(tubeAlong(archPointInner, z, 0.04, 8), steelMat));

      // X-lattice lacing the two chords together — the piece that actually
      // gives the arch real cross-sectional depth as the rig turns, rather
      // than reading as a single flat line from most angles. Verticals
      // skip the very ends (t = ±1), where the two chords already meet.
      const latticeBits = [];
      for (let i = 1; i < LATTICE_BAYS; i++){
        const t = -1 + (2 * i / LATTICE_BAYS);
        latticeBits.push(bakedGeo(makeStrut(archPoint(t, z), archPointInner(t, z), 0.014, 6)));
      }
      for (let i = 0; i < LATTICE_BAYS; i++){
        const t0 = -1 + (2 * i / LATTICE_BAYS);
        const t1 = -1 + (2 * (i + 1) / LATTICE_BAYS);
        latticeBits.push(bakedGeo(makeStrut(archPoint(t0, z), archPointInner(t1, z), 0.012, 6)));
        latticeBits.push(bakedGeo(makeStrut(archPointInner(t0, z), archPoint(t1, z), 0.012, 6)));
      }
      bridge.add(mergedMesh(latticeBits, steelMat));
    });

    // Guardrail assembly (front + back): a bottom rail flush with the deck
    // (the old single "edge rail"), a second rail above it, and a run of
    // vertical posts tying the two together — a real guardrail instead of
    // one free-floating rod along each edge.
    [depth, -depth].forEach((z) => {
      const railBits = [];
      const zInset = z > 0 ? z - 0.03 : z + 0.03;
      const topY = deckY + 0.16;
      railBits.push(bakedGeo(makeStrut(
        new THREE.Vector3(-half * 1.03, deckY, z), new THREE.Vector3(half * 1.03, deckY, z), 0.045
      )));
      railBits.push(bakedGeo(makeStrut(
        new THREE.Vector3(-half * 1.03, topY, zInset), new THREE.Vector3(half * 1.03, topY, zInset), 0.028
      )));
      const POSTS = 14;
      for (let i = 0; i <= POSTS; i++){
        const x = -half * 1.03 + (2 * half * 1.03) * (i / POSTS);
        railBits.push(bakedGeo(makeStrut(
          new THREE.Vector3(x, deckY, z), new THREE.Vector3(x, topY, zInset), 0.015, 6
        )));
      }
      bridge.add(mergedMesh(railBits, chromeMat));
    });

    // Vertical hangers suspending the deck from each arch's outer chord
    [depth, -depth].forEach((z) => {
      hangerXs.forEach((x) => {
        bridge.add(makeStrut(archPoint(x / half, z), new THREE.Vector3(x, deckY, z), 0.022));
      });
    });

    // Straight cross-ties tying the two arches directly together...
    crossTs.forEach((t) => {
      bridge.add(makeStrut(archPoint(t, depth), archPoint(t, -depth), 0.028));
    });
    // ...plus real X wind-bracing zigzagging between them, the way the
    // underside of a twin-arch bridge is actually braced against sway.
    {
      const diagBits = [];
      for (let i = 0; i < crossTs.length - 1; i++){
        diagBits.push(bakedGeo(makeStrut(archPoint(crossTs[i], depth), archPoint(crossTs[i + 1], -depth), 0.018, 8)));
        diagBits.push(bakedGeo(makeStrut(archPoint(crossTs[i], -depth), archPoint(crossTs[i + 1], depth), 0.018, 8)));
      }
      bridge.add(mergedMesh(diagBits, steelMat));
    }

    // Bearing-plate anchors where each arch foot lands — the two chords
    // converge to a single point here (see archPointInner), so one solid
    // block per foot reads as a real anchorage instead of two tube ends
    // just touching in mid-air.
    {
      const anchorBits = [];
      [1, -1].forEach((sign) => {
        [depth, -depth].forEach((z) => {
          const foot = archPoint(sign, z);
          const m = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.28));
          m.position.copy(foot);
          m.position.y -= 0.04;
          anchorBits.push(bakedGeo(m));
        });
      });
      bridge.add(mergedMesh(anchorBits, anchorMat));
    }

    // Rivet/gusset highlights at every hanger and cross-brace attachment
    // point on the arches — small, extra-glossy nodes that catch sharp
    // specular points as the rig turns, the detail that reads most as
    // "real bolted steel" rather than a smooth CG outline.
    {
      const nodeBits = [];
      function addNode(pos, r){
        const m = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6));
        m.position.copy(pos);
        nodeBits.push(bakedGeo(m));
      }
      [depth, -depth].forEach((z) => {
        hangerXs.forEach((x) => addNode(archPoint(x / half, z), 0.032));
      });
      crossTs.forEach((t) => {
        addNode(archPoint(t, depth), 0.036);
        addNode(archPoint(t, -depth), 0.036);
      });
      bridge.add(mergedMesh(nodeBits, rivetMat));
    }

    // Flat deck plate — a real, solid roadway surface; its top face sits
    // flush with the guardrail's bottom rail, so the rail reads as a
    // raised curb running along a continuous deck.
    {
      const deckLength = half * 2 * 1.03;
      const deckSpan = depth * 2;
      const deckThickness = 0.09;
      const deckGeo = new THREE.BoxGeometry(deckLength, deckThickness, deckSpan);
      const deckMesh = new THREE.Mesh(deckGeo, deckMat);
      deckMesh.position.set(0, deckY - deckThickness / 2 - 0.01, 0);
      bridge.add(deckMesh);

      // Centerline + a few expansion joints, sitting just proud of the
      // deck's top surface — enough to segment the deck into a real
      // roadway without introducing a brand-breaking paint color (same
      // neutral, non-metallic markMat family as everywhere else).
      const deckTopY = deckY - 0.01;
      const markBits = [];
      const centerline = new THREE.Mesh(new THREE.BoxGeometry(deckLength * 0.97, 0.008, 0.03));
      centerline.position.set(0, deckTopY + 0.006, 0);
      markBits.push(bakedGeo(centerline));
      const JOINTS = 6;
      for (let i = 1; i < JOINTS; i++){
        const x = -deckLength / 2 + deckLength * (i / JOINTS);
        const joint = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.006, deckSpan * 0.92));
        joint.position.set(x, deckTopY + 0.005, 0);
        markBits.push(bakedGeo(joint));
      }
      bridge.add(mergedMesh(markBits, markMat));

      // Longitudinal stringers under the deck — real structural depth when
      // the rig is viewed from a low angle or from behind, instead of the
      // deck plate reading as a flat, hollow slab.
      const stringerBits = [];
      const underY = deckY - deckThickness - 0.03;
      [depth * 0.92, depth * 0.4, -depth * 0.4, -depth * 0.92].forEach((z) => {
        stringerBits.push(bakedGeo(makeStrut(
          new THREE.Vector3(-half, underY, z), new THREE.Vector3(half, underY, z), 0.02, 8
        )));
      });
      bridge.add(mergedMesh(stringerBits, steelMat));
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
  // Soft upward bounce, as if off pavement below the bridge — with the
  // extra lattice/stringer geometry now underneath the arches and deck,
  // this keeps their undersides from reading as flat black voids.
  const bounceLight = new THREE.DirectionalLight(0xe7ecf6, 0.5);
  bounceLight.position.set(1, -4, 3);
  scene.add(keyLight, rimLight, fillLight, bounceLight);

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
  //   2. Every individual piece (both arches' outer/inner chords and
  //      lattice bracing, both guardrail assemblies, all 16 hangers, the
  //      straight and diagonal cross-bracing, the foot anchors, the rivet
  //      nodes, the deck plate and its markings/stringers) lets go on its
  //      own staggered delay biased left-to-right, then falls under a
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

  if (interactive) {
    mount.addEventListener('click', launchBridge);
  }

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
}

// Hero: the original interactive mark — click/Enter/Space tears the bridge
// apart and carries the visitor down to "what-we-do".
initBrandOrbitMark('heroOrbitMark', 'heroOrbitCanvas', { interactive: true });

// Client revision: same mark, purely decorative, now also sitting in the
// full roster overlay's footer (see .tr-footer-orbit / #footerOrbitMark in
// the HTML and style.css) — just turns in place, never responds to a
// click. Missing mount/canvas is a no-op (see the guard at the top of
// initBrandOrbitMark), so this is safe on any page that doesn't have the
// overlay footer markup.
initBrandOrbitMark('footerOrbitMark', 'footerOrbitCanvas', { interactive: false });
