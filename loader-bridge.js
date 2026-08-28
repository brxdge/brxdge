/* =========================================================
   BRXDGE LOADER MARK — 3D bridge, rotate + assemble entrance
   The loader's brand mark used to be a flat SVG bridge that drew its arc
   and popped its hangers in via CSS. This is the real 3D twin lenticular-
   truss-arch bridge (same geometry family as the hero's #heroOrbitMark —
   ported from the client's own exact reference buildBridge() code, at a
   lower poly count) instead, doing a single, unrepeatable "super
   incredible" entrance every time the site loads: every chord, merged
   lattice/guardrail/bracing chunk, hanger, foot anchor, rivet node and
   deck piece starts scattered and invisible around the finished bridge's
   shape, then flies inward — spinning, staggered left-to-right — while the
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
   - Like brand-orbit.js, the heavy part (building the ~30 top-level
     meshes — several of them merged batches of dozens of smaller
     lattice/rail/bracing/rivet parts — and rendering the first frame) is
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
   percent count finishes at 7000ms (client revision, round 2 — slowed
   from 4000ms so there's real time to watch the assembly happen instead
   of glimpsing it), and the loader is fully gone from the DOM by
   ~8650ms. The exit itself is two sequential phases — the mark
   expands from normal size to big first, fully opaque, then #loader
   fades to reveal the page underneath — rather than one blended scale-
   and-fade. This module keeps its own render loop alive a little past
   that (RENDER_LIFETIME_MS) and then disposes its GPU resources — the
   scene is never needed again once
   the loader unmounts.

   Same self-hosted-three.js / geometry-merging / SVG fallback-on-WebGL-
   failure conventions as brand-orbit.js throughout (no PMREM bake here —
   see below).
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
  // screen for ~8.65s total, so this needs to fire fast.
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

  // Fewer radial/tube segments and fewer truss bays/posts than the hero
  // mark's buildBridge() uses — even at this mark's doubled ~220px
  // on-screen size the extra smoothness stays close to invisible for the
  // few seconds it's up. Struts share ONE unit cylinder geometry (radius
  // 1, height 1, scaled per-instance) rather than each baking its own.
  const UNIT_CYL = new THREE.CylinderGeometry(1, 1, 1, 6, 1);
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

  // Same minimal hand-rolled geometry merge as brand-orbit.js (position +
  // normal + index only) — bakes a family of small parts (lattice,
  // guardrail posts, rivets) into one static BufferGeometry/draw call
  // instead of one draw call per strut. Matters even more here than in
  // the hero mark: this scene has to stand itself up fast, well inside
  // the loader's short on-screen window.
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
  // vertices (world-space, matrix-applied), then discards the mesh —
  // works the same whether the source mesh used its own sized geometry
  // or (as with makeStrut() above) a shared unit geometry plus scale.
  function bakedGeo(mesh){
    mesh.updateMatrix();
    const g = mesh.geometry.clone();
    g.applyMatrix4(mesh.matrix);
    if (mesh.geometry !== UNIT_CYL && mesh.geometry !== UNIT_BOX) mesh.geometry.dispose();
    return g;
  }
  // Merges a batch of baked geometries into one mesh, re-centered on its
  // own bounding-box center (with that offset moved onto mesh.position) —
  // so a merged chunk (a lattice, a guardrail) still behaves like every
  // other top-level piece below, and the assemble animation can fly it in
  // as one rigid piece around its own middle.
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

  // Secondary steel tone, bearing-plate tone, rivet highlight and deck-
  // marking tone — same material family/derivation as the hero mark's,
  // just derived from this mark's own chromeMat/deckMat.
  const steelMat = chromeMat.clone();
  steelMat.color = new THREE.Color(0xd6d9dd);
  steelMat.roughness = 0.24;
  steelMat.clearcoat = 0.2;
  steelMat.envMapIntensity = 1.3;
  const anchorMat = deckMat.clone();
  anchorMat.color = new THREE.Color(0xc7cad0);
  anchorMat.roughness = 0.42;
  const rivetMat = chromeMat.clone();
  rivetMat.roughness = 0.04;
  rivetMat.clearcoat = 0.7;
  const markMat = new THREE.MeshPhysicalMaterial({
    color: 0x26282d,
    metalness: 0.35,
    roughness: 0.6,
    clearcoat: 0.1,
    envMapIntensity: 0.8,
  });

  // Same twin lenticular-truss-arch silhouette as the hero mark's
  // buildBridge() (matching the client's exact reference bridge code) —
  // laced outer/inner chords, X-lattice bracing, a real guardrail, wind-
  // bracing, foot anchors, rivet nodes and deck stringers — just at a
  // lower poly count and fewer bays/posts, still reading as the same
  // trussed bridge motif at this size with meaningfully less to render.
  function buildBridge(){
    const bridge = new THREE.Group();
    const half = 1.7, peak = 1.05, baseY = -0.15, deckY = -0.65, depth = 0.55;
    const archSegs = 18;       // hero: 64
    const trussDepth = 0.24;   // max separation between an arch's two chords, at the crown
    const LATTICE_BAYS = 7;    // hero: 15
    const hangerXs = [-1.4, -0.8, -0.2, 0.2, 0.8, 1.4];
    const crossTs = [-1.2, -0.4, 0.4, 1.2].map((x) => x / half);

    function archPoint(t, z){
      return new THREE.Vector3(t * half, peak * (1 - t * t) + baseY, z);
    }
    // Inner chord: zero separation at the springing (t = ±1, chords meet
    // with no gap at the foot), largest at the crown — the lens-shaped
    // truss-arch silhouette, matching the client's exact reference code.
    function archPointInner(t, z){
      const p = archPoint(t, z);
      p.y -= trussDepth * (1 - t * t);
      return p;
    }
    function tubeAlong(pointFn, z, radius, radialSegs){
      const pts = [];
      for (let i = 0; i <= archSegs; i++) pts.push(pointFn(-1 + (2 * i / archSegs), z));
      const curve = new THREE.CatmullRomCurve3(pts);
      return new THREE.TubeGeometry(curve, archSegs, radius, radialSegs, false);
    }

    [depth, -depth].forEach((z) => {
      // Outer + inner chords
      bridge.add(new THREE.Mesh(tubeAlong(archPoint, z, 0.058, 6), chromeMat));
      bridge.add(new THREE.Mesh(tubeAlong(archPointInner, z, 0.038, 6), steelMat));

      // X-lattice lacing the two chords together
      const latticeBits = [];
      for (let i = 1; i < LATTICE_BAYS; i++){
        const t = -1 + (2 * i / LATTICE_BAYS);
        latticeBits.push(bakedGeo(makeStrut(archPoint(t, z), archPointInner(t, z), 0.014)));
      }
      for (let i = 0; i < LATTICE_BAYS; i++){
        const t0 = -1 + (2 * i / LATTICE_BAYS);
        const t1 = -1 + (2 * (i + 1) / LATTICE_BAYS);
        latticeBits.push(bakedGeo(makeStrut(archPoint(t0, z), archPointInner(t1, z), 0.012)));
        latticeBits.push(bakedGeo(makeStrut(archPointInner(t0, z), archPoint(t1, z), 0.012)));
      }
      bridge.add(mergedMesh(latticeBits, steelMat));
    });

    // Guardrail assembly (front + back): bottom rail flush with the deck,
    // a second rail above it, and vertical posts tying them together.
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
      const POSTS = 6; // hero: 14
      for (let i = 0; i <= POSTS; i++){
        const x = -half * 1.03 + (2 * half * 1.03) * (i / POSTS);
        railBits.push(bakedGeo(makeStrut(
          new THREE.Vector3(x, deckY, z), new THREE.Vector3(x, topY, zInset), 0.015
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

    // Straight cross-ties plus X wind-bracing between the two arches
    crossTs.forEach((t) => {
      bridge.add(makeStrut(archPoint(t, depth), archPoint(t, -depth), 0.028));
    });
    {
      const diagBits = [];
      for (let i = 0; i < crossTs.length - 1; i++){
        diagBits.push(bakedGeo(makeStrut(archPoint(crossTs[i], depth), archPoint(crossTs[i + 1], -depth), 0.018)));
        diagBits.push(bakedGeo(makeStrut(archPoint(crossTs[i], -depth), archPoint(crossTs[i + 1], depth), 0.018)));
      }
      bridge.add(mergedMesh(diagBits, steelMat));
    }

    // Bearing-plate anchors where each arch foot lands
    {
      const anchorBits = [];
      [1, -1].forEach((sign) => {
        [depth, -depth].forEach((z) => {
          const foot = archPoint(sign, z);
          const m = new THREE.Mesh(UNIT_BOX);
          m.scale.set(0.22, 0.14, 0.28);
          m.position.copy(foot);
          m.position.y -= 0.04;
          anchorBits.push(bakedGeo(m));
        });
      });
      bridge.add(mergedMesh(anchorBits, anchorMat));
    }

    // Rivet/gusset highlights at every hanger and cross-brace joint
    {
      const nodeBits = [];
      function addNode(pos, r){
        const m = new THREE.Mesh(new THREE.SphereGeometry(r, 6, 4));
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

    // Flat deck plate, deck markings and longitudinal stringers underneath
    {
      const deckLength = half * 2 * 1.03;
      const deckSpan = depth * 2;
      const deckThickness = 0.09;
      const deckMesh = new THREE.Mesh(UNIT_BOX, deckMat);
      deckMesh.scale.set(deckLength, deckThickness, deckSpan);
      deckMesh.position.set(0, deckY - deckThickness / 2 - 0.01, 0);
      bridge.add(deckMesh);

      const deckTopY = deckY - 0.01;
      const markBits = [];
      const centerline = new THREE.Mesh(UNIT_BOX);
      centerline.scale.set(deckLength * 0.97, 0.008, 0.03);
      centerline.position.set(0, deckTopY + 0.006, 0);
      markBits.push(bakedGeo(centerline));
      const JOINTS = 4; // hero: 6
      for (let i = 1; i < JOINTS; i++){
        const x = -deckLength / 2 + deckLength * (i / JOINTS);
        const joint = new THREE.Mesh(UNIT_BOX);
        joint.scale.set(0.02, 0.006, deckSpan * 0.92);
        joint.position.set(x, deckTopY + 0.005, 0);
        markBits.push(bakedGeo(joint));
      }
      bridge.add(mergedMesh(markBits, markMat));

      const stringerBits = [];
      const underY = deckY - deckThickness - 0.03;
      [depth * 0.92, depth * 0.4, -depth * 0.4, -depth * 0.92].forEach((z) => {
        stringerBits.push(bakedGeo(makeStrut(
          new THREE.Vector3(-half, underY, z), new THREE.Vector3(half, underY, z), 0.02
        )));
      });
      bridge.add(mergedMesh(stringerBits, steelMat));
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
  // Soft upward bounce, as if off pavement below the bridge — matches the
  // hero mark's addition, keeping the lattice/stringer undersides from
  // reading as flat black voids now that there's real structure down there.
  const bounceLight = new THREE.DirectionalLight(0xe7ecf6, 0.5);
  bounceLight.position.set(1, -4, 3);
  scene.add(keyLight, rimLight, accentLight, fillLight, bounceLight);

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
  // Every piece — each arch's outer/inner chord, the merged lattice and
  // guardrail chunks per side, all 12 hangers, the cross-ties and merged
  // wind-bracing, the merged foot anchors/rivet nodes, the deck plate,
  // and the merged deck markings/stringers — starts scattered around the
  // bridge's finished shape and
  // invisible, then flies inward to its resting position/rotation on a
  // staggered per-piece timeline — the
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
  // builds itself the same direction). Slowed down twice now (client
  // revision, round 2 — was 1500/900/1400, originally 1100/650/1000)
  // so the assembly reads as unmistakably deliberate — long enough for
  // the audience to actually watch it happen, not just catch the tail
  // end of it. script.js's COUNT_DURATION_MS was stretched to 7000ms to
  // match; keep the two in sync if either changes again.
  const ASSEMBLE_SPAN_MS = 2600;
  const FLY_MS_MIN = 1300;
  const FLY_MS_MAX = 1900;
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

  const RENDER_LIFETIME_MS = 9000; // covers script.js's full ~8650ms loader lifecycle (round 4: slowed COUNT_DURATION_MS + assembly), plus a small buffer
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
