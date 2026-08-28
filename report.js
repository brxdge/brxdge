/* ============================================================
   report.js — powers report.html, the private brand-facing
   campaign PORTAL. Reads ?t=<shareToken> from the URL, fetches
   GET /api/campaign-reports/by-token/:token (the one unauthenticated
   read the backend exposes for this feature — see talent-backend/
   index.js), and renders the creators + their profile/post links.
   No admin auth, no login — the token in the URL IS the access
   control, so treat this file as public-readable (it is).
   ============================================================ */

/* ---------------- THEME TOGGLE ----------------
   Same localStorage key + class as script.js's toggleTheme(), applied
   before first paint by the inline <script> in report.html's <head>. */
(function initThemeToggle(){
  const STORAGE_KEY = 'brxdge-theme';
  const btn = document.getElementById('themeToggle');
  if(!btn) return;
  btn.addEventListener('click', () => {
    const isDark = document.documentElement.classList.toggle('dark-mode');
    try { localStorage.setItem(STORAGE_KEY, isDark ? 'dark' : 'light'); } catch(e) {}
  });
})();

/* ---------------- COLORED PLATFORM ICONS ----------------
   Same icon paths as platformIconColor() in script.js/admin.js —
   copied rather than shared via a <script> include, since this page
   intentionally has no dependency on the rest of the site's (much
   heavier) script.js. Full-color reads more like a real product
   surface than the flat monochrome set, which is why the portal uses
   this version everywhere instead. */
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
function platformBadge(p, size){
  return `<span class="platform-badge" style="width:${size}px; height:${size}px;">${platformIconColor(p)}</span>`;
}

function escapeHtml(str){
  return (str || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// Same slug rule as script.js's slugify()/shareUrlFor() — copied rather
// than shared, same reasoning as the icon set above. talent.html reads a
// ?talent=<slug> URL param and auto-opens the matching roster entry's
// media kit on load (matched by slugify(name), not by id — see the
// "Deep link" block in script.js's init()), which is exactly what lets
// this page link out to "the real media kit" without needing a talent id
// of its own (a campaign report only ever stores name/photo/profiles).
function slugify(str){
  return (str || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function mediaKitUrlFor(name){
  return `talent.html?talent=${encodeURIComponent(slugify(name))}`;
}

// Same fallback avatar generator used across the rest of the site
// (admin.js's photoOrFallback / script.js's talent placeholder) — kept
// visually consistent even though this file doesn't share code with them.
function creatorPhotoOrFallback(c){
  const p = c && c.photo ? String(c.photo).trim() : '';
  if(p) return p;
  const seed = (c && c.name) || 'C';
  return `https://api.dicebear.com/9.x/notionists/svg?seed=${encodeURIComponent(seed)}&backgroundColor=c8302c,f0c239,fff8e9`;
}

function formatUpdatedDate(iso){
  if(!iso) return '—';
  const d = new Date(iso);
  if(isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/* ---------------- PUBLIC ROSTER LOOKUP (for the overview popup) ----------------
   GET /api/roster is the same public, unauthenticated endpoint talent.html
   itself uses to render every media kit — it already returns cover photo,
   niche, socials, and audience stats for every non-hidden talent, no
   token required (see the isSignedIn() branch in talent-backend/index.js).
   A campaign report's own creator objects never store that data, so the
   overview popup fetches this once, matches by the same slugify(name)
   rule the ?talent= deep link uses, and treats it as a purely optional
   enhancement — no match just means the popup stays lightweight. */
let publicRosterPromise = null;
function loadPublicRosterOnce(){
  if(!publicRosterPromise){
    publicRosterPromise = fetch(`${API}/api/roster`).then(r => r.ok ? r.json() : []).catch(() => []);
  }
  return publicRosterPromise;
}
function findRosterMatch(roster, name){
  const slug = slugify(name);
  if(!slug) return null;
  return (Array.isArray(roster) ? roster : []).find(t => slugify(t.name) === slug) || null;
}
function rosterCoverUrl(t){
  if(t.coverPhoto && String(t.coverPhoto).trim()) return String(t.coverPhoto).trim();
  return creatorPhotoOrFallback(t);
}

// Compact version of script.js's Creator Snapshot ("at a glance") card —
// same fields, same grouping, just re-authored small enough for a popup.
const SNAPSHOT_ICONS = {
  niche: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12.59 2.59a2 2 0 0 0-1.42-.59H4a2 2 0 0 0-2 2v7.17a2 2 0 0 0 .59 1.42l9 9a2 2 0 0 0 2.82 0l7.17-7.17a2 2 0 0 0 0-2.82l-9-9Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="7.5" cy="7.5" r="1.3" fill="currentColor"/></svg>',
  platforms: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.8"/><rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.8"/><rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.8"/><rect x="14" y="14" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.8"/></svg>',
  audience: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="9" cy="8" r="3.2" stroke="currentColor" stroke-width="1.8"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M16 8.5a3 3 0 1 1 0-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M15 14c2.8.3 5 2.8 5 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  content: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M8 5v14M16 5v14" stroke="currentColor" stroke-width="1.8"/><path d="M2.5 9.5h5M2.5 14.5h5M16 9.5h5M16 14.5h5" stroke="currentColor" stroke-width="1.8"/></svg>',
};
function snapshotNiches(t){
  return (t.niche || '').split(/[/,&]/).map(s => s.trim()).filter(Boolean);
}
function renderModalSnapshot(t){
  const niches = snapshotNiches(t);
  const platforms = [...new Set((t.socials || []).map(s => s.platform).filter(Boolean))];
  const audienceChips = [t.audienceAgeRange, t.location, t.gender].filter(Boolean);
  const contentChips = Array.isArray(t.contentFormats) ? t.contentFormats.filter(Boolean) : [];
  const rows = [
    { label: 'Niche', icon: SNAPSHOT_ICONS.niche, items: niches },
    { label: 'Platforms', icon: SNAPSHOT_ICONS.platforms, items: platforms },
    { label: 'Audience', icon: SNAPSHOT_ICONS.audience, items: audienceChips },
    { label: 'Content', icon: SNAPSHOT_ICONS.content, items: contentChips },
  ].filter(r => r.items.length);
  if(!rows.length) return '';
  return rows.map(r => `
    <div class="creator-modal-snap-row">
      <span class="creator-modal-snap-label">${r.icon}${escapeHtml(r.label)}</span>
      <div class="creator-modal-snap-chips">${r.items.map(i => `<span class="creator-modal-snap-chip">${escapeHtml(i)}</span>`).join('')}</div>
    </div>
  `).join('');
}
function buildMarqueeGroup(name){
  const upper = escapeHtml((name || '').toUpperCase());
  const sep = `<span class="creator-modal-marquee-sep">•</span>`;
  return `<span>${upper}</span>${sep}<span>${upper}</span>${sep}<span>${upper}</span>${sep}`;
}

function showState(which){
  document.getElementById('loadingState').style.display = which === 'loading' ? 'flex' : 'none';
  document.getElementById('errorState').style.display = which === 'error' ? 'flex' : 'none';
  document.getElementById('reportRoot').style.display = which === 'report' ? 'block' : 'none';
}

let currentCreators = []; // full list, so search can filter without re-fetching
let currentReport = null; // the loaded report — the Message Us form tags its submission with this

function renderStats(report, creators){
  const postsCount = creators.reduce((sum, c) => sum + (Array.isArray(c.posts) ? c.posts.filter(p => p.url).length : 0), 0);
  const platforms = new Set();
  creators.forEach(c => {
    (c.profiles || []).forEach(p => { if(p.url) platforms.add(p.platform || 'Other'); });
    (c.posts || []).forEach(p => { if(p.url) platforms.add(p.platform || 'Other'); });
  });

  const stats = [
    { val: creators.length, lbl: creators.length === 1 ? 'Creator' : 'Creators' },
    { val: postsCount, lbl: postsCount === 1 ? 'Post' : 'Posts' },
    { val: platforms.size, lbl: platforms.size === 1 ? 'Platform' : 'Platforms' },
    { val: formatUpdatedDate(report.updatedAt), lbl: 'Last Updated' },
  ];

  document.getElementById('reportStats').innerHTML = stats.map(s => `
    <div class="report-stat">
      <div class="rs-val">${s.val}</div>
      <div class="rs-lbl">${s.lbl}</div>
    </div>
  `).join('');
}

function renderCreatorCards(creators){
  const grid = document.getElementById('creatorsGrid');
  grid.innerHTML = creators.map((c, idx) => {
    const profiles = Array.isArray(c.profiles) ? c.profiles.filter(p => p.url) : [];
    const posts = Array.isArray(c.posts) ? c.posts.filter(p => p.url) : [];
    return `
      <div class="creator-card" data-name="${escapeHtml((c.name || '').toLowerCase())}">
        <div class="creator-card-head">
          <img class="creator-photo" src="${creatorPhotoOrFallback(c)}" alt="" onerror="this.style.visibility='hidden'">
          <button type="button" class="creator-name creator-name-link" data-creator-idx="${idx}">${escapeHtml(c.name)}</button>
        </div>
        ${profiles.length ? `
          <div class="creator-profiles">
            ${profiles.map(p => `
              <a class="creator-profile-link" href="${escapeHtml(p.url)}" target="_blank" rel="noopener noreferrer">
                ${platformBadge(p.platform, 16)}<span>${escapeHtml(p.platform || 'Profile')}</span>
              </a>
            `).join('')}
          </div>
        ` : ''}
        ${posts.length ? `
          <div class="creator-posts">
            <div class="creator-posts-label">Posts (${posts.length})</div>
            <div class="creator-posts-grid">
              ${posts.map(p => `
                <a class="post-thumb" href="${escapeHtml(p.url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(p.label) || escapeHtml(p.platform) || 'View post'}">
                  <div class="post-thumb-fallback">${platformBadge(p.platform, 30)}</div>
                  ${p.thumbnail ? `<img src="${escapeHtml(p.thumbnail)}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}
                  <span class="post-thumb-platform">${platformBadge(p.platform, 22)}</span>
                  ${p.label ? `<span class="post-thumb-label">${escapeHtml(p.label)}</span>` : ''}
                </a>
              `).join('')}
            </div>
          </div>
        ` : `<p class="creator-none">No posts linked yet.</p>`}
      </div>
    `;
  }).join('');
}

function applySearch(query){
  const q = query.trim().toLowerCase();
  const cards = Array.from(document.querySelectorAll('.creator-card'));
  let visibleCount = 0;
  cards.forEach(card => {
    const match = !q || card.dataset.name.includes(q);
    card.style.display = match ? '' : 'none';
    if(match) visibleCount++;
  });

  const grid = document.getElementById('creatorsGrid');
  const searchEmpty = document.getElementById('searchEmpty');
  const searchEmptyQuery = document.getElementById('searchEmptyQuery');
  if(currentCreators.length && visibleCount === 0){
    grid.style.display = 'none';
    searchEmpty.style.display = 'block';
    searchEmptyQuery.textContent = `"${query.trim()}"`;
  } else {
    grid.style.display = currentCreators.length ? 'grid' : 'none';
    searchEmpty.style.display = 'none';
  }

  const countLabel = document.getElementById('toolbarCount');
  if(currentCreators.length){
    countLabel.textContent = q
      ? `${visibleCount} of ${currentCreators.length} creator${currentCreators.length === 1 ? '' : 's'}`
      : `${currentCreators.length} creator${currentCreators.length === 1 ? '' : 's'}`;
  } else {
    countLabel.textContent = '';
  }
}

/* ---------------- CREATOR OVERVIEW MODAL ---------------- */
// Bumped on every open/close so a slow roster fetch from a previous click
// can't clobber the modal after the visitor already moved on to another
// creator (or closed it) — see the guard at the bottom of openCreatorModal.
let creatorModalOpenToken = 0;

function setCreatorModalCover(url, name){
  const modal = document.querySelector('.creator-modal');
  const cover = document.getElementById('creatorModalCover');
  if(!url){
    modal.classList.remove('has-cover');
    cover.style.display = 'none';
    return;
  }
  document.getElementById('creatorModalCoverImg').src = url;
  const group = buildMarqueeGroup(name);
  document.getElementById('creatorModalMarqueeTrack').innerHTML = `
    <div class="creator-modal-marquee-group">${group}</div>
    <div class="creator-modal-marquee-group">${group}</div>
  `;
  cover.style.display = 'block';
  modal.classList.add('has-cover');
}

function openCreatorModal(c){
  const myToken = ++creatorModalOpenToken;
  const profiles = Array.isArray(c.profiles) ? c.profiles.filter(p => p.url) : [];

  // Base overview — exactly what the report already knows about this
  // creator — renders immediately so the popup never waits on a network
  // request just to open.
  const photo = document.getElementById('creatorModalPhoto');
  photo.style.visibility = '';
  photo.src = creatorPhotoOrFallback(c);
  document.getElementById('creatorModalName').textContent = c.name || '';

  const profilesWrap = document.getElementById('creatorModalProfiles');
  profilesWrap.innerHTML = profiles.length
    ? profiles.map(p => `
        <a class="creator-profile-link" href="${escapeHtml(p.url)}" target="_blank" rel="noopener noreferrer">
          ${platformBadge(p.platform, 16)}<span>${escapeHtml(p.platform || 'Profile')}</span>
        </a>`).join('')
    : `<p class="creator-modal-noprofiles">No public profiles linked yet.</p>`;

  document.getElementById('creatorModalMkLink').href = mediaKitUrlFor(c.name);

  // Reset the "roster-only" sections until (if) the lookup below resolves,
  // so reopening the popup for a creator with no cover doesn't briefly
  // flash the previous creator's cover/snapshot.
  setCreatorModalCover(null);
  document.getElementById('creatorModalSnapshot').innerHTML = '';
  document.getElementById('creatorModalSnapshot').style.display = 'none';

  document.getElementById('creatorModalOverlay').classList.add('show');
  document.body.style.overflow = 'hidden';

  // Progressive enhancement — cover photo + marquee + Creator Snapshot,
  // sourced from the public live roster (see loadPublicRosterOnce()).
  // Silently does nothing if this creator isn't found there (e.g. a
  // manually-typed name that doesn't match anyone on the roster).
  loadPublicRosterOnce().then(roster => {
    if(myToken !== creatorModalOpenToken) return; // popup moved on since this fetch started
    const t = findRosterMatch(roster, c.name);
    if(!t) return;

    setCreatorModalCover(rosterCoverUrl(t), t.name);

    const snapshotHtml = renderModalSnapshot(t);
    const snapshotEl = document.getElementById('creatorModalSnapshot');
    if(snapshotHtml){
      snapshotEl.innerHTML = snapshotHtml;
      snapshotEl.style.display = 'flex';
    }
  });
}
function closeCreatorModal(){
  creatorModalOpenToken++; // invalidate any in-flight roster lookup for the creator that was open
  document.getElementById('creatorModalOverlay').classList.remove('show');
  document.body.style.overflow = '';
}
function wireCreatorModal(){
  // Delegated on the (always-present) grid container rather than bound
  // per-card, so it keeps working with no extra wiring after every
  // renderCreatorCards() re-render.
  document.getElementById('creatorsGrid').addEventListener('click', (e) => {
    const btn = e.target.closest('.creator-name-link');
    if(!btn) return;
    const c = currentCreators[Number(btn.dataset.creatorIdx)];
    if(c) openCreatorModal(c);
  });
  document.getElementById('creatorModalClose').addEventListener('click', closeCreatorModal);
  document.getElementById('creatorModalOverlay').addEventListener('click', (e) => {
    if(e.target.id === 'creatorModalOverlay') closeCreatorModal();
  });
  document.addEventListener('keydown', (e) => {
    if(e.key === 'Escape') closeCreatorModal();
  });
}
wireCreatorModal();

function renderReport(report){
  currentReport = report;
  document.title = `${report.brandName || 'Campaign'} Portal | BRXDGE`;

  // Kick off the public roster fetch now rather than waiting for the
  // first creator-name click — by the time anyone actually opens the
  // overview popup, it's almost always already in hand (loadPublicRosterOnce()
  // caches the one in-flight/resolved promise).
  loadPublicRosterOnce();

  // Sticky top bar — brand identity, visible the whole time you scroll.
  document.getElementById('topbarBrandName').textContent = report.brandName || '';
  if(report.brandLogo){
    const topbarLogo = document.getElementById('topbarLogo');
    topbarLogo.src = report.brandLogo;
    topbarLogo.alt = report.brandName || '';
    topbarLogo.style.display = 'block';
  }

  document.getElementById('reportBrandHeading').textContent = report.brandName || 'Campaign Portal';
  document.getElementById('reportTitle').textContent = report.title || '';

  const logoEl = document.getElementById('brandLogo');
  const logoWrap = document.getElementById('brandLogoWrap');
  if(report.brandLogo){
    logoEl.src = report.brandLogo;
    logoEl.alt = report.brandName || '';
    logoWrap.style.display = 'flex';
  }

  const notesEl = document.getElementById('reportNotes');
  if(report.notes && report.notes.trim()){
    notesEl.textContent = report.notes;
    notesEl.style.display = 'block';
  }

  currentCreators = Array.isArray(report.creators) ? report.creators : [];
  renderStats(report, currentCreators);

  const grid = document.getElementById('creatorsGrid');
  const empty = document.getElementById('creatorsEmpty');
  const toolbar = document.querySelector('.report-toolbar');

  if(!currentCreators.length){
    grid.style.display = 'none';
    empty.style.display = 'block';
    toolbar.style.display = 'none';
    return;
  }

  renderCreatorCards(currentCreators);
  grid.style.display = 'grid';
  document.getElementById('toolbarCount').textContent = `${currentCreators.length} creator${currentCreators.length === 1 ? '' : 's'}`;

  const searchInput = document.getElementById('creatorSearch');
  searchInput.addEventListener('input', () => applySearch(searchInput.value));
}

/* ---------------- HELP WIDGET (floating FAQ + Message Us) ----------------
   Scoped to what a brand actually needs while looking at THIS portal —
   not the main site's booking-focused FAQ (pricing, contracts, etc.),
   which doesn't apply here since there's nothing to book from this page. */
const HELP_FAQS = [
  {
    q: 'What is this page?',
    a: 'This is your private BRXDGE Campaign Portal — a live view of every creator working on this campaign, their profiles, and the content they’ve posted. Bookmark this link to come back to it any time.',
  },
  {
    q: 'Is this link private? Can I share it with my team?',
    a: 'Yes to both. This page isn’t listed anywhere public or indexed by search engines — only people you share this exact link with can view it, so feel free to forward it internally.',
  },
  {
    q: 'Will this page update automatically as the campaign progresses?',
    a: 'Yes. Whenever your BRXDGE manager adds a new creator or post to this campaign, it appears here the next time you load the page — no need to ask for a refreshed link.',
  },
  {
    q: 'How do I see more about a specific creator?',
    a: 'Click their name on any card to open a quick overview — their photo, niche, audience, and a link through to their full media kit.',
  },
  {
    q: 'What happens when I click a post thumbnail?',
    a: 'It opens that exact post on the platform it was published to (Instagram, TikTok, YouTube, etc.) in a new tab.',
  },
  {
    q: 'Can I get this report as a downloadable file?',
    a: 'Not as a one-click export today — everything here is yours to screenshot or share as-is. If you need a formal export, send us a message below and we’ll put one together.',
  },
  {
    q: 'A link or thumbnail isn’t loading — what do I do?',
    a: 'Occasionally a platform takes a post down or changes its thumbnail. Send us a message below and we’ll get it fixed.',
  },
  {
    q: 'Can I request more creators or start a new campaign?',
    a: 'Absolutely — message us below with what you’re looking for and your BRXDGE contact will follow up.',
  },
];

function renderHelpFaq(){
  const list = document.getElementById('helpFaqList');
  list.innerHTML = HELP_FAQS.map((item, i) => `
    <div class="help-faq-item">
      <button type="button" class="help-faq-question" id="helpFaqQ${i}" aria-expanded="false" aria-controls="helpFaqA${i}">
        <span>${escapeHtml(item.q)}</span>
        <svg class="help-faq-chevron" width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <div class="help-faq-answer" id="helpFaqA${i}"><p>${escapeHtml(item.a)}</p></div>
    </div>
  `).join('');
  list.querySelectorAll('.help-faq-question').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.setAttribute('aria-expanded', btn.getAttribute('aria-expanded') === 'true' ? 'false' : 'true');
    });
  });
}

function switchHelpTab(tab){
  const isFaq = tab === 'faq';
  document.getElementById('helpTabFaq').classList.toggle('active', isFaq);
  document.getElementById('helpTabFaq').setAttribute('aria-selected', String(isFaq));
  document.getElementById('helpTabMessage').classList.toggle('active', !isFaq);
  document.getElementById('helpTabMessage').setAttribute('aria-selected', String(!isFaq));
  document.getElementById('helpPaneFaq').style.display = isFaq ? 'block' : 'none';
  document.getElementById('helpPaneMessage').style.display = isFaq ? 'none' : 'block';
}

function openHelpWidget(){
  document.getElementById('helpWidget').classList.add('open');
  document.getElementById('helpFab').setAttribute('aria-expanded', 'true');
}
function closeHelpWidget(){
  document.getElementById('helpWidget').classList.remove('open');
  document.getElementById('helpFab').setAttribute('aria-expanded', 'false');
}

async function submitHelpMessage(e){
  e.preventDefault();
  const btn = document.getElementById('helpSubmitBtn');
  const note = document.getElementById('helpFormNote');
  const name = document.getElementById('helpName').value.trim();
  const email = document.getElementById('helpEmail').value.trim();
  const message = document.getElementById('helpMessageInput').value.trim();

  const report = currentReport || {};
  const talentTag = `Campaign Portal — ${report.brandName || 'Unknown Brand'}${report.title ? ` (${report.title})` : ''}`;

  btn.disabled = true;
  note.textContent = 'Sending…';
  note.classList.remove('is-error');
  try {
    const res = await fetch(`${API}/api/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, message, talent: talentTag }),
    });
    if(!res.ok) throw new Error('Failed to send');

    document.getElementById('helpMessageForm').style.display = 'none';
    document.getElementById('helpMessageSuccess').style.display = 'block';
  } catch(err){
    note.textContent = 'Something went wrong — please try again.';
    note.classList.add('is-error');
  } finally {
    btn.disabled = false;
  }
}

function resetHelpMessageForm(){
  document.getElementById('helpMessageForm').reset();
  document.getElementById('helpMessageForm').style.display = 'flex';
  document.getElementById('helpMessageSuccess').style.display = 'none';
  const note = document.getElementById('helpFormNote');
  note.textContent = 'Real humans read every message. Expect a reply within 1 business day.';
  note.classList.remove('is-error');
}

function wireHelpWidget(){
  renderHelpFaq();

  document.getElementById('helpFab').addEventListener('click', () => {
    const widget = document.getElementById('helpWidget');
    if(widget.classList.contains('open')) closeHelpWidget(); else openHelpWidget();
  });
  document.getElementById('helpTabFaq').addEventListener('click', () => switchHelpTab('faq'));
  document.getElementById('helpTabMessage').addEventListener('click', () => switchHelpTab('message'));
  document.getElementById('helpMessageForm').addEventListener('submit', submitHelpMessage);
  document.getElementById('helpSendAnother').addEventListener('click', resetHelpMessageForm);

  document.addEventListener('click', (e) => {
    if(!document.getElementById('helpWidget').classList.contains('open')) return;
    if(e.target.closest('#helpWidget')) return;
    closeHelpWidget();
  });
  document.addEventListener('keydown', (e) => {
    if(e.key === 'Escape') closeHelpWidget();
  });
}
wireHelpWidget();

async function init(){
  const token = new URLSearchParams(location.search).get('t');
  if(!token){
    showState('error');
    return;
  }
  try {
    const res = await fetch(`${API}/api/campaign-reports/by-token/${encodeURIComponent(token)}`);
    if(!res.ok) throw new Error('Not found');
    const report = await res.json();
    renderReport(report);
    showState('report');
  } catch(err){
    showState('error');
  }
}

init();
