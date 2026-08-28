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

function showState(which){
  document.getElementById('loadingState').style.display = which === 'loading' ? 'flex' : 'none';
  document.getElementById('errorState').style.display = which === 'error' ? 'flex' : 'none';
  document.getElementById('reportRoot').style.display = which === 'report' ? 'block' : 'none';
}

let currentCreators = []; // full list, so search can filter without re-fetching

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
  grid.innerHTML = creators.map(c => {
    const profiles = Array.isArray(c.profiles) ? c.profiles.filter(p => p.url) : [];
    const posts = Array.isArray(c.posts) ? c.posts.filter(p => p.url) : [];
    return `
      <div class="creator-card" data-name="${escapeHtml((c.name || '').toLowerCase())}">
        <div class="creator-card-head">
          <img class="creator-photo" src="${creatorPhotoOrFallback(c)}" alt="" onerror="this.style.visibility='hidden'">
          <div class="creator-name">${escapeHtml(c.name)}</div>
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
            ${posts.map(p => `
              <a class="creator-post-link" href="${escapeHtml(p.url)}" target="_blank" rel="noopener noreferrer">
                <span class="cp-icon">${platformBadge(p.platform, 20)}</span>
                <span class="cp-label">${escapeHtml(p.label) || escapeHtml(p.platform) || 'View post'}</span>
                <span class="cp-arrow">↗</span>
              </a>
            `).join('')}
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

function renderReport(report){
  document.title = `${report.brandName || 'Campaign'} Portal | BRXDGE`;

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
  if(report.brandLogo){
    logoEl.src = report.brandLogo;
    logoEl.alt = report.brandName || '';
    logoEl.style.display = 'block';
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
