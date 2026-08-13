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
   50%, i.e. centered) and rely on the tint wash + description reveal
   for the hover/tap feedback instead, since there's no cursor to track.
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
  const loadBar = document.getElementById('loadBar');
  const loaderMark = document.getElementById('loaderMark');
  const loaderWord = document.getElementById('loaderWord');
  const heroAnim = document.querySelector('.hero-anim');
  const heroItems = document.querySelectorAll('.hero-anim-item');

  // Brand mark pops in first, ahead of the counting
  setTimeout(() => { if (loaderMark) loaderMark.classList.add('show'); }, 150);

  let p = 0;
  let wordShown = false;
  // Count up more gradually so the loader has room to breathe
  const interval = setInterval(() => {
    p += Math.random() * 9; 
    if (p > 100) p = 100;
    
    loadPercent.textContent = Math.floor(p) + '%';
    loadBar.style.width = p + '%';

    // Wordmark reveals letter-by-letter once loading is nearly finished,
    // not mid-way through — it should feel like the last flourish before
    // the site is ready, not a halfway checkpoint.
    if (!wordShown && p >= 85) {
      wordShown = true;
      if (loaderWord) loaderWord.classList.add('show');
    }
    
    if (p === 100) {
      clearInterval(interval);
      setTimeout(() => {
        // Everything else steps back so the mark can take over the transition
        loader.querySelector('.loader-content').classList.add('exit');
        if (loaderMark) loaderMark.classList.add('expand');
        setTimeout(() => {
          loader.style.opacity = '0';
          setTimeout(() => loader.style.display = 'none', 500);
          // Straight into the hero content entrance
          if (heroAnim) heroAnim.classList.add('play');
          heroItems.forEach((item) => item.classList.add('play'));
        }, 650);
      }, 400);
    }
  }, 200);
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
      showToast('Signed in — manager tools unlocked');
    } else {
      showToast(data.error || "That didn't match. Try again.");
    }
  } catch (err) {
    showToast('Could not reach the server — is it running?');
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

// "Featured" homepage view shows a capped grid with the BRXDGE brand tile
// dropped into the middle slot. "View All Talent" opens a full-page
// overlay (like the media kit) with the complete, gender-filterable,
// searchable roster — no cap, no brand tile.
const FEATURED_CAP = 8;
const BRAND_TILE_POSITION = 4; // 0-based index -> 5th card, middle of row 2 in a 3-col grid
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

function resetTrFilters(){
  trGenderFilter = 'All';
  trSearchQuery = '';
  trNicheFilter = 'All';
  trLocationFilter = 'All';
  trAudienceSizeFilter = 'All';
  trPlatformFilters.clear();
  trAvailabilityFilters.clear();
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
      showToast('Your session expired — please sign in again');
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
        ${(t.socials||[]).map(s => `<div class="prow"><span>${escapeHtml(s.platform)}</span><span>${escapeHtml(s.followers || '—')}</span></div>`).join('')}
      </div>
    </div>
    <div class="talent-card-foot">
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

// The BRXDGE brand tile that sits in the middle slot of the featured grid
// (row 2, center column in the 3-per-row layout) instead of a 9th talent.
// It's a static visual element, not a link/button.
function buildBrandTile(){
  const tile = document.createElement('div');
  tile.className = 'talent-card brand-tile reveal-card';
  tile.innerHTML = `
    <div class="brand-tile-inner">
      <img class="brand-tile-mark" src="brxdge.png" alt="BRXDGE — Brxdge to Possibilities">
      <div class="brand-tile-glow" aria-hidden="true"></div>
    </div>
  `;
  return tile;
}

function renderRoster() {
  const grid = document.getElementById('rosterGrid');
  grid.innerHTML = '';

  const list = activeFilter === 'All' ? rosterData : rosterData.filter(t => t.niche === activeFilter);

  if (list.length === 0) {
    grid.innerHTML = `<div class="roster-empty">No talent here yet. ${isManager ? 'Add the first one with the button above.' : 'Check back soon.'}</div>`;
    return;
  }

  // Featured homepage view: cap at 8 cards, with the BRXDGE mark dropped
  // into the middle slot.
  const displayList = list.slice(0, FEATURED_CAP);

  displayList.forEach((t, i) => {
    if (i === BRAND_TILE_POSITION) grid.appendChild(buildBrandTile());
    grid.appendChild(buildTalentCard(t, i));
  });
  // If the list is too short to reach the middle slot, still show the mark at the end.
  if (displayList.length <= BRAND_TILE_POSITION) grid.appendChild(buildBrandTile());

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

document.getElementById('viewAllTalentBtn').addEventListener('click', () => {
  talentFilterOverlay.classList.add('show');
});
document.getElementById('talentFilterClose').addEventListener('click', () => talentFilterOverlay.classList.remove('show'));
talentFilterOverlay.querySelectorAll('.gender-option').forEach(btn => {
  btn.addEventListener('click', () => {
    talentFilterOverlay.classList.remove('show');
    openTalentRosterOverlay(btn.dataset.gender);
  });
});

function openTalentRosterOverlay(gender){
  resetTrFilters();
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
}

function closeTalentRosterOverlay(){
  talentRosterOverlay.classList.remove('show');
  setBodyScrollLocked(mediakitOverlay.classList.contains('show') ? 'hidden' : '');
}

document.getElementById('trBack').addEventListener('click', closeTalentRosterOverlay);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && talentRosterOverlay.classList.contains('show')) closeTalentRosterOverlay();
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

// Builds the Niche / Location / Audience Size selects and the Platform /
// Available For chip multi-selects inside the collapsible filters panel,
// every option list generated fresh from whatever's actually on the
// roster right now — same "derive options from live data" approach as
// renderTrGenderFilters() above, so a talent added with a new niche or
// platform shows up as a filterable option without any code changes.
function renderTrExpandedFilters(){
  const nicheSelect = document.getElementById('trNicheSelect');
  if (nicheSelect) {
    const niches = [...new Set(rosterData.map(t => t.niche).filter(Boolean))].sort();
    nicheSelect.innerHTML = `<option value="All">Any niche</option>` +
      niches.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
    nicheSelect.value = trNicheFilter;
  }

  const locationSelect = document.getElementById('trLocationSelect');
  if (locationSelect) {
    const locations = [...new Set(rosterData.map(t => t.location).filter(Boolean))].sort();
    locationSelect.innerHTML = `<option value="All">Any location</option>` +
      locations.map(l => `<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`).join('');
    locationSelect.value = trLocationFilter;
  }

  const audienceSizeSelect = document.getElementById('trAudienceSizeSelect');
  if (audienceSizeSelect) {
    audienceSizeSelect.innerHTML = AUDIENCE_SIZE_BUCKETS
      .map(b => `<option value="${b.key}">${escapeHtml(b.label)}</option>`).join('');
    audienceSizeSelect.value = trAudienceSizeFilter;
  }

  const platformBar = document.getElementById('trPlatformFilters');
  if (platformBar) {
    const platforms = [...new Set(rosterData.flatMap(t => (t.socials || []).map(s => s.platform)).filter(Boolean))].sort();
    platformBar.innerHTML = '';
    platforms.forEach(p => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip' + (trPlatformFilters.has(p) ? ' active' : '');
      chip.textContent = p;
      chip.addEventListener('click', () => {
        if (trPlatformFilters.has(p)) trPlatformFilters.delete(p); else trPlatformFilters.add(p);
        chip.classList.toggle('active');
        renderTalentRosterGrid();
        updateTrFiltersUI();
      });
      platformBar.appendChild(chip);
    });
  }

  const availabilityBar = document.getElementById('trAvailabilityFilters');
  if (availabilityBar) {
    const tags = [...new Set(rosterData.flatMap(t => t.availableFor || []).filter(Boolean))].sort();
    availabilityBar.innerHTML = '';
    tags.forEach(tag => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip' + (trAvailabilityFilters.has(tag) ? ' active' : '');
      chip.textContent = tag;
      chip.addEventListener('click', () => {
        if (trAvailabilityFilters.has(tag)) trAvailabilityFilters.delete(tag); else trAvailabilityFilters.add(tag);
        chip.classList.toggle('active');
        renderTalentRosterGrid();
        updateTrFiltersUI();
      });
      availabilityBar.appendChild(chip);
    });
  }

  updateTrFiltersUI();
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
    renderTalentRosterGrid();
    updateTrFiltersUI();
  });
}
const trLocationSelectEl = document.getElementById('trLocationSelect');
if (trLocationSelectEl) {
  trLocationSelectEl.addEventListener('change', (e) => {
    trLocationFilter = e.target.value;
    renderTalentRosterGrid();
    updateTrFiltersUI();
  });
}
const trAudienceSizeSelectEl = document.getElementById('trAudienceSizeSelect');
if (trAudienceSizeSelectEl) {
  trAudienceSizeSelectEl.addEventListener('change', (e) => {
    trAudienceSizeFilter = e.target.value;
    renderTalentRosterGrid();
    updateTrFiltersUI();
  });
}
const trClearFiltersBtn = document.getElementById('trClearFilters');
if (trClearFiltersBtn) {
  trClearFiltersBtn.addEventListener('click', () => {
    resetTrFilters();
    const searchInput = document.getElementById('talentSearchInput');
    if (searchInput) searchInput.value = '';
    renderTrGenderFilters();
    renderTrExpandedFilters();
    renderTalentRosterGrid();
  });
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

    const clearBtn = document.getElementById('talentSearchClear');
    if (clearBtn) clearBtn.style.display = trSearchQuery ? 'flex' : 'none';

    if (list.length === 0) {
      const safeQuery = trSearchQuery.trim().replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      let emptyMsg = 'No talent here yet.';
      if (safeQuery) emptyMsg = `No talent matching "${safeQuery}".`;
      else if (trHasActiveFilters()) emptyMsg = 'No talent matches these filters.';
      grid.innerHTML = `<div class="roster-empty">${emptyMsg}</div>`;
      return;
    }

    list.forEach((t, i) => grid.appendChild(buildTalentCard(t, i)));

    grid.querySelectorAll('[data-edit]').forEach(btn =>
      btn.addEventListener('click', (e) => { e.stopPropagation(); openTalentModal(btn.dataset.edit); })
    );
    grid.querySelectorAll('[data-delete]').forEach(btn =>
      btn.addEventListener('click', (e) => { e.stopPropagation(); deleteTalent(btn.dataset.delete); })
    );

    revealTalentCards(grid, { immediate: true });
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

/* ---------------- VIEW ALL TALENT: search box (lives inside the overlay) ---------------- */
const talentSearchInput = document.getElementById('talentSearchInput');
const talentSearchClear = document.getElementById('talentSearchClear');
if (talentSearchInput) {
  talentSearchInput.addEventListener('input', (e) => {
    trSearchQuery = e.target.value;
    renderTalentRosterGrid();
    updateTrFiltersUI();
  });
}
if (talentSearchClear) {
  talentSearchClear.addEventListener('click', () => {
    trSearchQuery = '';
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
  if(!opts || opts.updateUrl !== false){
    history.pushState({}, '', location.pathname);
  }
  document.title = 'BRXDGE — Talent Management for Creators';
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

// Small stat chips shown on a case-study card — only the ones that
// actually have a value are shown, so an article (or a partially filled
// case study) never renders empty "→" chips.
function buildBlogCardStats(p){
  const chips = [];
  if(p.statFollowersBefore || p.statFollowersAfter){
    chips.push(`Followers: ${escapeHtml(p.statFollowersBefore || '—')} → ${escapeHtml(p.statFollowersAfter || '—')}`);
  }
  if(p.statEngagementBefore || p.statEngagementAfter){
    chips.push(`Engagement: ${escapeHtml(p.statEngagementBefore || '—')} → ${escapeHtml(p.statEngagementAfter || '—')}`);
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
  document.title = `${postSummary.title} — BRXDGE`;

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
          <span class="blog-stat-panel-value">${escapeHtml(before || '—')} → ${escapeHtml(after || '—')}</span>
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

  container.innerHTML = `
    <article class="blog-post">
      ${cover ? `<img class="blog-post-cover" src="${escapeHtml(cover)}" alt="${escapeHtml(post.title)}">` : ''}
      <span class="blog-post-date">${isCaseStudy ? 'Case Study' : 'Article'}${post.talentName ? ' • ' + escapeHtml(post.talentName) : ''}${blogPostDate(post) ? ' • ' + blogPostDate(post) : ''}</span>
      <h1>${escapeHtml(post.title)}</h1>
      ${post.author ? `<p class="blog-post-meta">By ${escapeHtml(post.author)}</p>` : ''}
      ${statPanel}
      <div class="blog-post-body">${escapeHtml(post.body || post.excerpt || '')}</div>
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
  document.title = 'BRXDGE — Talent Management for Creators';
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
        ${c.brandLogo ? `<img class="campaign-card-logo" src="${escapeHtml(c.brandLogo)}" alt="${escapeHtml(c.brandName)} logo">` : ''}
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
      <img class="cast-row-avatar" src="${escapeHtml(t.photo || '')}" alt="" onerror="this.style.visibility='hidden'">
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
        `Deliverables: ${deliverables.length ? deliverables.join(', ') : '—'}`,
        `Budget: ${budget || 'Not sure yet'}`,
        `Timeline: ${timeline || '—'}`,
        '',
        details ? `Additional Information:\n${details}` : 'Additional Information: —',
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
      showToast("Campaign request sent — we'll be in touch within 1 business day");
      e.target.reset();
      resetBriefPills();
      castIds = [];
      saveCast();
      refreshCastButtons();
      renderAllCastWidgets();
    } catch(err){
      console.error(err);
      showToast("Couldn't send right now — please try again in a moment");
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
    <div class="mk-section-title">Latest Posts — ${platformName}</div>
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

function openMediakit(id, opts){
  const t = rosterData.find(x => x.id === id);
  if(!t) return;

  if(!opts || opts.updateUrl !== false){
    history.pushState({ talentId: id }, '', '?talent=' + slugify(t.name));
  }
  document.title = `${t.name} — BRXDGE`;

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
        ${(t.gallery && t.gallery.length) ? `
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
      <div class="mk-share">
        <button class="mk-share-btn theme-toggle" data-mk-theme-toggle title="Toggle dark mode" aria-label="Toggle dark mode" type="button">
          <svg class="icon-sun" width="17" height="17" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="5" stroke="currentColor" stroke-width="1.8"/><path d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8l1.8-1.8M18 6l1.8-1.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          <svg class="icon-moon" width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
        </button>
        <button class="mk-share-btn" data-copy-link title="Copy link" aria-label="Copy link to this profile">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M10 14a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1.5 1.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M14 10a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1.5-1.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
        <button class="mk-share-btn" data-share-profile title="Share profile" aria-label="Share this profile">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M12 3v12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M7 8l5-5 5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <button class="mk-share-btn" data-show-qr title="Show QR code" aria-label="Show a QR code for this profile">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="7" height="7" rx="1" stroke="currentColor" stroke-width="2"/><rect x="14" y="3" width="7" height="7" rx="1" stroke="currentColor" stroke-width="2"/><rect x="3" y="14" width="7" height="7" rx="1" stroke="currentColor" stroke-width="2"/><path d="M14 14h3v3h-3zM19 14h2v2h-2zM14 19h2v2h-2zM19 19h2v2h-2z" fill="currentColor"/></svg>
        </button>
      </div>
      <div class="mk-cta-row">
        <button class="btn btn-primary mk-cta" data-open-contact>Get in Touch</button>
        <button type="button" class="mk-addcast${castIds.includes(t.id) ? ' added' : ''}" id="mkAddCastBtn" data-cast-toggle="${t.id}" data-cast-label-off="Add to Cast" aria-pressed="${castIds.includes(t.id)}">
          ${castCheckSvg}${castPlusSvg}
          <span>${castIds.includes(t.id) ? 'Added' : 'Add to Cast'}</span>
        </button>
      </div>
    </div>
    <div class="mk-main">
      <p class="reach-line">Combined social reach: <b>${reach}</b> across ${(t.socials||[]).length} platform${(t.socials||[]).length === 1 ? '' : 's'}</p>
      ${t.location ? `<p class="mk-meta-line"><span class="mk-meta-label">Location</span>${escapeHtml(t.location)}</p>` : ''}
      ${(t.audienceAge || t.audienceLocation) ? `<p class="mk-meta-line"><span class="mk-meta-label">Audience</span>${escapeHtml([t.audienceAge, t.audienceLocation].filter(Boolean).join(' • '))}</p>` : ''}
      ${(t.availableFor && t.availableFor.length) ? `<p class="mk-meta-line"><span class="mk-meta-label">Available for</span>${escapeHtml(t.availableFor.join(' • '))}</p>` : ''}
      <p class="mk-bio">${escapeHtml(t.bio)}</p>

      <div class="mk-section-title">Platforms</div>
      <div class="mk-platforms">
        ${(t.socials||[]).map((s, i) => `
          <div class="mk-platform-card" style="--p-accent:${platformBrandColor(s.platform)}">
            <div class="row1">
              <div class="p-icon">${platformIconColor(s.platform)}</div>
              <div class="p-name">${escapeHtml(s.platform)}</div>
            </div>
            <div class="mk-metrics">
              <div class="m"><span class="v">${escapeHtml(s.followers || '—')}</span><span class="k"> Followers</span></div>
            </div>
            <div class="mk-platform-actions">
              ${safeUrl(s.url) ? `<a class="visit" href="${escapeHtml(safeUrl(s.url))}" target="_blank" rel="noopener">Visit profile <span class="arrow">→</span></a>` : ''}
              ${(s.platform === 'YouTube' || s.platform === 'TikTok') ? `<button type="button" class="view-stats" data-social-index="${i}">View statistics</button>` : ''}
            </div>
          </div>
        `).join('') || '<p style="color:var(--muted); font-size:14px;">No platforms added yet.</p>'}
      </div>

      ${(t.gallery && t.gallery.length) ? `
      <div class="mk-section-title">Gallery</div>
      <div class="mk-gallery">
        ${t.gallery.map((url, i) => `<img src="${escapeHtml(url)}" alt="${escapeHtml(t.name)} photo" loading="lazy" data-gallery-index="${i}">`).join('')}
      </div>
      ` : ''}

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

  content.querySelectorAll('.mk-gallery img').forEach(img => {
    img.addEventListener('click', () => {
      openGalleryLightbox(t, Number(img.dataset.galleryIndex));
    });
  });

  const galleryDownloadLink = content.querySelector('#mkHeroGalleryDownload');
  if(galleryDownloadLink){
    galleryDownloadLink.addEventListener('click', (e) => {
      e.preventDefault();
      downloadGalleryAlbum(t);
    });
  }

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

  const contactBtn = content.querySelector('[data-open-contact]');
  if(contactBtn) contactBtn.addEventListener('click', () => openContactModal(t.name));

  const shareUrl = getTalentShareUrl(t);
  const themeBtn = content.querySelector('[data-mk-theme-toggle]');
  if(themeBtn) themeBtn.addEventListener('click', () => window.toggleBrxdgeTheme && window.toggleBrxdgeTheme());
  const copyBtn = content.querySelector('[data-copy-link]');
  if(copyBtn) copyBtn.addEventListener('click', () => copyShareLink(shareUrl));
  const shareBtn = content.querySelector('[data-share-profile]');
  if(shareBtn) shareBtn.addEventListener('click', () => shareProfile(t.name, shareUrl));
  const qrBtn = content.querySelector('[data-show-qr]');
  if(qrBtn) qrBtn.addEventListener('click', () => openQrModal(t.name, shareUrl));

  // "Add to Cast" toggle beside "Get in Touch" — same castIds toggle used
  // by every talent card's "Add to Campaign" button (data-cast-toggle),
  // just re-labeled for this context via data-cast-label-off (see
  // refreshCastButtons()). Initial .added state is set directly in the
  // template above; this only needs to wire the click.
  const mkAddCastBtn = content.querySelector('[data-cast-toggle]');
  if(mkAddCastBtn) mkAddCastBtn.addEventListener('click', () => toggleCast(mkAddCastBtn.dataset.castToggle));
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
      await navigator.share({ title: `${name} — BRXDGE`, text: `Check out ${name}'s media kit`, url });
    } catch(err) {
      // User backed out of the share sheet — nothing to do
    }
  } else {
    copyShareLink(url, 'Link copied — share it anywhere');
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
      <span class="v">${x.v || '—'}</span>
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
  if(!t.gallery || !t.gallery.length){
    showToast('No gallery photos to download');
    return;
  }
  showToast('Preparing PDF…');
  try {
    await loadJsPdfLib();
  } catch(err){
    showToast('Download tool failed to load — check your connection');
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
    doc.text('Photo Gallery — BRXDGE', pageW / 2, pageH - 44, { align: 'center' });

    // One image per page, fit to the page with a margin, aspect preserved.
    for (const url of t.gallery) {
      const img = await loadImageForPdf(url);
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
    showToast('Could not create the PDF — try again');
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

function openGalleryLightbox(talent, startIndex){
  glImages = talent.gallery || [];
  if(!glImages.length) return;
  glIndex = Math.min(Math.max(startIndex || 0, 0), glImages.length - 1);
  glName.textContent = talent.name;

  glThumbs.innerHTML = glImages.map((url, i) =>
    `<img class="gl-thumb${i === glIndex ? ' active' : ''}" src="${url}" alt="" data-index="${i}">`
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

/* ---------------- ADD / EDIT TALENT MODAL ---------------- */
const talentOverlay = document.getElementById('talentOverlay');
const talentForm = document.getElementById('talentForm');
const socialRowsEl = document.getElementById('socialRows');
document.getElementById('addTalentBtn').addEventListener('click', () => openTalentModal(null));
document.getElementById('talentClose').addEventListener('click', () => talentOverlay.classList.remove('show'));
document.getElementById('addSocialRow').addEventListener('click', () => addSocialRow());

/* ---- Gallery (multiple pictures) state for the add/edit talent form ---- */
const galleryUploadEl = document.getElementById('tGalleryUpload');
const galleryPreviewEl = document.getElementById('galleryPreview');
let galleryExistingUrls = [];   // photo URLs already saved on this talent (kept unless removed)
let galleryPendingFiles = [];   // newly chosen File objects, not yet uploaded

function renderGalleryPreview(){
  galleryPreviewEl.innerHTML = '';

  galleryExistingUrls.forEach((url, i) => {
    const thumb = document.createElement('div');
    thumb.className = 'gallery-thumb';
    thumb.innerHTML = `<img src="${url}" alt="Gallery photo"><button type="button" class="remove-thumb" aria-label="Remove">&times;</button>`;
    thumb.querySelector('.remove-thumb').addEventListener('click', () => {
      galleryExistingUrls.splice(i, 1);
      renderGalleryPreview();
    });
    galleryPreviewEl.appendChild(thumb);
  });

  galleryPendingFiles.forEach((file, i) => {
    const thumb = document.createElement('div');
    thumb.className = 'gallery-thumb';
    const objectUrl = URL.createObjectURL(file);
    thumb.innerHTML = `<img src="${objectUrl}" alt="New photo"><button type="button" class="remove-thumb" aria-label="Remove">&times;</button>`;
    thumb.querySelector('.remove-thumb').addEventListener('click', () => {
      galleryPendingFiles.splice(i, 1);
      renderGalleryPreview();
    });
    galleryPreviewEl.appendChild(thumb);
  });
}

galleryUploadEl.addEventListener('change', () => {
  galleryPendingFiles = galleryPendingFiles.concat(Array.from(galleryUploadEl.files || []));
  galleryUploadEl.value = ''; // allow re-selecting the same file / picking more later
  renderGalleryPreview();
});

function addSocialRow(data){
  const wrap = document.createElement('div');
  wrap.className = 'social-entry';
  wrap.dataset.posts = JSON.stringify(data && data.posts ? data.posts : []);

  const row = document.createElement('div');
  row.className = 'social-row';
  row.innerHTML = `
    <select class="s-platform">${PLATFORMS.map(p => `<option ${data && data.platform===p ? 'selected':''}>${p}</option>`).join('')}</select>
    <input class="s-url" type="url" placeholder="Profile URL" value="${data ? data.url || '' : ''}">
    <button type="button" class="remove-row" aria-label="Remove">&times;</button>
  `;
  const followersInput = document.createElement('input');
  followersInput.className = 's-followers';
  followersInput.type = 'text';
  followersInput.placeholder = 'Followers e.g. 1.2M';
  followersInput.value = data ? data.followers || '' : '';
  followersInput.style.gridColumn = '1 / span 2';
  row.insertBefore(followersInput, row.querySelector('.remove-row'));
  row.querySelector('.remove-row').addEventListener('click', () => wrap.remove());
  wrap.appendChild(row);

  const extra = document.createElement('div');
  extra.className = 'social-extra';
  wrap.appendChild(extra);

  const existingStats = (data && data.stats) || {};
  function statsFieldsHTML(){
    return `
      <p class="extra-hint" style="margin-top:14px;">Stats shown on the "View statistics" button (optional):</p>
      <div class="stats-fields">
        <input type="text" class="stat-avgviews" placeholder="Avg. views per video e.g. 850K" value="${escapeHtml(existingStats.avgViews || '')}">
        <input type="text" class="stat-avglikes" placeholder="Avg. likes per video e.g. 62K" value="${escapeHtml(existingStats.avgLikes || '')}">
        <input type="text" class="stat-engagement" placeholder="Engagement rate e.g. 7.2%" value="${escapeHtml(existingStats.engagementRate || '')}">
        <input type="text" class="stat-growth" placeholder="Growth, last 30 days e.g. +4.1%" value="${escapeHtml(existingStats.growth || '')}">
      </div>
    `;
  }

  function renderPostThumbs(){
    const thumbsEl = extra.querySelector('.post-thumbs');
    if(!thumbsEl) return;
    const posts = JSON.parse(wrap.dataset.posts || '[]');
    thumbsEl.innerHTML = posts.map(p =>
      `<a class="post-thumb" href="${escapeHtml(safeUrl(p.link) || '#')}" target="_blank" rel="noopener" title="${escapeHtml(p.title || '')}"><img src="${escapeHtml(p.thumbnail)}" alt=""></a>`
    ).join('');
  }

  function renderExtra(){
    const platform = row.querySelector('.s-platform').value;
    extra.innerHTML = '';

    if(platform === 'YouTube'){
      extra.innerHTML = `
        <button type="button" class="fetch-btn" data-action="fetch-yt">↻ Fetch latest 4 videos</button>
        <div class="post-thumbs"></div>
        ${statsFieldsHTML()}
      `;
      extra.querySelector('[data-action="fetch-yt"]').addEventListener('click', async (e) => {
        const channelUrl = row.querySelector('.s-url').value.trim();
        if(!channelUrl){ showToast('Enter the YouTube channel URL first'); return; }
        const btn = e.currentTarget;
        const originalLabel = btn.textContent;
        btn.disabled = true; btn.textContent = 'Fetching…';
        try {
          const res = await fetch(API + '/api/youtube-latest?channelUrl=' + encodeURIComponent(channelUrl) + '&count=4');
          if(!res.ok) throw new Error('Request failed');
          const data = await res.json();
          wrap.dataset.posts = JSON.stringify(data.posts || []);
          if(data.stats) wrap.dataset.stats = JSON.stringify(data.stats);
          renderPostThumbs();
          showToast('Latest videos + stats fetched');
        } catch(err){
          console.error(err);
          showToast('Could not fetch latest videos — check the channel URL');
        } finally {
          btn.disabled = false; btn.textContent = originalLabel;
        }
      });
      renderPostThumbs();

    } else if(platform === 'TikTok'){
      const existingPosts = JSON.parse(wrap.dataset.posts || '[]');
      extra.innerHTML = `
        <p class="extra-hint">TikTok doesn't allow auto-fetching a profile's latest posts — paste up to 4 specific video links to preview instead:</p>
        <input type="url" class="tt-video-input" placeholder="TikTok video URL 1" value="${existingPosts[0] ? existingPosts[0].sourceUrl || '' : ''}">
        <input type="url" class="tt-video-input" placeholder="TikTok video URL 2" value="${existingPosts[1] ? existingPosts[1].sourceUrl || '' : ''}">
        <input type="url" class="tt-video-input" placeholder="TikTok video URL 3" value="${existingPosts[2] ? existingPosts[2].sourceUrl || '' : ''}">
        <input type="url" class="tt-video-input" placeholder="TikTok video URL 4" value="${existingPosts[3] ? existingPosts[3].sourceUrl || '' : ''}">
        <button type="button" class="fetch-btn" data-action="fetch-tt">↻ Preview these videos</button>
        <div class="post-thumbs"></div>
        ${statsFieldsHTML()}
      `;
      extra.querySelector('[data-action="fetch-tt"]').addEventListener('click', async (e) => {
        const urls = Array.from(extra.querySelectorAll('.tt-video-input')).map(i => i.value.trim()).filter(Boolean);
        if(!urls.length){ showToast('Paste at least one TikTok video URL'); return; }
        const btn = e.currentTarget;
        const originalLabel = btn.textContent;
        btn.disabled = true; btn.textContent = 'Fetching…';
        try {
          const posts = [];
          for(const url of urls){
            const res = await fetch(API + '/api/tiktok-oembed?url=' + encodeURIComponent(url));
            if(!res.ok) throw new Error('Request failed');
            const info = await res.json();
            posts.push({ thumbnail: info.thumbnail_url, title: info.title || '', link: url, sourceUrl: url });
          }
          wrap.dataset.posts = JSON.stringify(posts);
          renderPostThumbs();
          showToast('Video previews fetched');
        } catch(err){
          console.error(err);
          showToast('Could not preview one or more videos — check the links');
        } finally {
          btn.disabled = false; btn.textContent = originalLabel;
        }
      });
      renderPostThumbs();

    } else {
      wrap.dataset.posts = '[]';
    }
  }

  row.querySelector('.s-platform').addEventListener('change', renderExtra);
  renderExtra();

  socialRowsEl.appendChild(wrap);
}
function openTalentModal(id) {
  const existing = id ? rosterData.find(t => t.id === id) : null;
  
  // Set the title
  document.getElementById('talentModalTitle').textContent = existing ? 'Edit Talent' : 'Add Talent';
  
  // CRITICAL: Set the hidden ID field so the submit function knows it's an update
  document.getElementById('talentId').value = existing ? existing.id : '';
  
  document.getElementById('tName').value = existing ? existing.name : '';
  document.getElementById('tNiche').value = existing ? existing.niche : 'Lifestyle';
  document.getElementById('tGender').value = existing ? (existing.gender || '') : '';
  document.getElementById('tPhoto').value = existing ? (existing.photo || '') : '';
  document.getElementById('tCoverPhoto').value = existing ? (existing.coverPhoto || '') : '';
  document.getElementById('tBio').value = existing ? existing.bio : '';

  // Handle gallery (multiple pictures)
  galleryExistingUrls = existing && existing.gallery ? existing.gallery.slice() : [];
  galleryPendingFiles = [];
  galleryUploadEl.value = '';
  renderGalleryPreview();

  // Handle social rows
  socialRowsEl.innerHTML = '';
  if(existing && existing.socials && existing.socials.length){
    existing.socials.forEach(s => addSocialRow(s));
  } else {
    addSocialRow();
  }
  
  talentOverlay.classList.add('show');
}
talentForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const fileInput = document.getElementById('tImageUpload');
  let photoUrl = document.getElementById('tPhoto').value.trim();

  const coverFileInput = document.getElementById('tCoverImageUpload');
  let coverPhotoUrl = document.getElementById('tCoverPhoto').value.trim();

  // 1. Handle Upload
  if (fileInput.files && fileInput.files.length > 0) {
    try {
      const formData = new FormData();
      formData.append('talentImage', fileInput.files[0]);
      const response = await fetch(API + '/upload', { method: 'POST', headers: managerToken ? { Authorization: `Bearer ${managerToken}` } : {}, body: formData });
      const data = await response.json();
      photoUrl = data.url;
    } catch (err) {
      console.error(err);
      showToast('Image upload failed, using existing/placeholder.');
    }
  }

  // 1a. Handle the optional separate cover-photo upload
  if (coverFileInput.files && coverFileInput.files.length > 0) {
    try {
      const formData = new FormData();
      formData.append('talentImage', coverFileInput.files[0]);
      const response = await fetch(API + '/upload', { method: 'POST', headers: managerToken ? { Authorization: `Bearer ${managerToken}` } : {}, body: formData });
      const data = await response.json();
      coverPhotoUrl = data.url;
    } catch (err) {
      console.error(err);
      showToast('Cover photo upload failed, using existing/profile photo.');
    }
  }

  // 1b. Upload any new gallery pictures, then merge with kept existing ones
  let galleryUrls = galleryExistingUrls.slice();
  if (galleryPendingFiles.length > 0) {
    for (const file of galleryPendingFiles) {
      try {
        const formData = new FormData();
        formData.append('talentImage', file);
        const response = await fetch(API + '/upload', { method: 'POST', headers: managerToken ? { Authorization: `Bearer ${managerToken}` } : {}, body: formData });
        const data = await response.json();
        if (data && data.url) galleryUrls.push(data.url);
      } catch (err) {
        console.error(err);
        showToast('One or more gallery photos failed to upload.');
      }
    }
  }

  // 2. Identify if we are updating or adding
  const id = document.getElementById('talentId').value;
  
  // Spread the existing record first — this modal doesn't have fields for
  // everything a talent can carry (e.g. the media-kit categories/audience/
  // availability set from the admin dashboard), so without this, saving a
  // talent from here would silently wipe any of those fields back to blank.
  const existingForSave = id ? rosterData.find(t => t.id === id) : null;
  const entry = {
    ...(existingForSave || {}),
    id: id || ('t' + Date.now()),
    name: document.getElementById('tName').value.trim(),
    niche: document.getElementById('tNiche').value,
    gender: document.getElementById('tGender').value,
    photo: photoUrl,
    coverPhoto: coverPhotoUrl,
    gallery: galleryUrls,
    bio: document.getElementById('tBio').value.trim(),
    socials: Array.from(socialRowsEl.querySelectorAll('.social-entry')).map(wrap => {
      const row = wrap.querySelector('.social-row');
      const extra = wrap.querySelector('.social-extra');
      const avgViewsEl = extra.querySelector('.stat-avgviews');
      const stats = avgViewsEl ? {
        avgViews: avgViewsEl.value.trim(),
        avgLikes: extra.querySelector('.stat-avglikes').value.trim(),
        engagementRate: extra.querySelector('.stat-engagement').value.trim(),
        growth: extra.querySelector('.stat-growth').value.trim(),
      } : null;
      return {
        platform: row.querySelector('.s-platform').value,
        url: row.querySelector('.s-url').value.trim(),
        followers: row.querySelector('.s-followers').value.trim(),
        posts: JSON.parse(wrap.dataset.posts || '[]'),
        ...(stats ? { stats } : {}),
      };
    }).filter(s => s.url || s.followers)
  };

  // 3. Update or Add correctly
  if (id) {
    const index = rosterData.findIndex(t => t.id === id);
    if (index !== -1) {
      rosterData[index] = entry; 
      showToast('Talent updated');
    }
  } else {
    rosterData.push(entry);
    showToast('Talent added');
  }

  // 4. Save to server
  await saveRoster();
  
  // 5. Cleanup Form
  talentForm.reset();
  document.getElementById('talentId').value = ''; // Important: Clears the ID for next time
  socialRowsEl.innerHTML = ''; // Important: Clears the social rows so they don't duplicate
  galleryExistingUrls = [];
  galleryPendingFiles = [];
  galleryPreviewEl.innerHTML = '';
  talentOverlay.classList.remove('show');
  
  // 6. Refresh UI
  renderRoster();
  if (talentRosterOverlay.classList.contains('show')) renderTalentRosterGrid();
});


async function deleteTalent(id){
  if(!confirm('Remove this talent from the public roster?')) return;
  rosterData = rosterData.filter(t => t.id !== id);
  await saveRoster();
  renderRoster();
  if (talentRosterOverlay.classList.contains('show')) renderTalentRosterGrid();
  showToast('Talent removed');
}

/* ---------------- CONTACT FORM (general inquiries, from the Contact Us section) ---------------- */

// Inquiry-type pills: one click of self-segmentation (Brand / Creator /
// Other) instead of an extra typed field. Tapping the active pill again
// deselects it — it's a helpful default, not a required gate on submitting.
const inquiryToggle = document.getElementById('inquiryToggle');
const contactInquiryType = document.getElementById('contactInquiryType');
const contactMessageField = document.getElementById('contactMessage');
const DEFAULT_MESSAGE_PLACEHOLDER = 'Tell us about your brand or your content...';
const INQUIRY_MESSAGE_PLACEHOLDERS = {
  Brand: "Tell us about your brand and the kind of creator you're looking for...",
  Creator: "Tell us about your content, your audience, and what you're looking for in representation...",
  Other: "Tell us what's on your mind...",
};

if(inquiryToggle){
  inquiryToggle.querySelectorAll('.inquiry-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      const wasActive = pill.classList.contains('active');
      inquiryToggle.querySelectorAll('.inquiry-pill').forEach(p => p.classList.remove('active'));
      if(wasActive){
        contactInquiryType.value = '';
        if(contactMessageField) contactMessageField.placeholder = DEFAULT_MESSAGE_PLACEHOLDER;
        return;
      }
      pill.classList.add('active');
      contactInquiryType.value = pill.dataset.type;
      if(contactMessageField){
        contactMessageField.placeholder = INQUIRY_MESSAGE_PLACEHOLDERS[pill.dataset.type] || DEFAULT_MESSAGE_PLACEHOLDER;
      }
    });
  });
}

const contactForm = document.getElementById('contactForm');
const contactSuccess = document.getElementById('contactSuccess');

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
    showToast("Couldn't send right now — please try again in a moment");
  } finally {
    btn.disabled = false; label.textContent = originalLabel;
  }
});

const contactSendAnotherBtn = document.getElementById('contactSendAnother');
if(contactSendAnotherBtn){
  contactSendAnotherBtn.addEventListener('click', () => {
    contactForm.reset();
    if(inquiryToggle) inquiryToggle.querySelectorAll('.inquiry-pill').forEach(p => p.classList.remove('active'));
    if(contactInquiryType) contactInquiryType.value = '';
    if(contactMessageField) contactMessageField.placeholder = DEFAULT_MESSAGE_PLACEHOLDER;
    if(contactSuccess) contactSuccess.style.display = 'none';
    contactForm.style.display = 'flex';
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
    showToast("Message sent — we'll get back to you soon");
    e.target.reset();
  } catch(err){
    console.error(err);
    showToast("Couldn't send right now — please try again in a moment");
  } finally {
    btn.disabled = false; btn.textContent = originalLabel;
  }
});

/* ---------------- SMOOTH SCROLL TO SECTION (used by inline onclick handlers) ---------------- */
function scrollToSection(id){
  const el = document.getElementById(id);
  if(el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

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
  // "what-we-do", not "services" — the id="services" section is a
  // *different* section (the relocated "BRXDGE TO POSSIBILITIES" headline
  // + CTAs, which is the bridge's click-to-cross landing target). The two
  // used to share id="services", which meant this lookup silently grabbed
  // the wrong section and could fire the typewriter while that first
  // section was on screen instead of this one. See index.html for the
  // full explanation.
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

/* ---------------- MANAGERS: fetch from the database, then wire up
   the hover-reactive background ---------------- */
(async function initManagers(){
  const grid = document.getElementById('managersGrid');
  const bg = document.getElementById('managersBg');
  if (!grid || !bg) return;

  let managers = [];
  try {
    const res = await fetch(API + '/api/managers');
    managers = await res.json();
  } catch(err) {
    console.error('Could not load managers:', err);
    return;
  }
  if (!managers.length) return;

  grid.innerHTML = managers.map((m, i) => `
    <div class="manager-card stagger-item" data-bg-index="${i}">
      <img src="${escapeHtml(m.photo || '')}" alt="${escapeHtml(m.name || '')}">
      <h3>${escapeHtml(m.name || '')}</h3>
      <span class="role">${escapeHtml(m.role || '')}</span>
      <p class="bio">${escapeHtml(m.bio || '')}</p>
    </div>
  `).join('');

  bg.innerHTML = managers.map((m, i) =>
    `<div class="bg-layer${i === 0 ? ' active' : ''}" style="--bg: url('${escapeHtml(m.photo || '')}')"></div>`
  ).join('');

  const layers = Array.from(bg.querySelectorAll('.bg-layer'));
  function showLayer(index){
    layers.forEach((layer, i) => layer.classList.toggle('active', i === index));
  }
  grid.querySelectorAll('.manager-card').forEach(card => {
    const index = parseInt(card.dataset.bgIndex, 10);
    if (isNaN(index)) return;
    card.addEventListener('mouseenter', () => showLayer(index));
  });
  grid.addEventListener('mouseleave', () => showLayer(0));
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
