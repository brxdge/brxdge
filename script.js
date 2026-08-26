/* =========================================================
   BACKEND API LOCATION
   IS_LOCAL / API are now defined once in config.js, loaded by a
   <script> tag in index.html right before this file — see that file
   for why (script.js and admin.js used to each hardcode their own
   copy of this URL and silently drifted apart).
========================================================= */

/* =========================================================
   DARK MODE
   Toggleable everywhere except the full "View All Talent" roster
   page, which dropped its own toggle button (see script.js's
   openTalentRosterOverlay / the HTML) but still reflects whatever
   theme was last chosen elsewhere on the site.
========================================================= */
(function initTheme() {
  const root = document.documentElement;
  const STORAGE_KEY = 'brxdge-theme';

  // Keeps every switch-styled toggle's aria-checked in sync with the
  // actual theme — there can be more than one on screen at once (desktop
  // navbar + mobile tabbar), plus the media kit's own instance.
  function syncSwitchAria(isDark) {
    document.querySelectorAll('.theme-switch[role="switch"]').forEach(el => {
      el.setAttribute('aria-checked', isDark ? 'true' : 'false');
    });
  }

  function applyTheme(theme) {
    if (theme === 'dark') {
      root.classList.add('dark-mode');
    } else {
      root.classList.remove('dark-mode');
    }
    syncSwitchAria(theme === 'dark');
  }

  // Preference order: saved choice -> system preference -> light
  let saved = null;
  try { saved = localStorage.getItem(STORAGE_KEY); } catch (e) { /* storage unavailable */ }

  if (saved === 'dark' || saved === 'light') {
    applyTheme(saved);
  } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    applyTheme('dark');
  }

  function toggleTheme() {
    const isDark = root.classList.toggle('dark-mode');
    syncSwitchAria(isDark);
    try { localStorage.setItem(STORAGE_KEY, isDark ? 'dark' : 'light'); } catch (e) { /* ignore */ }
  }
  // Exposed so the media kit's theme toggle — rendered fresh into the DOM
  // every time a profile opens — can hook into the same toggle logic.
  window.toggleBrxdgeTheme = toggleTheme;

  document.addEventListener('DOMContentLoaded', () => {
    function wireToggle(id) {
      const toggle = document.getElementById(id);
      if (!toggle) return;
      toggle.addEventListener('click', toggleTheme);
    }
    wireToggle('themeToggle');
    wireToggle('themeToggleMobile');
    // Re-sync now that the two switches above actually exist in the DOM —
    // the very first applyTheme() call (above) ran before DOMContentLoaded,
    // so its aria-checked write had nothing to attach to yet.
    syncSwitchAria(root.classList.contains('dark-mode'));
    // The full "View All Talent" roster page intentionally has no toggle
    // of its own — it just inherits whatever theme is already active.
    // mkThemeToggle no longer exists as a static element — it's rendered
    // inside the media kit header template and wired in openMediakit().
  });
})();


/* =========================================================
   AMBIENT BACKGROUND PARALLAX
   The fixed bridge-cable layers (.cable-layer--near/--far) drift a
   few px with the cursor and with scroll position. Values are only
   ever written to CSS custom properties — the actual easing comes
   from the `transition: transform` already on .cable-layer in CSS,
   so this stays a cheap, rAF-throttled var write rather than a JS
   animation loop. Skipped entirely for reduced-motion; the mouse
   listener specifically is skipped on touch devices since there's
   no cursor to track there.
========================================================= */
(function initBackgroundParallax() {
  const bg = document.querySelector('.brand-lines-bg');
  if (!bg) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const isTouch = window.matchMedia && window.matchMedia('(hover: none)').matches;

  let pendingMX = 0, pendingMY = 0, pendingSY = 0;
  let queued = false;

  function flush() {
    bg.style.setProperty('--bg-mx', pendingMX.toFixed(2) + 'px');
    bg.style.setProperty('--bg-my', pendingMY.toFixed(2) + 'px');
    bg.style.setProperty('--bg-sy', pendingSY.toFixed(2) + 'px');
    queued = false;
  }
  function schedule() {
    if (!queued) { queued = true; requestAnimationFrame(flush); }
  }

  if (!isTouch) {
    window.addEventListener('mousemove', (e) => {
      pendingMX = ((e.clientX / window.innerWidth) - 0.5) * 22;
      pendingMY = ((e.clientY / window.innerHeight) - 0.5) * 16;
      schedule();
    }, { passive: true });
  }

  window.addEventListener('scroll', () => {
    const y = window.pageYOffset || document.documentElement.scrollTop || 0;
    pendingSY = Math.max(-60, Math.min(60, y * 0.03));
    schedule();
  }, { passive: true });
})();


/* =========================================================
   HERO SCROLL TRANSITION ("BRXDGE TO POSSIBILITIES")
   As the hero scrolls past, .hero-copy (eyebrow + headline + buttons)
   fades, lifts and softens out of focus instead of just being clipped
   off under the navbar — see --hero-scroll in style.css. Progress is
   0 at the top of the page and reaches 1 once the hero's own height has
   scrolled fully by, independent of how tall any section below it is.
   Skipped under reduced-motion; --hero-scroll's CSS default (0) keeps
   .hero-copy fully visible and static if this never runs. */
(function initHeroScrollTransition() {
  const hero = document.querySelector('.hero');
  const heroCopy = hero ? hero.querySelector('.hero-copy') : null;
  if (!hero || !heroCopy) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  let ticking = false;
  function update() {
    ticking = false;
    const rect = hero.getBoundingClientRect();
    const heroHeight = rect.height || 1;
    // -rect.top is how far the hero's top has scrolled past the viewport
    // top; dividing by its own height gives a clean 0..1 regardless of
    // viewport size.
    const progress = Math.min(1, Math.max(0, -rect.top / heroHeight));
    heroCopy.style.setProperty('--hero-scroll', progress.toFixed(3));
  }
  window.addEventListener('scroll', () => {
    if (!ticking) { ticking = true; requestAnimationFrame(update); }
  }, { passive: true });
  update();
})();


/* =========================================================
   SHOWCASE SCROLL IN/OUT
   The mosaic plays a proper entrance every time it scrolls into view
   (staggered fade + rise + un-blur, see .slider-wrapper.in-view in
   style.css), and a distinct exit — not just a fade — every time it
   scrolls back out (.slider-wrapper.has-exited: continues drifting
   upward while it scales down and blurs, rather than simply dimming).
   The ambient twinkle loop only runs while .in-view is active, so it
   never fights the in/out opacity transition on the same property.
   A single IntersectionObserver on the section (not the individual
   boxes) drives both classes on .slider-wrapper; CSS staggers each
   .slide-box's own transition-delay from there.
   Skipped under reduced-motion; that section's own reduced-motion
   block forces full opacity/no transform/no filter regardless of
   which of these classes is present, so boxes are simply always
   visible with no animation. */
(function initShowcaseInOut() {
  const section = document.getElementById('showcase');
  const wrapper = section ? section.querySelector('.slider-wrapper') : null;
  if (!section || !wrapper) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  let hasEntered = false;
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        hasEntered = true;
        wrapper.classList.remove('has-exited');
        wrapper.classList.add('in-view');
      } else if (hasEntered) {
        // Only treat it as an "exit" once it's actually been seen —
        // otherwise this fires immediately on page load (before the user
        // has ever scrolled to it) and the mosaic would exit-transition
        // before it was ever shown.
        wrapper.classList.remove('in-view');
        wrapper.classList.add('has-exited');
      }
    });
  }, {
    root: null,
    threshold: 0.15
  });
  io.observe(section);
})();


/* =========================================================
   CATEGORY ROW HOVER PREVIEW ("What We Represent")
   Floats a small preview thumbnail near the cursor as it moves over a
   .category-row, via the --pop-x/--pop-y custom properties consumed in
   CSS (see .category-row-preview). Skipped entirely on touch/imprecise
   pointers — those rows fall back to the CSS default (--pop-x/--pop-y:
   50%, i.e. centered) and rely on the tint wash + arrow reveal for the
   hover/tap feedback instead, since there's no cursor to track.
========================================================= */
(function initCategoryPreviews() {
  const rows = document.querySelectorAll('.category-row');
  if (!rows.length) return;
  if (!window.matchMedia || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

  rows.forEach((row) => {
    let raf = null;
    let pendingX = 0, pendingY = 0;

    function flush() {
      row.style.setProperty('--pop-x', pendingX.toFixed(0) + 'px');
      row.style.setProperty('--pop-y', pendingY.toFixed(0) + 'px');
      raf = null;
    }
    function onMove(e) {
      const rect = row.getBoundingClientRect();
      pendingX = e.clientX - rect.left;
      pendingY = e.clientY - rect.top;
      if (!raf) raf = requestAnimationFrame(flush);
    }
    row.addEventListener('mousemove', onMove);
  });
})();


/* =========================================================
   LOADER + BRAND INTRO (combined)
   The brand mark pops in above the percentage almost immediately,
   then the bold wordmark appears below the bar once loading is
   mostly done. Once it hits 100%, the loader fades straight into
   the hero reveal — no separate full-screen intro overlay.
   Triggered on DOMContentLoaded rather than window's `load` event:
   `load` waits for every last resource on the page — every image,
   plus the external jsPDF script pulled in from cdnjs at the bottom
   of the page — to finish downloading before it fires. On a slow or
   flaky mobile connection that can take a long time or effectively
   never resolve, which stalls the percentage counter and, since the
   hero's entrance-animation `.play` classes are triggered at the end
   of this same callback, silently takes every animation on the page
   down with it. DOMContentLoaded only waits for the HTML itself to
   finish parsing (which this script, loaded at the end of <body>,
   is part of) — it doesn't care whether images or third-party
   scripts have loaded, which is all this purely DOM-class-toggling
   logic actually needs. */
  document.addEventListener('DOMContentLoaded', () => {
  const loader = document.getElementById('loader');
  const loadPercent = document.getElementById('loadPercent');
  const loaderMark = document.getElementById('loaderMark');
  const loaderWord = document.getElementById('loaderWord');
  const heroAnim = document.querySelector('.hero-anim');
  const heroItems = document.querySelectorAll('.hero-anim-item');

  // Brand mark pops in first, ahead of the counting. loader-bridge.js's
  // own assembly-animation timing is hardcoded to start at this same
  // 150ms mark — keep the two in sync if this ever changes. The
  // percentage (now positioned above the mark) fades/rises in on this
  // same beat rather than just appearing instantly at first paint.
  setTimeout(() => {
    if (loaderMark) loaderMark.classList.add('show');
    if (loadPercent) loadPercent.classList.add('show');
  }, 150);

  let p = 0;
  let wordShown = false;
  // Client revision: slowed a little from the original 3000ms so the count
  // (and the rotate+assemble animation it's paced against) doesn't feel
  // rushed. Keep loader-bridge.js's assembly timing in sync if this changes.
  const COUNT_DURATION_MS = 4000;
  const countStart = performance.now();
  // Driven off elapsed wall-clock time rather than a flat per-tick
  // increment: every integer 1..100 still gets shown, in order, none
  // skipped, at a steady 30ms cadence under normal conditions (30ms of
  // elapsed time is roughly 1% of the 4000ms total, so most ticks land on
  // the very next integer). The difference only shows up if something else
  // briefly blocks the main thread (a slow synchronous script elsewhere, a
  // busy tab, etc.) — a flat "+1 per tick" counter would just pick up where
  // it left off and run long, stretching the loader out past its intended
  // 4000ms; computing p from real elapsed time instead means the very next
  // tick jumps straight to wherever it should actually be, so the counter
  // can't be stalled into running indefinitely. loader-bridge.js's render
  // lifetime is hardcoded against this same 4000ms total (plus the exit
  // sequence below); keep the two in sync if this duration ever changes.
  const interval = setInterval(() => {
    const elapsed = performance.now() - countStart;
    const next = Math.min(100, Math.floor((elapsed / COUNT_DURATION_MS) * 100));
    if (next === p) return;
    p = next;

    // talent.html removes the percentage readout and wordmark from its
    // loader (keeps only the bridge mark animation), so both are guarded —
    // the counting/timing logic itself still runs unchanged everywhere so
    // it stays in sync with loader-bridge.js's assembly animation.
    if (loadPercent) loadPercent.textContent = p + '%';

    // Wordmark reveals letter-by-letter once loading is nearly finished,
    // not mid-way through — it should feel like the last flourish before
    // the site is ready, not a halfway checkpoint.
    if (!wordShown && p >= 85) {
      wordShown = true;
      if (loaderWord) loaderWord.classList.add('show');
    }

    if (p === 100) {
      clearInterval(interval);
      // Exit sequence (client revision, round 4 — the "expand until it's
      // huge" version read as the bridge jumping to a giant size "out of
      // nowhere" rather than a real transition. Replaced with a plainer,
      // more physically believable two-step handoff:
      //   1. The mark shrinks back down and fades out in place
      //      (.loader-mark.shrink's transform+opacity transition in
      //      style.css) — like it's receding away, not blowing up.
      //   2. Only once that shrink has finished does #loader itself start
      //      its own opacity transition, fading the rest of the loader
      //      away to reveal the page underneath.
      // The two setTimeout delays below match those two CSS transition
      // durations exactly — keep them in sync if either changes.
      setTimeout(() => {
        // Everything else steps back so the mark can take over the transition
        loader.querySelector('.loader-content').classList.add('exit');
        if (loaderMark) {
          // Two classes, one frame apart, not one: .show's entrance
          // animation has fill-mode "forwards" and keeps "owning"
          // transform/opacity indefinitely, so switching animation off
          // and the transform/opacity target values in the very same
          // style recalc leaves the transition with no distinct "before"
          // frame to interpolate from — it just snaps straight to the
          // shrunk/faded end state with no visible motion (see style.css's
          // comment above .loader-mark.shrink-armed for how this was
          // caught). shrink-armed freezes the mark at its current resting
          // state first (kills the animation, arms the transition,
          // changes nothing visually); the forced reflow makes the
          // browser actually paint that frame before .shrink changes the
          // real target values a moment later, so there's a real "before"
          // to animate away from.
          loaderMark.classList.add('shrink-armed');
          void loaderMark.offsetWidth; // force a reflow between the two classes
          loaderMark.classList.add('shrink');
        }
        setTimeout(() => {
          // Phase 2 starts here, only after the shrink-fade (0.7s) has played out.
          loader.style.opacity = '0';
          setTimeout(() => loader.style.display = 'none', 600);
          // Straight into the hero content entrance
          if (heroAnim) heroAnim.classList.add('play');
          heroItems.forEach((item) => item.classList.add('play'));
        }, 700);
      }, 350);
    }
  }, 30);
});
/* ---------------- UPDATED NAV SCROLL BEHAVIOR ---------------- */
/* ---------------- SMOOTH NAV SCROLL BEHAVIOR ---------------- */
let lastScrollTop = 0;
let navScrollTicking = false;
const navbar = document.getElementById('navbar');
const mobileTabbar = document.getElementById('mobileTabbar');

function updateNavOnScroll() {
  let scrollTop = window.pageYOffset || document.documentElement.scrollTop;

  navbar.classList.toggle('scrolled', scrollTop > 12);

  // Only act if the scroll distance is significant to avoid "flicker"
  if (Math.abs(scrollTop - lastScrollTop) > 10) {
    if (scrollTop > lastScrollTop && scrollTop > 100) {
      // Scrolling DOWN — hide both the top bar and the mobile bottom tab bar
      navbar.classList.add('hidden');
      if (mobileTabbar) mobileTabbar.classList.add('hidden');
    } else {
      // Scrolling UP — bring both back
      navbar.classList.remove('hidden');
      if (mobileTabbar) mobileTabbar.classList.remove('hidden');
    }
    lastScrollTop = scrollTop;
  }
  navScrollTicking = false;
}

window.addEventListener('scroll', () => {
  // requestAnimationFrame collapses rapid-fire scroll events into one
  // read/write per frame, which keeps scrolling buttery instead of janky.
  if (!navScrollTicking) {
    navScrollTicking = true;
    requestAnimationFrame(updateNavOnScroll);
  }
}, { passive: true });

/* ---------------- TOAST ---------------- */
function showToast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ---------------- ORBIT HERO ---------------- */



/* ---------------- MOBILE NAV ----------------
   The old hamburger + slide-down menu is gone — mobile now uses a slim top
   bar (Contact Us / logo / theme toggle / Login) plus a persistent bottom
   tab bar (#mobileTabbar) for Home/About/Roster/Managers. Both bars share
   the same scroll-hide behavior as the desktop navbar (see below), and the
   "Login" link is the same shared #navLoginBtn element used on desktop. */

/* ---------------- MANAGER LOGIN (real server-verified auth) ---------------- */
const MANAGER_SESSION_KEY = 'brxdge-manager-token';
let isManager = false;
let managerToken = null;

// Restore an existing manager session (e.g. after a page refresh) so
// adding/updating talent never requires signing in again.
try {
  managerToken = sessionStorage.getItem(MANAGER_SESSION_KEY);
  isManager = !!managerToken;
} catch (e) { /* storage unavailable */ }

const loginOverlay = document.getElementById('loginOverlay');
document.getElementById('loginClose').addEventListener('click', () => loginOverlay.classList.remove('show'));

// Keeps every login/sign-out button (desktop nav, managers section) in sync
function setManagerUI(active){
  const navBtn = document.getElementById('navLoginBtn');
  const navLabel = navBtn ? navBtn.querySelector('.login-label') : null;
  const managersBtn = document.getElementById('managersLoginBtn');
  const toolbar = document.getElementById('rosterToolbar');
  if(navLabel) navLabel.textContent = active ? 'Manager • Sign Out' : ' Login';
  else if(navBtn) navBtn.textContent = active ? 'Manager • Sign Out' : ' Login';
  if(navBtn) navBtn.classList.toggle('is-manager', active);
  if(managersBtn) managersBtn.textContent = active ? 'Manager • Sign Out' : ' Login →';
  if(toolbar) toolbar.style.display = active ? 'flex' : 'none';
}

function openLoginOrSignOut(){
  if(isManager){
    // Best-effort — tell the server to forget this token too, but sign
    // out locally regardless of whether that request succeeds.
    fetch(API + '/api/logout', {
      method: 'POST',
      headers: managerToken ? { Authorization: `Bearer ${managerToken}` } : {},
    }).catch(() => {});

    isManager = false;
    managerToken = null;
    try { sessionStorage.removeItem(MANAGER_SESSION_KEY); } catch (e) { /* ignore */ }
    setManagerUI(false);
    renderRoster();
    showToast('Signed out');
  } else {
    loginOverlay.classList.add('show');
  }
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('usernameInput').value.trim();
  const password = document.getElementById('passcodeInput').value;
  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;

  try {
    const res = await fetch(API + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();

    if(res.ok && data.ok){
      isManager = true;
      managerToken = data.token;
      try { sessionStorage.setItem(MANAGER_SESSION_KEY, managerToken); } catch (e) { /* ignore */ }
      loginOverlay.classList.remove('show');
      document.getElementById('passcodeInput').value = '';
      setManagerUI(true);
      renderRoster();
      showToast('Signed in, manager tools unlocked');
    } else {
      showToast(data.error || "That didn't match. Try again.");
    }
  } catch (err) {
    showToast('Could not reach the server. Is it running?');
  } finally {
    submitBtn.disabled = false;
  }
});

// Apply a restored session's UI state immediately (roster itself re-renders in loadRoster())
setManagerUI(isManager);

/* ---------------- PLATFORM OPTIONS + ICONS ---------------- */
const PLATFORMS = ['Instagram','TikTok','YouTube','Twitter / X','Facebook','Snapchat','Twitch','LinkedIn','Pinterest','Threads','Other'];

function platformIcon(p){
  const icons = {
    'Instagram': '<rect x="3" y="3" width="18" height="18" rx="5" stroke="currentColor" stroke-width="1.8" fill="none"/><circle cx="12" cy="12" r="3.6" stroke="currentColor" stroke-width="1.8" fill="none"/><circle cx="16.6" cy="7.4" r="1" fill="currentColor"/>',
    'TikTok': '<path d="M13 3v11.5a3.3 3.3 0 1 1-2.5-3.2" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/><path d="M13 3c.5 2.8 2.4 4.5 4.6 4.8" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
    'YouTube': '<rect x="2.5" y="6" width="19" height="12" rx="4" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M10.5 9.7l4.5 2.3-4.5 2.3z" fill="currentColor"/>',
    'Twitter / X': '<path d="M4 4l16 16M20 4L4 20" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    'Facebook': '<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M13.5 8.5h1.5V6h-1.7c-1.7 0-2.8 1-2.8 2.8V11H9v2.5h1.5V19h2.6v-5.5h1.8l.3-2.5h-2.1V9c0-.3.2-.5.4-.5z" fill="currentColor"/>',
    'Snapchat': '<path d="M12 3c2.5 0 4 1.8 4 4.3 0 1 0 2 .3 2.7.3.6 1 1 1.7 1.3.4.2.4.7 0 1-.5.4-1.2.6-1.2 1 0 .3.3.9.9 1.4-.2.5-1 .7-1.7.8-.1.5-.2 1.1-1 1.1-.6 0-1-.3-1.9-.3-.8 0-1.3.6-2.1.6s-1.3-.6-2.1-.6c-.9 0-1.3.3-1.9.3-.8 0-.9-.6-1-1.1-.7-.1-1.5-.3-1.7-.8.6-.5.9-1.1.9-1.4 0-.4-.7-.6-1.2-1-.4-.3-.4-.8 0-1 .7-.3 1.4-.7 1.7-1.3.3-.7.3-1.7.3-2.7C8 4.8 9.5 3 12 3z" stroke="currentColor" stroke-width="1.4" fill="none"/>',
    'Twitch': '<path d="M5 3h15v10.5L16 17h-3l-2.5 2.5H8V17H5V3z" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M13 7v4M17 7v4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    'LinkedIn': '<rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" stroke-width="1.8" fill="none"/><circle cx="7.2" cy="8" r="1.1" fill="currentColor"/><path d="M7.2 11v6M11 11v6M11 13.6c0-1.7 1.2-2.6 2.5-2.6 1.3 0 2.3.8 2.3 2.5V17" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>',
    'Pinterest': '<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M10 18c.5-2 1-4.2 1.4-6 .3.6 1 1 1.9 1 2 0 3.4-1.8 3.4-4.1 0-2-1.6-3.6-4-3.6-3 0-4.6 2-4.6 4.2 0 1 .5 2 1.2 2.4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/>',
    'Threads': '<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M9 9.5c1.8-1 4.5-.6 5 1.7.4 2-.6 4.3-3 4.3-1.6 0-2.5-.9-2.5-2 0-1.4 1.5-2 3.2-2 1.4 0 2.3.4 2.8 1" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/>',
    'Other': '<path d="M9 12a3 3 0 0 1 3-3h1.5a3 3 0 1 1 0 6H13" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/><path d="M15 12a3 3 0 0 1-3 3h-1.5a3 3 0 1 1 0-6H11" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
  };
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none">${icons[p] || icons['Other']}</svg>`;
}

/* Full-color, on-brand versions of the platform marks — used on the
   platform cards in a talent's media kit, where the real logo colors
   read much better than a flat monochrome outline. */
function platformIconColor(p){
  const uid = Math.random().toString(36).slice(2, 9);
  const icons = {
    'Instagram': `
      <defs><linearGradient id="igGrad-${uid}" x1="0%" y1="100%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#FFDD55"/><stop offset="26%" stop-color="#FF543E"/>
        <stop offset="60%" stop-color="#C837AB"/><stop offset="100%" stop-color="#5B51D8"/>
      </linearGradient></defs>
      <rect width="34" height="34" rx="9" fill="url(#igGrad-${uid})"/>
      <rect x="9" y="9" width="16" height="16" rx="5" stroke="#fff" stroke-width="1.8" fill="none"/>
      <circle cx="17" cy="17" r="4.2" stroke="#fff" stroke-width="1.8" fill="none"/>
      <circle cx="22.3" cy="11.7" r="1.1" fill="#fff"/>`,
    'TikTok': `
      <rect width="34" height="34" rx="9" fill="#000"/>
      <path d="M21 8.2c.5 3 2.6 4.9 5 5.2" stroke="#25F4EE" stroke-width="1.9" fill="none" stroke-linecap="round" transform="translate(-1.3,0)"/>
      <path d="M19.7 8c.5 3 2.6 4.9 5 5.2" stroke="#FE2C55" stroke-width="1.9" fill="none" stroke-linecap="round" transform="translate(1.3,0)"/>
      <path d="M20 8v12.3a3.9 3.9 0 1 1-3-3.8" stroke="#fff" stroke-width="1.9" fill="none" stroke-linecap="round"/>`,
    'YouTube': `
      <rect width="34" height="34" rx="9" fill="#FF0000"/>
      <path d="M14.5 12.3l8 4.7-8 4.7z" fill="#fff"/>`,
    'Twitter / X': `
      <rect width="34" height="34" rx="9" fill="#000"/>
      <path d="M9 9l16 16M25 9L9 25" stroke="#fff" stroke-width="2" stroke-linecap="round"/>`,
    'Facebook': `
      <rect width="34" height="34" rx="9" fill="#1877F2"/>
      <path d="M19.6 12.1h2.1V8.8h-2.8c-2.4 0-4 1.6-4 4.3V15H12v3.4h2.9V27h3.6v-8.6h2.7l.4-3.4h-3.1v-1.4c0-.9.4-1.5 1.1-1.5z" fill="#fff"/>`,
    'Snapchat': `
      <rect width="34" height="34" rx="9" fill="#FFFC00"/>
      <path d="M17 8.6c2.9 0 4.9 2.1 4.9 5.2 0 1.2 0 2.3.3 3.1.4.8 1.1 1.1 1.9 1.5.5.2.5.9 0 1.1-.6.4-1.4.6-1.4 1.1 0 .3.3.9.9 1.5-.2.6-1.1.9-1.9 1-.1.6-.3 1.2-1.1 1.2-.8 0-1.2-.3-2.2-.3-1 0-1.6.7-2.4.7s-1.5-.7-2.4-.7c-1 0-1.4.3-2.2.3-.8 0-1-.6-1.1-1.2-.8-.1-1.7-.4-1.9-1 .6-.6.9-1.2.9-1.5 0-.5-.8-.7-1.4-1.1-.5-.2-.5-.9 0-1.1.8-.4 1.5-.7 1.9-1.5.3-.8.3-1.9.3-3.1 0-3.1 2-5.2 4.9-5.2z" fill="#000" fill-opacity="0.82"/>`,
    'Twitch': `
      <rect width="34" height="34" rx="9" fill="#9146FF"/>
      <path d="M11.2 8.5h13v9.6l-3.2 3.2h-3l-2.4 2.4h-2.1v-2.4h-2.3V8.5z" stroke="#fff" stroke-width="1.4" fill="none"/>
      <path d="M18 12v4M21.6 12v4" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>`,
    'LinkedIn': `
      <rect width="34" height="34" rx="9" fill="#0A66C2"/>
      <circle cx="11.6" cy="11.2" r="1.6" fill="#fff"/>
      <rect x="10.3" y="14.7" width="2.6" height="10.1" fill="#fff"/>
      <path d="M16.4 14.7h2.5v1.4c.6-1 1.7-1.7 3.2-1.7 2.5 0 4 1.6 4 4.9v6.3h-2.6v-5.9c0-1.6-.6-2.6-2-2.6-1.1 0-1.8.8-2.1 1.6-.1.2-.1.6-.1 1v5.9h-2.6V14.7z" fill="#fff"/>`,
    'Pinterest': `
      <rect width="34" height="34" rx="9" fill="#E60023"/>
      <path d="M17 8.4c-4.7 0-7.2 3.3-7.2 6.7 0 1.6.9 3.6 2.3 4.3.2.1.4 0 .4-.2l.3-1.2c.1-.3 0-.4-.1-.6-.6-.7-1-1.7-1-2.9 0-3.7 2.8-6.3 6.4-6.3 3.1 0 4.9 1.9 4.9 4.5 0 3.4-1.5 6.2-3.6 6.2-1.2 0-2.1-1-1.8-2.2.3-1.4.9-2.9.9-4 0-.9-.5-1.6-1.5-1.6-1.2 0-2.2 1.2-2.2 2.9 0 1 .4 1.7.4 1.7s-1.3 5.1-1.5 6c-.4 1.7-.1 3.7 0 3.9.1.1.1.1.2 0 .1-.1 1.3-1.6 1.7-3.1.1-.5.7-2.7.7-2.7.3.6 1.4 1.2 2.5 1.2 3.3 0 5.8-3 5.8-6.9.1-3.7-3-6.6-7.4-6.6z" fill="#fff"/>`,
    'Threads': `
      <rect width="34" height="34" rx="9" fill="#000"/>
      <path d="M12.4 11.3c2.3-1.3 5.7-.8 6.3 2.2.5 2.5-.7 5.4-3.8 5.4-2 0-3.2-1.1-3.2-2.6 0-1.7 1.9-2.5 4-2.5 1.8 0 2.9.5 3.5 1.2" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round"/>`,
    'Other': `
      <rect width="34" height="34" rx="9" fill="#6b6b6b"/>
      <path d="M13.5 17a3.5 3.5 0 0 1 3.5-3.5H19a3.5 3.5 0 1 1 0 7h-1.5" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round"/>
      <path d="M20.5 17a3.5 3.5 0 0 1-3.5 3.5H15a3.5 3.5 0 1 1 0-7h1.5" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
  };
  return `<svg width="100%" height="100%" viewBox="0 0 34 34" xmlns="http://www.w3.org/2000/svg">${icons[p] || icons['Other']}</svg>`;
}

/* ---------------- FOLLOWER PARSING ---------------- */
function parseFollowers(str){
  if(!str) return 0;
  const s = str.toString().trim().toUpperCase().replace(/,/g,'');
  const num = parseFloat(s);
  if(isNaN(num)) return 0;
  if(s.endsWith('M')) return Math.round(num * 1000000);
  if(s.endsWith('K')) return Math.round(num * 1000);
  return Math.round(num);
}
function formatFollowers(n){
  if(n >= 1000000) return (n/1000000).toFixed(n % 1000000 === 0 ? 0 : 1) + 'M';
  if(n >= 1000) return (n/1000).toFixed(n % 1000 === 0 ? 0 : 1) + 'K';
  return String(n);
}
function totalReach(socials){
  return (socials || []).reduce((sum, s) => sum + parseFollowers(s.followers), 0);
}

/* ---------------- TALENT ROSTER (persisted via shared storage) ---------------- */
const ROSTER_KEY = 'roster:list';
let rosterData = [];
let activeFilter = 'All';

/* ---------------- BLOG / CASE STUDIES + CAMPAIGNS (proof sections) ---------------- */
let blogData = [];
let campaignsData = [];

// Turns a talent's name into a URL-safe slug, e.g. "Mark Ramirez" -> "mark-ramirez"
function slugify(str){
  return (str||'').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Escapes text before it's dropped into innerHTML. Almost everything
// rendered on the public site — talent names/bios, campaign objectives,
// blog titles, manager bios — is free text an admin typed into the
// dashboard, not something this site wrote itself. Without this, a
// compromised or malicious manager account could type a <script> or
// onerror= payload into any of those fields and have it run in every
// visitor's browser. Safe for both text content and inside a quoted HTML
// attribute (escapes & < > " ').
function escapeHtml(str){
  return String(str == null ? '' : str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// Locks/unlocks background scroll behind full-screen overlays (media kit,
// full talent roster, campaign brief, contact popup, etc). Setting
// overflow:hidden on <body> alone looked right but didn't actually stop
// the page from scrolling: in standards mode the document's own scrollbar
// belongs to <html> (document.documentElement), not <body>, since neither
// has an explicit height — so the underlying page kept its own working
// scrollbar right alongside the overlay's, which is what showed up as "two
// scrollbars" when opening the full roster or a media kit. Both elements
// need to be locked together for the background to actually stop scrolling.
function setBodyScrollLocked(value){
  document.documentElement.style.overflow = value;
  document.body.style.overflow = value;
}

// Social profile links and post links are also admin-entered free text, and
// they end up inside an href rather than as page text — escapeHtml alone
// stops someone breaking out of the attribute, but it wouldn't stop the
// whole value being something like "javascript:alert(1)", which runs the
// moment a visitor clicks it. Only allowing values that actually start
// with http:// or https:// closes that off; anything else (including a
// blank field) is treated as "no link".
function safeUrl(str){
  const s = String(str || '').trim();
  return /^https?:\/\//i.test(s) ? s : '';
}

// "Featured" view (talent.html's roster grid) shows a capped grid of real
// talent cards only — the BRXDGE brand tile that used to occupy the middle
// slot has been retired in favor of showing one more actual talent there
// instead (bumped from 8 to 9 to keep the same grid size). "View All
// Talent" opens a full-page overlay (like the media kit) with the
// complete, gender-filterable, searchable roster — no cap.
const FEATURED_CAP = 9;
let trGenderFilter = 'All';   // gender filter, scoped to the full talent-roster overlay
let trSearchQuery = '';       // name search, scoped to the full talent-roster overlay

// Expanded filters (niche/location/audience-size are single-select "All"
// dropdowns; platform/availability are multi-select chip sets), all scoped
// to the full talent-roster overlay same as the two above.
let trNicheFilter = 'All';
let trLocationFilter = 'All';
let trAudienceSizeFilter = 'All';
let trPlatformFilters = new Set();
let trAvailabilityFilters = new Set();

// Client revision: the full roster overlay used to render every matching
// talent at once, unbounded — fine for a handful of cards, but it meant
// scrolling through dozens with no pacing and a dead-empty stretch below
// the last row. Paginated in batches of 6 instead, with a "Load More"
// button revealing the next batch; resets back to the first page whenever
// the *filtered set itself* changes (new gender/search/filter), but NOT
// on every render (admin add/edit/delete, cast-toggle refreshes, and the
// Load More click itself all re-render without losing your place).
const TR_PAGE_SIZE = 6;
let trVisibleCount = TR_PAGE_SIZE;

// Client revision: added a Grid / Showcase / List view toggle for the full
// roster overlay — purely a display preference (which CSS layout the same
// .talent-card markup renders as), so it lives as one piece of state read
// by renderTalentRosterGrid() below and doesn't need to survive anywhere
// beyond this page load. Deliberately NOT reset on filter changes or on
// reopening the overlay — once picked, it stays picked for the session.
let trViewMode = 'grid'; // 'grid' | 'comfort' | 'list'

// Client revision: "Sort by" menu in the rebuilt minimal toolbar — same
// sticky-for-the-session treatment as trViewMode above (not reset on
// filter changes or reopening the overlay). getFilteredTrList() applies
// it last, after every filter, on a copy of the list so rosterData itself
// is never mutated by .sort().
let trSortMode = 'featured'; // 'featured' | 'name-asc' | 'name-desc' | 'reach-desc' | 'reach-asc'

// Preset combined-reach buckets for the "Audience Size" filter — computed
// from totalReach(t.socials) rather than a stored field, since reach is
// already derived from each platform's follower count.
const AUDIENCE_SIZE_BUCKETS = [
  { key: 'All', label: 'Any audience size' },
  { key: 'under100k', label: 'Under 100K', test: n => n < 100000 },
  { key: '100k-500k', label: '100K – 500K', test: n => n >= 100000 && n < 500000 },
  { key: '500k-1m', label: '500K – 1M', test: n => n >= 500000 && n < 1000000 },
  { key: '1m-5m', label: '1M – 5M', test: n => n >= 1000000 && n < 5000000 },
  { key: '5m-plus', label: '5M+', test: n => n >= 5000000 },
];

// True if any filter beyond the defaults is active — drives the "Filters"
// badge count, the "Clear all filters" link visibility, and the trSub
// "showing X of Y" vs "showing all" copy.
function trHasActiveFilters(){
  return trGenderFilter !== 'All' || !!trSearchQuery.trim() || trNicheFilter !== 'All' ||
    trLocationFilter !== 'All' || trAudienceSizeFilter !== 'All' ||
    trPlatformFilters.size > 0 || trAvailabilityFilters.size > 0;
}

// Count of active filters inside the collapsible panel specifically
// (everything except gender + search, which live outside it) — shown as
// the toggle button's badge.
function trActivePanelFilterCount(){
  return (trNicheFilter !== 'All' ? 1 : 0) + (trLocationFilter !== 'All' ? 1 : 0) +
    (trAudienceSizeFilter !== 'All' ? 1 : 0) + trPlatformFilters.size + trAvailabilityFilters.size;
}

// Just the niche/location/audience-size/platform/availability group —
// shared by resetTrFilters() (full reset, including gender + search) and
// the "Build Your Preferred Talents" popup's "Skip, show me everyone"
// button, which should clear these back to "show everything" without also
// undoing the gender the visitor already picked one step earlier.
function resetTrExpandedFilters(){
  trNicheFilter = 'All';
  trLocationFilter = 'All';
  trAudienceSizeFilter = 'All';
  trPlatformFilters.clear();
  trAvailabilityFilters.clear();
}

function resetTrFilters(){
  trGenderFilter = 'All';
  trSearchQuery = '';
  resetTrExpandedFilters();
}

const defaultRoster = [
  { id:'t1', name:'Nova Reyes', niche:'Lifestyle', gender:'Female', bio:'Toronto street style meets everyday storytelling, one outfit post at a time.', seed:'Nova', photo:'', gallery:[],
    socials:[ {platform:'Instagram', url:'https://instagram.com', followers:'1.6M'}, {platform:'TikTok', url:'https://tiktok.com', followers:'2.4M'}, {platform:'YouTube', url:'https://youtube.com', followers:'622K'} ] },
  { id:'t2', name:'Kai Whitlock', niche:'Gaming', gender:'Male', bio:'Ranked climbs, chaotic co-op, and late-night Q&As with the chat.', seed:'Kai', photo:'', gallery:[],
    socials:[ {platform:'Twitch', url:'https://twitch.tv', followers:'890K'}, {platform:'YouTube', url:'https://youtube.com', followers:'410K'} ] },
  { id:'t3', name:'Zora Bennett', niche:'Comedy', gender:'Female', bio:'Skits about surviving your twenties.', seed:'Zora', photo:'', gallery:[],
    socials:[ {platform:'TikTok', url:'https://tiktok.com', followers:'3.1M'}, {platform:'Instagram', url:'https://instagram.com', followers:'720K'} ] },
  { id:'t4', name:'Milo Santana', niche:'Food', gender:'Male', bio:'Rating the city one patty at a time.', seed:'Milo', photo:'', gallery:[],
    socials:[ {platform:'Instagram', url:'https://instagram.com', followers:'480K'}, {platform:'YouTube', url:'https://youtube.com', followers:'160K'} ] },
  { id:'t5', name:'Indie Park', niche:'Music', gender:'Female', bio:'Bedroom pop covers and behind-the-scenes drops.', seed:'Indie', photo:'', gallery:[],
    socials:[ {platform:'TikTok', url:'https://tiktok.com', followers:'1.2M'}, {platform:'YouTube', url:'https://youtube.com', followers:'340K'}, {platform:'Instagram', url:'https://instagram.com', followers:'210K'} ] },
];

// Replace your existing loadRoster function
async function loadRoster(){
  try {
    const response = await fetch(API + '/api/roster');
    rosterData = await response.json();
  } catch(err) {
    rosterData = defaultRoster; // Fallback to defaults
  }
  renderRoster();
  // Cast is stored as talent ids in localStorage and rendered against
  // rosterData, so the nav Talents pill can't reflect it until the roster
  // itself has loaded — this is the earliest point that's true, including
  // on a returning visit where localStorage already has a saved shortlist.
  renderAllCastWidgets();

  // Deep link: if the URL already points at a specific talent (e.g. a
  // shared link like ?talent=mark-ramirez), open their media kit right away.
  const requestedSlug = new URLSearchParams(location.search).get('talent');
  if(requestedSlug){
    const match = rosterData.find(t => slugify(t.name) === requestedSlug);
    if(match) openMediakit(match.id, { updateUrl: false });
  }
}

// Replace your existing saveRoster function
async function saveRoster(){
  try {
    const res = await fetch(API + '/api/roster', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(managerToken ? { Authorization: `Bearer ${managerToken}` } : {}),
      },
      body: JSON.stringify(rosterData)
    });
    if(res.status === 401){
      showToast('Your session expired. Please sign in again');
      isManager = false;
      managerToken = null;
      try { sessionStorage.removeItem(MANAGER_SESSION_KEY); } catch (e) { /* ignore */ }
      setManagerUI(false);
    }
  } catch(err) {
    showToast('Could not save to database');
  }
}

function talentPhotoUrl(t){
  return t.photo && t.photo.trim() ? t.photo.trim()
    : `https://api.dicebear.com/9.x/notionists/svg?seed=${encodeURIComponent(t.seed || t.name)}&backgroundColor=c8302c,f0c239,fff8e9`;
}

// A single representative brand color per platform, used as a subtle
// accent on that platform's card in the media kit.
function platformBrandColor(p){
  const colors = {
    'Instagram': '#C837AB',
    'TikTok': '#25F4EE',
    'YouTube': '#FF0000',
    'Twitter / X': '#000000',
    'Facebook': '#1877F2',
    'Snapchat': '#FFFC00',
    'Twitch': '#9146FF',
    'LinkedIn': '#0A66C2',
    'Pinterest': '#E60023',
    'Threads': '#000000',
  };
  return colors[p] || 'var(--panel-line)';
}

// The media kit's wide cover/header photo. Separate from the profile
// picture so a talent can have a distinct cover shot — falls back to
// the regular profile photo until one is set.
function talentCoverUrl(t){
  return t.coverPhoto && t.coverPhoto.trim() ? t.coverPhoto.trim() : talentPhotoUrl(t);
}

// Categories shown on the card footer / media kit — prefers the new
// multi-category field; falls back to the single legacy `niche` value so
// talent that haven't been re-saved with the new field yet still show
// something instead of a blank row.
function talentCategories(t){
  if(Array.isArray(t.categories) && t.categories.length) return t.categories;
  return t.niche ? [t.niche] : [];
}

// Builds one talent photo-card as a DOM node (used by both the featured
// homepage grid and the full "View All Talent" grid). `index` positions the
// editorial numeral badge and staggers this card's entrance animation.
function buildTalentCard(t, index){
  const reachNum = totalReach(t.socials);
  const reach = formatFollowers(reachNum);
  const cats = talentCategories(t);
  const availableFor = t.availableFor || [];
  const audience = [t.audienceAge, t.audienceLocation].filter(Boolean).join(' • ');
  const card = document.createElement('div');
  card.className = 'talent-card reveal-card';
  card.style.setProperty('--card-i', index || 0);
  card.innerHTML = `
    <div class="talent-card-head">
      <span class="name">${escapeHtml(t.name)}</span>
      <span class="reach"><span class="lbl">Social Reach</span><span class="num" data-count-to="${reachNum}">0</span></span>
    </div>
    <div class="talent-photo">
      <span class="talent-index" aria-hidden="true">${String((index || 0) + 1).padStart(2,'0')}</span>
      ${isManager ? `<div class="admin-controls">
        <button class="icon-btn" data-edit="${t.id}" aria-label="Edit">✎</button>
        <button class="icon-btn" data-delete="${t.id}" aria-label="Delete">🗑</button>
      </div>` : ''}
      <img class="cover" src="${escapeHtml(talentPhotoUrl(t))}" alt="${escapeHtml(t.name)}" loading="lazy">
      <div class="card-spotlight" aria-hidden="true"></div>
      <div class="card-frame" aria-hidden="true">
        <span class="cf-corner cf-tl"></span><span class="cf-corner cf-tr"></span>
        <span class="cf-corner cf-bl"></span><span class="cf-corner cf-br"></span>
      </div>
      <div class="platform-list">
        ${(t.socials||[]).map(s => `<div class="prow"><span>${escapeHtml(s.platform)}</span><span>${escapeHtml(s.followers || '-')}</span></div>`).join('')}
      </div>
    </div>
    <div class="talent-card-foot">
      <div class="tcf-inner">
        ${cats.length ? `<div class="tcf-tags">${cats.map(c => `<span class="tcf-tag">${escapeHtml(c)}</span>`).join('')}</div>` : ''}
        ${t.location ? `<p class="tcf-line"><span class="tcf-label">Location</span>${escapeHtml(t.location)}</p>` : ''}
        ${audience ? `<p class="tcf-line"><span class="tcf-label">Audience</span>${escapeHtml(audience)}</p>` : ''}
        ${availableFor.length ? `<p class="tcf-line"><span class="tcf-label">Available for</span>${escapeHtml(availableFor.join(' • '))}</p>` : ''}
        <div class="tcf-actions">
          <button type="button" class="tcf-viewmk" data-view-mk="${t.id}">
            View Media Kit
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <button type="button" class="tcf-addcast${castIds.includes(t.id) ? ' added' : ''}" data-cast-toggle="${t.id}" aria-pressed="${castIds.includes(t.id)}">
            ${castCheckSvg}${castPlusSvg}
            <span>${castIds.includes(t.id) ? 'Added' : 'Add to Campaign'}</span>
          </button>
        </div>
      </div>
    </div>
  `;
  card.querySelector('.talent-photo').addEventListener('click', (e) => {
    if(e.target.closest('.admin-controls')) return;
    openMediakit(t.id);
  });
  card.querySelector('.tcf-viewmk').addEventListener('click', (e) => {
    e.stopPropagation();
    openMediakit(t.id);
  });
  card.querySelector('.tcf-addcast').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleCast(t.id);
  });
  attachTiltInteraction(card);
  return card;
}

/* ---------------- CARD TILT + CURSOR SPOTLIGHT ----------------
   Desktop-only (hover:hover + pointer:fine) magnetic tilt with a soft
   light that follows the cursor across the photo — purely presentational,
   driven by CSS custom properties so the actual transform/gradient work
   happens in style.css. */
function attachTiltInteraction(card){
  if(!window.matchMedia || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  const photo = card.querySelector('.talent-photo');
  if(!photo) return;
  let raf = null;

  function onMove(e){
    if(raf) return;
    raf = requestAnimationFrame(() => {
      raf = null;
      const rect = photo.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width;   // 0..1
      const py = (e.clientY - rect.top) / rect.height;    // 0..1
      const rx = (py - 0.5) * -10;  // rotateX
      const ry = (px - 0.5) * 12;   // rotateY
      card.style.setProperty('--tilt-rx', rx.toFixed(2) + 'deg');
      card.style.setProperty('--tilt-ry', ry.toFixed(2) + 'deg');
      card.style.setProperty('--spot-x', (px * 100).toFixed(1) + '%');
      card.style.setProperty('--spot-y', (py * 100).toFixed(1) + '%');
    });
  }
  function onLeave(){
    card.style.setProperty('--tilt-rx', '0deg');
    card.style.setProperty('--tilt-ry', '0deg');
    card.classList.remove('is-tilting');
  }
  photo.addEventListener('mouseenter', () => card.classList.add('is-tilting'));
  photo.addEventListener('mousemove', onMove);
  photo.addEventListener('mouseleave', onLeave);
}

/* ---------------- COUNT-UP REACH NUMBERS ---------------- */
function animateCountUp(el, duration){
  const target = Number(el.dataset.countTo || 0);
  const suffix = el.dataset.suffix || '';
  if(!target){ el.textContent = '0' + suffix; return; }
  const start = performance.now();
  const dur = duration || 900;
  function tick(now){
    const t = Math.min((now - start) / dur, 1);
    const eased = 1 - Math.pow(1 - t, 3); // ease-out-cubic
    el.textContent = formatFollowers(Math.round(target * eased)) + suffix;
    if(t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

/* ---------------- ABOUT: STAT COUNT-UP ----------------
   Same count-up treatment as the roster's reach numbers, fired once
   when the About stat tiles scroll into view. */
(function initAboutStatCounters(){
  const nums = document.querySelectorAll('.about-stats-bar [data-count-to]');
  if(!nums.length) return;
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if(!entry.isIntersecting) return;
      animateCountUp(entry.target, 1400);
      io.unobserve(entry.target);
    });
  }, { root: null, rootMargin: '0px 0px -10% 0px', threshold: 0.4 });
  nums.forEach((el) => io.observe(el));
})();

/* ---------------- CONTACT: TRUST STRIP COUNT-UP ----------------
   Same treatment, separate tiny observer — kept independent of
   initAboutStatCounters above rather than widening its selector, so this
   section's animation timing/threshold can be tuned on its own later
   without touching About. */
(function initContactTrustCounters(){
  const nums = document.querySelectorAll('.contact-trust [data-count-to]');
  if(!nums.length) return;
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if(!entry.isIntersecting) return;
      animateCountUp(entry.target, 1400);
      io.unobserve(entry.target);
    });
  }, { root: null, rootMargin: '0px 0px -10% 0px', threshold: 0.4 });
  nums.forEach((el) => io.observe(el));
})();

/* ---------------- BRANDS MARQUEE ----------------
   One continuously-drifting ticker of brand wordmarks below the roster.
   Motion is driven by a single rAF loop (not a CSS @keyframes animation)
   so drag input and the passive auto-scroll share one position instead
   of fighting each other: dragging simply overrides `pos` for a moment,
   then the same loop picks the auto-scroll back up.
   - Hover anywhere over the strip pauses it (lets a visitor read/click).
   - Click-drag (mouse or touch, via Pointer Events) spins it manually.
   - After a release, auto-scroll resumes ~1s later from wherever the
     visitor left it.
   - The single authored .brands-marquee-group is cloned at runtime until
     the track is at least 2 viewports wider than the container, so the
     modulo-wrap loop never runs out of content on ultrawide screens.
   - Declared as a named function (not an auto-invoking IIFE) so it can be
     called AFTER loadBrandsIntoMarquees() has had a chance to swap in live
     brand data from the admin dashboard — see the boot call near the
     bottom of the logo marquee block below. */
function initBrandsMarquee(){
  const wrap = document.getElementById('brandsMarquee');
  const track = document.getElementById('brandsMarqueeTrack');
  if(!wrap || !track) return;
  const original = track.querySelector('.brands-marquee-group');
  if(!original) return;

  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const SPEED = 0.5; // px per frame, ~30px/s at 60fps — unhurried ticker pace

  let groupWidth = 0;
  let pos = 0;
  let isDragging = false;
  let isHovering = false;
  let startX = 0;
  let startPos = 0;
  let resumeAt = 0;

  function buildTrack(){
    while(track.children.length > 1){ track.removeChild(track.lastChild); }
    const w = original.offsetWidth;
    if(!w) return 0;
    const minWidth = wrap.clientWidth * 2 + w;
    let total = w;
    while(total < minWidth){
      const clone = original.cloneNode(true);
      clone.setAttribute('aria-hidden', 'true');
      track.appendChild(clone);
      total += w;
    }
    return w;
  }

  function wrapPos(p){
    if(!groupWidth) return 0;
    while(p <= -groupWidth) p += groupWidth;
    while(p > 0) p -= groupWidth;
    return p;
  }

  function onPointerDown(e){
    if(!groupWidth) return;
    isDragging = true;
    wrap.classList.add('is-dragging');
    startX = e.clientX;
    startPos = pos;
    if(wrap.setPointerCapture && e.pointerId != null){
      try{ wrap.setPointerCapture(e.pointerId); }catch(err){}
    }
  }
  function onPointerMove(e){
    if(!isDragging) return;
    pos = wrapPos(startPos + (e.clientX - startX));
  }
  function endDrag(){
    if(!isDragging) return;
    isDragging = false;
    wrap.classList.remove('is-dragging');
    resumeAt = performance.now() + 1000;
  }

  wrap.addEventListener('pointerdown', onPointerDown);
  wrap.addEventListener('pointermove', onPointerMove);
  wrap.addEventListener('pointerup', endDrag);
  wrap.addEventListener('pointercancel', endDrag);
  wrap.addEventListener('pointerleave', () => { endDrag(); isHovering = false; });
  wrap.addEventListener('mouseenter', () => { isHovering = true; });
  wrap.addEventListener('mouseleave', () => { isHovering = false; });

  function frame(now){
    if(groupWidth){
      if(!isDragging && !isHovering && !reduceMotion && now >= resumeAt){
        pos = wrapPos(pos - SPEED);
      }
      track.style.transform = `translateX(${pos}px)`;
    }
    requestAnimationFrame(frame);
  }

  groupWidth = buildTrack();
  requestAnimationFrame(frame);

  if(document.fonts && document.fonts.ready){
    document.fonts.ready.then(() => {
      const w = buildTrack();
      if(w) groupWidth = w;
    }).catch(() => {});
  }

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const w = buildTrack();
      if(w) groupWidth = w;
    }, 150);
  });
}

/* ---------------- BRAND LOGO MARQUEE ----------------
   Second brand marquee — same drag/hover-pause/seamless-loop rig as
   initBrandsMarquee above, reused almost verbatim, but for pictorial
   .logo-tile marks instead of words, and running the opposite way:
   the auto-scroll increment is added instead of subtracted, so content
   flows left-to-right instead of right-to-left. The wrap() function
   doesn't need to change for that — it keeps `pos` in the same
   (-groupWidth, 0] window either way, and because the cloned content is
   periodic, crossing that wrap boundary is seamless regardless of which
   direction pushed it there. Dragging always tracks the cursor 1:1
   independent of the default direction. */
function initLogoMarquee(){
  const wrap = document.getElementById('logoMarquee');
  const track = document.getElementById('logoMarqueeTrack');
  if(!wrap || !track) return;
  const original = track.querySelector('.logo-marquee-group');
  if(!original) return;

  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const SPEED = 0.5;

  let groupWidth = 0;
  let pos = 0;
  let isDragging = false;
  let isHovering = false;
  let startX = 0;
  let startPos = 0;
  let resumeAt = 0;

  function buildTrack(){
    while(track.children.length > 1){ track.removeChild(track.lastChild); }
    const w = original.offsetWidth;
    if(!w) return 0;
    const minWidth = wrap.clientWidth * 2 + w;
    let total = w;
    while(total < minWidth){
      const clone = original.cloneNode(true);
      clone.setAttribute('aria-hidden', 'true');
      track.appendChild(clone);
      total += w;
    }
    return w;
  }

  function wrapPos(p){
    if(!groupWidth) return 0;
    while(p <= -groupWidth) p += groupWidth;
    while(p > 0) p -= groupWidth;
    return p;
  }

  function onPointerDown(e){
    if(!groupWidth) return;
    isDragging = true;
    wrap.classList.add('is-dragging');
    startX = e.clientX;
    startPos = pos;
    if(wrap.setPointerCapture && e.pointerId != null){
      try{ wrap.setPointerCapture(e.pointerId); }catch(err){}
    }
  }
  function onPointerMove(e){
    if(!isDragging) return;
    pos = wrapPos(startPos + (e.clientX - startX));
  }
  function endDrag(){
    if(!isDragging) return;
    isDragging = false;
    wrap.classList.remove('is-dragging');
    resumeAt = performance.now() + 1000;
  }

  wrap.addEventListener('pointerdown', onPointerDown);
  wrap.addEventListener('pointermove', onPointerMove);
  wrap.addEventListener('pointerup', endDrag);
  wrap.addEventListener('pointercancel', endDrag);
  wrap.addEventListener('pointerleave', () => { endDrag(); isHovering = false; });
  wrap.addEventListener('mouseenter', () => { isHovering = true; });
  wrap.addEventListener('mouseleave', () => { isHovering = false; });

  function frame(now){
    if(groupWidth){
      if(!isDragging && !isHovering && !reduceMotion && now >= resumeAt){
        pos = wrapPos(pos + SPEED); // '+' instead of the text ticker's '-' => left-to-right
      }
      track.style.transform = `translateX(${pos}px)`;
    }
    requestAnimationFrame(frame);
  }

  groupWidth = buildTrack();
  requestAnimationFrame(frame);

  if(document.fonts && document.fonts.ready){
    document.fonts.ready.then(() => {
      const w = buildTrack();
      if(w) groupWidth = w;
    }).catch(() => {});
  }

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const w = buildTrack();
      if(w) groupWidth = w;
    }, 150);
  });
}

/* ---------------- LOAD LIVE BRAND DATA (admin-managed) ----------------
   Both marquees above ship with hardcoded fallback markup so the section
   never looks broken. This swaps that fallback for live data from the
   admin-managed /api/brands list when it's reachable — same
   fetch-then-fall-back-gracefully pattern as initManagers(): a failed or
   empty response just leaves the static markup already in the DOM alone,
   it never clears it out. Follows this codebase's existing convention of
   not HTML-escaping admin-controlled string fields when interpolating
   them into template literals (matches initManagers()). */
async function loadBrandsIntoMarquees(){
  let brands;
  try {
    const res = await fetch(API + '/api/brands');
    brands = await res.json();
  } catch(err){
    console.error('Failed to load brands:', err);
    return;
  }
  if(!Array.isArray(brands) || !brands.length) return;

  const wordGroup = document.querySelector('#brandsMarqueeTrack .brands-marquee-group');
  if(wordGroup){
    wordGroup.innerHTML = brands.map((b) => `
      <span class="brand-word">${escapeHtml(b.name || '')}</span>
      <span class="brand-dot" aria-hidden="true">&#9670;</span>
    `).join('');
  }

  const logoGroup = document.querySelector('#logoMarqueeTrack .logo-marquee-group');
  if(logoGroup){
    logoGroup.innerHTML = brands.map((b) => `
      <div class="logo-tile" title="${escapeHtml(b.name || '')}">
        ${b.logo
          ? `<img src="${escapeHtml(b.logo)}" alt="${escapeHtml(b.name || '')}" loading="lazy">`
          : `<span class="tile-initial">${escapeHtml((b.name || '?').charAt(0).toUpperCase())}</span>`}
      </div>
    `).join('');
  }
}

(async function bootBrandMarquees(){
  await loadBrandsIntoMarquees();
  initBrandsMarquee();
  initLogoMarquee();
})();

/* ---------------- SCROLL/ENTRANCE REVEAL FOR TALENT CARDS ----------------
   Staggers each card's fade-up-in as it appears, scaling to any grid size
   (unlike the CSS-only .stagger-item rules, which only cover the first
   four children). Also fires the reach count-up once per card. `immediate`
   skips the IntersectionObserver and reveals right away, staggered by
   index — used inside overlays that are already on-screen when populated. */
// Despite the name, this works for any grid of `.reveal-card` elements —
// originally built for talent cards, now reused as-is for the blog/
// case-study and campaign card grids (see buildBlogCard/buildCampaignCard),
// since the stagger/fade-in mechanic here isn't talent-specific.
function revealTalentCards(container, opts){
  const immediate = opts && opts.immediate;
  const cards = Array.from(container.querySelectorAll('.reveal-card'));
  if(!cards.length) return;

  const STEP = 0.07, MAX_DELAY = 0.63; // seconds; caps the tail-end wait on long grids

  function activate(card, i){
    const delay = Math.min(i * STEP, MAX_DELAY);
    card.style.transitionDelay = delay.toFixed(2) + 's';
    card.classList.add('in-view');
    const num = card.querySelector('[data-count-to]');
    if(num && !num.dataset.counted){
      num.dataset.counted = '1';
      setTimeout(() => animateCountUp(num, 800), delay * 1000);
    }
  }

  if(immediate){
    cards.forEach((card, i) => activate(card, i));
    return;
  }

  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if(!entry.isIntersecting) return;
      const i = cards.indexOf(entry.target);
      activate(entry.target, i);
      io.unobserve(entry.target);
    });
  }, { root: null, rootMargin: '0px 0px -6% 0px', threshold: 0.15 });

  cards.forEach(card => io.observe(card));
}

function renderRoster() {
  const grid = document.getElementById('rosterGrid');
  // #roster (and its grid) only exists on talent.html now — index.html no
  // longer renders the featured roster, so this is a no-op there instead
  // of throwing and halting every top-level script below this point.
  if (!grid) return;
  grid.innerHTML = '';

  const list = activeFilter === 'All' ? rosterData : rosterData.filter(t => t.niche === activeFilter);

  if (list.length === 0) {
    grid.innerHTML = `<div class="roster-empty">No talent here yet. ${isManager ? 'Add the first one with the button above.' : 'Check back soon.'}</div>`;
    return;
  }

  // Featured talent.html view: cap at FEATURED_CAP real talent cards.
  const displayList = list.slice(0, FEATURED_CAP);

  displayList.forEach((t, i) => {
    grid.appendChild(buildTalentCard(t, i));
  });

  // Attach click handlers for manager controls
  grid.querySelectorAll('[data-edit]').forEach(btn =>
    btn.addEventListener('click', (e) => { e.stopPropagation(); openTalentModal(btn.dataset.edit); })
  );
  grid.querySelectorAll('[data-delete]').forEach(btn =>
    btn.addEventListener('click', (e) => { e.stopPropagation(); deleteTalent(btn.dataset.delete); })
  );

  revealTalentCards(grid);
}

/* ---------------- VIEW ALL TALENT ----------------
   "View All Talent" opens a gender-choice popup, which then opens a
   full-page overlay (same pattern as the media kit) showing the
   complete, uncapped roster with its own gender filter chips and a
   name search — independent from the featured homepage grid. */
const talentFilterOverlay = document.getElementById('talentFilterOverlay');
const talentRosterOverlay = document.getElementById('talentRosterOverlay');

// "View All Talent" lives inside #roster, which only exists on talent.html
// now — guard it so index.html (which no longer has this button) doesn't
// throw and halt every top-level script below this point.
const viewAllTalentBtn = document.getElementById('viewAllTalentBtn');
if (viewAllTalentBtn) {
  viewAllTalentBtn.addEventListener('click', () => {
    talentFilterOverlay.classList.add('show');
  });
}
document.getElementById('talentFilterClose').addEventListener('click', () => talentFilterOverlay.classList.remove('show'));
talentFilterOverlay.querySelectorAll('.gender-option').forEach(btn => {
  btn.addEventListener('click', () => {
    talentFilterOverlay.classList.remove('show');
    openTalentRosterOverlay(btn.dataset.gender);
  });
});

function openTalentRosterOverlay(gender){
  resetTrFilters();
  trVisibleCount = TR_PAGE_SIZE; // always start browsing from page 1
  trGenderFilter = gender || 'All';
  const searchInput = document.getElementById('talentSearchInput');
  if (searchInput) searchInput.value = '';
  // Collapse the expanded-filters panel back down each time the overlay is
  // freshly opened, same "start clean" behavior as the search box above.
  const filtersPanel = document.getElementById('trFiltersPanel');
  if (filtersPanel) filtersPanel.classList.remove('show');
  const filtersToggle = document.getElementById('trFiltersToggle');
  if (filtersToggle) { filtersToggle.classList.remove('active'); filtersToggle.setAttribute('aria-expanded', 'false'); }
  // Clear so this open's grid always builds+reveals immediately, rather than
  // fading out whatever the overlay happened to be showing last time.
  const grid = document.getElementById('talentRosterGrid');
  if (grid) grid.innerHTML = '';
  renderTrGenderFilters();
  renderTrExpandedFilters();
  renderTalentRosterGrid();
  talentRosterOverlay.classList.add('show');
  talentRosterOverlay.classList.remove('tr-in'); // restart entrance choreography each time it opens
  talentRosterOverlay.scrollTop = 0;
  setBodyScrollLocked('hidden');
  requestAnimationFrame(() => requestAnimationFrame(() => {
    talentRosterOverlay.classList.add('tr-in');
  }));

  // "Build Your Preferred Talents" — a guided filter prompt, shown a beat
  // after the grid so a visitor sees it populate first, then gets invited
  // to narrow it down rather than only discovering the Filters toggle on
  // their own. openTrBuildPopup() is defined further down and is a no-op
  // where the popup doesn't exist (index.html never reaches this function
  // in the first place, since nothing there can open the roster overlay).
  setTimeout(openTrBuildPopup, 550);
}

function closeTalentRosterOverlay(){
  talentRosterOverlay.classList.remove('show');
  closeTrBuildPopup();
  setBodyScrollLocked(mediakitOverlay.classList.contains('show') ? 'hidden' : '');
}

document.getElementById('trBack').addEventListener('click', closeTalentRosterOverlay);
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  // Close the build popup first if it's the topmost thing open, rather
  // than closing the whole roster overlay out from under it in one step.
  if (trBuildOverlay && trBuildOverlay.classList.contains('show')) { closeTrBuildPopup(); return; }
  if (talentRosterOverlay.classList.contains('show')) closeTalentRosterOverlay();
});

/* ---------------- COMPANY BACKGROUND (horizontal-scroll story) ----------------
   Opened from the About section's "See Our Background" button. On wide
   viewports (matching CSS's 900px fallback breakpoint) scrolling the
   overlay drives .bg-track's translateX instead of the overlay scrolling
   vertically — see the big comment above ".background-overlay" in
   style.css for the full mechanics this is implementing. Below 900px the
   engine never starts and the CSS fallback (plain vertical stack) is all
   that's needed, so this only has to know how to turn itself on and off. */
const backgroundOverlay = document.getElementById('backgroundOverlay');
const bgScrollPad = document.getElementById('bgScrollPad');
const bgTrack = document.getElementById('bgTrack');
const bgScrollCue = document.getElementById('bgScrollCue');
const bgProgressDots = Array.from(document.querySelectorAll('[data-bg-dot]'));
const BG_DESKTOP_QUERY = '(min-width: 900px)';

let bgEngineActive = false;
let bgRafId = null;
let bgMobileObserver = null;
// Left-edge offset (px) of each of the 4 main panels within the track,
// recomputed on every measure — lets a progress-dot click jump straight to
// that panel instead of the dots only ever reflecting scroll passively.
let bgPanelOffsets = [0, 0, 0, 0];

function bgMeasure(){
  if(!bgTrack || !bgScrollPad) return 0;
  const maxTranslate = Math.max(0, bgTrack.scrollWidth - window.innerWidth);
  bgScrollPad.style.height = (window.innerHeight + maxTranslate) + 'px';
  bgPanelOffsets = Array.from(document.querySelectorAll('[data-bg-panel]')).map(el => el.offsetLeft);
  return maxTranslate;
}

function bgUpdate(){
  bgRafId = null;
  if(!bgEngineActive || !backgroundOverlay.classList.contains('show')) return;
  const maxTranslate = Math.max(0, bgTrack.scrollWidth - window.innerWidth);
  const padRect = bgScrollPad.getBoundingClientRect();
  const scrolled = Math.min(Math.max(-padRect.top, 0), maxTranslate);
  bgTrack.style.transform = `translateX(-${scrolled}px)`;

  // Reveal panels/connectors once they've actually scrolled into view —
  // checked against real rendered position (post-transform) rather than a
  // fixed scroll-progress number, so it stays correct no matter how wide
  // any individual panel or connector ends up being.
  document.querySelectorAll('.bg-panel, .bg-connector').forEach(el => {
    const r = el.getBoundingClientRect();
    const visible = r.right > window.innerWidth * 0.15 && r.left < window.innerWidth * 0.85;
    el.classList.toggle('in-view', visible);
  });

  // Progress dots — active = the last main panel whose offset the current
  // scroll position has already reached (with a little lead-in so a dot
  // lights up just before its panel is fully centered, not only after).
  let activeIdx = 0;
  for(let i = 0; i < bgPanelOffsets.length; i++){
    if(scrolled >= bgPanelOffsets[i] - window.innerWidth * 0.3) activeIdx = i;
  }
  bgProgressDots.forEach((dot, i) => dot.classList.toggle('active', i === activeIdx));

  if(bgScrollCue) bgScrollCue.classList.toggle('hide', scrolled > 40);
}

function bgOnScroll(){
  if(bgRafId) return;
  bgRafId = requestAnimationFrame(bgUpdate);
}

function bgStartEngine(){
  if(bgEngineActive) return;
  bgEngineActive = true;
  bgMeasure();
  backgroundOverlay.addEventListener('scroll', bgOnScroll, { passive: true });
  bgOnScroll();
}

function bgStopEngine(){
  if(!bgEngineActive) return;
  bgEngineActive = false;
  backgroundOverlay.removeEventListener('scroll', bgOnScroll);
  if(bgRafId){ cancelAnimationFrame(bgRafId); bgRafId = null; }
  if(bgTrack) bgTrack.style.transform = '';
  if(bgScrollPad) bgScrollPad.style.height = '';
}

// Mobile/narrow fallback — CSS already stacks everything vertically; this
// just re-arms the same fade-up entrance treatment via IntersectionObserver
// instead of the desktop engine's scroll-progress checks.
function bgStartMobileReveal(){
  if(bgMobileObserver) return;
  const targets = document.querySelectorAll('.bg-panel-content, .bg-connector');
  targets.forEach(el => el.classList.add('bg-mobile-pending'));
  bgMobileObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if(!entry.isIntersecting) return;
      entry.target.classList.remove('bg-mobile-pending');
      entry.target.classList.add('in-view');
      bgMobileObserver.unobserve(entry.target);
    });
  }, { threshold: 0.2 });
  targets.forEach(el => bgMobileObserver.observe(el));
}

function bgStopMobileReveal(){
  if(!bgMobileObserver) return;
  bgMobileObserver.disconnect();
  bgMobileObserver = null;
  document.querySelectorAll('.bg-mobile-pending').forEach(el => el.classList.remove('bg-mobile-pending'));
}

function bgSyncEngineForViewport(){
  if(!backgroundOverlay.classList.contains('show')) return;
  if(window.matchMedia(BG_DESKTOP_QUERY).matches){
    bgStopMobileReveal();
    bgStartEngine();
  } else {
    bgStopEngine();
    bgStartMobileReveal();
  }
}

function openBackground(){
  backgroundOverlay.classList.add('show');
  backgroundOverlay.scrollTop = 0;
  setBodyScrollLocked('hidden');
  bgProgressDots.forEach((dot, i) => dot.classList.toggle('active', i === 0));
  if(bgScrollCue) bgScrollCue.classList.remove('hide');
  // Layout needs a frame to settle (overlay just went from display:none to
  // block) before measuring widths, or bgMeasure() would read stale/zero sizes.
  requestAnimationFrame(() => requestAnimationFrame(bgSyncEngineForViewport));
}

function closeBackground(){
  backgroundOverlay.classList.remove('show');
  bgStopEngine();
  bgStopMobileReveal();
  setBodyScrollLocked((mediakitOverlay && mediakitOverlay.classList.contains('show')) || (talentRosterOverlay && talentRosterOverlay.classList.contains('show')) ? 'hidden' : '');
}

const viewBackgroundBtn = document.getElementById('viewBackgroundBtn');
if(viewBackgroundBtn) viewBackgroundBtn.addEventListener('click', openBackground);

const bgBackBtn = document.getElementById('bgBack');
if(bgBackBtn) bgBackBtn.addEventListener('click', closeBackground);

document.addEventListener('keydown', (e) => {
  if(e.key === 'Escape' && backgroundOverlay && backgroundOverlay.classList.contains('show')) closeBackground();
});

bgProgressDots.forEach((dot, i) => {
  dot.addEventListener('click', () => {
    if(!bgEngineActive) return;
    backgroundOverlay.scrollTo({ top: bgPanelOffsets[i] || 0, behavior: 'smooth' });
  });
});

window.addEventListener('resize', () => {
  if(!backgroundOverlay.classList.contains('show')) return;
  bgSyncEngineForViewport();
  if(bgEngineActive) bgMeasure();
});

// Gender chips inside the overlay (All / Female / Male / ...), built from
// whatever genders actually exist on the roster, so switching between them
// never has to leave the full-page view.
function renderTrGenderFilters(){
  const bar = document.getElementById('trGenderFilters');
  const genders = ['All', ...new Set(rosterData.map(t => t.gender).filter(Boolean))];
  bar.innerHTML = '<span class="chip-highlight" id="chipHighlight" aria-hidden="true"></span>';
  genders.forEach(g => {
    const chip = document.createElement('button');
    chip.className = 'chip' + (g === trGenderFilter ? ' active' : '');
    chip.textContent = g;
    chip.addEventListener('click', () => {
      if (g === trGenderFilter) return;
      trGenderFilter = g;
      trVisibleCount = TR_PAGE_SIZE; // new filter set — start from page 1
      renderTrGenderFilters();
      renderTalentRosterGrid();
      updateTrFiltersUI();
    });
    bar.appendChild(chip);
  });
  requestAnimationFrame(() => positionChipHighlight());
}

// Slides a soft pill behind whichever gender chip is currently active,
// instead of just swapping a border color — reads its size straight off
// the real DOM so it works for any label length or chip count.
function positionChipHighlight(){
  const bar = document.getElementById('trGenderFilters');
  const highlight = document.getElementById('chipHighlight');
  const active = bar && bar.querySelector('.chip.active');
  if(!bar || !highlight || !active) return;
  const barRect = bar.getBoundingClientRect();
  const chipRect = active.getBoundingClientRect();
  highlight.style.width = chipRect.width + 'px';
  highlight.style.height = chipRect.height + 'px';
  highlight.style.transform = `translate(${(chipRect.left - barRect.left).toFixed(1)}px, ${(chipRect.top - barRect.top).toFixed(1)}px)`;
  highlight.classList.add('is-positioned');
}
window.addEventListener('resize', () => {
  if (talentRosterOverlay && talentRosterOverlay.classList.contains('show')) positionChipHighlight();
});

// Updates the "Filters" toggle badge count and the "Clear all filters"
// link's visibility — called after any filter control changes, so both
// stay in sync no matter which control triggered the change.
function updateTrFiltersUI(){
  const badge = document.getElementById('trFiltersBadge');
  if (badge) {
    const count = trActivePanelFilterCount();
    badge.textContent = String(count);
    badge.style.display = count > 0 ? 'inline-flex' : 'none';
  }
  const clearBtn = document.getElementById('trClearFilters');
  if (clearBtn) clearBtn.style.display = trHasActiveFilters() ? 'inline-flex' : 'none';
}

// Fills a <select>'s options and current value if it exists on the page —
// used to drive both the collapsible Filters panel's selects AND the
// "Build Your Preferred Talents" popup's own selects from the same data,
// since talent.html has one of each per field (trNicheSelect/trbNicheSelect,
// etc.) that both need to reflect the same underlying filter state.
function populateTrSelect(id, optionsHtml, currentValue){
  const select = document.getElementById(id);
  if (!select) return;
  select.innerHTML = optionsHtml;
  select.value = currentValue;
}

// Same idea for the Platform/Available For chip multi-selects: rebuilds a
// chip bar from a fresh values list, wiring every chip's click to toggle
// the shared Set and re-render EVERYTHING filter-related afterward (both
// the panel's and the popup's copies of every control) so the two never
// show a stale/mismatched state relative to each other.
function populateTrChipBar(id, values, activeSet){
  const bar = document.getElementById(id);
  if (!bar) return;
  bar.innerHTML = '';
  values.forEach(v => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (activeSet.has(v) ? ' active' : '');
    chip.textContent = v;
    chip.addEventListener('click', () => {
      if (activeSet.has(v)) activeSet.delete(v); else activeSet.add(v);
      applyTrFilterChange();
    });
    bar.appendChild(chip);
  });
}

// Builds the Niche / Location / Audience Size selects and the Platform /
// Available For chip multi-selects — both the collapsible Filters panel's
// copies AND the "Build Your Preferred Talents" popup's copies, every
// option list generated fresh from whatever's actually on the roster right
// now — same "derive options from live data" approach as
// renderTrGenderFilters() above, so a talent added with a new niche or
// platform shows up as a filterable option without any code changes.
// populateTrSelect()/populateTrChipBar() are both null-safe, so this works
// fine on pages that only have one of the two control sets (or neither).
function renderTrExpandedFilters(){
  const niches = [...new Set(rosterData.map(t => t.niche).filter(Boolean))].sort();
  const nicheOptions = `<option value="All">Any niche</option>` +
    niches.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
  populateTrSelect('trNicheSelect', nicheOptions, trNicheFilter);
  populateTrSelect('trbNicheSelect', nicheOptions, trNicheFilter);

  const locations = [...new Set(rosterData.map(t => t.location).filter(Boolean))].sort();
  const locationOptions = `<option value="All">Any location</option>` +
    locations.map(l => `<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`).join('');
  populateTrSelect('trLocationSelect', locationOptions, trLocationFilter);
  populateTrSelect('trbLocationSelect', locationOptions, trLocationFilter);

  const audienceOptions = AUDIENCE_SIZE_BUCKETS
    .map(b => `<option value="${b.key}">${escapeHtml(b.label)}</option>`).join('');
  populateTrSelect('trAudienceSizeSelect', audienceOptions, trAudienceSizeFilter);
  populateTrSelect('trbAudienceSizeSelect', audienceOptions, trAudienceSizeFilter);

  const platforms = [...new Set(rosterData.flatMap(t => (t.socials || []).map(s => s.platform)).filter(Boolean))].sort();
  populateTrChipBar('trPlatformFilters', platforms, trPlatformFilters);
  populateTrChipBar('trbPlatformFilters', platforms, trPlatformFilters);

  const tags = [...new Set(rosterData.flatMap(t => t.availableFor || []).filter(Boolean))].sort();
  populateTrChipBar('trAvailabilityFilters', tags, trAvailabilityFilters);
  populateTrChipBar('trbAvailabilityFilters', tags, trAvailabilityFilters);

  updateTrFiltersUI();
}

// Every filter control (either copy) funnels through this after mutating
// state: re-renders the grid, then rebuilds both control sets so neither
// can ever show a value/active-state the other doesn't agree with.
function applyTrFilterChange(){
  trVisibleCount = TR_PAGE_SIZE; // new filter set — start from page 1
  renderTalentRosterGrid();
  renderTrExpandedFilters();
}

const trFiltersToggle = document.getElementById('trFiltersToggle');
const trFiltersPanel = document.getElementById('trFiltersPanel');
if (trFiltersToggle && trFiltersPanel) {
  trFiltersToggle.addEventListener('click', () => {
    const isOpen = trFiltersPanel.classList.toggle('show');
    trFiltersToggle.classList.toggle('active', isOpen);
    trFiltersToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  });
}

const trNicheSelectEl = document.getElementById('trNicheSelect');
if (trNicheSelectEl) {
  trNicheSelectEl.addEventListener('change', (e) => {
    trNicheFilter = e.target.value;
    applyTrFilterChange();
  });
}
const trbNicheSelectEl = document.getElementById('trbNicheSelect');
if (trbNicheSelectEl) {
  trbNicheSelectEl.addEventListener('change', (e) => {
    trNicheFilter = e.target.value;
    applyTrFilterChange();
  });
}
const trLocationSelectEl = document.getElementById('trLocationSelect');
if (trLocationSelectEl) {
  trLocationSelectEl.addEventListener('change', (e) => {
    trLocationFilter = e.target.value;
    applyTrFilterChange();
  });
}
const trbLocationSelectEl = document.getElementById('trbLocationSelect');
if (trbLocationSelectEl) {
  trbLocationSelectEl.addEventListener('change', (e) => {
    trLocationFilter = e.target.value;
    applyTrFilterChange();
  });
}
const trAudienceSizeSelectEl = document.getElementById('trAudienceSizeSelect');
if (trAudienceSizeSelectEl) {
  trAudienceSizeSelectEl.addEventListener('change', (e) => {
    trAudienceSizeFilter = e.target.value;
    applyTrFilterChange();
  });
}
const trbAudienceSizeSelectEl = document.getElementById('trbAudienceSizeSelect');
if (trbAudienceSizeSelectEl) {
  trbAudienceSizeSelectEl.addEventListener('change', (e) => {
    trAudienceSizeFilter = e.target.value;
    applyTrFilterChange();
  });
}
const trClearFiltersBtn = document.getElementById('trClearFilters');
if (trClearFiltersBtn) {
  trClearFiltersBtn.addEventListener('click', () => {
    resetTrFilters();
    trVisibleCount = TR_PAGE_SIZE; // new filter set — start from page 1
    const searchInput = document.getElementById('talentSearchInput');
    if (searchInput) searchInput.value = '';
    renderTrGenderFilters();
    renderTrExpandedFilters();
    renderTalentRosterGrid();
  });
}

/* ---------------- BUILD YOUR PREFERRED TALENTS (popup) ----------------
   A guided version of the same expanded filters above, shown automatically
   a beat after the full roster overlay opens — see the setTimeout in
   openTalentRosterOverlay() below. Every control here shares state (and is
   kept in sync) with the collapsible Filters panel via renderTrExpandedFilters()
   and applyTrFilterChange() above; this section only owns opening/closing
   the popup itself and the Skip/Apply actions. Guarded throughout since
   this popup's markup — unlike the rest of the roster overlay — only
   exists on talent.html. */
const trBuildOverlay = document.getElementById('trBuildOverlay');

function openTrBuildPopup(){
  if (trBuildOverlay) trBuildOverlay.classList.add('show');
}
function closeTrBuildPopup(){
  if (trBuildOverlay) trBuildOverlay.classList.remove('show');
}

const trBuildClose = document.getElementById('trBuildClose');
if (trBuildClose) trBuildClose.addEventListener('click', closeTrBuildPopup);

const trBuildApply = document.getElementById('trBuildApply');
if (trBuildApply) trBuildApply.addEventListener('click', closeTrBuildPopup);

// "Skip" means show everyone — clears the niche/location/audience-size/
// platform/availability choices (but leaves the gender pick from the step
// before this one alone; that wasn't this popup's decision to undo).
const trBuildSkip = document.getElementById('trBuildSkip');
if (trBuildSkip) {
  trBuildSkip.addEventListener('click', () => {
    resetTrExpandedFilters();
    applyTrFilterChange();
    closeTrBuildPopup();
  });
}

// Shared by renderTalentRosterGrid() below and nothing else (yet) — pulled
// out on its own so the pagination slicing in doRender() has a clean "full
// filtered set" to work from before cutting it down to trVisibleCount.
function getFilteredTrList(){
  let list = trGenderFilter === 'All' ? rosterData : rosterData.filter(t => (t.gender || '').toLowerCase() === trGenderFilter.toLowerCase());
  if (trSearchQuery.trim()) {
    const q = trSearchQuery.trim().toLowerCase();
    list = list.filter(t => (t.name || '').toLowerCase().includes(q));
  }
  if (trNicheFilter !== 'All') {
    list = list.filter(t => t.niche === trNicheFilter);
  }
  if (trLocationFilter !== 'All') {
    list = list.filter(t => t.location === trLocationFilter);
  }
  if (trAudienceSizeFilter !== 'All') {
    const bucket = AUDIENCE_SIZE_BUCKETS.find(b => b.key === trAudienceSizeFilter);
    if (bucket && bucket.test) list = list.filter(t => bucket.test(totalReach(t.socials)));
  }
  if (trPlatformFilters.size) {
    // Match talent with a profile on ANY of the selected platforms (OR
    // within this filter), same relationship used for availability below.
    list = list.filter(t => (t.socials || []).some(s => trPlatformFilters.has(s.platform)));
  }
  if (trAvailabilityFilters.size) {
    list = list.filter(t => (t.availableFor || []).some(a => trAvailabilityFilters.has(a)));
  }

  // Sort last, on a copy — list may still be the original rosterData
  // reference at this point (e.g. no filters active at all), so .slice()
  // before .sort() to avoid silently reordering the source data itself.
  if (trSortMode !== 'featured') {
    list = list.slice();
    if (trSortMode === 'name-asc') list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    else if (trSortMode === 'name-desc') list.sort((a, b) => (b.name || '').localeCompare(a.name || ''));
    else if (trSortMode === 'reach-desc') list.sort((a, b) => totalReach(b.socials) - totalReach(a.socials));
    else if (trSortMode === 'reach-asc') list.sort((a, b) => totalReach(a.socials) - totalReach(b.socials));
  }

  return list;
}

// Shows/hides the "Load More" button and updates its label with however
// many are left, given how many cards are currently on screen vs. how many
// match the active filters in total.
function updateTrLoadMoreUI(shownCount, totalCount){
  const wrap = document.getElementById('trLoadMoreWrap');
  if (!wrap) return;
  const remaining = totalCount - shownCount;
  if (remaining <= 0) {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = '';
  const btn = document.getElementById('trLoadMoreBtn');
  const label = btn ? btn.querySelector('span') : null;
  if (label) label.textContent = `Load ${Math.min(TR_PAGE_SIZE, remaining)} More Talent`;
}

// Bumped on every call so a slow-arriving fade-out from a previous filter
// change can't clobber a newer one (e.g. rapid search typing).
let trRenderToken = 0;

function renderTalentRosterGrid(){
  const grid = document.getElementById('talentRosterGrid');
  const isFirstRender = grid.childElementCount === 0;
  const token = ++trRenderToken;

  const doRender = () => {
    if (token !== trRenderToken) return; // a newer change has since taken over
    grid.classList.remove('grid-swapping');
    grid.innerHTML = '';
    grid.classList.toggle('tr-view-comfort', trViewMode === 'comfort');
    grid.classList.toggle('tr-view-list', trViewMode === 'list');

    const list = getFilteredTrList();

    const sub = document.getElementById('trSub');
    if (sub) {
      const total = rosterData.length;
      sub.textContent = !trHasActiveFilters()
        ? `Showing all ${total} talent`
        : `Showing ${list.length} of ${total} talent`;
      sub.classList.remove('pulse');
      void sub.offsetWidth;
      sub.classList.add('pulse');
    }

    // Client revision: terse "N Profiles" count centered in the rebuilt
    // toolbar, matching the reference screenshots — separate element from
    // #trSub above (which keeps its own richer "Showing X of Y" copy up in
    // the header) so neither design has to compromise for the other.
    const toolbarCount = document.getElementById('trToolbarCount');
    if (toolbarCount) toolbarCount.textContent = `${list.length} Profile${list.length === 1 ? '' : 's'}`;

    const clearBtn = document.getElementById('talentSearchClear');
    if (clearBtn) clearBtn.style.display = trSearchQuery ? 'flex' : 'none';

    if (list.length === 0) {
      const safeQuery = trSearchQuery.trim().replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      let emptyMsg = 'No talent here yet.';
      if (safeQuery) emptyMsg = `No talent matching "${safeQuery}".`;
      else if (trHasActiveFilters()) emptyMsg = 'No talent matches these filters.';
      grid.innerHTML = `<div class="roster-empty">${emptyMsg}</div>`;
      updateTrLoadMoreUI(0, 0);
      return;
    }

    // Paginated: only the first trVisibleCount of the filtered list actually
    // get built as cards. Card index (i) stays relative to the full filtered
    // list, not just the visible slice, so numbering/reveal-delay stays
    // consistent as more pages load in.
    const visibleList = list.slice(0, trVisibleCount);
    visibleList.forEach((t, i) => grid.appendChild(buildTalentCard(t, i)));

    grid.querySelectorAll('[data-edit]').forEach(btn =>
      btn.addEventListener('click', (e) => { e.stopPropagation(); openTalentModal(btn.dataset.edit); })
    );
    grid.querySelectorAll('[data-delete]').forEach(btn =>
      btn.addEventListener('click', (e) => { e.stopPropagation(); deleteTalent(btn.dataset.delete); })
    );

    revealTalentCards(grid, { immediate: true });
    updateTrLoadMoreUI(visibleList.length, list.length);
  };

  // First paint (overlay just opened): no old cards to transition out of,
  // so build immediately. Subsequent filter/search changes get a quick
  // fade-and-swap instead of an instant content pop.
  if (isFirstRender) {
    doRender();
  } else {
    grid.classList.add('grid-swapping');
    setTimeout(doRender, 180);
  }
}

/* ---------------- LOAD MORE (full roster overlay pagination) ----------------
   Just bumps trVisibleCount and re-renders — goes through the same
   fade-and-swap as a filter change (renderTalentRosterGrid sees the grid
   already has children, so it's never the "isFirstRender" instant-paint
   path). Keeping one render path instead of a separate append-only one
   means there's nowhere for the visible cards / index numbers / Load More
   label to drift out of sync with the underlying filtered list. */
const trLoadMoreBtn = document.getElementById('trLoadMoreBtn');
if (trLoadMoreBtn) {
  trLoadMoreBtn.addEventListener('click', () => {
    trVisibleCount += TR_PAGE_SIZE;
    renderTalentRosterGrid();
  });
}

/* ---------------- VIEW TOGGLE (Grid / Showcase / List, full roster overlay) ----------------
   Purely a display-mode switch — same buildTalentCard() markup, different
   CSS (see .tr-view-comfort/.tr-view-list in style.css). Doesn't reset
   pagination or any filter; renderTalentRosterGrid() just reads trViewMode
   each time it rebuilds the grid. */
const trViewToggle = document.getElementById('trViewToggle');
if (trViewToggle) {
  const trViewBtns = Array.from(trViewToggle.querySelectorAll('.tr-view-btn'));
  trViewBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.view;
      if (!mode || mode === trViewMode) return;
      trViewMode = mode;
      trViewBtns.forEach(b => {
        const active = b === btn;
        b.classList.toggle('active', active);
        b.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      renderTalentRosterGrid();
    });
  });
}

/* ---------------- SORT BY (full roster overlay, rebuilt minimal toolbar) ----------------
   A small popover menu next to the View toggle — picks trSortMode, which
   getFilteredTrList() applies last (see above). Resets pagination back to
   page 1 on change (new order, same idea as a new filter) but — like
   trViewMode — is NOT reset by filter changes or reopening the overlay;
   once picked, the chosen order sticks for the session. */
const trSortToggle = document.getElementById('trSortToggle');
const trSortMenu = document.getElementById('trSortMenu');
if (trSortToggle && trSortMenu) {
  const trSortLabelEl = document.getElementById('trSortLabel');
  const trSortOptions = Array.from(trSortMenu.querySelectorAll('.tr-sort-option'));

  const closeTrSortMenu = () => {
    trSortMenu.classList.remove('show');
    trSortToggle.setAttribute('aria-expanded', 'false');
  };

  trSortToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = trSortMenu.classList.toggle('show');
    trSortToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  });

  trSortOptions.forEach(opt => {
    opt.addEventListener('click', () => {
      const mode = opt.dataset.sort;
      if (!mode) return;
      trSortOptions.forEach(o => o.classList.toggle('active', o === opt));
      if (trSortLabelEl) trSortLabelEl.textContent = opt.textContent.trim();
      closeTrSortMenu();
      if (mode === trSortMode) return;
      trSortMode = mode;
      trVisibleCount = TR_PAGE_SIZE; // new order — start from page 1
      renderTalentRosterGrid();
    });
  });

  // Outside click / Escape closes the menu, same pattern as other popovers
  // on this page (nav-talents dropdown, etc).
  document.addEventListener('click', (e) => {
    if (!trSortMenu.classList.contains('show')) return;
    if (trSortToggle.contains(e.target) || trSortMenu.contains(e.target)) return;
    closeTrSortMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && trSortMenu.classList.contains('show')) closeTrSortMenu();
  });
}

/* ---------------- VIEW ALL TALENT: search box (lives inside the overlay) ---------------- */
const talentSearchInput = document.getElementById('talentSearchInput');
const talentSearchClear = document.getElementById('talentSearchClear');
if (talentSearchInput) {
  talentSearchInput.addEventListener('input', (e) => {
    trSearchQuery = e.target.value;
    trVisibleCount = TR_PAGE_SIZE; // new filter set — start from page 1
    renderTalentRosterGrid();
    updateTrFiltersUI();
  });
}
if (talentSearchClear) {
  talentSearchClear.addEventListener('click', () => {
    trSearchQuery = '';
    trVisibleCount = TR_PAGE_SIZE; // new filter set — start from page 1
    if (talentSearchInput) { talentSearchInput.value = ''; talentSearchInput.focus(); }
    renderTalentRosterGrid();
    updateTrFiltersUI();
  });
}
/* ---------------- MEDIA KIT VIEW ---------------- */
const mediakitOverlay = document.getElementById('mediakitOverlay');
document.getElementById('mkBack').addEventListener('click', closeMediakit);

function closeMediakit(opts){
  mediakitOverlay.classList.remove('show');
  setBodyScrollLocked(talentRosterOverlay.classList.contains('show') ? 'hidden' : '');
  // Re-enable the roster overlay's own scroll now that the media kit
  // covering it is gone — see the matching suspend in openMediakit().
  talentRosterOverlay.style.overflow = '';
  stopMediakitLinesParallax();
  if(mkWhyAutoplayTimer){ clearInterval(mkWhyAutoplayTimer); mkWhyAutoplayTimer = null; }
  const heroActionsEl = document.getElementById('mkHeroActions');
  if(heroActionsEl) heroActionsEl.classList.remove('open');
  if(!opts || opts.updateUrl !== false){
    history.pushState({}, '', location.pathname);
  }
  document.title = 'BRXDGE | Talent Management for Creators';
}

/* ---------------- MEDIA KIT AMBIENT WAVE BACKGROUND ----------------
   Same cursor-parallax technique as the homepage's .brand-lines-bg
   (initBackgroundParallax() near the top of this file) — a cheap
   rAF-throttled CSS custom-property write, eased by a CSS transition
   rather than a JS tween loop — but its own element and its own
   listeners entirely, so it can never interact with (or risk
   regressing) that homepage effect. Started when the media kit opens,
   stopped when it closes (see closeMediakit() above and openMediakit()
   below), so a visitor who never opens a media kit never pays for an
   extra global mousemove listener, and re-opening a second talent's
   kit doesn't stack a second one on top of the first. */
const mkLinesBg = document.getElementById('mkLinesBg');
let mkLinesActive = false;
let mkLinesMouseHandler = null;
let mkLinesScrollHandler = null;

function startMediakitLinesParallax(){
  if(!mkLinesBg || mkLinesActive) return;
  if(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const isTouch = window.matchMedia && window.matchMedia('(hover: none)').matches;
  mkLinesActive = true;

  let pendingMX = 0, pendingMY = 0, pendingSY = 0, queued = false;
  function flush(){
    mkLinesBg.style.setProperty('--mk-bg-mx', pendingMX.toFixed(2) + 'px');
    mkLinesBg.style.setProperty('--mk-bg-my', pendingMY.toFixed(2) + 'px');
    mkLinesBg.style.setProperty('--mk-bg-sy', pendingSY.toFixed(2) + 'px');
    queued = false;
  }
  function schedule(){
    if(!queued){ queued = true; requestAnimationFrame(flush); }
  }

  if(!isTouch){
    mkLinesMouseHandler = (e) => {
      pendingMX = ((e.clientX / window.innerWidth) - 0.5) * 26;
      pendingMY = ((e.clientY / window.innerHeight) - 0.5) * 20;
      schedule();
    };
    window.addEventListener('mousemove', mkLinesMouseHandler, { passive: true });
  }

  // A little scroll-driven drift too (mirrors the homepage version's
  // --bg-sy), so the lines feel woven into the page rather than pasted
  // on top of it. Reads mediakitOverlay's own scroll position since
  // that's the element that actually scrolls (see .mediakit-overlay{
  // overflow-y:auto } in style.css) — not the window.
  mkLinesScrollHandler = () => {
    const y = mediakitOverlay.scrollTop || 0;
    pendingSY = Math.max(-40, Math.min(40, y * 0.015));
    schedule();
  };
  mediakitOverlay.addEventListener('scroll', mkLinesScrollHandler, { passive: true });
}

function stopMediakitLinesParallax(){
  if(!mkLinesActive) return;
  mkLinesActive = false;
  if(mkLinesMouseHandler) window.removeEventListener('mousemove', mkLinesMouseHandler);
  if(mkLinesScrollHandler) mediakitOverlay.removeEventListener('scroll', mkLinesScrollHandler);
  mkLinesMouseHandler = null;
  mkLinesScrollHandler = null;
}

// Handle the browser's Back/Forward buttons so they open/close the right
// media kit instead of just changing the URL underneath the page.
window.addEventListener('popstate', () => {
  const slug = new URLSearchParams(location.search).get('talent');
  const blogSlug = new URLSearchParams(location.search).get('blog');
  if(slug){
    const match = rosterData.find(t => slugify(t.name) === slug);
    if(match) openMediakit(match.id, { updateUrl: false });
  } else if(blogSlug){
    const match = blogData.find(p => p.slug === blogSlug);
    if(match) openBlogPost(match, { updateUrl: false });
  } else {
    closeMediakit({ updateUrl: false });
    closeBlogPost({ updateUrl: false });
  }
});

/* ---------------- CASE STUDIES / BLOG (public "proof" section) ----------------
   Same shape as the media-kit deep-link pattern above: the list endpoint
   only returns summary fields (title/excerpt/stats), so opening a post
   fetches the full body from /api/blog/post/:slug. The section hides
   itself entirely when there's no published content, rather than showing
   placeholder posts — see the no-fake-data note further down. */
async function loadBlog(){
  try {
    const response = await fetch(API + '/api/blog');
    blogData = await response.json();
  } catch(err) {
    blogData = [];
  }
  renderBlogGrid();

  const requestedSlug = new URLSearchParams(location.search).get('blog');
  if(requestedSlug){
    const match = blogData.find(p => p.slug === requestedSlug);
    if(match) openBlogPost(match, { updateUrl: false });
  }
}

function blogPostDate(p){
  if(!p.publishedAt) return '';
  try {
    return new Date(p.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch(err) { return ''; }
}

// Post bodies are typed into a single admin textarea as plain text, with
// blank lines separating paragraphs — there's no markdown/rich-text editor
// behind them. Rendering that as one flat pre-wrapped block (the old
// behavior) meant a short standalone line like "The Challenge" looked
// exactly like a body paragraph, with no visual structure at all. This
// splits on blank lines and promotes any short, punctuation-free
// standalone line to a section heading, so that same plain-text habit
// (a short label line, then its paragraph) reads as real hierarchy
// instead of a wall of undifferentiated text. Falls back gracefully to
// plain paragraphs for bodies that don't follow that pattern. Every piece
// of user-entered text is escaped before it touches innerHTML.
function formatBlogBody(raw){
  if(!raw) return '';
  const blocks = raw.trim().split(/\n{2,}/);
  return blocks.map(block => {
    const trimmed = block.trim();
    if(!trimmed) return '';
    const isSingleLine = !trimmed.includes('\n');
    const looksLikeHeading = isSingleLine && trimmed.length <= 60 && !/[.!?"')]$/.test(trimmed);
    if(looksLikeHeading) return `<h3 class="blog-post-h3">${escapeHtml(trimmed)}</h3>`;
    return `<p>${escapeHtml(trimmed).replace(/\n/g, ' ')}</p>`;
  }).filter(Boolean).join('');
}

// Small stat chips shown on a case-study card — only the ones that
// actually have a value are shown, so an article (or a partially filled
// case study) never renders empty "→" chips.
function buildBlogCardStats(p){
  const chips = [];
  if(p.statFollowersBefore || p.statFollowersAfter){
    chips.push(`Followers: ${escapeHtml(p.statFollowersBefore || '-')} → ${escapeHtml(p.statFollowersAfter || '-')}`);
  }
  if(p.statEngagementBefore || p.statEngagementAfter){
    chips.push(`Engagement: ${escapeHtml(p.statEngagementBefore || '-')} → ${escapeHtml(p.statEngagementAfter || '-')}`);
  }
  if(p.statRevenue) chips.push(`Revenue: ${escapeHtml(p.statRevenue)}`);
  if(!chips.length) return '';
  return `<div class="blog-card-stats">${chips.map(c => `<span class="blog-stat-chip">${c}</span>`).join('')}</div>`;
}

function buildBlogCard(p){
  const card = document.createElement('a');
  card.href = 'javascript:void(0)';
  card.className = 'blog-card reveal-card';
  const isCaseStudy = p.postType === 'case-study';
  const cover = p.coverImage && p.coverImage.trim() ? p.coverImage.trim()
    : `https://api.dicebear.com/9.x/notionists/svg?seed=${encodeURIComponent(p.slug || p.title)}&backgroundColor=c8302c,f0c239,fff8e9`;
  card.innerHTML = `
    <img class="blog-card-cover" src="${escapeHtml(cover)}" alt="${escapeHtml(p.title)}" loading="lazy">
    <div class="blog-card-body">
      <span class="blog-card-date">${isCaseStudy ? 'Case Study' : 'Article'}${p.talentName ? ' • ' + escapeHtml(p.talentName) : ''}${blogPostDate(p) ? ' • ' + blogPostDate(p) : ''}</span>
      <span class="blog-card-title">${escapeHtml(p.title)}</span>
      ${p.excerpt ? `<span class="blog-card-excerpt">${escapeHtml(p.excerpt)}</span>` : ''}
      ${isCaseStudy ? buildBlogCardStats(p) : ''}
      <span class="blog-card-readmore">Read more <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
    </div>
  `;
  card.addEventListener('click', () => openBlogPost(p));
  return card;
}

function renderBlogGrid(){
  const section = document.getElementById('blog');
  const grid = document.getElementById('blogGrid');
  if(!section || !grid) return;

  // No published posts yet — hide the whole section rather than show a
  // placeholder/fake case study. Real content only, added via the admin
  // dashboard.
  if(!blogData.length){
    section.style.display = 'none';
    return;
  }
  section.style.display = '';

  grid.innerHTML = '';
  blogData.forEach(p => grid.appendChild(buildBlogCard(p)));
  revealTalentCards(grid);
}

async function openBlogPost(postSummary, opts){
  if(!opts || opts.updateUrl !== false){
    history.pushState({ blogSlug: postSummary.slug }, '', '?blog=' + postSummary.slug);
  }
  document.title = `${postSummary.title} | BRXDGE`;

  // The list endpoint only carries summary fields — fetch the full post
  // (body included) before rendering, but fall back to the summary object
  // if that fetch fails so the overlay still opens with what we have.
  let post = postSummary;
  try {
    const res = await fetch(API + '/api/blog/post/' + encodeURIComponent(postSummary.slug));
    if(res.ok) post = await res.json();
  } catch(err) { /* fall back to summary */ }

  renderBlogPostContent(post);

  const overlay = document.getElementById('blogOverlay');
  if(overlay){
    overlay.classList.add('show');
    overlay.scrollTop = 0;
  }
  setBodyScrollLocked('hidden');
}

function renderBlogPostContent(post){
  const container = document.getElementById('blogPostContent');
  if(!container) return;
  const isCaseStudy = post.postType === 'case-study';
  const cover = post.coverImage && post.coverImage.trim() ? post.coverImage.trim() : '';

  const statRows = [
    ['Followers', post.statFollowersBefore, post.statFollowersAfter],
    ['Engagement', post.statEngagementBefore, post.statEngagementAfter],
  ].filter(([, before, after]) => before || after);

  const statPanel = isCaseStudy && (statRows.length || post.statBrandDeals || post.statRevenue) ? `
    <div class="blog-stat-panel">
      ${statRows.map(([label, before, after]) => `
        <div class="blog-stat-panel-item">
          <span class="blog-stat-panel-label">${label}</span>
          <span class="blog-stat-panel-value">${escapeHtml(before || '-')} → ${escapeHtml(after || '-')}</span>
        </div>
      `).join('')}
      ${post.statBrandDeals ? `
        <div class="blog-stat-panel-item">
          <span class="blog-stat-panel-label">Brand Deals</span>
          <span class="blog-stat-panel-value">${escapeHtml(post.statBrandDeals)}</span>
        </div>
      ` : ''}
      ${post.statRevenue ? `
        <div class="blog-stat-panel-item">
          <span class="blog-stat-panel-label">Revenue</span>
          <span class="blog-stat-panel-value">${escapeHtml(post.statRevenue)}</span>
        </div>
      ` : ''}
    </div>
  ` : '';

  // Type + talent go on a small pill badge — overlaid on the cover photo
  // (editorial-style, over a gradient scrim so it stays legible on any
  // image) when there is one, or standalone above the title when there
  // isn't. The date and author move to one quiet byline line under the
  // title instead of being crammed into the same badge as the type.
  const badgeText = (isCaseStudy ? 'Case Study' : 'Article') + (post.talentName ? ' • ' + escapeHtml(post.talentName) : '');
  const bylineText = [blogPostDate(post), post.author ? 'By ' + escapeHtml(post.author) : ''].filter(Boolean).join(' · ');

  container.innerHTML = `
    <article class="blog-post">
      ${cover ? `
      <div class="blog-post-hero">
        <img class="blog-post-cover" src="${escapeHtml(cover)}" alt="${escapeHtml(post.title)}">
        <div class="blog-post-hero-scrim" aria-hidden="true"></div>
        <span class="blog-post-badge blog-post-badge--on-image">${badgeText}</span>
      </div>
      ` : `<span class="blog-post-badge">${badgeText}</span>`}
      <h1>${escapeHtml(post.title)}</h1>
      ${bylineText ? `<p class="blog-post-byline">${bylineText}</p>` : ''}
      ${statPanel}
      <div class="blog-post-body">${formatBlogBody(post.body || post.excerpt || '')}</div>
    </article>
  `;
}

function closeBlogPost(opts){
  const overlay = document.getElementById('blogOverlay');
  if(overlay) overlay.classList.remove('show');
  setBodyScrollLocked((mediakitOverlay && mediakitOverlay.classList.contains('show')) || (talentRosterOverlay && talentRosterOverlay.classList.contains('show')) ? 'hidden' : '');
  if(!opts || opts.updateUrl !== false){
    history.pushState({}, '', location.pathname);
  }
  document.title = 'BRXDGE | Talent Management for Creators';
}

const blogBackBtn = document.getElementById('blogBack');
if(blogBackBtn) blogBackBtn.addEventListener('click', () => closeBlogPost());
document.addEventListener('keydown', (e) => {
  const overlay = document.getElementById('blogOverlay');
  if(e.key === 'Escape' && overlay && overlay.classList.contains('show')) closeBlogPost();
});

/* ---------------- CAMPAIGNS (Brand × Creator proof section) ---------------- */
async function loadCampaigns(){
  try {
    const response = await fetch(API + '/api/campaigns');
    campaignsData = await response.json();
  } catch(err) {
    campaignsData = [];
  }
  renderCampaignsGrid();
}

function buildCampaignCard(c){
  const card = document.createElement('div');
  card.className = 'campaign-card reveal-card';
  const cover = c.coverImage && c.coverImage.trim() ? c.coverImage.trim()
    : `https://api.dicebear.com/9.x/notionists/svg?seed=${encodeURIComponent(c.id || c.brandName)}&backgroundColor=c8302c,f0c239,fff8e9`;
  const deliverables = Array.isArray(c.deliverables) ? c.deliverables : [];
  const stats = [
    ['Reach', c.reach],
    ['Engagement', c.engagement],
  ].filter(([, v]) => v);

  card.innerHTML = `
    <img class="campaign-card-cover" src="${escapeHtml(cover)}" alt="${escapeHtml(c.brandName)}" loading="lazy">
    <div class="campaign-card-body">
      <div class="campaign-card-head">
        ${c.brandLogo ? `<img class="campaign-card-logo" src="${escapeHtml(c.brandLogo)}" alt="${escapeHtml(c.brandName)} logo" loading="lazy">` : ''}
        <span class="campaign-card-brand">${escapeHtml(c.brandName)}${c.creatorName ? ` × ${escapeHtml(c.creatorName)}` : ''}</span>
      </div>
      ${c.objective ? `<p class="campaign-card-objective">${escapeHtml(c.objective)}</p>` : ''}
      ${deliverables.length ? `<div class="campaign-card-deliverables">${deliverables.map(d => `<span class="campaign-deliverable-tag">${escapeHtml(d)}</span>`).join('')}</div>` : ''}
      ${stats.length ? `<div class="campaign-card-stats">${stats.map(([label, v]) => `<span class="campaign-stat-chip"><b>${escapeHtml(v)}</b> ${label}</span>`).join('')}</div>` : ''}
      ${c.results ? `<p class="campaign-card-results">${escapeHtml(c.results)}</p>` : ''}
    </div>
  `;
  return card;
}

function renderCampaignsGrid(){
  const section = document.getElementById('campaigns');
  const grid = document.getElementById('campaignsGrid');
  if(!section || !grid) return;

  // Same rule as the case-studies section: no real campaigns yet means no
  // section shown at all, never placeholder brand results.
  if(!campaignsData.length){
    section.style.display = 'none';
    return;
  }
  section.style.display = '';

  grid.innerHTML = '';
  campaignsData.forEach(c => grid.appendChild(buildCampaignCard(c)));
  revealTalentCards(grid);
}

/* ---------------- CAST / CAMPAIGN BRIEF ----------------
   Lets a brand tap "+ Add to Campaign" on any talent card to build up a
   shortlist ("cast"), then send one combined inquiry for the whole group
   instead of contacting each talent one at a time. Persisted to
   localStorage (not sessionStorage) so a brand's shortlist survives a
   page reload or a return visit — this is a real production site, not a
   sandboxed Claude artifact, so localStorage is the right tool here.
   Reuses the existing /api/contact endpoint (no backend changes): the
   selected talent names are joined into the `talent` field and folded
   into the message body, so these submissions show up in the admin's
   existing Contact Responses inbox alongside regular inquiries. */
const CAST_KEY = 'brxdge:cast';
const CAST_MAX = 10; // soft cap so the tray/avatar stack never gets unwieldy
let castIds = [];
try {
  const stored = JSON.parse(localStorage.getItem(CAST_KEY) || '[]');
  if(Array.isArray(stored)) castIds = stored;
} catch(err) { castIds = []; }

const castPlusSvg = `<svg class="cast-icon cast-icon-plus" width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`;
const castCheckSvg = `<svg class="cast-icon cast-icon-check" width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function saveCast(){
  try { localStorage.setItem(CAST_KEY, JSON.stringify(castIds)); } catch(err) { /* private mode etc — cast just won't persist */ }
}

// Keeps every "+ Add to Campaign" button on screen (featured grid + full
// roster overlay, if both happen to have rendered cards) in sync with
// castIds, without re-rendering the whole grid — re-rendering would kill
// scroll position and re-trigger card entrance animations.
function refreshCastButtons(){
  document.querySelectorAll('[data-cast-toggle]').forEach(btn => {
    const inCast = castIds.includes(btn.dataset.castToggle);
    btn.classList.toggle('added', inCast);
    btn.setAttribute('aria-pressed', inCast);
    const label = btn.querySelector('span');
    // Most cast-toggle buttons (talent cards) read "Add to Campaign"; the
    // media kit's version reads "Add to Cast" instead (data-cast-label-off)
    // — both fall back to these defaults if unset.
    if(label) label.textContent = inCast ? (btn.dataset.castLabelOn || 'Added') : (btn.dataset.castLabelOff || 'Add to Campaign');
  });
}

function toggleCast(id){
  const i = castIds.indexOf(id);
  if(i > -1){
    castIds.splice(i, 1);
  } else {
    if(castIds.length >= CAST_MAX){
      showToast(`You can add up to ${CAST_MAX} talent to a campaign brief`);
      return;
    }
    castIds.push(id);
  }
  saveCast();
  refreshCastButtons();
  renderAllCastWidgets();
  renderCastBriefList();
  // Sending the last talent to zero while the brief modal is open would
  // leave it showing an empty list — close it rather than let that happen.
  if(!castIds.length){
    const overlay = document.getElementById('campaignBriefOverlay');
    if(overlay && overlay.classList.contains('show')) overlay.classList.remove('show');
  }
}

function castTalents(){
  return castIds.map(id => rosterData.find(t => t.id === id)).filter(Boolean);
}

// Shared row renderer — builds the same removable talent row (photo, name,
// niche + reach, remove) used by both the Campaign Request modal's
// "Selected Talent" recap and the top-nav Talents dropdown, so the two stay
// visually and behaviorally identical. Clicking a name jumps to that
// talent's media kit (closing whichever cast UI is open first).
function renderCastRows(container){
  if(!container) return;
  const talents = castTalents();
  container.innerHTML = talents.map(t => {
    const reach = formatFollowers(totalReach(t.socials));
    return `
    <div class="cast-row">
      <img class="cast-row-avatar" src="${escapeHtml(t.photo || '')}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
      <div class="cast-row-info">
        <button type="button" class="cast-row-name" data-view-talent="${t.id}">${escapeHtml(t.name)}</button>
        <span class="cast-row-meta">${escapeHtml(t.niche || 'Creator')} · ${reach} reach</span>
      </div>
      <button type="button" class="cast-brief-remove" data-remove-cast="${t.id}" aria-label="Remove ${escapeHtml(t.name)} from cast">&times;</button>
    </div>`;
  }).join('');
  container.querySelectorAll('[data-remove-cast]').forEach(btn => {
    btn.addEventListener('click', () => toggleCast(btn.dataset.removeCast));
  });
  container.querySelectorAll('[data-view-talent]').forEach(btn => {
    btn.addEventListener('click', () => {
      closeAllCastWidgets();
      if(campaignBriefOverlay) campaignBriefOverlay.classList.remove('show');
      openMediakit(btn.dataset.viewTalent);
    });
  });
}

// CAST WIDGET (generic) — a "Talents (N)" trigger + dropdown (cast list,
// Clear, Build Campaign Request). The same widget now appears in three
// places: the top nav (always available), the full talent-roster overlay
// (floating top-right, since that overlay covers the navbar), and each
// individual media kit (next to "Get in Touch"). All instances share the
// same castIds state and are kept in sync via renderAllCastWidgets(),
// called anywhere the cast changes.
//
// Stored in a Map keyed by a stable name rather than a plain array because
// the media kit's instance is rebuilt from scratch every time openMediakit()
// re-renders #mkContent — re-registering under the same key replaces the
// old (now-detached) entry instead of leaking a new one on every profile
// view. The outside-click/Escape handling is registered ONCE globally
// (not per-widget) for the same reason — so it never needs re-binding.
const castWidgets = new Map();

function setupCastWidget(key, ids){
  const wrap = document.getElementById(ids.wrapId);
  const btn = document.getElementById(ids.btnId);
  const dropdown = document.getElementById(ids.dropdownId);
  if(!wrap || !btn || !dropdown){ castWidgets.delete(key); return null; }
  const count = document.getElementById(ids.countId);
  const list = document.getElementById(ids.listId);
  const clearBtn = document.getElementById(ids.clearId);
  const sendBtn = document.getElementById(ids.sendId);

  function close(){
    dropdown.classList.remove('show');
    btn.setAttribute('aria-expanded', 'false');
  }
  function open(){
    closeAllCastWidgets();
    dropdown.classList.add('show');
    btn.setAttribute('aria-expanded', 'true');
    renderCastRows(list);
  }
  function toggle(){
    if(dropdown.classList.contains('show')) close(); else open();
  }
  function render(){
    const talents = castTalents();
    if(!talents.length){
      wrap.classList.remove('show');
      close();
      return;
    }
    wrap.classList.add('show');
    if(count) count.textContent = talents.length;
    // Keep the dropdown's list live if it's currently open (e.g. removing
    // a row from inside it shouldn't require closing/reopening to see it gone).
    if(dropdown.classList.contains('show')) renderCastRows(list);
  }

  btn.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
  if(clearBtn){
    clearBtn.addEventListener('click', () => {
      castIds = [];
      saveCast();
      refreshCastButtons();
      renderAllCastWidgets();
    });
  }
  if(sendBtn){
    sendBtn.addEventListener('click', () => {
      close();
      openCampaignBriefModal();
    });
  }

  const instance = { render, close, wrap };
  castWidgets.set(key, instance);
  render();
  return instance;
}

function renderAllCastWidgets(){ castWidgets.forEach(w => w.render()); }
function closeAllCastWidgets(){ castWidgets.forEach(w => w.close()); }

// Close on outside click / Escape, same UX as the other dropdown-style
// menus on the site — registered once, applies to every current widget.
document.addEventListener('click', (e) => {
  castWidgets.forEach(w => { if(!w.wrap.contains(e.target)) w.close(); });
});
document.addEventListener('keydown', (e) => {
  if(e.key === 'Escape') closeAllCastWidgets();
});

// Top nav (desktop + mobile share this markup) and the full talent-roster
// overlay's floating widget both exist in the static page HTML, so they
// can be wired up once here. The media kit's instance is wired inside
// openMediakit() instead, since that markup is (re)built dynamically.
setupCastWidget('nav', { wrapId: 'navTalentsWrap', btnId: 'navTalentsBtn', dropdownId: 'navTalentsDropdown', countId: 'navTalentsCount', listId: 'navTalentsList', clearId: 'navTalentsClear', sendId: 'navTalentsSend' });
setupCastWidget('roster', { wrapId: 'trTalentsWrap', btnId: 'trTalentsBtn', dropdownId: 'trTalentsDropdown', countId: 'trTalentsCount', listId: 'trTalentsList', clearId: 'trTalentsClear', sendId: 'trTalentsSend' });

const campaignBriefOverlay = document.getElementById('campaignBriefOverlay');
const campaignBriefCloseBtn = document.getElementById('campaignBriefClose');
if(campaignBriefCloseBtn) campaignBriefCloseBtn.addEventListener('click', () => campaignBriefOverlay.classList.remove('show'));

function renderCastBriefList(){
  renderCastRows(document.getElementById('castBriefList'));
}

function openCampaignBriefModal(){
  if(!castIds.length) return;
  closeAllCastWidgets();
  renderCastBriefList();
  if(campaignBriefOverlay) campaignBriefOverlay.classList.add('show');
}

// Note: each cast widget's own Clear/Build-Campaign-Request buttons are
// already wired inside setupCastWidget() above (ids.clearId/ids.sendId) —
// no separate handlers needed here.

// CAMPAIGN TYPE — single-select pill group (radio-like: only one active at
// a time), value mirrored into the hidden #briefCampaignType input so the
// submit handler can read + validate it like any other required field.
const briefCampaignTypePills = document.getElementById('briefCampaignTypePills');
const briefCampaignTypeInput = document.getElementById('briefCampaignType');
if(briefCampaignTypePills){
  briefCampaignTypePills.querySelectorAll('[data-type]').forEach(pill => {
    pill.addEventListener('click', () => {
      briefCampaignTypePills.querySelectorAll('[data-type]').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      if(briefCampaignTypeInput) briefCampaignTypeInput.value = pill.dataset.type;
    });
  });
}

// DELIVERABLES — multi-select pill group; any number can be active at once.
const briefDeliverablesPills = document.getElementById('briefDeliverablesPills');
if(briefDeliverablesPills){
  briefDeliverablesPills.querySelectorAll('[data-deliverable]').forEach(pill => {
    pill.addEventListener('click', () => pill.classList.toggle('active'));
  });
}

// Native form.reset() only clears real form controls (input/select/
// textarea) — it doesn't touch the pill buttons' .active class or the
// hidden campaign-type value, so that has to be done explicitly whenever
// the form is cleared out after a successful submit.
function resetBriefPills(){
  if(briefCampaignTypePills) briefCampaignTypePills.querySelectorAll('.active').forEach(p => p.classList.remove('active'));
  if(briefDeliverablesPills) briefDeliverablesPills.querySelectorAll('.active').forEach(p => p.classList.remove('active'));
  if(briefCampaignTypeInput) briefCampaignTypeInput.value = '';
}

const campaignBriefForm = document.getElementById('campaignBriefForm');
if(campaignBriefForm){
  campaignBriefForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const talents = castTalents();
    if(!talents.length){ showToast('Add at least one talent to your cast first'); return; }

    const campaignType = (briefCampaignTypeInput && briefCampaignTypeInput.value.trim()) || '';
    if(!campaignType){ showToast('Pick a campaign type'); return; }

    const btn = e.target.querySelector('button[type="submit"]');
    const originalLabel = btn.textContent;
    btn.disabled = true; btn.textContent = 'Sending…';
    try {
      const talentNames = talents.map(t => t.name);
      const brandName = document.getElementById('briefBrandName').value.trim();
      const campaignName = document.getElementById('briefCampaignName').value.trim();
      const deliverables = briefDeliverablesPills
        ? Array.from(briefDeliverablesPills.querySelectorAll('.active')).map(p => p.dataset.deliverable)
        : [];
      const budget = document.getElementById('briefBudget').value;
      const timeline = document.getElementById('briefTimeline').value.trim();
      const details = document.getElementById('briefMessage').value.trim();

      // Backend still stores this as one free-text `message` field (see
      // POST /api/contact in index.js) — no schema change needed. Formatted
      // as readable labeled lines since the admin inbox renders it with
      // white-space:pre-wrap, so every structured field the manager filled
      // in still shows up clearly instead of being crammed into one blob.
      const message = [
        `Campaign Request: ${campaignName}`,
        `Brand: ${brandName}`,
        `Campaign Type: ${campaignType}`,
        `Selected Talent: ${talentNames.join(', ')}`,
        `Deliverables: ${deliverables.length ? deliverables.join(', ') : '-'}`,
        `Budget: ${budget || 'Not sure yet'}`,
        `Timeline: ${timeline || '-'}`,
        '',
        details ? `Additional Information:\n${details}` : 'Additional Information: -',
      ].join('\n');

      const res = await fetch(API + '/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: document.getElementById('briefContactName').value.trim(),
          email: document.getElementById('briefEmail').value.trim(),
          talent: talentNames.join(', '),
          message,
        }),
      });
      if(!res.ok) throw new Error('Request failed');
      campaignBriefOverlay.classList.remove('show');
      showToast("Campaign request sent. We'll be in touch within 1 business day");
      e.target.reset();
      resetBriefPills();
      castIds = [];
      saveCast();
      refreshCastButtons();
      renderAllCastWidgets();
    } catch(err){
      console.error(err);
      showToast("Couldn't send right now. Please try again in a moment");
    } finally {
      btn.disabled = false; btn.textContent = originalLabel;
    }
  });
}

// Converts a normal YouTube or TikTok video link into an embeddable
// player URL. Returns null if the link doesn't match a known pattern
// (in which case the post card just falls back to opening the link
// in a new tab, same as before).
function getVideoEmbedUrl(link){
  if(!link) return null;
  try {
    const url = new URL(link);

    // YouTube: watch?v=, youtu.be/, shorts/, already-embed links
    if(/(^|\.)youtube\.com$/.test(url.hostname) || url.hostname === 'youtu.be'){
      let id = null;
      if(url.hostname === 'youtu.be'){
        id = url.pathname.slice(1);
      } else if(url.pathname === '/watch'){
        id = url.searchParams.get('v');
      } else if(url.pathname.startsWith('/shorts/')){
        id = url.pathname.split('/')[2];
      } else if(url.pathname.startsWith('/embed/')){
        id = url.pathname.split('/')[2];
      }
      return id ? `https://www.youtube.com/embed/${id}?autoplay=1&rel=0` : null;
    }

    // TikTok: tiktok.com/@user/video/1234567890123456789
    if(/(^|\.)tiktok\.com$/.test(url.hostname)){
      const match = url.pathname.match(/\/video\/(\d+)/);
      return match ? `https://www.tiktok.com/embed/v2/${match[1]}` : null;
    }
  } catch(err) {
    return null;
  }
  return null;
}

// Renders a standalone "Latest Posts — X" section for one specific platform only
// (called once per platform so YouTube / TikTok / Instagram each get their own section, in order)
function renderPostsSection(platformName, socials){
  const social = (socials||[]).find(s => s.platform === platformName);
  const posts = social && social.posts ? social.posts : [];
  if(!posts.length) return '';
  return `
    <div class="mk-section-title">Latest Posts: ${platformName}</div>
    <div class="mk-posts-grid">
      ${posts.map(p => {
        const embedUrl = getVideoEmbedUrl(p.link);
        const href = safeUrl(p.link);
        return `
        <a class="mk-post-card" href="${escapeHtml(href || '#')}" target="_blank" rel="noopener" ${embedUrl ? `data-embed-url="${escapeHtml(embedUrl)}"` : ''}>
          <div class="mk-post-thumb">
            <img src="${escapeHtml(p.thumbnail)}" alt="${escapeHtml(p.title || '')}" loading="lazy">
            <span class="mk-post-badge">${platformIcon(platformName)}</span>
            ${embedUrl ? `<span class="mk-post-play" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M8 5v14l11-7z" fill="currentColor"/></svg></span>` : ''}
          </div>
          ${p.title ? `<div class="mk-post-title">${escapeHtml(p.title)}</div>` : ''}
        </a>
      `;
      }).join('')}
    </div>
  `;
}

// ---------------- MEDIA KIT HERO SCROLL TRANSITION ----------------
// As the visitor scrolls past the full-bleed hero photo, it fades/scales
// back while a small circular avatar grows in at the lower-center of the
// hero, overlapping the top of the (always-centered) title bar below it.
// Driven by a single CSS custom property (--intro-progress) so the
// photo/marquee/avatar all animate off one continuous scroll value.
let heroScrollTicking = false;
function updateHeroScrollProgress(){
  const heroWrap = document.getElementById('mkHeroWrap');
  const heroIntro = document.getElementById('mkHeroIntro');
  if(!heroWrap || !heroIntro) return; // media kit not open / roster view instead

  const heroHeight = heroIntro.offsetHeight || window.innerHeight;
  const range = heroHeight * 0.85; // transition completes slightly before the hero is fully scrolled past
  const progress = range > 0 ? Math.min(Math.max(mediakitOverlay.scrollTop / range, 0), 1) : 0;

  heroWrap.style.setProperty('--intro-progress', progress.toFixed(3));
  // Also expose it on the overlay itself (an ancestor of the fixed "Back to
  // Roster" button, which lives outside .mk-hero-wrap) so that button can
  // crossfade from its frosted-glass hero look to the normal theme pill.
  mediakitOverlay.style.setProperty('--intro-progress', progress.toFixed(3));
  mediakitOverlay.classList.toggle('past-hero', progress > 0.12);
}

// Subtle cursor-parallax on the hero's photo/marquee/wordmark layers —
// desktop-only (hover:hover + pointer:fine), same gating pattern as
// attachTiltInteraction(). Purely presentational; driven by CSS custom
// properties consumed in style.css so no layout math lives here.
function initHeroParallax(heroIntro){
  if(!heroIntro) return;
  if(!window.matchMedia || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  let raf = null;
  function onMove(e){
    if(raf) return;
    raf = requestAnimationFrame(() => {
      raf = null;
      const rect = heroIntro.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width - 0.5;   // -0.5..0.5
      const py = (e.clientY - rect.top) / rect.height - 0.5;
      heroIntro.style.setProperty('--hero-mx', (px * 28).toFixed(1) + 'px');
      heroIntro.style.setProperty('--hero-my', (py * 20).toFixed(1) + 'px');
    });
  }
  function onLeave(){
    heroIntro.style.setProperty('--hero-mx', '0px');
    heroIntro.style.setProperty('--hero-my', '0px');
  }
  heroIntro.addEventListener('mousemove', onMove);
  heroIntro.addEventListener('mouseleave', onLeave);
}

// ---------------- MEDIA KIT HERO ACTIONS: collapsible fan menu ----------
// Theme/copy-link/share/QR collapse behind a single toggle button (top
// right, over the hero photo) instead of always showing all 4 — click
// opens a quarter-circle "fan" of buttons out from the toggle (see
// .mk-hero-actions/.mk-hero-action --tx/--ty in style.css for the actual
// arc math). Static markup (#mkHeroActions in index.html, not part of
// the per-talent template), so — same as initSplashTilt() below — this
// only needs to attach its open/close listeners once at script load;
// openMediakit()/closeMediakit() just re-wire the 4 buttons' click
// handlers per talent and force the fan shut on every open/close.
(function initHeroActionsToggle(){
  const container = document.getElementById('mkHeroActions');
  const toggle = document.getElementById('mkHeroActionsToggle');
  if(!container || !toggle) return;

  function setOpen(open){
    container.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(!container.classList.contains('open'));
  });

  // Selecting any of the 4 fanned-out actions closes the menu again,
  // rather than leaving it open until the visitor taps the toggle a
  // second time.
  container.addEventListener('click', (e) => {
    if(e.target.closest('.mk-hero-action')) setOpen(false);
  });

  document.addEventListener('click', (e) => {
    if(container.classList.contains('open') && !container.contains(e.target)) setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if(e.key === 'Escape' && container.classList.contains('open')) setOpen(false);
  });
})();

// ---------------- MEDIA KIT SPLASH: interactive 3D tilt ----------------
// Desktop-only mouse-tracked tilt on the splash logo, same gating pattern
// as attachTiltInteraction()/initHeroParallax() above. The splash element
// is static in the DOM (not rebuilt on every open), so this only needs to
// attach its listeners once at script load.
(function initSplashTilt(){
  const splash = document.getElementById('mkSplash');
  const img = document.getElementById('mkSplashLogoImg');
  if(!splash || !img) return;
  if(!window.matchMedia || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  const maxTilt = 12;
  let raf = null;
  function onMove(e){
    if(raf) return;
    raf = requestAnimationFrame(() => {
      raf = null;
      const rect = splash.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width;
      const py = (e.clientY - rect.top) / rect.height;
      img.style.setProperty('--splash-rx', ((px - 0.5) * maxTilt * 2).toFixed(2) + 'deg');
      img.style.setProperty('--splash-ry', ((0.5 - py) * maxTilt * 2).toFixed(2) + 'deg');
    });
  }
  function onLeave(){
    img.style.setProperty('--splash-rx', '0deg');
    img.style.setProperty('--splash-ry', '0deg');
  }
  splash.addEventListener('mousemove', onMove);
  splash.addEventListener('mouseleave', onLeave);
})();

mediakitOverlay.addEventListener('scroll', () => {
  if(heroScrollTicking) return;
  heroScrollTicking = true;
  requestAnimationFrame(() => {
    updateHeroScrollProgress();
    heroScrollTicking = false;
  });
});

// ---------------- MEDIA KIT: ICON SET ----------------
// Small inline-SVG line icons for the Snapshot / Audience / Booking
// sections — stroke-based like the share/theme-toggle icons already used
// elsewhere in the media kit, so the new iconography reads as native to
// the site instead of a bolted-on icon library.
const MK_ICONS = {
  niche: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12.59 2.59a2 2 0 0 0-1.42-.59H4a2 2 0 0 0-2 2v7.17a2 2 0 0 0 .59 1.42l9 9a2 2 0 0 0 2.82 0l7.17-7.17a2 2 0 0 0 0-2.82l-9-9Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="7.5" cy="7.5" r="1.3" fill="currentColor"/></svg>',
  platforms: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.8"/><rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.8"/><rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.8"/><rect x="14" y="14" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.8"/></svg>',
  audience: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="9" cy="8" r="3.2" stroke="currentColor" stroke-width="1.8"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M16 8.5a3 3 0 1 1 0-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M15 14c2.8.3 5 2.8 5 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  content: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M8 5v14M16 5v14" stroke="currentColor" stroke-width="1.8"/><path d="M2.5 9.5h5M2.5 14.5h5M16 9.5h5M16 14.5h5" stroke="currentColor" stroke-width="1.8"/></svg>',
  gender: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="9" cy="8" r="3.2" stroke="currentColor" stroke-width="1.8"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M16 8.5a3 3 0 1 1 0-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M15 14c2.8.3 5 2.8 5 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  age: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><path d="M12 7v5l3.5 2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  locations: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 22s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="10" r="2.4" stroke="currentColor" stroke-width="1.8"/></svg>',
  interests: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  megaphone: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 11v2a2 2 0 0 0 2 2h1l1 5h2l-1-5h2l7 4V6l-7 4H6a2 2 0 0 0-2 2Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  target: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="5" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/></svg>',
  calendar: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M3 10h18M8 3v4M16 3v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  plus: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  check: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 13l4 4L19 7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};
// Available-For group names are a fixed taxonomy (talent-wizard.js's
// AVAILABLE_FOR_GROUPS), so they can be mapped to specific icons; any
// custom/overflow group ("Also Available For") falls back to a plain plus.
const MK_BOOKING_GROUP_ICONS = {
  'Sponsored Content': MK_ICONS.megaphone,
  'Campaigns': MK_ICONS.target,
  'Events': MK_ICONS.calendar,
};

// ---------------- MEDIA KIT: CREATOR SNAPSHOT ----------------
// "Immediately below the hero" at-a-glance card — lets a brand manager
// tell in a few seconds whether this creator fits their campaign, without
// having to read the full bio or platform cards further down the page.
function snapshotNiches(t){
  return (t.niche || '').split(/[/,&]/).map(s => s.trim()).filter(Boolean);
}

function renderSnapshotSection(t){
  const niches = snapshotNiches(t);
  const platforms = [...new Set((t.socials || []).map(s => s.platform).filter(Boolean))];
  const audienceChips = [t.audienceAgeRange, t.location, t.gender].filter(Boolean);
  const contentChips = t.contentFormats || [];
  const cols = [
    { label: 'Niche', icon: MK_ICONS.niche, items: niches },
    { label: 'Platforms', icon: MK_ICONS.platforms, items: platforms },
    { label: 'Audience', icon: MK_ICONS.audience, items: audienceChips },
    { label: 'Content', icon: MK_ICONS.content, items: contentChips },
  ].filter(c => c.items.length);
  if(!cols.length) return '';
  return `
    <div class="mk-snapshot">
      <span class="mk-snapshot-eyebrow">${escapeHtml((t.name || '').split(' ')[0].toUpperCase())} AT A GLANCE</span>
      <div class="mk-section-title">Creator Snapshot</div>
      <div class="mk-snap-grid">
        ${cols.map(c => `
          <div class="mk-snap-col">
            <span class="mk-snap-label">${c.icon}${escapeHtml(c.label)}</span>
            <div class="mk-snap-chips">${c.items.map(i => `<span class="mk-snap-chip">${escapeHtml(i)}</span>`).join('')}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// ---------------- MEDIA KIT: AUDIENCE ANALYTICS ----------------
// This is what turns "125K followers" into "reaches exactly the audience
// we're trying to reach" — the single biggest upgrade a media kit can get.
// Entirely optional per talent: the whole section (and each block inside
// it) only renders once the wizard has real numbers to show.
function mkBarRow(label, pct){
  const num = Number(pct);
  const clamped = Number.isFinite(num) ? Math.max(0, Math.min(100, num)) : 0;
  return `
    <div class="mk-bar-row">
      <span class="mk-bar-label">${escapeHtml(label)}</span>
      <div class="mk-bar-track"><div class="mk-bar-fill" style="width:${clamped}%"></div></div>
      <span class="mk-bar-pct">${escapeHtml(String(pct))}%</span>
    </div>
  `;
}

// Renders each populated data block (gender / age / locations / interests)
// as its own icon-labeled block, stacked vertically. Previously gender+age
// sat in an internal 2-col grid with locations/interests as separate
// full-width sections below — that only worked when the whole Audience
// section had the full page width to itself. Now that it lives in one half
// of the Snapshot+Audience two-column row, a single vertical stack reads
// far cleaner at that narrower width.
function renderAudienceSection(t){
  const male = Number(t.audienceGenderMale) || 0;
  const female = Number(t.audienceGenderFemale) || 0;
  const hasGender = male > 0 || female > 0;
  const ageRows = (t.audienceAgeBreakdown || []).filter(r => r.range && r.pct !== '' && r.pct != null);
  const locRows = (t.audienceTopLocations || []).filter(r => r.location && r.pct !== '' && r.pct != null);
  const interestRows = (t.audienceInterests || []).filter(r => r.interest && r.pct !== '' && r.pct != null);
  if(!hasGender && !ageRows.length && !locRows.length && !interestRows.length) return '';

  const genderTotal = male + female;
  const blocks = [];
  if(hasGender){
    blocks.push(`
      <div class="mk-aud-block">
        <span class="mk-aud-block-label">${MK_ICONS.gender}Gender</span>
        <div class="mk-gender-stat-row">
          ${male ? `<div class="mk-gender-stat"><span class="mk-gender-stat-num">${escapeHtml(String(t.audienceGenderMale))}<i>%</i></span><span class="mk-gender-stat-lbl"><i class="mk-gender-dot mk-gender-dot--male"></i>Male</span></div>` : ''}
          ${female ? `<div class="mk-gender-stat"><span class="mk-gender-stat-num">${escapeHtml(String(t.audienceGenderFemale))}<i>%</i></span><span class="mk-gender-stat-lbl"><i class="mk-gender-dot mk-gender-dot--female"></i>Female</span></div>` : ''}
        </div>
        <div class="mk-gender-split">
          ${male ? `<div class="mk-gender-seg mk-gender-male" style="width:${genderTotal ? (male / genderTotal * 100) : 50}%"></div>` : ''}
          ${female ? `<div class="mk-gender-seg mk-gender-female" style="width:${genderTotal ? (female / genderTotal * 100) : 50}%"></div>` : ''}
        </div>
      </div>
    `);
  }
  if(ageRows.length){
    blocks.push(`<div class="mk-aud-block"><span class="mk-aud-block-label">${MK_ICONS.age}Age</span>${ageRows.map(r => mkBarRow(r.range, r.pct)).join('')}</div>`);
  }
  if(locRows.length){
    blocks.push(`<div class="mk-aud-block"><span class="mk-aud-block-label">${MK_ICONS.locations}Top Locations</span>${locRows.map(r => mkBarRow(r.location, r.pct)).join('')}</div>`);
  }
  if(interestRows.length){
    blocks.push(`<div class="mk-aud-block"><span class="mk-aud-block-label">${MK_ICONS.interests}Top Interests</span>${interestRows.map(r => mkBarRow(r.interest, r.pct)).join('')}</div>`);
  }

  return `
    <div class="mk-audience">
      <div class="mk-section-title">Audience</div>
      <div class="mk-audience-blocks">${blocks.join('')}</div>
    </div>
  `;
}

// Combines Creator Snapshot + Audience Analytics into one two-column row on
// desktop ("the screenshot section... one side for the Snapshot, and the
// other one is for Audience") instead of two separately-centered narrow
// sections stacked on top of each other. Falls back to a single centered
// column (via .mk-glance-row--single) when only one side has data, and
// stacks to one column below the tablet breakpoint (see CSS).
function renderGlanceRow(t){
  const snapshot = renderSnapshotSection(t);
  const audience = renderAudienceSection(t);
  if(!snapshot && !audience) return '';
  const single = !snapshot || !audience;
  return `<div class="mk-glance-row${single ? ' mk-glance-row--single' : ''}">${snapshot}${audience}</div>`;
}

// ---------------- MEDIA KIT: "WHY [NAME]?" ----------------
// The sales pitch a brand manager shouldn't have to write themselves.
// A 2-column auto-playing carousel — one reason (category/title +
// description) paired with one gallery photo per slide, index-for-index
// (reason 1 with photo 1, reason 2 with photo 2, ...). No filler: a
// reason with no matching photo just shows an empty media side rather
// than a placeholder box, and the whole section renders nothing at all
// if there are no real reasons to show (same guard as before). See
// initWhyCarousel() for the crossfade/autoplay wiring.
function renderWhySection(t){
  const cards = (t.whyCards || []).filter(c => c.title && c.title.trim());
  if(!cards.length) return '';
  const firstName = escapeHtml((t.name || '').split(' ')[0] || 'This Talent');
  const images = (t.gallery || []).filter(g => (g.mediaType || 'image') !== 'video');
  return `
    <div class="mk-why">
      <div class="mk-section-title">Why ${firstName}?</div>
      <div class="mk-why-carousel" id="mkWhyCarousel">
        <div class="mk-why-slides">
          ${cards.map((c, i) => `
            <div class="mk-why-slide${i === 0 ? ' is-active' : ''}${i % 2 === 1 ? ' mk-why-slide--reverse' : ''}" data-why-index="${i}">
              <div class="mk-why-text">
                <span class="mk-why-badge">${MK_ICONS.check}</span>
                <h4>${escapeHtml(c.title)}</h4>
                ${c.description ? `<p>${escapeHtml(c.description)}</p>` : ''}
              </div>
              <div class="mk-why-media">
                ${images[i] ? `<img src="${escapeHtml(images[i].url)}" alt="${escapeHtml(c.title)}" loading="lazy">` : ''}
              </div>
            </div>
          `).join('')}
        </div>
        ${cards.length > 1 ? `
        <div class="mk-why-dots">
          ${cards.map((_, i) => `<button type="button" class="mk-why-dot${i === 0 ? ' active' : ''}" data-why-dot="${i}" aria-label="Show reason ${i + 1} of ${cards.length}"></button>`).join('')}
        </div>
        ` : ''}
      </div>
    </div>
  `;
}

// Crossfade + autoplay for the carousel built by renderWhySection() above.
// Slides are stacked (position:absolute) and swapped by toggling
// .is-active, so the fade in/out is a plain CSS opacity transition rather
// than a JS tween — "fade in, dissolve" happens for free from that
// transition firing on both the outgoing and incoming slide at once.
// Autoplay pauses on hover/focus and while the tab is hidden, and is
// skipped entirely under prefers-reduced-motion (dots still work
// manually). mkWhyAutoplayTimer/mkWhyVisibilityHandler are module-scoped
// and explicitly torn down before every re-bind — same reasoning as
// mkPlatformCarouselResize above: openMediakit() rebuilds #mkContent from
// scratch per talent, so a naive setInterval here would otherwise keep
// ticking against removed DOM forever, one extra leaked timer per talent
// viewed in a session.
const MK_WHY_AUTOPLAY_MS = 5000;
let mkWhyAutoplayTimer = null;
let mkWhyVisibilityHandler = null;

function initWhyCarousel(content){
  const root = content.querySelector('#mkWhyCarousel');
  if(!root) return;
  const slides = Array.from(root.querySelectorAll('.mk-why-slide'));
  if(!slides.length) return;
  const dots = Array.from(root.querySelectorAll('.mk-why-dot'));
  let active = 0;

  function goTo(i){
    const next = ((i % slides.length) + slides.length) % slides.length;
    if(next === active) return;
    slides[active].classList.remove('is-active');
    slides[next].classList.add('is-active');
    if(dots[active]) dots[active].classList.remove('active');
    if(dots[next]) dots[next].classList.add('active');
    active = next;
  }

  dots.forEach((d, i) => d.addEventListener('click', () => { goTo(i); resetAutoplay(); }));

  function stopAutoplay(){
    if(mkWhyAutoplayTimer){ clearInterval(mkWhyAutoplayTimer); mkWhyAutoplayTimer = null; }
  }
  function startAutoplay(){
    stopAutoplay();
    if(slides.length < 2) return;
    if(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if(document.hidden) return;
    mkWhyAutoplayTimer = setInterval(() => goTo(active + 1), MK_WHY_AUTOPLAY_MS);
  }
  function resetAutoplay(){ startAutoplay(); }

  root.addEventListener('mouseenter', stopAutoplay);
  root.addEventListener('mouseleave', startAutoplay);
  root.addEventListener('focusin', stopAutoplay);
  root.addEventListener('focusout', startAutoplay);

  if(mkWhyVisibilityHandler) document.removeEventListener('visibilitychange', mkWhyVisibilityHandler);
  mkWhyVisibilityHandler = () => { if(document.hidden) stopAutoplay(); else startAutoplay(); };
  document.addEventListener('visibilitychange', mkWhyVisibilityHandler);

  startAutoplay();
}

// ---------------- MEDIA KIT: "WHAT THEY CAN BOOK" ----------------
// Spells out exactly what's on offer instead of making a brand guess.
// Prices stay off the page — the CTA is "Request Campaign Pricing".
function renderBookingSection(t){
  const availableFor = t.availableFor || [];
  const bookingOptions = t.bookingOptions || [];
  if(!availableFor.length && !bookingOptions.length) return '';
  const taxonomy = window.TALENT_TAXONOMY || { AVAILABLE_FOR_GROUPS: [] };
  const definedGroups = taxonomy.AVAILABLE_FOR_GROUPS || [];
  const groups = definedGroups.map(g => ({
    group: g.group,
    items: availableFor.filter(a => g.items.includes(a)),
  })).filter(g => g.items.length);
  const customAvailable = availableFor.filter(a => !definedGroups.some(g => g.items.includes(a)));
  if(customAvailable.length) groups.push({ group: 'Also Available For', items: customAvailable });

  return `
    <div class="mk-booking">
      <div class="mk-section-title">What ${escapeHtml((t.name || '').split(' ')[0] || 'They')} Can Book</div>
      ${groups.length ? `
      <div class="mk-avail-groups">
        ${groups.map(g => `
          <div class="mk-avail-group">
            <span class="mk-avail-group-icon">${MK_BOOKING_GROUP_ICONS[g.group] || MK_ICONS.plus}</span>
            <span class="mk-avail-group-label">${escapeHtml(g.group)}</span>
            <div class="mk-avail-chips">${g.items.map(i => `<span class="mk-avail-chip">${escapeHtml(i)}</span>`).join('')}</div>
          </div>
        `).join('')}
      </div>` : ''}
      ${bookingOptions.length ? `
      <div class="mk-booking-options">
        <span class="mk-avail-group-label mk-booking-options-label">Booking Options</span>
        <div class="mk-booking-pills">${bookingOptions.map(o => `<span class="mk-booking-pill">${escapeHtml(o)}</span>`).join('')}</div>
      </div>` : ''}
      <div class="mk-pricing-callout">
        <p>Pricing is available on request. Every booking starts with a short campaign brief.</p>
        <button type="button" class="btn btn-primary mk-pricing-cta" data-open-campaign-pricing>Request Campaign Pricing <span class="arrow">→</span></button>
      </div>
    </div>
  `;
}

// ---------------- MEDIA KIT: CONTENT PORTFOLIO ----------------
// A categorized, filterable gallery instead of a flat pile of photos —
// images and videos both work. Each item's category comes from the wizard's
// Portfolio step; "ALL" always shows everything.
function renderPortfolioSection(t){
  const gallery = t.gallery || [];
  if(!gallery.length) return '';
  const categories = [...new Set(gallery.map(g => g.category).filter(Boolean))];
  return `
    <div class="mk-portfolio">
      <div class="mk-section-title">Content Portfolio</div>
      <div class="mk-portfolio-tabs" id="mkPortfolioTabs">
        <button type="button" class="mk-portfolio-tab active" data-portfolio-filter="ALL">All</button>
        ${categories.map(c => `<button type="button" class="mk-portfolio-tab" data-portfolio-filter="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join('')}
      </div>
      <div class="mk-portfolio-grid" id="mkPortfolioGrid">
        ${gallery.map((g, i) => `
          <div class="mk-portfolio-item" data-portfolio-cat="${escapeHtml(g.category || '')}" data-portfolio-index="${i}">
            ${g.mediaType === 'video'
              ? `<video src="${escapeHtml(g.url)}" muted playsinline preload="metadata"></video><span class="mk-portfolio-play" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M8 5v14l11-7z" fill="currentColor"/></svg></span>`
              : `<img src="${escapeHtml(g.url)}" alt="${escapeHtml(t.name)} photo" loading="lazy">`}
            ${g.category ? `<span class="mk-portfolio-tag">${escapeHtml(g.category)}</span>` : ''}
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// ---------------- MEDIA KIT: CAMPAIGN PORTFOLIO ----------------
// Reuses the site-wide Campaigns dataset (already loaded into
// campaignsData by loadCampaigns()) rather than duplicating campaign data
// per-talent — a talent's "previous campaigns" here are just whichever
// entries in the admin's Campaigns page have this talent's name as
// creatorName. The grid itself is populated after content.innerHTML is
// set (see openMediakit()), reusing buildCampaignCard() so these cards
// look identical to the ones on the public Campaigns section.
function renderCampaignPortfolioSection(t){
  const matches = campaignsData.filter(c => (c.creatorName || '').trim().toLowerCase() === (t.name || '').trim().toLowerCase());
  if(!matches.length) return '';
  return `
    <div class="mk-campaigns">
      <div class="mk-section-title">Campaign Portfolio</div>
      <div class="mk-campaigns-grid" id="mkCampaignsGrid"></div>
    </div>
  `;
}

// ---------------- MEDIA KIT: CLIENT FEEDBACK (SOCIAL PROOF) ----------------
function renderTestimonialsSection(t){
  const quotes = (t.testimonials || []).filter(q => q.quote && q.quote.trim());
  if(!quotes.length) return '';
  return `
    <div class="mk-testimonials">
      <div class="mk-section-title">Client Feedback</div>
      <div class="mk-testimonials-grid">
        ${quotes.map(q => `
          <div class="mk-testimonial-card">
            <p class="mk-testimonial-quote">“${escapeHtml(q.quote)}”</p>
            ${(q.author || q.role) ? `
            <div class="mk-testimonial-attrib">
              ${q.logo ? `<img class="mk-testimonial-logo" src="${escapeHtml(q.logo)}" alt="" loading="lazy">` : ''}
              <div>
                ${q.author ? `<span class="mk-testimonial-author">${escapeHtml(q.author)}</span>` : ''}
                ${q.role ? `<span class="mk-testimonial-role">${escapeHtml(q.role)}</span>` : ''}
              </div>
            </div>` : ''}
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// Coverflow-style carousel for the media kit's "Platforms" section — one
// card centered and in focus, neighbors peeking at reduced scale/opacity
// on either side. Card spacing is measured from the rendered card width
// (not hardcoded), so it stays proportional at any viewport size.
// `mkPlatformCarouselResize` is kept at module scope and re-bound (not
// stacked) on every call, mirroring the .mk-sticky-book-btn pattern above —
// openMediakit() re-renders #mkContent from scratch on every talent switch,
// so a naive addEventListener('resize', ...) here would leak one listener
// per talent viewed in a session.
let mkPlatformCarouselResize = null;
function initPlatformCarousel(content){
  const stage = content.querySelector('.mk-pc-stage');
  const viewport = content.querySelector('#mkPcViewport');
  if(!stage || !viewport) return;
  const cards = Array.from(viewport.querySelectorAll('.mk-platform-card'));
  if(!cards.length) return;
  const prevBtn = content.querySelector('.mk-pc-prev');
  const nextBtn = content.querySelector('.mk-pc-next');
  const dots = Array.from(content.querySelectorAll('.mk-pc-dot'));
  let active = 0;

  function layout(){
    const cardWidth = cards[0].offsetWidth || 300;
    const spacing = Math.max(cardWidth * 0.62, 130);
    cards.forEach((card, i) => {
      const offset = i - active;
      const abs = Math.abs(offset);
      const visible = abs <= 3;
      const scale = offset === 0 ? 1 : Math.max(0.74, 1 - abs * 0.12);
      const ty = offset === 0 ? 0 : 14;
      const opacity = offset === 0 ? 1 : Math.max(0.25, 1 - abs * 0.3);
      const blurPx = offset === 0 ? 0 : Math.min(abs * 1.4, 4);
      card.style.transform = `translate(-50%, -50%) translateX(${offset * spacing}px) translateY(${ty}px) scale(${scale})`;
      card.style.opacity = visible ? String(opacity) : '0';
      card.style.filter = blurPx ? `blur(${blurPx}px)` : '';
      card.style.zIndex = String(10 - abs);
      card.style.pointerEvents = visible ? '' : 'none';
      card.classList.toggle('is-active', offset === 0);
      card.querySelectorAll('a, button').forEach(el => { el.tabIndex = offset === 0 ? 0 : -1; });
    });
    dots.forEach((d, i) => d.classList.toggle('active', i === active));
    if(prevBtn) prevBtn.disabled = active === 0;
    if(nextBtn) nextBtn.disabled = active === cards.length - 1;
  }

  function goTo(i){
    active = Math.max(0, Math.min(cards.length - 1, i));
    layout();
  }

  if(prevBtn) prevBtn.addEventListener('click', () => goTo(active - 1));
  if(nextBtn) nextBtn.addEventListener('click', () => goTo(active + 1));
  dots.forEach((d, i) => d.addEventListener('click', () => goTo(i)));
  cards.forEach((card, i) => {
    card.addEventListener('click', () => { if(i !== active) goTo(i); });
  });

  stage.setAttribute('tabindex', '0');
  stage.addEventListener('keydown', (e) => {
    if(e.key === 'ArrowLeft'){ e.preventDefault(); goTo(active - 1); }
    else if(e.key === 'ArrowRight'){ e.preventDefault(); goTo(active + 1); }
  });

  let touchStartX = null;
  viewport.addEventListener('touchstart', (e) => { touchStartX = e.touches[0].clientX; }, { passive: true });
  viewport.addEventListener('touchend', (e) => {
    if(touchStartX === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    if(Math.abs(dx) > 40) goTo(active + (dx < 0 ? 1 : -1));
    touchStartX = null;
  }, { passive: true });

  if(mkPlatformCarouselResize) window.removeEventListener('resize', mkPlatformCarouselResize);
  let resizeTimer = null;
  mkPlatformCarouselResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(layout, 120);
  };
  window.addEventListener('resize', mkPlatformCarouselResize);

  layout();
}

function openMediakit(id, opts){
  const t = rosterData.find(x => x.id === id);
  if(!t) return;

  startMediakitLinesParallax();

  if(!opts || opts.updateUrl !== false){
    history.pushState({ talentId: id }, '', '?talent=' + slugify(t.name));
  }
  document.title = `${t.name} | BRXDGE`;

  const reach = formatFollowers(totalReach(t.socials));
  const content = document.getElementById('mkContent');
  const nameUpper = escapeHtml(t.name.toUpperCase());
  const heroSep = `<span class="mk-hero-marquee-sep">•</span>`;
  const heroMarqueeGroup = `
      <span>${nameUpper}</span>${heroSep}<span>${nameUpper}</span>${heroSep}<span>${nameUpper}</span>${heroSep}
    `;
  content.innerHTML = `
    <div class="mk-hero-wrap" id="mkHeroWrap">
      <section class="mk-hero-intro" id="mkHeroIntro">
        <div class="mk-hero-marquee" id="mkHeroMarquee" aria-hidden="true">
          <div class="mk-hero-marquee-track">
            <div class="mk-hero-marquee-group">${heroMarqueeGroup}</div>
            <div class="mk-hero-marquee-group">${heroMarqueeGroup}</div>
          </div>
        </div>
        <div class="mk-hero-brand" id="mkHeroBrand" aria-hidden="true">
          <span class="mk-hero-brand-text">BRXDGE</span>
        </div>
        ${(t.gallery || []).some(g => (g.mediaType || 'image') !== 'video') ? `
        <a href="javascript:void(0)" class="mk-hero-gallery-link" id="mkHeroGalleryDownload">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span>Download Gallery</span>
        </a>
        ` : ''}
        <img class="mk-hero-photo" id="mkHeroPhoto" src="${escapeHtml(talentCoverUrl(t))}" alt="${escapeHtml(t.name)}">
        <div class="mk-hero-scrollcue" id="mkHeroScrollcue" aria-hidden="true">
          <span class="mk-hero-scrollcue-label">Scroll</span>
          <svg class="mk-hero-scrollcue-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
      </section>
      <div class="mk-hero-avatar" id="mkHeroAvatar" aria-hidden="true">
        <img src="${escapeHtml(talentPhotoUrl(t))}" alt="${escapeHtml(t.name)}">
      </div>
    </div>

    <div class="wrap">
    <div class="mk-title-wrapper" id="mkTitleWrapper">
      <div class="mk-title">
        <h2>${escapeHtml(t.name)}</h2>
        <div class="niche-tags">${talentCategories(t).map(c => `<span class="niche-tag">${escapeHtml(c)}</span>`).join('')}</div>
        ${t.bio ? `<p class="mk-title-tagline">${escapeHtml(t.bio.split('.')[0])}.</p>` : ''}
      </div>
      <div class="mk-cta-row">
        <button class="btn btn-primary mk-cta" data-open-contact>Get in Touch</button>
        <button type="button" class="mk-addcast${castIds.includes(t.id) ? ' added' : ''}" id="mkAddCastBtn" data-cast-toggle="${t.id}" data-cast-label-off="Add to Cast" aria-pressed="${castIds.includes(t.id)}">
          ${castCheckSvg}${castPlusSvg}
          <span>${castIds.includes(t.id) ? 'Added' : 'Add to Cast'}</span>
        </button>
        <button type="button" class="mk-addcast mk-download-kit" id="mkDownloadKitBtn" data-download-mediakit>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span>Download Media Kit</span>
        </button>
      </div>
    </div>
    <div class="mk-main">
      ${renderGlanceRow(t)}

      <p class="reach-line">Combined social reach: <b>${reach}</b> across ${(t.socials||[]).length} platform${(t.socials||[]).length === 1 ? '' : 's'}</p>
      ${t.location ? `<p class="mk-meta-line"><span class="mk-meta-label">Location</span>${escapeHtml(t.location)}</p>` : ''}
      <p class="mk-bio">${escapeHtml(t.bio)}</p>

      <div class="mk-section-title">Platforms</div>
      ${(t.socials||[]).length ? `
      <div class="mk-platform-carousel" id="mkPlatformCarousel">
        ${(t.socials||[]).length > 1 ? `
        <div class="mk-pc-dots">
          ${(t.socials||[]).map((_, i) => `<button type="button" class="mk-pc-dot${i === 0 ? ' active' : ''}" data-pc-dot="${i}" aria-label="Show ${escapeHtml((t.socials||[])[i].platform || 'platform')}"></button>`).join('')}
        </div>
        ` : ''}
        <div class="mk-pc-stage">
          <div class="mk-pc-viewport" id="mkPcViewport">
            ${(t.socials||[]).map((s, i) => `
              <div class="mk-platform-card" data-pc-index="${i}" style="--p-accent:${platformBrandColor(s.platform)}">
                <div class="row1">
                  <div class="p-icon">${platformIconColor(s.platform)}</div>
                  <div class="p-name">${escapeHtml(s.platform)}</div>
                </div>
                <div class="mk-metrics">
                  <div class="m"><span class="v">${escapeHtml(s.followers || '-')}</span><span class="k"> Followers</span></div>
                </div>
                <div class="mk-platform-actions">
                  ${safeUrl(s.url) ? `<a class="visit" href="${escapeHtml(safeUrl(s.url))}" target="_blank" rel="noopener">Visit profile <span class="arrow">→</span></a>` : ''}
                  ${(s.platform === 'YouTube' || s.platform === 'TikTok') ? `<button type="button" class="view-stats" data-social-index="${i}">View statistics</button>` : ''}
                </div>
              </div>
            `).join('')}
          </div>
          ${(t.socials||[]).length > 1 ? `
          <button type="button" class="mk-pc-nav mk-pc-prev" aria-label="Previous platform">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M15 6l-6 6 6 6" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <button type="button" class="mk-pc-nav mk-pc-next" aria-label="Next platform">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          ` : ''}
        </div>
      </div>
      ` : '<p style="color:var(--muted); font-size:14px;">No platforms added yet.</p>'}

      ${renderWhySection(t)}
      ${renderBookingSection(t)}
      ${renderPortfolioSection(t)}
      ${renderCampaignPortfolioSection(t)}
      ${renderTestimonialsSection(t)}

      ${renderPostsSection('YouTube', t.socials)}
      ${renderPostsSection('TikTok', t.socials)}

      <p class="mk-note">Follower counts are entered and updated by the BRXDGE team rather than pulled live from each platform. Tap "Visit profile" to see current numbers directly on the source.</p>
    </div>
    </div>
  `;
  mediakitOverlay.classList.add('show');
  mediakitOverlay.scrollTop = 0;
  setBodyScrollLocked('hidden');
  // openMediakit() can be triggered from inside the "View All Talent"
  // roster overlay (clicking a card there) — that overlay is deliberately
  // left .show'd underneath so "Back to Roster" doesn't need to re-render
  // it, but it's ALSO its own independently-scrollable fixed/fullscreen
  // panel (overflow-y:auto), same as this one. Left alone, that meant two
  // separate scrollable regions were live at once — the roster underneath
  // and the media kit on top — each showing its own scrollbar. Suspend the
  // roster's own scroll while it's covered; closeMediakit() restores it.
  if(talentRosterOverlay.classList.contains('show')){
    talentRosterOverlay.style.overflow = 'hidden';
  }
  updateHeroScrollProgress();
  initHeroParallax(content.querySelector('.mk-hero-intro'));

  // Splash intro: show the logo immediately, hold briefly, then fade it
  // out while the hero section animates in underneath it.
  const splash = document.getElementById('mkSplash');
  const hero = content.querySelector('.mk-hero-intro');
  splash.classList.remove('fade-out');
  splash.style.display = 'flex';
  void splash.offsetWidth; // restart the logo's entrance animation on repeat opens
  if(hero) hero.classList.remove('mk-hero-in');

  setTimeout(() => {
    splash.classList.add('fade-out');
    if(hero) hero.classList.add('mk-hero-in');
  }, 900);
  setTimeout(() => {
    splash.style.display = 'none';
  }, 1500);

  // Content Portfolio — category tabs (client-side filter, no re-render)
  // and per-item click: images open the lightbox, videos open the video
  // modal with a native <video> player.
  const portfolioTabs = content.querySelector('#mkPortfolioTabs');
  const portfolioGrid = content.querySelector('#mkPortfolioGrid');
  if(portfolioTabs && portfolioGrid){
    portfolioTabs.querySelectorAll('[data-portfolio-filter]').forEach(tab => {
      tab.addEventListener('click', () => {
        portfolioTabs.querySelectorAll('[data-portfolio-filter]').forEach(b => b.classList.remove('active'));
        tab.classList.add('active');
        const filter = tab.dataset.portfolioFilter;
        portfolioGrid.querySelectorAll('.mk-portfolio-item').forEach(item => {
          item.style.display = (filter === 'ALL' || item.dataset.portfolioCat === filter) ? '' : 'none';
        });
      });
    });
    portfolioGrid.querySelectorAll('.mk-portfolio-item').forEach(item => {
      item.addEventListener('click', () => {
        const idx = Number(item.dataset.portfolioIndex);
        const g = (t.gallery || [])[idx];
        if(!g) return;
        if(g.mediaType === 'video'){
          openPortfolioVideo(g.url);
        } else {
          const imageItems = (t.gallery || []).filter(x => (x.mediaType || 'image') !== 'video');
          const imgIdx = imageItems.indexOf(g);
          openGalleryLightbox(t, imgIdx >= 0 ? imgIdx : 0);
        }
      });
    });
  }

  // Campaign Portfolio — populated with real DOM nodes from
  // buildCampaignCard() (same cards as the public Campaigns section)
  // rather than duplicating that markup as a string here.
  const campaignsGridEl = content.querySelector('#mkCampaignsGrid');
  if(campaignsGridEl){
    campaignsData
      .filter(c => (c.creatorName || '').trim().toLowerCase() === (t.name || '').trim().toLowerCase())
      .forEach(c => campaignsGridEl.appendChild(buildCampaignCard(c)));
    // buildCampaignCard() marks each card .reveal-card (opacity:0 until an
    // IntersectionObserver adds .in-view — see revealTalentCards()). These
    // cards are appended straight into an overlay that's already on
    // screen, so they'd never scroll into view to trigger that observer on
    // their own; `immediate: true` reveals them right away instead, same
    // as the talent roster overlay does for the same reason.
    revealTalentCards(campaignsGridEl, { immediate: true });
  }

  const galleryDownloadLink = content.querySelector('#mkHeroGalleryDownload');
  if(galleryDownloadLink){
    galleryDownloadLink.addEventListener('click', (e) => {
      e.preventDefault();
      downloadGalleryAlbum(t);
    });
  }

  // "Download Media Kit" — the full 7-page PDF dossier (hero, about,
  // audience, platforms, content, campaigns, booking), distinct from the
  // simpler "Download Gallery" photo album above.
  const downloadKitBtn = content.querySelector('[data-download-mediakit]');
  if(downloadKitBtn) downloadKitBtn.addEventListener('click', () => downloadMediaKitPdf(t));

  content.querySelectorAll('.mk-post-card[data-embed-url]').forEach(card => {
    card.addEventListener('click', (e) => {
      e.preventDefault();
      openVideoModal(card.dataset.embedUrl);
    });
  });

  content.querySelectorAll('.view-stats').forEach(btn => {
    btn.addEventListener('click', () => {
      const social = (t.socials || [])[Number(btn.dataset.socialIndex)];
      if(social) openStatsModal(t, social);
    });
  });

  initPlatformCarousel(content);
  initWhyCarousel(content);

  const contactBtn = content.querySelector('[data-open-contact]');
  if(contactBtn) contactBtn.addEventListener('click', () => openContactModal(t.name));

  // Theme/copy-link/share/QR buttons — static markup fixed over the hero
  // photo (see #mkHeroActions in index.html), collapsed behind a single
  // toggle button and fanned out in a quarter-circle on click (see
  // initHeroActionsToggle() + .mk-hero-actions in style.css). Not part of
  // this innerHTML template, so it persists across talent switches —
  // clone-and-replace instead of a plain addEventListener (same reasoning
  // as #mkStickyBookBtn below), otherwise every open would stack another
  // listener bound to the previous talent's shareUrl. Also collapse the
  // fan back shut on every fresh open so switching talents never leaves
  // it stuck open.
  const heroActionsEl = document.getElementById('mkHeroActions');
  if(heroActionsEl){
    heroActionsEl.classList.remove('open');
    const toggleEl = document.getElementById('mkHeroActionsToggle');
    if(toggleEl) toggleEl.setAttribute('aria-expanded', 'false');
  }
  const shareUrl = getTalentShareUrl(t);
  const themeBtnEl = document.getElementById('mkHeroThemeBtn');
  if(themeBtnEl){
    const freshThemeBtn = themeBtnEl.cloneNode(true);
    themeBtnEl.replaceWith(freshThemeBtn);
    freshThemeBtn.addEventListener('click', () => window.toggleBrxdgeTheme && window.toggleBrxdgeTheme());
  }
  const copyBtnEl = document.getElementById('mkHeroCopyBtn');
  if(copyBtnEl){
    const freshCopyBtn = copyBtnEl.cloneNode(true);
    copyBtnEl.replaceWith(freshCopyBtn);
    freshCopyBtn.addEventListener('click', () => copyShareLink(shareUrl));
  }
  const shareBtnEl = document.getElementById('mkHeroShareBtn');
  if(shareBtnEl){
    const freshShareBtn = shareBtnEl.cloneNode(true);
    shareBtnEl.replaceWith(freshShareBtn);
    freshShareBtn.addEventListener('click', () => shareProfile(t.name, shareUrl));
  }
  const qrBtnEl = document.getElementById('mkHeroQrBtn');
  if(qrBtnEl){
    const freshQrBtn = qrBtnEl.cloneNode(true);
    qrBtnEl.replaceWith(freshQrBtn);
    freshQrBtn.addEventListener('click', () => openQrModal(t.name, shareUrl));
  }

  // "Add to Cast" toggle beside "Get in Touch" — same castIds toggle used
  // by every talent card's "Add to Campaign" button (data-cast-toggle),
  // just re-labeled for this context via data-cast-label-off (see
  // refreshCastButtons()). Initial .added state is set directly in the
  // template above; this only needs to wire the click.
  const mkAddCastBtn = content.querySelector('[data-cast-toggle]');
  if(mkAddCastBtn) mkAddCastBtn.addEventListener('click', () => toggleCast(mkAddCastBtn.dataset.castToggle));

  // "Request Campaign Pricing →" (What They Can Book section) — adds this
  // talent to the cast if they aren't already in it, then jumps straight
  // into the campaign request flow instead of making the brand manager
  // find "Add to Cast" first.
  const pricingBtn = content.querySelector('[data-open-campaign-pricing]');
  if(pricingBtn) pricingBtn.addEventListener('click', () => {
    if(!castIds.includes(t.id)) toggleCast(t.id);
    openCampaignBriefModal();
  });

  // Sticky "Book" bar — lives outside #mkContent (static markup in
  // index.html, see .mk-sticky-book), so it's re-populated per talent here
  // rather than re-rendered. Its own show/hide is pure CSS, gated on the
  // same .mediakit-overlay.past-hero class updateHeroScrollProgress()
  // already toggles for #mkBack — no extra scroll listener needed.
  const stickyFirstName = (t.name || '').split(' ')[0] || 'Them';
  const stickyPhoto = document.getElementById('mkStickyBookPhoto');
  const stickyName = document.getElementById('mkStickyBookName');
  const stickyNiche = document.getElementById('mkStickyBookNiche');
  const stickyLabel = document.getElementById('mkStickyBookLabel');
  const stickyBtn = document.getElementById('mkStickyBookBtn');
  if(stickyPhoto) stickyPhoto.src = talentPhotoUrl(t);
  if(stickyPhoto) stickyPhoto.alt = escapeHtml(t.name);
  if(stickyName) stickyName.textContent = t.name || '';
  if(stickyNiche) stickyNiche.textContent = talentCategories(t)[0] || t.niche || '';
  if(stickyLabel) stickyLabel.textContent = `Book ${stickyFirstName}`;
  if(stickyBtn){
    // Replace instead of addEventListener — openMediakit() re-populates this
    // same static element on every talent switch, and stacking listeners
    // across opens would fire once per previous talent too.
    const freshBtn = stickyBtn.cloneNode(true);
    stickyBtn.replaceWith(freshBtn);
    freshBtn.addEventListener('click', () => {
      if(!castIds.includes(t.id)) toggleCast(t.id);
      openCampaignBriefModal();
    });
  }
}

// The full, shareable URL for a talent's media kit (matches the ?talent=
// deep-link scheme handled in loadRoster/openMediakit).
function getTalentShareUrl(t){
  return `${location.origin}${location.pathname}?talent=${slugify(t.name)}`;
}

async function copyShareLink(url, message){
  try {
    await navigator.clipboard.writeText(url);
    showToast(message || 'Link copied');
  } catch(err) {
    // Clipboard API unavailable (e.g. insecure context) — fall back to a manual prompt
    window.prompt('Copy this link:', url);
  }
}

// Native share sheet (mobile browsers, most desktop browsers now too) so a
// profile can be dropped straight into Messages, Mail, etc. Falls back to
// copying the link when navigator.share isn't available.
async function shareProfile(name, url){
  if(navigator.share){
    try {
      await navigator.share({ title: `${name} | BRXDGE`, text: `Check out ${name}'s media kit`, url });
    } catch(err) {
      // User backed out of the share sheet — nothing to do
    }
  } else {
    copyShareLink(url, 'Link copied, share it anywhere');
  }
}

/* ---------------- VIDEO MODAL (inline trailer/post playback) ---------------- */
const videoModal = document.getElementById('videoModal');
const videoModalFrame = document.getElementById('videoModalFrame');
document.getElementById('videoModalClose').addEventListener('click', closeVideoModal);
videoModal.addEventListener('click', (e) => { if(e.target === videoModal) closeVideoModal(); });
document.addEventListener('keydown', (e) => {
  if(e.key === 'Escape' && videoModal.classList.contains('show')) closeVideoModal();
});

function openVideoModal(embedUrl){
  videoModalFrame.innerHTML = `<iframe src="${embedUrl}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
  videoModal.classList.add('show');
  setBodyScrollLocked('hidden');
}

// Content Portfolio videos are direct hosted video files (uploaded or a
// pasted URL), not YouTube/TikTok embed links — a real <video> element
// plays those correctly, where an <iframe> (openVideoModal's job, above)
// would not.
function openPortfolioVideo(url){
  videoModalFrame.innerHTML = `<video src="${escapeHtml(url)}" controls autoplay playsinline></video>`;
  videoModal.classList.add('show');
  setBodyScrollLocked('hidden');
}

function closeVideoModal(){
  videoModal.classList.remove('show');
  videoModalFrame.innerHTML = ''; // stop playback
  setBodyScrollLocked(mediakitOverlay.classList.contains('show') ? 'hidden' : '');
}

/* ---------------- QR SHARE MODAL ---------------- */
const qrModal = document.getElementById('qrModal');
const qrModalImg = document.getElementById('qrModalImg');
const qrModalName = document.getElementById('qrModalName');
const qrModalUrl = document.getElementById('qrModalUrl');
document.getElementById('qrModalClose').addEventListener('click', closeQrModal);
qrModal.addEventListener('click', (e) => { if(e.target === qrModal) closeQrModal(); });
document.getElementById('qrModalCopy').addEventListener('click', () => copyShareLink(qrModalUrl.textContent));
document.addEventListener('keydown', (e) => {
  if(e.key === 'Escape' && qrModal.classList.contains('show')) closeQrModal();
});

function openQrModal(name, url){
  qrModalName.textContent = name;
  qrModalUrl.textContent = url;
  qrModalImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=280x280&margin=12&data=${encodeURIComponent(url)}`;
  qrModal.classList.add('show');
  setBodyScrollLocked('hidden');
}

function closeQrModal(){
  qrModal.classList.remove('show');
  setBodyScrollLocked(mediakitOverlay.classList.contains('show') ? 'hidden' : '');
}

/* ---------------- STATISTICS MODAL (TikTok / YouTube performance numbers) ---------------- */
const statsModal = document.getElementById('statsModal');
const statsModalIcon = document.getElementById('statsModalIcon');
const statsModalName = document.getElementById('statsModalName');
const statsModalPlatform = document.getElementById('statsModalPlatform');
const statsModalGrid = document.getElementById('statsModalGrid');
document.getElementById('statsModalClose').addEventListener('click', closeStatsModal);
statsModal.addEventListener('click', (e) => { if(e.target === statsModal) closeStatsModal(); });
document.addEventListener('keydown', (e) => {
  if(e.key === 'Escape' && statsModal.classList.contains('show')) closeStatsModal();
});

function openStatsModal(t, social){
  const stats = social.stats || {};
  statsModalName.textContent = t.name;
  statsModalPlatform.textContent = social.platform;
  statsModalIcon.innerHTML = platformIconColor(social.platform);

  const tiles = [
    { k: 'Followers', v: social.followers },
    { k: 'Avg. Views', v: stats.avgViews },
    { k: 'Avg. Likes', v: stats.avgLikes },
    { k: 'Engagement Rate', v: stats.engagementRate },
    { k: 'Growth (30 days)', v: stats.growth },
  ];
  statsModalGrid.innerHTML = tiles.map(x => `
    <div class="stats-tile">
      <span class="v">${x.v || '-'}</span>
      <span class="k">${x.k}</span>
    </div>
  `).join('');

  statsModal.classList.add('show');
  setBodyScrollLocked('hidden');
}

function closeStatsModal(){
  statsModal.classList.remove('show');
  setBodyScrollLocked(mediakitOverlay.classList.contains('show') ? 'hidden' : '');
}

/* ---------------- GALLERY LIGHTBOX (enlarged photo viewer) ---------------- */
const galleryLightbox = document.getElementById('galleryLightbox');
const glMainImage = document.getElementById('glMainImage');
const glThumbs = document.getElementById('glThumbs');
const glCounter = document.getElementById('glCounter');
const glName = document.getElementById('glName');
const glStage = document.querySelector('.gl-stage');
const glPrevBtn = document.getElementById('glPrev');
const glNextBtn = document.getElementById('glNext');
document.getElementById('glBack').addEventListener('click', closeGalleryLightbox);
glPrevBtn.addEventListener('click', () => { if(glIndex > 0) setGalleryIndex(glIndex - 1); });
glNextBtn.addEventListener('click', () => { if(glIndex < glImages.length - 1) setGalleryIndex(glIndex + 1); });

let glImages = [];
let glIndex = 0;

// jsPDF is only ever needed here, so it's loaded on first use instead of
// as a blocking <script> tag on every page load (see brxdge.html — that
// used to sit right before script.js and hold up the entire page, loader
// included, until it finished downloading; slow on a good connection,
// and effectively stalls everything if it's slow or unreachable, which
// is far more likely on mobile). Memoized so a second gallery download
// doesn't re-fetch or re-inject the script.
let jsPdfLoadPromise = null;
function loadJsPdfLib(){
  if(typeof window.jspdf !== 'undefined') return Promise.resolve();
  if(jsPdfLoadPromise) return jsPdfLoadPromise;
  jsPdfLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    script.onload = () => resolve();
    script.onerror = () => { jsPdfLoadPromise = null; reject(new Error('jsPDF failed to load')); };
    document.head.appendChild(script);
  });
  return jsPdfLoadPromise;
}

// Bundles every photo in a talent's gallery into a single .zip and downloads
// it — the "Gallery" link's whole job. Uses jsPDF, loaded on demand above.
async function downloadGalleryAlbum(t){
  const images = (t.gallery || []).filter(g => (g.mediaType || 'image') !== 'video');
  if(!images.length){
    showToast('No gallery photos to download');
    return;
  }
  showToast('Preparing PDF…');
  try {
    await loadJsPdfLib();
  } catch(err){
    showToast('Download tool failed to load. Check your connection');
    return;
  }
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();

    // Cover page — dark, branded, matches the site's own palette.
    doc.setFillColor(12, 12, 12);
    doc.rect(0, 0, pageW, pageH, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(34);
    doc.text(t.name, pageW / 2, pageH / 2 - 16, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(13);
    doc.setTextColor(190, 190, 190);
    doc.text((t.niche || '').toUpperCase(), pageW / 2, pageH / 2 + 16, { align: 'center' });
    doc.setFontSize(10.5);
    doc.setTextColor(140, 140, 140);
    doc.text('Photo Gallery | BRXDGE', pageW / 2, pageH - 44, { align: 'center' });

    // One image per page, fit to the page with a margin, aspect preserved.
    for (const g of images) {
      const img = await loadImageForPdf(g.url);
      doc.addPage();
      const margin = 28;
      const maxW = pageW - margin * 2;
      const maxH = pageH - margin * 2;
      const ratio = Math.min(maxW / img.width, maxH / img.height);
      const w = img.width * ratio;
      const h = img.height * ratio;
      const x = (pageW - w) / 2;
      const y = (pageH - h) / 2;
      doc.addImage(img.dataUrl, img.format, x, y, w, h);
    }

    doc.save(`${slugify(t.name)}-gallery.pdf`);
    showToast('Download started');
  } catch(err) {
    console.error(err);
    showToast('Could not create the PDF. Try again');
  }
}

// Fetches an image URL and resolves the data needed for jsPDF's addImage():
// a base64 data URL, its pixel dimensions, and PNG/JPEG format.
function loadImageForPdf(url){
  return fetch(url)
    .then(res => res.blob())
    .then(blob => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result;
        const img = new Image();
        img.onload = () => {
          const format = blob.type.includes('png') ? 'PNG' : 'JPEG';
          resolve({ dataUrl, width: img.width, height: img.height, format });
        };
        img.onerror = () => reject(new Error('Failed to decode ' + url));
        img.src = dataUrl;
      };
      reader.onerror = () => reject(new Error('Failed to read ' + url));
      reader.readAsDataURL(blob);
    }));
}

// ============================================================================
// MEDIA KIT PDF — "Download Media Kit"
// A full 7-page dossier (hero / about / audience / platforms / content /
// campaigns / booking), separate from the simpler "Download Gallery" photo
// album above. Built with plain jsPDF drawing calls (rects, text, thin
// hairlines) rather than an html2canvas screenshot of the live page — the
// site leans on backdrop-filter/gradients that don't capture reliably, and
// vector-drawn text stays crisp and matches the "premium dossier" brief
// (editorial, black/white, minimal data viz) far better than a rasterized
// snapshot would. Reuses the exact same data + grouping logic as the public
// media kit sections (renderAudienceSection, renderBookingSection, etc.) so
// the PDF never drifts from what's shown on-site.
// ============================================================================

// Parses a "#RRGGBB" string into a jsPDF-ready [r,g,b] triple; anything else
// (CSS var() fallbacks like platformBrandColor's, or missing colors) falls
// back to a neutral gray so a bad/unknown color never throws mid-render.
function pdfHex(hex, fallback){
  if(typeof hex === 'string' && /^#[0-9a-f]{6}$/i.test(hex)){
    return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  }
  return fallback || [140, 140, 140];
}

// Shared chrome for every page after the cover: a thin top rule with the
// BRXDGE wordmark + talent name, a big section title, and a page-number
// footer — so any single page is still identifiable if the set gets
// separated or printed loose. Returns the y-coordinate content should start
// at, right below the title.
function pdfPageChrome(doc, pageW, pageH, talentName, sectionTitle, pageNum, totalPages){
  doc.setFillColor(10, 10, 10);
  doc.rect(0, 0, pageW, pageH, 'F');
  doc.setDrawColor(45, 45, 45);
  doc.setLineWidth(0.6);
  doc.line(40, 44, pageW - 40, 44);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(230, 230, 230);
  doc.text('BRXDGE', 40, 32);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(150, 150, 150);
  doc.text((talentName || '').toUpperCase(), pageW - 40, 32, { align: 'right' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(245, 245, 245);
  doc.text(sectionTitle, 40, 78);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(110, 110, 110);
  doc.text(`${pageNum} / ${totalPages}`, pageW - 40, pageH - 26, { align: 'right' });
  doc.text('BRXDGE Media Kit', 40, pageH - 26);
  return 104;
}

// Wraps a list of strings into pill "chips", flowing to a new row once the
// current one runs out of width. Returns the y just below the last row.
function pdfDrawChipRow(doc, x, y, maxWidth, items){
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  let cx = x, cy = y;
  const rowH = 22, gap = 8, padX = 10;
  (items || []).forEach(item => {
    const label = String(item);
    const w = doc.getTextWidth(label) + padX * 2;
    if(cx !== x && cx + w > x + maxWidth){ cx = x; cy += rowH + gap; }
    doc.setDrawColor(70, 70, 70);
    doc.setFillColor(26, 26, 26);
    doc.roundedRect(cx, cy, w, rowH, 11, 11, 'FD');
    doc.setTextColor(220, 220, 220);
    doc.text(label, cx + padX, cy + 14.5);
    cx += w + gap;
  });
  return cy + rowH;
}

// Minimal, monochrome bar-chart block — mirrors the on-site .mk-bar-row
// treatment (flat label / track / percentage, no color-coding). Caps how
// many rows it draws so a talent with an unusually long list (many
// locations/interests) can't push a page past its bounds; the remainder is
// summarized as "+N more" rather than silently dropped.
function pdfDrawBarBlock(doc, x, y, maxWidth, label, rows, maxRows){
  const capped = rows.slice(0, maxRows || rows.length);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(140, 140, 140);
  doc.text(label, x, y);
  y += 16;
  const labelW = 110, gap = 10;
  const trackX = x + labelW + gap;
  const trackW = maxWidth - labelW - gap - 40;
  capped.forEach(([name, pct]) => {
    const num = Math.max(0, Math.min(100, Number(pct) || 0));
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(215, 215, 215);
    doc.text(String(name), x, y + 7);
    doc.setFillColor(40, 40, 40);
    doc.rect(trackX, y, trackW, 7, 'F');
    doc.setFillColor(215, 215, 215);
    doc.rect(trackX, y, trackW * (num / 100), 7, 'F');
    doc.setFontSize(9.5);
    doc.setTextColor(180, 180, 180);
    doc.text(`${pct}%`, x + maxWidth, y + 7, { align: 'right' });
    y += 22;
  });
  if(rows.length > capped.length){
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8.5);
    doc.setTextColor(120, 120, 120);
    doc.text(`+${rows.length - capped.length} more`, x, y + 2);
    y += 16;
  }
  return y;
}

async function downloadMediaKitPdf(t){
  showToast('Preparing media kit PDF…');
  try {
    await loadJsPdfLib();
  } catch(err){
    showToast('Download tool failed to load. Check your connection');
    return;
  }
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 40;
    const contentW = pageW - margin * 2;
    const totalPages = 7;
    const firstName = (t.name || '').split(' ')[0] || 'This talent';
    const reach = formatFollowers(totalReach(t.socials));

    // ---------------- PAGE 1 — HERO ----------------
    doc.setFillColor(8, 8, 8);
    doc.rect(0, 0, pageW, pageH, 'F');
    let heroImg = null;
    try { heroImg = await loadImageForPdf(talentCoverUrl(t)); } catch(err) { heroImg = null; }
    if(heroImg){
      const ratio = Math.max(pageW / heroImg.width, pageH / heroImg.height);
      const w = heroImg.width * ratio, h = heroImg.height * ratio;
      doc.addImage(heroImg.dataUrl, heroImg.format, (pageW - w) / 2, (pageH - h) / 2, w, h);
      // Dark scrim behind the name/niche so they stay legible over any
      // photo — GState (opacity) is core jsPDF, but fall back to a flat
      // solid band if a given CDN build doesn't expose it.
      try {
        doc.saveGraphicsState();
        doc.setGState(new doc.GState({ opacity: 0.62 }));
        doc.setFillColor(0, 0, 0);
        doc.rect(0, pageH * 0.52, pageW, pageH * 0.48, 'F');
        doc.restoreGraphicsState();
      } catch(err) {
        doc.setFillColor(0, 0, 0);
        doc.rect(0, pageH * 0.58, pageW, pageH * 0.42, 'F');
      }
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(255, 255, 255);
    doc.text('BRXDGE', margin, 50);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(200, 200, 200);
    doc.text('MEDIA KIT', pageW - margin, 50, { align: 'right' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(38);
    doc.setTextColor(255, 255, 255);
    doc.text(t.name || '', margin, pageH - 148);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(13);
    doc.setTextColor(210, 210, 210);
    doc.text((t.niche || '').toUpperCase(), margin, pageH - 122);
    doc.setFontSize(11);
    doc.setTextColor(180, 180, 180);
    doc.text(`${reach} combined reach across ${(t.socials || []).length} platform${(t.socials || []).length === 1 ? '' : 's'}`, margin, pageH - 60);
    if(t.location){
      doc.text(t.location, pageW - margin, pageH - 60, { align: 'right' });
    }

    // ---------------- PAGE 2 — ABOUT ----------------
    doc.addPage();
    let y = pdfPageChrome(doc, pageW, pageH, t.name || '', 'About', 2, totalPages);
    const niches = snapshotNiches(t);
    if(niches.length){
      y = pdfDrawChipRow(doc, margin, y, contentW, niches) + 26;
    }
    if(t.location){
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(140, 140, 140);
      doc.text('LOCATION', margin, y);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(220, 220, 220);
      doc.text(t.location, margin, y + 16);
      y += 40;
    }
    if(t.bio){
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(140, 140, 140);
      doc.text('BIO', margin, y);
      y += 16;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(11.5); doc.setTextColor(225, 225, 225);
      const lines = doc.splitTextToSize(t.bio, contentW);
      doc.text(lines, margin, y);
      y += lines.length * 15 + 26;
    }
    const platforms = [...new Set((t.socials || []).map(s => s.platform).filter(Boolean))];
    if(platforms.length){
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(140, 140, 140);
      doc.text('PLATFORMS', margin, y); y += 16;
      y = pdfDrawChipRow(doc, margin, y, contentW, platforms) + 24;
    }
    if((t.contentFormats || []).length){
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(140, 140, 140);
      doc.text('CONTENT FORMATS', margin, y); y += 16;
      y = pdfDrawChipRow(doc, margin, y, contentW, t.contentFormats) + 24;
    }

    // ---------------- PAGE 3 — AUDIENCE DEMOGRAPHICS ----------------
    doc.addPage();
    y = pdfPageChrome(doc, pageW, pageH, t.name || '', 'Audience Demographics', 3, totalPages);
    const male = Number(t.audienceGenderMale) || 0;
    const female = Number(t.audienceGenderFemale) || 0;
    const ageRows = (t.audienceAgeBreakdown || []).filter(r => r.range && r.pct !== '' && r.pct != null);
    const locRows = (t.audienceTopLocations || []).filter(r => r.location && r.pct !== '' && r.pct != null);
    const interestRows = (t.audienceInterests || []).filter(r => r.interest && r.pct !== '' && r.pct != null);
    if(!male && !female && !ageRows.length && !locRows.length && !interestRows.length){
      doc.setFont('helvetica', 'italic'); doc.setFontSize(12); doc.setTextColor(140, 140, 140);
      doc.text('Audience analytics not yet available for this talent.', margin, y + 20);
    } else {
      if(male || female){
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(140, 140, 140);
        doc.text('GENDER', margin, y); y += 14;
        const total = (male + female) || 1;
        doc.setFillColor(40, 40, 40);
        doc.rect(margin, y, contentW, 10, 'F');
        if(male){ doc.setFillColor(220, 220, 220); doc.rect(margin, y, contentW * (male / total), 10, 'F'); }
        if(female){ doc.setFillColor(90, 90, 90); doc.rect(margin + contentW * (male / total), y, contentW * (female / total), 10, 'F'); }
        y += 24;
        doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(200, 200, 200);
        doc.text(`${male}% Male   /   ${female}% Female`, margin, y);
        y += 34;
      }
      if(ageRows.length){ y = pdfDrawBarBlock(doc, margin, y, contentW, 'AGE', ageRows.map(r => [r.range, r.pct]), 6) + 22; }
      if(locRows.length){ y = pdfDrawBarBlock(doc, margin, y, contentW, 'TOP LOCATIONS', locRows.map(r => [r.location, r.pct]), 6) + 22; }
      if(interestRows.length){ y = pdfDrawBarBlock(doc, margin, y, contentW, 'TOP AUDIENCE INTERESTS', interestRows.map(r => [r.interest, r.pct]), 8) + 22; }
    }

    // ---------------- PAGE 4 — PLATFORM STATISTICS ----------------
    doc.addPage();
    y = pdfPageChrome(doc, pageW, pageH, t.name || '', 'Platform Statistics', 4, totalPages);
    const socials = (t.socials || []);
    if(!socials.length){
      doc.setFont('helvetica', 'italic'); doc.setFontSize(12); doc.setTextColor(140, 140, 140);
      doc.text('No platforms added yet.', margin, y + 20);
    } else {
      const shownSocials = socials.slice(0, 10);
      shownSocials.forEach((s, i) => {
        const rowY = y + i * 50;
        const [r, g, b] = pdfHex(platformBrandColor(s.platform));
        doc.setFillColor(r, g, b);
        doc.circle(margin + 4, rowY + 8, 4, 'F');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(12.5); doc.setTextColor(235, 235, 235);
        doc.text(s.platform || '', margin + 18, rowY + 12);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(255, 255, 255);
        doc.text(s.followers || '-', pageW - margin, rowY + 6, { align: 'right' });
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(140, 140, 140);
        doc.text('FOLLOWERS', pageW - margin, rowY + 18, { align: 'right' });
        doc.setDrawColor(40, 40, 40); doc.setLineWidth(0.6);
        doc.line(margin, rowY + 32, pageW - margin, rowY + 32);
      });
      const afterY = y + shownSocials.length * 50 + 16;
      if(socials.length > shownSocials.length){
        doc.setFont('helvetica', 'italic'); doc.setFontSize(9); doc.setTextColor(120, 120, 120);
        doc.text(`+${socials.length - shownSocials.length} more platforms`, margin, afterY);
      }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(200, 200, 200);
      doc.text(`Combined reach: ${reach}`, margin, pageH - 60);
    }

    // ---------------- PAGE 5 — CONTENT EXAMPLES ----------------
    doc.addPage();
    y = pdfPageChrome(doc, pageW, pageH, t.name || '', 'Content Examples', 5, totalPages);
    const galleryAll = t.gallery || [];
    const galleryItems = galleryAll.slice(0, 6);
    if(!galleryItems.length){
      doc.setFont('helvetica', 'italic'); doc.setFontSize(12); doc.setTextColor(140, 140, 140);
      doc.text('No content examples uploaded yet.', margin, y + 20);
    } else {
      const cols = 3;
      const gap = 14;
      const cellW = (contentW - gap * (cols - 1)) / cols;
      const cellH = cellW * 1.15;
      for (let i = 0; i < galleryItems.length; i++) {
        const g = galleryItems[i];
        const col = i % cols, row = Math.floor(i / cols);
        const cx = margin + col * (cellW + gap);
        const cy = y + row * (cellH + 32);
        doc.setFillColor(24, 24, 24);
        doc.rect(cx, cy, cellW, cellH, 'F');
        if(g.mediaType === 'video'){
          // Video frames can't be rendered into a static PDF — a play glyph
          // marks it as a video example instead of leaving a blank tile.
          doc.setDrawColor(90, 90, 90); doc.setLineWidth(1);
          doc.circle(cx + cellW / 2, cy + cellH / 2, 18, 'S');
          doc.setFillColor(200, 200, 200);
          doc.triangle(cx + cellW / 2 - 5, cy + cellH / 2 - 8, cx + cellW / 2 - 5, cy + cellH / 2 + 8, cx + cellW / 2 + 9, cy + cellH / 2, 'F');
        } else {
          try {
            const img = await loadImageForPdf(g.url);
            const ratio = Math.min(cellW / img.width, cellH / img.height);
            const iw = img.width * ratio, ih = img.height * ratio;
            doc.addImage(img.dataUrl, img.format, cx + (cellW - iw) / 2, cy + (cellH - ih) / 2, iw, ih);
          } catch(err) { /* leave the placeholder panel if the image fails to load */ }
        }
        if(g.category){
          doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(150, 150, 150);
          doc.text(g.category.toUpperCase(), cx, cy + cellH + 16);
        }
      }
      if(galleryAll.length > galleryItems.length){
        const rows = Math.ceil(galleryItems.length / cols);
        doc.setFont('helvetica', 'italic'); doc.setFontSize(9); doc.setTextColor(120, 120, 120);
        doc.text(`+${galleryAll.length - galleryItems.length} more in the full Content Portfolio`, margin, y + rows * (cellH + 32) + 4);
      }
    }

    // ---------------- PAGE 6 — PREVIOUS CAMPAIGNS ----------------
    doc.addPage();
    y = pdfPageChrome(doc, pageW, pageH, t.name || '', 'Previous Campaigns', 6, totalPages);
    const campaignMatches = campaignsData.filter(c => (c.creatorName || '').trim().toLowerCase() === (t.name || '').trim().toLowerCase());
    if(!campaignMatches.length){
      doc.setFont('helvetica', 'italic'); doc.setFontSize(12); doc.setTextColor(140, 140, 140);
      doc.text(`No campaign history yet. ${firstName} is available for your first.`, margin, y + 20);
    } else {
      const shownCampaigns = campaignMatches.slice(0, 4);
      shownCampaigns.forEach((c, i) => {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(235, 235, 235);
        doc.text(c.brandName || 'Campaign', margin, y);
        const statText = [c.reach ? `${c.reach} reach` : '', c.engagement ? `${c.engagement} engagement` : ''].filter(Boolean).join('   ·   ');
        if(statText){
          doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(150, 150, 150);
          doc.text(statText, pageW - margin, y, { align: 'right' });
        }
        y += 18;
        if(c.objective){
          doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.setTextColor(200, 200, 200);
          const lines = doc.splitTextToSize(c.objective, contentW);
          doc.text(lines, margin, y);
          y += lines.length * 13 + 4;
        }
        if((c.deliverables || []).length){
          doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(140, 140, 140);
          doc.text(c.deliverables.join('   •   '), margin, y);
          y += 16;
        }
        if(c.results){
          doc.setFont('helvetica', 'italic'); doc.setFontSize(9.5); doc.setTextColor(170, 170, 170);
          const lines = doc.splitTextToSize(`"${c.results}"`, contentW);
          doc.text(lines, margin, y);
          y += lines.length * 12 + 8;
        }
        y += 10;
        if(i < shownCampaigns.length - 1){
          doc.setDrawColor(40, 40, 40); doc.setLineWidth(0.6);
          doc.line(margin, y, pageW - margin, y);
          y += 22;
        }
      });
      if(campaignMatches.length > shownCampaigns.length){
        doc.setFont('helvetica', 'italic'); doc.setFontSize(9); doc.setTextColor(120, 120, 120);
        doc.text(`+${campaignMatches.length - shownCampaigns.length} more campaigns. Full history available on request.`, margin, y + 6);
      }
    }

    // ---------------- PAGE 7 — BOOKING & CONTACT ----------------
    doc.addPage();
    y = pdfPageChrome(doc, pageW, pageH, t.name || '', 'Booking & Contact', 7, totalPages);
    const availableFor = t.availableFor || [];
    const bookingOptions = t.bookingOptions || [];
    const taxonomy = window.TALENT_TAXONOMY || { AVAILABLE_FOR_GROUPS: [] };
    const definedGroups = taxonomy.AVAILABLE_FOR_GROUPS || [];
    const bookGroups = definedGroups.map(g => ({
      group: g.group,
      items: availableFor.filter(a => g.items.includes(a)),
    })).filter(g => g.items.length);
    const customAvailable = availableFor.filter(a => !definedGroups.some(g => g.items.includes(a)));
    if(customAvailable.length) bookGroups.push({ group: 'Also Available For', items: customAvailable });

    if(bookGroups.length){
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(140, 140, 140);
      doc.text('AVAILABLE FOR', margin, y); y += 16;
      bookGroups.forEach(g => {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(200, 200, 200);
        doc.text(g.group, margin, y); y += 14;
        y = pdfDrawChipRow(doc, margin, y, contentW, g.items) + 18;
      });
    }
    if(bookingOptions.length){
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(140, 140, 140);
      doc.text('BOOKING OPTIONS', margin, y); y += 16;
      y = pdfDrawChipRow(doc, margin, y, contentW, bookingOptions) + 24;
    }
    if(!bookGroups.length && !bookingOptions.length){
      doc.setFont('helvetica', 'italic'); doc.setFontSize(11); doc.setTextColor(140, 140, 140);
      doc.text('Booking details available on request.', margin, y); y += 30;
    }

    // Pricing is intentionally never published — every booking routes
    // through a campaign brief instead of a static rate card, matching the
    // "Request Campaign Pricing" CTA on the live media kit.
    y = Math.max(y + 20, pageH - 190);
    doc.setDrawColor(45, 45, 45); doc.setLineWidth(0.6);
    doc.line(margin, y, pageW - margin, y);
    y += 26;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(240, 240, 240);
    doc.text(`Ready to book ${firstName}?`, margin, y); y += 20;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.setTextColor(190, 190, 190);
    doc.text('Pricing is available on request. Submit a campaign brief and the BRXDGE team will follow up within 1 business day.', margin, y, { maxWidth: contentW });
    y += 34;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(220, 220, 220);
    doc.text(getTalentShareUrl(t), margin, y);

    doc.save(`${slugify(t.name)}-media-kit.pdf`);
    showToast('Download started');
  } catch(err) {
    console.error(err);
    showToast('Could not create the media kit PDF. Try again');
  }
}

function openGalleryLightbox(talent, startIndex){
  // startIndex is expected to already be an index into the image-only
  // subset (callers filter out video items before computing it) — glImages
  // itself has always been a flat array of URL strings, kept that way here
  // so the rest of this lightbox (updateGalleryStage, thumbs, etc.) didn't
  // need to change when gallery items became {url,category,mediaType} objects.
  glImages = (talent.gallery || []).filter(g => (g.mediaType || 'image') !== 'video').map(g => g.url);
  if(!glImages.length) return;
  glIndex = Math.min(Math.max(startIndex || 0, 0), glImages.length - 1);
  glName.textContent = talent.name;

  glThumbs.innerHTML = glImages.map((url, i) =>
    `<img class="gl-thumb${i === glIndex ? ' active' : ''}" src="${url}" alt="" loading="lazy" data-index="${i}">`
  ).join('');
  glThumbs.querySelectorAll('.gl-thumb').forEach(thumb => {
    thumb.addEventListener('click', () => setGalleryIndex(Number(thumb.dataset.index)));
  });

  updateGalleryStage();
  galleryLightbox.classList.add('show');
  setBodyScrollLocked('hidden');
}

function setGalleryIndex(i){
  glIndex = i;
  updateGalleryStage();
}

function updateGalleryStage(){
  glMainImage.src = glImages[glIndex];
  glCounter.textContent = `${glIndex + 1} / ${glImages.length}`;
  glThumbs.querySelectorAll('.gl-thumb').forEach((thumb, i) => {
    thumb.classList.toggle('active', i === glIndex);
    if(i === glIndex) thumb.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
  glPrevBtn.classList.toggle('disabled', glIndex === 0);
  glNextBtn.classList.toggle('disabled', glIndex === glImages.length - 1);
}

function closeGalleryLightbox(){
  galleryLightbox.classList.remove('show');
  // Keep scroll locked if the media kit is still open behind the lightbox
  setBodyScrollLocked(mediakitOverlay.classList.contains('show') ? 'hidden' : '');
}

document.addEventListener('keydown', (e) => {
  if(!galleryLightbox.classList.contains('show')) return;
  if(e.key === 'Escape') closeGalleryLightbox();
  if(e.key === 'ArrowRight' && glIndex < glImages.length - 1) setGalleryIndex(glIndex + 1);
  if(e.key === 'ArrowLeft' && glIndex > 0) setGalleryIndex(glIndex - 1);
});

// Touch swipe support (phones): swipe left for next, swipe right for previous.
let glTouchStartX = 0;
glStage.addEventListener('touchstart', (e) => {
  glTouchStartX = e.changedTouches[0].clientX;
}, { passive: true });
glStage.addEventListener('touchend', (e) => {
  const dx = e.changedTouches[0].clientX - glTouchStartX;
  if(Math.abs(dx) < 40) return; // ignore small/accidental drags
  if(dx < 0 && glIndex < glImages.length - 1) setGalleryIndex(glIndex + 1);
  if(dx > 0 && glIndex > 0) setGalleryIndex(glIndex - 1);
}, { passive: true });

/* ---------------- ADD / EDIT TALENT MODAL ----------------
   This used to be its own full copy of the add/edit form — name, niche,
   gender, photos, gallery, socials, all hand-built right here — completely
   separate from (and missing several fields that existed only in) the
   admin dashboard's copy of the same form. Both are now the shared
   phase-by-phase wizard in talent-wizard.js (loaded by index.html right
   before this file), so a manager adding/editing a talent from the public
   site gets the exact same Creator Snapshot / Audience Analytics / Why /
   Booking / Portfolio / Testimonials steps the admin dashboard has. */
const talentOverlay = document.getElementById('talentOverlay');
const talentModalBody = document.getElementById('talentModalBody');
// "+ Add Talent" lives inside #roster's toolbar, which only exists on
// talent.html now — guard it so index.html doesn't throw and halt every
// top-level script below this point. Editing existing talent still works
// on index.html via the full roster overlay's own [data-edit] buttons.
const addTalentBtn = document.getElementById('addTalentBtn');
if (addTalentBtn) addTalentBtn.addEventListener('click', () => openTalentModal(null));

async function uploadTalentImage(file){
  const formData = new FormData();
  formData.append('talentImage', file);
  const response = await fetch(API + '/upload', { method: 'POST', headers: managerToken ? { Authorization: `Bearer ${managerToken}` } : {}, body: formData });
  if(!response.ok) throw new Error('Upload failed');
  const data = await response.json();
  return data.url;
}

function openTalentModal(id) {
  const existing = id ? rosterData.find(t => t.id === id) : null;
  talentOverlay.classList.add('show');

  function close(){
    talentOverlay.classList.remove('show');
    talentModalBody.innerHTML = '';
  }

  openTalentWizard({
    container: talentModalBody,
    existing,
    uploadImage: uploadTalentImage,
    fetchYouTube: async (channelUrl, count) => {
      const res = await fetch(API + '/api/youtube-latest?channelUrl=' + encodeURIComponent(channelUrl) + '&count=' + count);
      if(!res.ok) throw new Error('Request failed');
      return res.json();
    },
    fetchTikTok: async (videoUrl) => {
      const res = await fetch(API + '/api/tiktok-oembed?url=' + encodeURIComponent(videoUrl));
      if(!res.ok) throw new Error('Request failed');
      return res.json();
    },
    onCancel: close,
    onSave: async (entry, isEditing) => {
      if(isEditing){
        const index = rosterData.findIndex(t => t.id === entry.id);
        if(index !== -1) rosterData[index] = entry; else rosterData.push(entry);
      } else {
        rosterData.push(entry);
      }
      await saveRoster();
      close();
      showToast(isEditing ? 'Talent updated' : 'Talent added');
      renderRoster();
      if (talentRosterOverlay.classList.contains('show')) renderTalentRosterGrid();
    },
  });
}


async function deleteTalent(id){
  if(!confirm('Remove this talent from the public roster?')) return;
  rosterData = rosterData.filter(t => t.id !== id);
  await saveRoster();
  renderRoster();
  if (talentRosterOverlay.classList.contains('show')) renderTalentRosterGrid();
  showToast('Talent removed');
}

/* ---------------- CONTACT FORM (general inquiries, from the Contact Us section) ---------------- */

// Inquiry type used to be a second self-segmentation step inside the form
// itself (Brand/Creator/Other pills) — retired as redundant now that the
// Creator/Management chooser tiles one step back already capture the same
// choice. The hidden field below still carries it through to submission;
// showContactForm() sets it directly instead of simulating a pill click.
const contactInquiryType = document.getElementById('contactInquiryType');
const contactMessageField = document.getElementById('contactMessage');
const DEFAULT_MESSAGE_PLACEHOLDER = 'Tell us about your brand or your content...';
const INQUIRY_MESSAGE_PLACEHOLDERS = {
  Brand: "Tell us about your brand and the kind of creator you're looking for...",
  Creator: "Tell us about your content, your audience, and what you're looking for in representation...",
  Other: "Tell us what's on your mind...",
};

const contactForm = document.getElementById('contactForm');
const contactSuccess = document.getElementById('contactSuccess');
const contactChooser = document.getElementById('contactChooser');
const contactFormBackBtn = document.getElementById('contactFormBack');

// Chooser gate: two photo tiles (Creator / Management) shown first
// instead of the form. Picking one hides the chooser, reveals the form,
// and records the inquiry type (Management maps to the existing "Brand"
// value — there's no separate backend category for it, and "Brand"/
// company-side is what that value already means downstream).
function showContactForm(type){
  // #contact (and its form) lives only on index.html now — talent.html
  // routes its own CTAs there via a cross-page link, so this is guarded
  // rather than assuming the form is on the current page.
  if(contactChooser) contactChooser.style.display = 'none';
  if(contactSuccess) contactSuccess.style.display = 'none';
  if(contactForm) contactForm.style.display = 'flex';
  if(type){
    if(contactInquiryType) contactInquiryType.value = type;
    if(contactMessageField) contactMessageField.placeholder = INQUIRY_MESSAGE_PLACEHOLDERS[type] || DEFAULT_MESSAGE_PLACEHOLDER;
  }
}

function showContactChooser(){
  if(contactForm) contactForm.style.display = 'none';
  if(contactSuccess) contactSuccess.style.display = 'none';
  if(contactChooser) contactChooser.style.display = 'block';
}

if(contactChooser){
  contactChooser.querySelectorAll('.chooser-tile').forEach((tile) => {
    tile.addEventListener('click', () => showContactForm(tile.dataset.choose));
  });
}

if(contactFormBackBtn){
  contactFormBackBtn.addEventListener('click', () => {
    // Clear the pre-selection so re-entering the form via a tile starts
    // clean rather than carrying over the previous pick.
    if(contactInquiryType) contactInquiryType.value = '';
    if(contactMessageField) contactMessageField.placeholder = DEFAULT_MESSAGE_PLACEHOLDER;
    showContactChooser();
  });
}

// #contact only exists on index.html now — guarded so talent.html (which
// no longer has this form) doesn't throw and halt every top-level script
// below this point.
if(contactForm){
  contactForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const label = btn.querySelector('span');
    const originalLabel = label.textContent;
    btn.disabled = true; label.textContent = 'Sending…';
    try {
      const inquiryType = contactInquiryType ? contactInquiryType.value : '';
      const rawMessage = document.getElementById('contactMessage').value.trim();
      const res = await fetch(API + '/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: document.getElementById('contactName').value.trim(),
          email: document.getElementById('contactEmail').value.trim(),
          // Inquiry type is folded into the message text itself, rather than
          // sent as a new field, so this works with the existing /api/contact
          // endpoint as-is — no backend or database change required.
          message: inquiryType ? `[Inquiry type: ${inquiryType}]\n\n${rawMessage}` : rawMessage,
          talent: '',
        }),
      });
      if(!res.ok) throw new Error('Request failed');
      // Swap the whole form for an inline confirmation — more reassuring
      // than a toast alone for something as high-stakes as a lead form.
      contactForm.style.display = 'none';
      if(contactSuccess) contactSuccess.style.display = 'block';
    } catch(err){
      console.error(err);
      showToast("Couldn't send right now. Please try again in a moment");
    } finally {
      btn.disabled = false; label.textContent = originalLabel;
    }
  });
}

const contactSendAnotherBtn = document.getElementById('contactSendAnother');
if(contactSendAnotherBtn){
  contactSendAnotherBtn.addEventListener('click', () => {
    contactForm.reset();
    if(contactInquiryType) contactInquiryType.value = '';
    if(contactMessageField) contactMessageField.placeholder = DEFAULT_MESSAGE_PLACEHOLDER;
    // Back to the chooser rather than straight to the form — the pill
    // selection was just cleared, so re-picking a tile is the natural
    // next step instead of landing on an unselected form.
    showContactChooser();
  });
}

/* ---------------- CONTACT POPUP MODAL (opened from "Get in Touch" on a profile) ---------------- */
const contactOverlay = document.getElementById('contactOverlay');
document.getElementById('contactClose').addEventListener('click', () => contactOverlay.classList.remove('show'));

function openContactModal(talentName){
  document.getElementById('contactModalTitle').textContent = talentName ? `Get In Touch about ${talentName}` : 'Get In Touch';
  document.getElementById('contactModalSub').textContent = talentName
    ? `Interested in booking ${talentName}? Send a message and a real human on the team will get back to you.`
    : "Send us a message and a real human on the team will get back to you.";
  document.getElementById('contactPopupTalent').value = talentName || '';
  contactOverlay.classList.add('show');
}

document.getElementById('contactPopupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  const originalLabel = btn.textContent;
  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    const res = await fetch(API + '/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: document.getElementById('contactPopupName').value.trim(),
        email: document.getElementById('contactPopupEmail').value.trim(),
        message: document.getElementById('contactPopupMessage').value.trim(),
        talent: document.getElementById('contactPopupTalent').value,
      }),
    });
    if(!res.ok) throw new Error('Request failed');
    contactOverlay.classList.remove('show');
    showToast("Message sent. We'll get back to you soon");
    e.target.reset();
  } catch(err){
    console.error(err);
    showToast("Couldn't send right now. Please try again in a moment");
  } finally {
    btn.disabled = false; btn.textContent = originalLabel;
  }
});

/* ---------------- SMOOTH SCROLL TO SECTION (used by inline onclick handlers) ---------------- */
function scrollToSection(id){
  const el = document.getElementById(id);
  if(el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Used by the "Build Your Campaign →" (For Brands) and "Apply for
// Representation →" (For Creators) CTAs — scrolls to the contact section
// AND skips straight past the Creator/Management chooser to the form,
// pre-selecting its Brand/Creator inquiry pill, since the visitor's
// intent was already declared by which CTA they clicked. Reuses
// showContactForm() (see the chooser wiring above) instead of duplicating
// the reveal/pre-select logic here.
function scrollToContactAs(type){
  scrollToSection('contact');
  showContactForm(type);
}

// Used by talent.html's "Apply for Representation" CTA — opens the same
// popup contact modal used for talent-booking inquiries (#contactOverlay,
// part of the shared chrome on every page) instead of navigating away, so
// applying for representation never leaves the Talent page. talentName is
// left blank (this isn't about a specific talent) and the title/subtitle
// are swapped for representation-specific copy instead of openContactModal()'s
// booking-flavored defaults.
function openCreatorApplicationModal(){
  document.getElementById('contactModalTitle').textContent = 'Apply for Representation';
  document.getElementById('contactModalSub').textContent = "Tell us about your content and audience, and a real human on the team will get back to you.";
  document.getElementById('contactPopupTalent').value = '';
  contactOverlay.classList.add('show');
}

// ---------------- FAQ ACCORDION ----------------
// Independent items rather than a strict single-open accordion — opening
// one doesn't close the others, since there's no reason two answers can't
// be read side by side. Static markup, attached once at script load.
(function initFaqAccordion(){
  document.querySelectorAll('.faq-item').forEach((item) => {
    const btn = item.querySelector('.faq-question');
    if(!btn) return;
    btn.addEventListener('click', () => {
      const open = !item.classList.contains('open');
      item.classList.toggle('open', open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  });
})();

// ---------------- FAQ POPUP (opened from the footer "FAQ" link) ----------------
// The FAQ used to be an inline section right before Contact, then a popup
// opened by an always-floating bottom-right button — that floating trigger
// sat on screen over every section and read as distracting, so it's now a
// plain link in the footer nav row (#faqTrigger) instead; nothing floats
// until it's clicked. Closes via its own close button, an outside click,
// or Escape — same as before.
(function initFaqPopup(){
  const trigger = document.getElementById('faqTrigger');
  const panel = document.getElementById('faqPanel');
  const closeBtn = document.getElementById('faqPanelClose');
  if(!trigger || !panel) return;

  function openPanel(){
    panel.classList.add('open');
    trigger.classList.add('open');
    trigger.setAttribute('aria-expanded', 'true');
  }
  function closePanel(){
    panel.classList.remove('open');
    trigger.classList.remove('open');
    trigger.setAttribute('aria-expanded', 'false');
  }

  trigger.addEventListener('click', () => {
    if(panel.classList.contains('open')) closePanel(); else openPanel();
  });
  if(closeBtn) closeBtn.addEventListener('click', closePanel);

  document.addEventListener('click', (e) => {
    if(!panel.classList.contains('open')) return;
    if(panel.contains(e.target) || trigger.contains(e.target)) return;
    closePanel();
  });
  document.addEventListener('keydown', (e) => {
    if(e.key === 'Escape' && panel.classList.contains('open')) closePanel();
  });
})();

/* ---------------- INIT ---------------- */
loadRoster();
loadBlog();
loadCampaigns();

/* ---------------- SECTION SCROLL-TRANSITIONS ---------------- */
// IntersectionObserver plays each .reveal section's transition the moment
// it crosses into view, then stops watching it (animation runs once).
const sectionObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add('active');
      sectionObserver.unobserve(entry.target);
    }
  });
}, {
  root: null,
  rootMargin: '0px 0px -8% 0px', // trigger a little before the section fully enters
  threshold: 0.03
});

document.querySelectorAll('.reveal').forEach((section) => {
  sectionObserver.observe(section);
});

/* ---------------- TYPEWRITER HEADLINE (Services section) ----------------
   "WHAT WE DO?" then "THREE WAYS WE MOVE FORWARD" type themselves out,
   character by character, once the section scrolls into view. The full
   text stays as the element's aria-label the whole time, so screen readers
   announce it immediately rather than waiting on the animation or reading
   partial fragments as it types. */
(function initTypewriterHeadline(){
  const line1 = document.getElementById('servicesEyebrow');
  const line2 = document.getElementById('servicesHeading');
  // "what-we-do" — the actual "THREE WAYS WE MOVE FORWARD" services
  // section — is intentionally a separate id from #home/#bridge-mark
  // (the "BRIDGING CREATORS..." headline and the 3D bridge mark). All
  // three used to collide under id="services" at one point or another;
  // this lookup must stay pinned to "what-we-do" specifically so it
  // never silently grabs the wrong section again. See index.html.
  const section = document.getElementById('what-we-do');
  if(!line1 || !line2 || !section) return;

  function prepareLine(el){
    const fullText = el.textContent.trim();
    el.textContent = '';
    // A real (visually-hidden) text node rather than aria-label — aria-label
    // isn't guaranteed to be exposed on an element with no ARIA role (e.g.
    // this <span>), so screen readers get the full line as actual text
    // instead, while the animated characters stay aria-hidden.
    const srText = document.createElement('span');
    srText.className = 'sr-only';
    srText.textContent = fullText;
    const textSpan = document.createElement('span');
    textSpan.className = 'tw-text';
    textSpan.setAttribute('aria-hidden', 'true');
    const cursor = document.createElement('span');
    cursor.className = 'tw-cursor';
    cursor.setAttribute('aria-hidden', 'true');
    el.appendChild(srText);
    el.appendChild(textSpan);
    el.appendChild(cursor);
    return { fullText, textSpan, cursor };
  }

  const lines = [prepareLine(line1), prepareLine(line2)];

  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(reduceMotion){
    lines.forEach(l => { l.textSpan.textContent = l.fullText; l.cursor.remove(); });
    return;
  }

  function typeLine(line, speed){
    return new Promise((resolve) => {
      let i = 0;
      (function step(){
        if(i <= line.fullText.length){
          line.textSpan.textContent = line.fullText.slice(0, i);
          i++;
          // Slight random jitter per character reads more like typing
          // than a metronome-even reveal would.
          setTimeout(step, speed + Math.random() * 30);
        } else {
          resolve();
        }
      })();
    });
  }

  async function playSequence(){
    await typeLine(lines[0], 55);
    lines[0].cursor.classList.add('tw-cursor-pause');
    await new Promise(r => setTimeout(r, 260));
    lines[0].cursor.remove();
    await typeLine(lines[1], 42);
    lines[1].cursor.classList.add('tw-cursor-blink-end');
  }

  // Only play once the section is in view AND the visitor has actually
  // scrolled there themselves. Without this, clicking the 3D bridge mark
  // above (which smooth-scrolls the page to this section programmatically)
  // would land the section in view immediately and fire the typewriter
  // mid-transition, fighting with the bridge's own falling-apart animation
  // and the section's "reveal" entrance animation for attention. Real
  // wheel/touch/keyboard input from the visitor is the only thing that
  // counts as "scrolled" — a script-driven scrollIntoView() never fires
  // these events, so the auto-scroll from the bridge click can't trigger it.
  let sectionIntersecting = false;
  let userHasScrolled = false;
  let sequenceStarted = false;

  function maybePlaySequence(){
    if(sequenceStarted || !sectionIntersecting || !userHasScrolled) return;
    sequenceStarted = true;
    playSequence();
    twObserver.unobserve(section);
  }

  function onScrollInput(e){
    if(e.type === 'keydown'){
      const scrollKeys = ['ArrowDown','ArrowUp','PageDown','PageUp',' ','Spacebar','Home','End'];
      if(!scrollKeys.includes(e.key)) return;
    }
    userHasScrolled = true;
    window.removeEventListener('wheel', onScrollInput);
    window.removeEventListener('touchmove', onScrollInput);
    window.removeEventListener('keydown', onScrollInput);
    maybePlaySequence();
  }
  window.addEventListener('wheel', onScrollInput, { passive: true });
  window.addEventListener('touchmove', onScrollInput, { passive: true });
  window.addEventListener('keydown', onScrollInput);

  const twObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      sectionIntersecting = entry.isIntersecting;
      if(entry.isIntersecting) maybePlaySequence();
    });
  }, { threshold: 0.35 });
  twObserver.observe(section);
})();

/* ---------------- MANAGERS: fetch from the database, render one card
   per manager (photo inline in the card — see the MANAGERS section in
   style.css for why this dropped the old hover-reactive side photo
   pane) ---------------- */
(async function initManagers(){
  const grid = document.getElementById('managersGrid');
  if (!grid) return;

  let managers = [];
  try {
    const res = await fetch(API + '/api/managers');
    managers = await res.json();
  } catch(err) {
    console.error('Could not load managers:', err);
    return;
  }
  if (!managers.length) return;

  grid.innerHTML = managers.map((m) => `
    <div class="manager-card stagger-item">
      <div class="manager-card-photo"><img src="${escapeHtml(m.photo || '')}" alt="${escapeHtml(m.name || '')}" loading="lazy"></div>
      <div class="manager-card-body">
        <h3>${escapeHtml(m.name || '')}</h3>
        <span class="role">${escapeHtml(m.role || '')}</span>
        <p class="bio">${escapeHtml(m.bio || '')}</p>
      </div>
    </div>
  `).join('');
})();

// Tap-to-color for the "What We Do" tilt-cards. On desktop, hover already
// reveals full color via CSS. On touch devices there's no hover, so tapping
// a card toggles the .card-colored class instead (tapping elsewhere closes it).
(function initTiltCardTapColor(){
  const tiltCards = document.querySelectorAll('.tilt-card');
  if (!tiltCards.length) return;

  tiltCards.forEach(card => {
    card.addEventListener('click', (e) => {
      const alreadyColored = card.classList.contains('card-colored');
      tiltCards.forEach(c => c.classList.remove('card-colored'));
      if (!alreadyColored) card.classList.add('card-colored');
      e.stopPropagation();
    });
  });

  document.addEventListener('click', () => {
    tiltCards.forEach(c => c.classList.remove('card-colored'));
  });
})();
