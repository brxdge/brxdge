/* ============================================================
   report.js — powers report.html, the private brand-facing
   campaign report page. Reads ?t=<shareToken> from the URL, fetches
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

/* ---------------- MONOCHROME PLATFORM ICONS ----------------
   Same icon paths as platformIcon() in script.js — copied rather than
   shared via a <script> include, since this page intentionally has no
   dependency on the rest of the site's (much heavier) script.js. */
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
  return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none">${icons[p] || icons['Other']}</svg>`;
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

function showState(which){
  document.getElementById('loadingState').style.display = which === 'loading' ? 'flex' : 'none';
  document.getElementById('errorState').style.display = which === 'error' ? 'flex' : 'none';
  document.getElementById('reportRoot').style.display = which === 'report' ? 'block' : 'none';
}

function renderReport(report){
  document.title = `${report.title || 'Campaign Report'} | BRXDGE`;

  document.getElementById('reportTitle').textContent = report.title || 'Campaign Report';
  document.getElementById('reportBrand').textContent = report.brandName ? `for ${report.brandName}` : '';

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

  const creators = Array.isArray(report.creators) ? report.creators : [];
  const grid = document.getElementById('creatorsGrid');
  const empty = document.getElementById('creatorsEmpty');

  if(!creators.length){
    grid.style.display = 'none';
    empty.style.display = 'block';
    return;
  }

  grid.innerHTML = creators.map(c => {
    const profiles = Array.isArray(c.profiles) ? c.profiles.filter(p => p.url) : [];
    const posts = Array.isArray(c.posts) ? c.posts.filter(p => p.url) : [];
    return `
      <div class="creator-card">
        <div class="creator-card-head">
          <img class="creator-photo" src="${creatorPhotoOrFallback(c)}" alt="" onerror="this.style.visibility='hidden'">
          <div class="creator-name">${escapeHtml(c.name)}</div>
        </div>
        ${profiles.length ? `
          <div class="creator-profiles">
            ${profiles.map(p => `
              <a class="creator-profile-link" href="${escapeHtml(p.url)}" target="_blank" rel="noopener noreferrer">
                ${platformIcon(p.platform)}<span>${escapeHtml(p.platform || 'Profile')}</span>
              </a>
            `).join('')}
          </div>
        ` : ''}
        ${posts.length ? `
          <div class="creator-posts">
            <div class="creator-posts-label">Posts (${posts.length})</div>
            ${posts.map(p => `
              <a class="creator-post-link" href="${escapeHtml(p.url)}" target="_blank" rel="noopener noreferrer">
                <span class="cp-icon">${platformIcon(p.platform)}</span>
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