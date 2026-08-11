/* ============================================================
   BRXDGE ADMIN DASHBOARD
   IS_LOCAL / API are now defined once in config.js, loaded by a
   <script> tag in admin.html right before this file — this used to be
   its own hardcoded copy of the URL that drifted out of sync with
   script.js's copy (this dashboard was pointed at an old, dead Render
   deployment while the public site had already moved to Railway,
   silently reading/writing a completely different set of data). See
   config.js for the full story.
   ============================================================ */
const TOKEN_KEY = 'brxdge-admin-token';
let token = null;
let me = { username: '' };

let rosterData = [];
let managersData = [];
let messagesData = [];
let adminsData = [];
let brandsData = [];
let blogData = [];
let campaignsData = [];

try { token = sessionStorage.getItem(TOKEN_KEY); } catch(e) {}

/* ---------------- TOAST ---------------- */
function showToast(msg){
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove('show'), 2600);
}

/* ---------------- API HELPER ---------------- */
async function api(path, opts = {}){
  const headers = Object.assign({}, opts.headers || {});
  if(token) headers['Authorization'] = `Bearer ${token}`;
  if(opts.body && !(opts.body instanceof FormData)){
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(API + path, Object.assign({}, opts, { headers }));
  if(res.status === 401){
    signOut();
    throw new Error('Session expired');
  }
  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await res.json() : await res.text();
  if(!res.ok){
    const message = (data && data.error) ? data.error : (typeof data === 'string' ? data : 'Request failed');
    throw new Error(message);
  }
  return data;
}

/* ---------------- AUTH ---------------- */
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('loginError');
  errEl.classList.remove('show');
  const btn = e.target.querySelector('button');
  btn.disabled = true;

  try {
    const res = await fetch(API + '/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if(!res.ok || !data.ok){
      errEl.textContent = data.error || 'Incorrect username or password';
      errEl.classList.add('show');
      return;
    }
    token = data.token;
    try { sessionStorage.setItem(TOKEN_KEY, token); } catch(e){}
    await enterDashboard();
  } catch(err){
    errEl.textContent = 'Could not reach the server — is it running?';
    errEl.classList.add('show');
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('signOutBtn').addEventListener('click', async () => {
  try { await api('/api/logout', { method: 'POST' }); } catch(e){}
  signOut();
});

function signOut(){
  token = null;
  try { sessionStorage.removeItem(TOKEN_KEY); } catch(e){}
  document.getElementById('dashboard').classList.remove('show');
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('loginPassword').value = '';
}

async function enterDashboard(){
  try {
    me = await api('/api/me');
  } catch(err){
    return; // signOut() already fired inside api() on 401
  }
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('dashboard').classList.add('show');
  document.getElementById('whoamiName').textContent = me.username;
  await Promise.all([loadRoster(), loadManagers(), loadBrands(), loadMessages(), loadBlog(), loadCampaigns()]);
  renderTalentPage();
  renderManagersPage();
  renderBrandsPage();
  renderMessagesPage();
  renderProfilePage();
  renderBlogPage();
  renderCampaignsPage();
}

/* ---------------- NAVIGATION ---------------- */
document.querySelectorAll('.nav-item[data-page]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item[data-page]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
    document.getElementById('page-' + btn.dataset.page).style.display = 'block';
  });
});

/* ---------------- DATA LOADERS ---------------- */
async function loadRoster(){ rosterData = await api('/api/roster'); }
async function loadManagers(){ managersData = await api('/api/managers'); }
async function loadBrands(){
  // Caught locally (unlike the other loaders) so that if the live backend
  // hasn't been redeployed with the new /api/brands route yet — or that
  // one request hiccups for any other reason — it can't reject the
  // Promise.all() in enterDashboard() and take the whole dashboard down
  // with it. renderBrandsPage() already handles an empty brandsData with
  // a friendly "No brands yet" state.
  try {
    brandsData = await api('/api/brands');
  } catch(err){
    console.error('Failed to load brands:', err);
    brandsData = [];
  }
}
async function loadBlog(){
  // Same "catch locally" reasoning as loadBrands() above.
  try {
    blogData = await api('/api/blog');
  } catch(err){
    console.error('Failed to load blog posts:', err);
    blogData = [];
  }
}
async function loadCampaigns(){
  try {
    campaignsData = await api('/api/campaigns');
  } catch(err){
    console.error('Failed to load campaigns:', err);
    campaignsData = [];
  }
}
async function loadMessages(){
  messagesData = await api('/api/contact-messages');
  updateMessagesBadge();
}
function updateMessagesBadge(){
  const badge = document.getElementById('messagesBadge');
  if(messagesData.length > 0){
    badge.style.display = 'inline-block';
    badge.textContent = messagesData.length;
  } else {
    badge.style.display = 'none';
  }
}

/* ---------------- SHARED HELPERS ---------------- */
// Matches the public site's talentPhotoUrl() fallback (script.js) — a
// talent/manager without an uploaded photo yet used to render as a bare
// `src=""`, which the browser resolves to the current page URL and shows
// as a broken-image icon. Falling back to the same generated placeholder
// the public site already uses keeps the admin preview honest (what you
// see here is what a visitor actually sees) instead of just looking broken.
function photoOrFallback(entry){
  const p = entry && entry.photo ? String(entry.photo).trim() : '';
  if(p) return p;
  const seed = (entry && (entry.seed || entry.name)) || 'X';
  return `https://api.dicebear.com/9.x/notionists/svg?seed=${encodeURIComponent(seed)}&backgroundColor=c8302c,f0c239,fff8e9`;
}
function formatFollowers(n){ return n || '0'; }
function escapeHtml(str){
  return (str || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function slugify(str){
  return (str||'').toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
}

// Full-color platform icon, matching the public site's look.
function platformIconColor(p){
  const uid = Math.random().toString(36).slice(2,9);
  const icons = {
    'Instagram': `<defs><linearGradient id="a${uid}" x1="0%" y1="100%" x2="100%" y2="0%"><stop offset="0%" stop-color="#FFDD55"/><stop offset="26%" stop-color="#FF543E"/><stop offset="60%" stop-color="#C837AB"/><stop offset="100%" stop-color="#5B51D8"/></linearGradient></defs><rect width="34" height="34" rx="9" fill="url(#a${uid})"/><rect x="9" y="9" width="16" height="16" rx="5" stroke="#fff" stroke-width="1.8" fill="none"/><circle cx="17" cy="17" r="4.2" stroke="#fff" stroke-width="1.8" fill="none"/><circle cx="22.3" cy="11.7" r="1.1" fill="#fff"/>`,
    'TikTok': `<rect width="34" height="34" rx="9" fill="#000"/><path d="M21 8.2c.5 3 2.6 4.9 5 5.2" stroke="#25F4EE" stroke-width="1.9" fill="none" stroke-linecap="round" transform="translate(-1.3,0)"/><path d="M19.7 8c.5 3 2.6 4.9 5 5.2" stroke="#FE2C55" stroke-width="1.9" fill="none" stroke-linecap="round" transform="translate(1.3,0)"/><path d="M20 8v12.3a3.9 3.9 0 1 1-3-3.8" stroke="#fff" stroke-width="1.9" fill="none" stroke-linecap="round"/>`,
    'YouTube': `<rect width="34" height="34" rx="9" fill="#FF0000"/><path d="M14.5 12.3l8 4.7-8 4.7z" fill="#fff"/>`,
    'Twitter / X': `<rect width="34" height="34" rx="9" fill="#000"/><path d="M9 9l16 16M25 9L9 25" stroke="#fff" stroke-width="2" stroke-linecap="round"/>`,
    'Facebook': `<rect width="34" height="34" rx="9" fill="#1877F2"/><path d="M19.6 12.1h2.1V8.8h-2.8c-2.4 0-4 1.6-4 4.3V15H12v3.4h2.9V27h3.6v-8.6h2.7l.4-3.4h-3.1v-1.4c0-.9.4-1.5 1.1-1.5z" fill="#fff"/>`,
    'Snapchat': `<rect width="34" height="34" rx="9" fill="#FFFC00"/><path d="M17 8.6c2.9 0 4.9 2.1 4.9 5.2 0 1.2 0 2.3.3 3.1.4.8 1.1 1.1 1.9 1.5.5.2.5.9 0 1.1-.6.4-1.4.6-1.4 1.1 0 .3.3.9.9 1.5-.2.6-1.1.9-1.9 1-.1.6-.3 1.2-1.1 1.2-.8 0-1.2-.3-2.2-.3-1 0-1.6.7-2.4.7s-1.5-.7-2.4-.7c-1 0-1.4.3-2.2.3-.8 0-1-.6-1.1-1.2-.8-.1-1.7-.4-1.9-1 .6-.6.9-1.2.9-1.5 0-.5-.8-.7-1.4-1.1-.5-.2-.5-.9 0-1.1.8-.4 1.5-.7 1.9-1.5.3-.8.3-1.9.3-3.1 0-3.1 2-5.2 4.9-5.2z" fill="#000" fill-opacity="0.82"/>`,
    'Twitch': `<rect width="34" height="34" rx="9" fill="#9146FF"/><path d="M11.2 8.5h13v9.6l-3.2 3.2h-3l-2.4 2.4h-2.1v-2.4h-2.3V8.5z" stroke="#fff" stroke-width="1.4" fill="none"/><path d="M18 12v4M21.6 12v4" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>`,
    'LinkedIn': `<rect width="34" height="34" rx="9" fill="#0A66C2"/><circle cx="11.6" cy="11.2" r="1.6" fill="#fff"/><rect x="10.3" y="14.7" width="2.6" height="10.1" fill="#fff"/><path d="M16.4 14.7h2.5v1.4c.6-1 1.7-1.7 3.2-1.7 2.5 0 4 1.6 4 4.9v6.3h-2.6v-5.9c0-1.6-.6-2.6-2-2.6-1.1 0-1.8.8-2.1 1.6-.1.2-.1.6-.1 1v5.9h-2.6V14.7z" fill="#fff"/>`,
    'Pinterest': `<rect width="34" height="34" rx="9" fill="#E60023"/><path d="M17 8.4c-4.7 0-7.2 3.3-7.2 6.7 0 1.6.9 3.6 2.3 4.3.2.1.4 0 .4-.2l.3-1.2c.1-.3 0-.4-.1-.6-.6-.7-1-1.7-1-2.9 0-3.7 2.8-6.3 6.4-6.3 3.1 0 4.9 1.9 4.9 4.5 0 3.4-1.5 6.2-3.6 6.2-1.2 0-2.1-1-1.8-2.2.3-1.4.9-2.9.9-4 0-.9-.5-1.6-1.5-1.6-1.2 0-2.2 1.2-2.2 2.9 0 1 .4 1.7.4 1.7s-1.3 5.1-1.5 6c-.4 1.7-.1 3.7 0 3.9.1.1.1.1.2 0 .1-.1 1.3-1.6 1.7-3.1.1-.5.7-2.7.7-2.7.3.6 1.4 1.2 2.5 1.2 3.3 0 5.8-3 5.8-6.9.1-3.7-3-6.6-7.4-6.6z" fill="#fff"/>`,
    'Threads': `<rect width="34" height="34" rx="9" fill="#000"/><path d="M12.4 11.3c2.3-1.3 5.7-.8 6.3 2.2.5 2.5-.7 5.4-3.8 5.4-2 0-3.2-1.1-3.2-2.6 0-1.7 1.9-2.5 4-2.5 1.8 0 2.9.5 3.5 1.2" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round"/>`,
    'Other': `<rect width="34" height="34" rx="9" fill="#6b6b6b"/><path d="M13.5 17a3.5 3.5 0 0 1 3.5-3.5H19a3.5 3.5 0 1 1 0 7h-1.5" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round"/><path d="M20.5 17a3.5 3.5 0 0 1-3.5 3.5H15a3.5 3.5 0 1 1 0-7h1.5" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
  };
  return `<svg width="30" height="30" viewBox="0 0 34 34" xmlns="http://www.w3.org/2000/svg">${icons[p] || icons['Other']}</svg>`;
}

/* ============================================================
   PAGE: TALENT MEDIA KITS
   ============================================================ */
function totalReach(socials){
  return (socials || []).reduce((sum, s) => {
    const n = parseFollowerCount(s.followers);
    return sum + n;
  }, 0);
}
function parseFollowerCount(str){
  if(!str) return 0;
  const m = String(str).trim().match(/^([\d.]+)\s*(K|M|B)?$/i);
  if(!m) return 0;
  let n = parseFloat(m[1]);
  const suffix = (m[2] || '').toUpperCase();
  if(suffix === 'K') n *= 1e3;
  if(suffix === 'M') n *= 1e6;
  if(suffix === 'B') n *= 1e9;
  return n;
}
function formatReach(n){
  if(n >= 1e9) return (n/1e9).toFixed(1).replace(/\.0$/,'') + 'B';
  if(n >= 1e6) return (n/1e6).toFixed(1).replace(/\.0$/,'') + 'M';
  if(n >= 1e3) return (n/1e3).toFixed(1).replace(/\.0$/,'') + 'K';
  return String(Math.round(n));
}

function renderTalentPage(){
  const grandTotalReach = rosterData.reduce((sum, t) => sum + totalReach(t.socials), 0);
  const niches = new Set(rosterData.map(t => t.niche).filter(Boolean));

  document.getElementById('page-talent').innerHTML = `
    <h1 class="page-title">Talent Media Kits</h1>
    <p class="page-sub">Add, edit, and remove talent profiles shown on the public site.</p>

    <div class="stat-row">
      <div class="stat-card"><div class="lbl">Total Talent</div><div class="val">${rosterData.length}</div></div>
      <div class="stat-card"><div class="lbl">Combined Reach</div><div class="val">${formatReach(grandTotalReach)}</div></div>
      <div class="stat-card"><div class="lbl">Categories</div><div class="val">${niches.size}</div></div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <div><h2>All Talent</h2><p>${rosterData.length} profile${rosterData.length===1?'':'s'}</p></div>
        <button class="btn btn-primary" id="addTalentBtn" style="width:auto;">+ Add Talent</button>
      </div>
      <div class="talent-grid" id="talentGrid"></div>
    </div>
  `;
  document.getElementById('addTalentBtn').addEventListener('click', () => openTalentModal(null));

  const grid = document.getElementById('talentGrid');
  if(!rosterData.length){
    grid.innerHTML = `<p style="color:var(--muted); font-size:14px;">No talent yet — add your first one above.</p>`;
    return;
  }
  grid.innerHTML = rosterData.map(t => `
    <div class="talent-card">
      <img src="${photoOrFallback(t)}" alt="${escapeHtml(t.name)}" onerror="this.style.background='#eee'">
      <div class="talent-card-body">
        <div class="talent-card-name">${escapeHtml(t.name)}</div>
        <div class="talent-card-niche">${escapeHtml(t.niche || '')}</div>
        <div class="platform-row">${(t.socials||[]).slice(0,5).map(s => `<span class="p-pill">${platformIconColor(s.platform)}</span>`).join('')}</div>
        <div class="talent-card-actions">
          <button class="btn btn-ghost btn-sm" data-edit="${t.id}">Edit Media Kit</button>
          <button class="btn btn-danger btn-sm" data-delete="${t.id}">Delete</button>
        </div>
      </div>
    </div>
  `).join('');

  grid.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => openTalentModal(btn.dataset.edit));
  });
  grid.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', () => deleteTalent(btn.dataset.delete));
  });
}

async function deleteTalent(id){
  const t = rosterData.find(x => x.id === id);
  if(!confirm(`Remove "${t ? t.name : 'this talent'}" from the public roster?`)) return;
  rosterData = rosterData.filter(x => x.id !== id);
  try {
    await api('/api/roster', { method: 'POST', body: JSON.stringify(rosterData) });
    showToast('Talent removed');
    renderTalentPage();
  } catch(err){
    showToast(err.message);
  }
}

function openTalentModal(id){
  const existing = id ? rosterData.find(t => t.id === id) : null;
  const socials = existing ? (existing.socials || []) : [];

  document.getElementById('talentModal').innerHTML = `
    <button class="modal-close" data-close>&times;</button>
    <h3>${existing ? 'Edit Talent' : 'Add Talent'}</h3>
    <p class="sub">${existing ? existing.name : 'Create a new media kit profile.'}</p>
    <form id="talentForm">
      <div class="field-row">
        <div class="field"><label>Name</label><input type="text" id="tName" value="${escapeHtml(existing?.name)}" required></div>
        <div class="field"><label>Niche / Category</label><input type="text" id="tNiche" value="${escapeHtml(existing?.niche)}" placeholder="e.g. Comedy"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Gender</label>
          <select id="tGender">
            <option value="">—</option>
            <option value="Male" ${existing?.gender==='Male'?'selected':''}>Male</option>
            <option value="Female" ${existing?.gender==='Female'?'selected':''}>Female</option>
          </select>
        </div>
        <div class="field"><label>Profile Photo</label><input type="file" id="tPhotoFile" accept="image/*"></div>
      </div>
      <div class="field"><label>Cover Photo (media kit header)</label><input type="file" id="tCoverFile" accept="image/*"></div>
      <div class="field"><label>Bio</label><textarea id="tBio" rows="2">${escapeHtml(existing?.bio)}</textarea></div>
      <div class="field"><label>Gallery Photos</label>
        <div class="gallery-thumbs" id="galleryThumbs"></div>
        <input type="file" id="tGalleryFiles" accept="image/*" multiple>
      </div>

      <div class="field">
        <label>Social Platforms</label>
        <div id="socialsList"></div>
        <button type="button" class="btn btn-ghost btn-sm" id="addSocialBtn" style="margin-top:8px;">+ Add Platform</button>
      </div>

      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-close>Cancel</button>
        <button type="submit" class="btn btn-primary" style="width:auto;">Save</button>
      </div>
    </form>
  `;

  const socialsList = document.getElementById('socialsList');
  const PLATFORMS = ['Instagram','TikTok','YouTube','Twitter / X','Facebook','Snapchat','Twitch','LinkedIn','Pinterest','Threads','Other'];

  function addSocialRow(s){
    const wrap = document.createElement('div');
    wrap.className = 'social-entry';
    let posts = (s && s.posts) ? s.posts : [];

    const row = document.createElement('div');
    row.className = 'social-row';
    row.innerHTML = `
      <select class="s-platform">
        ${PLATFORMS.map(p => `<option value="${p}" ${s?.platform===p?'selected':''}>${p}</option>`).join('')}
      </select>
      <input type="text" class="s-followers" placeholder="Followers e.g. 1.2M" value="${escapeHtml(s?.followers)}">
      <input type="url" class="s-url" placeholder="Profile URL" value="${escapeHtml(s?.url)}">
      <button type="button" class="row-remove">&times;</button>
    `;
    row.querySelector('.row-remove').addEventListener('click', () => wrap.remove());
    wrap.appendChild(row);

    const extra = document.createElement('div');
    extra.className = 'social-extra';
    wrap.appendChild(extra);

    const existingStats = (s && s.stats) || {};
    function statsFieldsHTML(){
      return `
        <p class="extra-hint" style="margin-top:12px;">Stats shown on the "View statistics" button (optional):</p>
        <div class="stats-fields">
          <input type="text" class="stat-avgviews" placeholder="Avg. views per video e.g. 850K" value="${escapeHtml(existingStats.avgViews)}">
          <input type="text" class="stat-avglikes" placeholder="Avg. likes per video e.g. 62K" value="${escapeHtml(existingStats.avgLikes)}">
          <input type="text" class="stat-engagement" placeholder="Engagement rate e.g. 7.2%" value="${escapeHtml(existingStats.engagementRate)}">
          <input type="text" class="stat-growth" placeholder="Growth, last 30 days e.g. +4.1%" value="${escapeHtml(existingStats.growth)}">
        </div>
      `;
    }

    function renderPostThumbs(){
      const thumbsEl = extra.querySelector('.post-thumbs');
      if(!thumbsEl) return;
      thumbsEl.innerHTML = posts.map(p =>
        `<a class="post-thumb" href="${p.link}" target="_blank" rel="noopener" title="${escapeHtml(p.title)}"><img src="${p.thumbnail}" alt=""></a>`
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
            // The endpoint returns { posts, stats }, not a bare array — this
            // used to assign that whole wrapper object to `posts` directly,
            // which looked fine here but crashed the server on Save (it
            // expects posts to be an array to iterate over). Unwrap it.
            const result = await api('/api/youtube-latest?channelUrl=' + encodeURIComponent(channelUrl) + '&count=4');
            posts = result.posts || [];
            renderPostThumbs();
            // Auto-fill the stat fields from real YouTube data, same as the
            // backend comment intends — but only if empty, so this never
            // overwrites numbers you've already typed in by hand.
            if (result.stats) {
              const avgViewsEl = extra.querySelector('.stat-avgviews');
              const avgLikesEl = extra.querySelector('.stat-avglikes');
              const engagementEl = extra.querySelector('.stat-engagement');
              if (avgViewsEl && !avgViewsEl.value.trim()) avgViewsEl.value = result.stats.avgViews;
              if (avgLikesEl && !avgLikesEl.value.trim()) avgLikesEl.value = result.stats.avgLikes;
              if (engagementEl && !engagementEl.value.trim()) engagementEl.value = result.stats.engagementRate;
            }
            showToast('Latest videos fetched');
          } catch(err){
            showToast('Could not fetch latest videos — check the channel URL');
          } finally {
            btn.disabled = false; btn.textContent = originalLabel;
          }
        });
        renderPostThumbs();

      } else if(platform === 'TikTok'){
        extra.innerHTML = `
          <p class="extra-hint">TikTok doesn't allow auto-fetching a profile's latest posts — paste up to 4 specific video links to preview instead:</p>
          <input type="url" class="tt-video-input" placeholder="TikTok video URL 1" value="${escapeHtml(posts[0]?.sourceUrl)}">
          <input type="url" class="tt-video-input" placeholder="TikTok video URL 2" value="${escapeHtml(posts[1]?.sourceUrl)}">
          <input type="url" class="tt-video-input" placeholder="TikTok video URL 3" value="${escapeHtml(posts[2]?.sourceUrl)}">
          <input type="url" class="tt-video-input" placeholder="TikTok video URL 4" value="${escapeHtml(posts[3]?.sourceUrl)}">
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
            const fetched = [];
            for(const url of urls){
              const info = await api('/api/tiktok-oembed?url=' + encodeURIComponent(url));
              fetched.push({ thumbnail: info.thumbnail_url, title: info.title || '', link: url, sourceUrl: url });
            }
            posts = fetched;
            renderPostThumbs();
            showToast('Video previews fetched');
          } catch(err){
            showToast('Could not preview one or more videos — check the links');
          } finally {
            btn.disabled = false; btn.textContent = originalLabel;
          }
        });
        renderPostThumbs();

      } else {
        posts = [];
      }
    }

    row.querySelector('.s-platform').addEventListener('change', renderExtra);
    renderExtra();

    wrap.getData = () => ({
      platform: row.querySelector('.s-platform').value,
      followers: row.querySelector('.s-followers').value.trim(),
      url: row.querySelector('.s-url').value.trim(),
      posts,
      stats: extra.querySelector('.stat-avgviews') ? {
        avgViews: extra.querySelector('.stat-avgviews').value.trim(),
        avgLikes: extra.querySelector('.stat-avglikes').value.trim(),
        engagementRate: extra.querySelector('.stat-engagement').value.trim(),
        growth: extra.querySelector('.stat-growth').value.trim(),
      } : undefined,
    });

    socialsList.appendChild(wrap);
  }
  if(socials.length){ socials.forEach(addSocialRow); } else { addSocialRow(null); }
  document.getElementById('addSocialBtn').addEventListener('click', () => addSocialRow(null));

  // Existing gallery photos — shown as thumbnails you can remove; new
  // uploads (from the file input below) get appended to this on save.
  let galleryUrls = [...(existing?.gallery || [])];
  const galleryThumbs = document.getElementById('galleryThumbs');
  function renderGalleryThumbs(){
    galleryThumbs.innerHTML = galleryUrls.map((url, i) => `
      <div class="gallery-thumb">
        <img src="${url}" onerror="this.style.background='#eee'">
        <button type="button" class="thumb-remove" data-i="${i}">&times;</button>
      </div>
    `).join('');
    galleryThumbs.querySelectorAll('.thumb-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        galleryUrls.splice(Number(btn.dataset.i), 1);
        renderGalleryThumbs();
      });
    });
  }
  renderGalleryThumbs();

  const overlay = document.getElementById('talentModalOverlay');
  overlay.classList.add('show');
  overlay.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', () => overlay.classList.remove('show')));

  document.getElementById('talentForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      let photoUrl = existing?.photo || '';
      let coverUrl = existing?.coverPhoto || '';
      const photoFile = document.getElementById('tPhotoFile').files[0];
      const coverFile = document.getElementById('tCoverFile').files[0];
      if(photoFile) photoUrl = await uploadImage(photoFile);
      if(coverFile) coverUrl = await uploadImage(coverFile);

      const newGalleryFiles = Array.from(document.getElementById('tGalleryFiles').files);
      if(newGalleryFiles.length){
        const uploaded = await Promise.all(newGalleryFiles.map(f => uploadImage(f)));
        galleryUrls = galleryUrls.concat(uploaded);
      }

      const socialsOut = Array.from(socialsList.querySelectorAll('.social-entry')).map(wrap => wrap.getData());

      const entry = {
        id: existing ? existing.id : ('t' + Date.now()),
        name: document.getElementById('tName').value.trim(),
        niche: document.getElementById('tNiche').value.trim(),
        gender: document.getElementById('tGender').value,
        photo: photoUrl,
        coverPhoto: coverUrl,
        bio: document.getElementById('tBio').value.trim(),
        gallery: galleryUrls,
        socials: socialsOut,
      };

      if(existing){
        rosterData = rosterData.map(t => t.id === existing.id ? entry : t);
      } else {
        rosterData.push(entry);
      }
      await api('/api/roster', { method: 'POST', body: JSON.stringify(rosterData) });
      overlay.classList.remove('show');
      showToast(existing ? 'Talent updated' : 'Talent added');
      renderTalentPage();
    } catch(err){
      showToast(err.message);
    } finally {
      submitBtn.disabled = false;
    }
  });
}

async function uploadImage(file){
  const formData = new FormData();
  formData.append('talentImage', file);
  const data = await api('/upload', { method: 'POST', body: formData });
  return data.url;
}

/* ============================================================
   PAGE: MANAGERS (editable table — the public "Managers" section)
   ============================================================ */
function renderManagersPage(){
  document.getElementById('page-managers').innerHTML = `
    <h1 class="page-title">Managers</h1>
    <p class="page-sub">Shown in the "Managers" section of the public site. Edit their info and photo here.</p>

    <div class="panel">
      <div class="panel-head">
        <div><h2>Team</h2><p>${managersData.length} manager${managersData.length===1?'':'s'}</p></div>
        <button class="btn btn-primary" id="addManagerBtn" style="width:auto;">+ Add Manager</button>
      </div>
      <div class="table-scroll">
      <table class="data-table">
        <thead><tr><th></th><th>Name</th><th>Role</th><th>Bio</th><th></th></tr></thead>
        <tbody id="managersTbody"></tbody>
      </table>
      </div>
    </div>
  `;
  document.getElementById('addManagerBtn').addEventListener('click', () => openManagerModal(null));

  const tbody = document.getElementById('managersTbody');
  if(!managersData.length){
    tbody.innerHTML = `<tr><td colspan="5" style="color:var(--muted); padding:16px 0;">No managers yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = managersData.map((m, i) => `
    <tr>
      <td><img class="table-avatar" src="${photoOrFallback(m)}" onerror="this.style.background='#eee'"></td>
      <td><b>${escapeHtml(m.name)}</b></td>
      <td>${escapeHtml(m.role)}</td>
      <td class="truncate">${escapeHtml(m.bio)}</td>
      <td class="table-actions">
        <button class="btn btn-ghost btn-sm" data-edit="${i}">Edit</button>
        <button class="btn btn-danger btn-sm" data-delete="${i}">Delete</button>
      </td>
    </tr>
  `).join('');
  tbody.querySelectorAll('[data-edit]').forEach(btn => btn.addEventListener('click', () => openManagerModal(Number(btn.dataset.edit))));
  tbody.querySelectorAll('[data-delete]').forEach(btn => btn.addEventListener('click', () => deleteManager(Number(btn.dataset.delete))));
}

async function deleteManager(index){
  const m = managersData[index];
  if(!confirm(`Remove "${m.name}" from the Managers section?`)) return;
  managersData = managersData.filter((_, i) => i !== index);
  try {
    await api('/api/managers', { method: 'POST', body: JSON.stringify(managersData) });
    showToast('Manager removed');
    renderManagersPage();
  } catch(err){
    showToast(err.message);
  }
}

function openManagerModal(index){
  const existing = index !== null ? managersData[index] : null;
  document.getElementById('managerModal').innerHTML = `
    <button class="modal-close" data-close>&times;</button>
    <h3>${existing ? 'Edit Manager' : 'Add Manager'}</h3>
    <p class="sub">Shown on the public site's Managers section.</p>
    <form id="managerForm">
      <div class="field"><label>Name</label><input type="text" id="mName" value="${escapeHtml(existing?.name)}" required></div>
      <div class="field"><label>Role</label><input type="text" id="mRole" value="${escapeHtml(existing?.role)}" placeholder="e.g. Brand Partnerships"></div>
      <div class="field"><label>Bio</label><textarea id="mBio" rows="2">${escapeHtml(existing?.bio)}</textarea></div>
      <div class="field"><label>Photo</label><input type="file" id="mPhotoFile" accept="image/*"></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-close>Cancel</button>
        <button type="submit" class="btn btn-primary" style="width:auto;">Save</button>
      </div>
    </form>
  `;
  const overlay = document.getElementById('managerModalOverlay');
  overlay.classList.add('show');
  overlay.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', () => overlay.classList.remove('show')));

  document.getElementById('managerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      let photo = existing?.photo || '';
      const file = document.getElementById('mPhotoFile').files[0];
      if(file) photo = await uploadImage(file);

      const entry = {
        name: document.getElementById('mName').value.trim(),
        role: document.getElementById('mRole').value.trim(),
        bio: document.getElementById('mBio').value.trim(),
        photo,
      };
      if(existing){ managersData[index] = entry; } else { managersData.push(entry); }
      await api('/api/managers', { method: 'POST', body: JSON.stringify(managersData) });
      overlay.classList.remove('show');
      showToast(existing ? 'Manager updated' : 'Manager added');
      renderManagersPage();
    } catch(err){
      showToast(err.message);
    } finally {
      submitBtn.disabled = false;
    }
  });
}

/* ============================================================
   PAGE: BRAND MARQUEE (feeds both marquees on the public site — the
   text ticker uses just `name`, the logo row uses `logo` and falls back
   to an initial-letter badge client-side for any brand with no logo yet)
   ============================================================ */
function renderBrandsPage(){
  document.getElementById('page-brands').innerHTML = `
    <h1 class="page-title">Brand Marquee</h1>
    <p class="page-sub">Add, edit, and remove the brand partners shown in the two scrolling marquees under "Featured Talent" on the public site. Order here is the order they scroll in.</p>

    <div class="panel">
      <div class="panel-head">
        <div><h2>Brands</h2><p>${brandsData.length} brand${brandsData.length===1?'':'s'}</p></div>
        <button class="btn btn-primary" id="addBrandBtn" style="width:auto;">+ Add Brand</button>
      </div>
      <div class="table-scroll">
      <table class="data-table">
        <thead><tr><th></th><th>Name</th><th>Logo</th><th></th></tr></thead>
        <tbody id="brandsTbody"></tbody>
      </table>
      </div>
    </div>
  `;
  document.getElementById('addBrandBtn').addEventListener('click', () => openBrandModal(null));

  const tbody = document.getElementById('brandsTbody');
  if(!brandsData.length){
    tbody.innerHTML = `<tr><td colspan="4" style="color:var(--muted); padding:16px 0;">No brands yet — add your first one above.</td></tr>`;
    return;
  }
  tbody.innerHTML = brandsData.map((b, i) => `
    <tr>
      <td>${b.logo
        ? `<img class="table-logo" src="${b.logo}" onerror="this.style.background='#eee'">`
        : `<div class="brand-logo-fallback">${escapeHtml((b.name||'?').charAt(0).toUpperCase())}</div>`}</td>
      <td><b>${escapeHtml(b.name)}</b></td>
      <td style="color:var(--muted);">${b.logo ? 'Uploaded' : 'No logo — using initial'}</td>
      <td class="table-actions">
        <button class="btn btn-ghost btn-sm" data-edit="${i}">Edit</button>
        <button class="btn btn-danger btn-sm" data-delete="${i}">Delete</button>
      </td>
    </tr>
  `).join('');
  tbody.querySelectorAll('[data-edit]').forEach(btn => btn.addEventListener('click', () => openBrandModal(Number(btn.dataset.edit))));
  tbody.querySelectorAll('[data-delete]').forEach(btn => btn.addEventListener('click', () => deleteBrand(Number(btn.dataset.delete))));
}

async function deleteBrand(index){
  const b = brandsData[index];
  if(!confirm(`Remove "${b.name}" from the brand marquee?`)) return;
  brandsData = brandsData.filter((_, i) => i !== index);
  try {
    await api('/api/brands', { method: 'POST', body: JSON.stringify(brandsData) });
    showToast('Brand removed');
    renderBrandsPage();
  } catch(err){
    showToast(err.message);
  }
}

function openBrandModal(index){
  const existing = index !== null ? brandsData[index] : null;
  document.getElementById('brandModal').innerHTML = `
    <button class="modal-close" data-close>&times;</button>
    <h3>${existing ? 'Edit Brand' : 'Add Brand'}</h3>
    <p class="sub">Shown in both brand marquees on the public site.</p>
    <form id="brandForm">
      <div class="field"><label>Brand Name</label><input type="text" id="bName" value="${escapeHtml(existing?.name)}" required></div>
      <div class="field">
        <label>Logo</label>
        ${existing?.logo ? `<img class="table-logo" style="width:56px; height:56px; margin-bottom:8px;" src="${existing.logo}">` : ''}
        <input type="file" id="bLogoFile" accept="image/*">
        <p style="font-size:11px; color:var(--muted); margin-top:4px;">Optional — a square image works best. Without one, the logo marquee shows the brand's first initial instead.</p>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-close>Cancel</button>
        <button type="submit" class="btn btn-primary" style="width:auto;">Save</button>
      </div>
    </form>
  `;
  const overlay = document.getElementById('brandModalOverlay');
  overlay.classList.add('show');
  overlay.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', () => overlay.classList.remove('show')));

  document.getElementById('brandForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      let logo = existing?.logo || '';
      const file = document.getElementById('bLogoFile').files[0];
      if(file) logo = await uploadImage(file);

      const entry = {
        name: document.getElementById('bName').value.trim(),
        logo,
      };
      if(existing){ brandsData[index] = entry; } else { brandsData.push(entry); }
      await api('/api/brands', { method: 'POST', body: JSON.stringify(brandsData) });
      overlay.classList.remove('show');
      showToast(existing ? 'Brand updated' : 'Brand added');
      renderBrandsPage();
    } catch(err){
      showToast(err.message);
    } finally {
      submitBtn.disabled = false;
    }
  });
}

/* ============================================================
   PAGE: BLOG & CASE STUDIES
   ============================================================ */
// slugify() already exists above (shared with the talent-card URL slugs).

function renderBlogPage(){
  document.getElementById('page-blog').innerHTML = `
    <h1 class="page-title">Blog &amp; Case Studies</h1>
    <p class="page-sub">Articles and case studies shown in the "Blog &amp; Case Studies" section on the public site.</p>

    <div class="panel">
      <div class="panel-head">
        <div><h2>Posts</h2><p>${blogData.length} post${blogData.length===1?'':'s'}</p></div>
        <button class="btn btn-primary" id="addBlogBtn" style="width:auto;">+ Add Post</button>
      </div>
      <div class="table-scroll">
      <table class="data-table">
        <thead><tr><th></th><th>Title</th><th>Type</th><th>Talent</th><th></th></tr></thead>
        <tbody id="blogTbody"></tbody>
      </table>
      </div>
    </div>
  `;
  document.getElementById('addBlogBtn').addEventListener('click', () => openBlogModal(null));

  const tbody = document.getElementById('blogTbody');
  if(!blogData.length){
    tbody.innerHTML = `<tr><td colspan="5" style="color:var(--muted); padding:16px 0;">No posts yet — add your first one above.</td></tr>`;
    return;
  }
  tbody.innerHTML = blogData.map((p, i) => `
    <tr>
      <td>${p.coverImage
        ? `<img class="table-logo" src="${p.coverImage}" onerror="this.style.background='#eee'">`
        : `<div class="brand-logo-fallback">${escapeHtml((p.title||'?').charAt(0).toUpperCase())}</div>`}</td>
      <td><b>${escapeHtml(p.title)}</b></td>
      <td style="color:var(--muted);">${p.postType === 'case-study' ? 'Case Study' : 'Article'}</td>
      <td style="color:var(--muted);">${escapeHtml(p.talentName) || '—'}</td>
      <td class="table-actions">
        <button class="btn btn-ghost btn-sm" data-edit="${i}">Edit</button>
        <button class="btn btn-danger btn-sm" data-delete="${i}">Delete</button>
      </td>
    </tr>
  `).join('');
  tbody.querySelectorAll('[data-edit]').forEach(btn => btn.addEventListener('click', () => openBlogModal(Number(btn.dataset.edit))));
  tbody.querySelectorAll('[data-delete]').forEach(btn => btn.addEventListener('click', () => deleteBlogPost(Number(btn.dataset.delete))));
}

async function deleteBlogPost(index){
  const p = blogData[index];
  if(!confirm(`Delete "${p.title}"?`)) return;
  blogData = blogData.filter((_, i) => i !== index);
  try {
    await api('/api/blog', { method: 'POST', body: JSON.stringify(blogData) });
    showToast('Post deleted');
    renderBlogPage();
  } catch(err){
    showToast(err.message);
  }
}

function openBlogModal(index){
  const existing = index !== null ? blogData[index] : null;
  const isCaseStudy = existing?.postType === 'case-study';
  document.getElementById('blogModal').innerHTML = `
    <button class="modal-close" data-close>&times;</button>
    <h3>${existing ? 'Edit Post' : 'Add Post'}</h3>
    <p class="sub">Shown in the Blog &amp; Case Studies section on the public site.</p>
    <form id="blogForm">
      <div class="field"><label>Title</label><input type="text" id="pTitle" value="${escapeHtml(existing?.title)}" required></div>
      <div class="field">
        <label>Type</label>
        <select id="pType">
          <option value="article" ${!isCaseStudy ? 'selected' : ''}>Article</option>
          <option value="case-study" ${isCaseStudy ? 'selected' : ''}>Case Study</option>
        </select>
      </div>
      <div class="field"><label>Talent (optional)</label><input type="text" id="pTalent" value="${escapeHtml(existing?.talentName)}"></div>
      <div class="field"><label>Author (optional)</label><input type="text" id="pAuthor" value="${escapeHtml(existing?.author)}"></div>
      <div class="field"><label>Excerpt</label><textarea id="pExcerpt" rows="2">${escapeHtml(existing?.excerpt)}</textarea></div>
      <div class="field"><label>Body</label><textarea id="pBody" rows="6">${escapeHtml(existing?.body)}</textarea></div>
      <div class="field">
        <label>Cover Image</label>
        ${existing?.coverImage ? `<img class="table-logo" style="width:56px; height:56px; margin-bottom:8px;" src="${existing.coverImage}">` : ''}
        <input type="file" id="pCoverFile" accept="image/*">
        <p style="font-size:11px; color:var(--muted); margin-top:4px;">Optional — without one, a generated avatar is used instead.</p>
      </div>
      <div id="pCaseStudyFields" style="display:${isCaseStudy ? 'block' : 'none'};">
        <div class="field"><label>Followers Before / After</label>
          <div style="display:flex; gap:8px;">
            <input type="text" id="pFollowersBefore" placeholder="e.g. 12K" value="${escapeHtml(existing?.statFollowersBefore)}">
            <input type="text" id="pFollowersAfter" placeholder="e.g. 84K" value="${escapeHtml(existing?.statFollowersAfter)}">
          </div>
        </div>
        <div class="field"><label>Engagement Before / After</label>
          <div style="display:flex; gap:8px;">
            <input type="text" id="pEngagementBefore" placeholder="e.g. 2.1%" value="${escapeHtml(existing?.statEngagementBefore)}">
            <input type="text" id="pEngagementAfter" placeholder="e.g. 6.4%" value="${escapeHtml(existing?.statEngagementAfter)}">
          </div>
        </div>
        <div class="field"><label>Brand Deals</label><input type="text" id="pBrandDeals" value="${escapeHtml(existing?.statBrandDeals)}"></div>
        <div class="field"><label>Revenue</label><input type="text" id="pRevenue" value="${escapeHtml(existing?.statRevenue)}"></div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-close>Cancel</button>
        <button type="submit" class="btn btn-primary" style="width:auto;">Save</button>
      </div>
    </form>
  `;
  const overlay = document.getElementById('blogModalOverlay');
  overlay.classList.add('show');
  overlay.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', () => overlay.classList.remove('show')));

  document.getElementById('pType').addEventListener('change', (e) => {
    document.getElementById('pCaseStudyFields').style.display = e.target.value === 'case-study' ? 'block' : 'none';
  });

  document.getElementById('blogForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      let coverImage = existing?.coverImage || '';
      const file = document.getElementById('pCoverFile').files[0];
      if(file) coverImage = await uploadImage(file);

      const title = document.getElementById('pTitle').value.trim();
      const entry = {
        slug: existing?.slug || (slugify(title) + '-' + Date.now().toString(36)),
        title,
        postType: document.getElementById('pType').value,
        talentName: document.getElementById('pTalent').value.trim(),
        author: document.getElementById('pAuthor').value.trim(),
        excerpt: document.getElementById('pExcerpt').value.trim(),
        body: document.getElementById('pBody').value.trim(),
        coverImage,
        publishedAt: existing?.publishedAt || new Date().toISOString(),
        statFollowersBefore: document.getElementById('pFollowersBefore').value.trim(),
        statFollowersAfter: document.getElementById('pFollowersAfter').value.trim(),
        statEngagementBefore: document.getElementById('pEngagementBefore').value.trim(),
        statEngagementAfter: document.getElementById('pEngagementAfter').value.trim(),
        statBrandDeals: document.getElementById('pBrandDeals').value.trim(),
        statRevenue: document.getElementById('pRevenue').value.trim(),
      };
      if(existing){ blogData[index] = entry; } else { blogData.push(entry); }
      await api('/api/blog', { method: 'POST', body: JSON.stringify(blogData) });
      overlay.classList.remove('show');
      showToast(existing ? 'Post updated' : 'Post added');
      renderBlogPage();
    } catch(err){
      showToast(err.message);
    } finally {
      submitBtn.disabled = false;
    }
  });
}

/* ============================================================
   PAGE: CAMPAIGNS
   ============================================================ */
function renderCampaignsPage(){
  document.getElementById('page-campaigns').innerHTML = `
    <h1 class="page-title">Campaigns</h1>
    <p class="page-sub">Brand &times; creator campaign case studies shown in the "Campaigns" section on the public site.</p>

    <div class="panel">
      <div class="panel-head">
        <div><h2>Campaigns</h2><p>${campaignsData.length} campaign${campaignsData.length===1?'':'s'}</p></div>
        <button class="btn btn-primary" id="addCampaignBtn" style="width:auto;">+ Add Campaign</button>
      </div>
      <div class="table-scroll">
      <table class="data-table">
        <thead><tr><th></th><th>Brand</th><th>Creator</th><th></th></tr></thead>
        <tbody id="campaignsTbody"></tbody>
      </table>
      </div>
    </div>
  `;
  document.getElementById('addCampaignBtn').addEventListener('click', () => openCampaignModal(null));

  const tbody = document.getElementById('campaignsTbody');
  if(!campaignsData.length){
    tbody.innerHTML = `<tr><td colspan="4" style="color:var(--muted); padding:16px 0;">No campaigns yet — add your first one above.</td></tr>`;
    return;
  }
  tbody.innerHTML = campaignsData.map((c, i) => `
    <tr>
      <td>${c.brandLogo
        ? `<img class="table-logo" src="${c.brandLogo}" onerror="this.style.background='#eee'">`
        : `<div class="brand-logo-fallback">${escapeHtml((c.brandName||'?').charAt(0).toUpperCase())}</div>`}</td>
      <td><b>${escapeHtml(c.brandName)}</b></td>
      <td style="color:var(--muted);">${escapeHtml(c.creatorName) || '—'}</td>
      <td class="table-actions">
        <button class="btn btn-ghost btn-sm" data-edit="${i}">Edit</button>
        <button class="btn btn-danger btn-sm" data-delete="${i}">Delete</button>
      </td>
    </tr>
  `).join('');
  tbody.querySelectorAll('[data-edit]').forEach(btn => btn.addEventListener('click', () => openCampaignModal(Number(btn.dataset.edit))));
  tbody.querySelectorAll('[data-delete]').forEach(btn => btn.addEventListener('click', () => deleteCampaign(Number(btn.dataset.delete))));
}

async function deleteCampaign(index){
  const c = campaignsData[index];
  if(!confirm(`Remove the "${c.brandName}" campaign?`)) return;
  campaignsData = campaignsData.filter((_, i) => i !== index);
  try {
    await api('/api/campaigns', { method: 'POST', body: JSON.stringify(campaignsData) });
    showToast('Campaign removed');
    renderCampaignsPage();
  } catch(err){
    showToast(err.message);
  }
}

function openCampaignModal(index){
  const existing = index !== null ? campaignsData[index] : null;
  document.getElementById('campaignModal').innerHTML = `
    <button class="modal-close" data-close>&times;</button>
    <h3>${existing ? 'Edit Campaign' : 'Add Campaign'}</h3>
    <p class="sub">Shown in the Campaigns section on the public site.</p>
    <form id="campaignForm">
      <div class="field"><label>Brand Name</label><input type="text" id="cBrandName" value="${escapeHtml(existing?.brandName)}" required></div>
      <div class="field"><label>Creator (optional)</label><input type="text" id="cCreatorName" value="${escapeHtml(existing?.creatorName)}"></div>
      <div class="field"><label>Objective</label><textarea id="cObjective" rows="2">${escapeHtml(existing?.objective)}</textarea></div>
      <div class="field"><label>Deliverables (comma-separated)</label><input type="text" id="cDeliverables" placeholder="e.g. 3 TikToks, 1 IG Reel, 2 Stories" value="${escapeHtml((existing?.deliverables || []).join(', '))}"></div>
      <div class="field"><label>Reach / Engagement</label>
        <div style="display:flex; gap:8px;">
          <input type="text" id="cReach" placeholder="e.g. 2.4M" value="${escapeHtml(existing?.reach)}">
          <input type="text" id="cEngagement" placeholder="e.g. 8.1%" value="${escapeHtml(existing?.engagement)}">
        </div>
      </div>
      <div class="field"><label>Results</label><textarea id="cResults" rows="2">${escapeHtml(existing?.results)}</textarea></div>
      <div class="field">
        <label>Brand Logo</label>
        ${existing?.brandLogo ? `<img class="table-logo" style="width:56px; height:56px; margin-bottom:8px;" src="${existing.brandLogo}">` : ''}
        <input type="file" id="cLogoFile" accept="image/*">
      </div>
      <div class="field">
        <label>Cover Image</label>
        ${existing?.coverImage ? `<img class="table-logo" style="width:56px; height:56px; margin-bottom:8px;" src="${existing.coverImage}">` : ''}
        <input type="file" id="cCoverFile" accept="image/*">
        <p style="font-size:11px; color:var(--muted); margin-top:4px;">Optional — without one, a generated avatar is used instead.</p>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-close>Cancel</button>
        <button type="submit" class="btn btn-primary" style="width:auto;">Save</button>
      </div>
    </form>
  `;
  const overlay = document.getElementById('campaignModalOverlay');
  overlay.classList.add('show');
  overlay.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', () => overlay.classList.remove('show')));

  document.getElementById('campaignForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      let brandLogo = existing?.brandLogo || '';
      const logoFile = document.getElementById('cLogoFile').files[0];
      if(logoFile) brandLogo = await uploadImage(logoFile);

      let coverImage = existing?.coverImage || '';
      const coverFile = document.getElementById('cCoverFile').files[0];
      if(coverFile) coverImage = await uploadImage(coverFile);

      const entry = {
        brandName: document.getElementById('cBrandName').value.trim(),
        creatorName: document.getElementById('cCreatorName').value.trim(),
        objective: document.getElementById('cObjective').value.trim(),
        deliverables: document.getElementById('cDeliverables').value.split(',').map(s => s.trim()).filter(Boolean),
        reach: document.getElementById('cReach').value.trim(),
        engagement: document.getElementById('cEngagement').value.trim(),
        results: document.getElementById('cResults').value.trim(),
        brandLogo,
        coverImage,
      };
      if(existing){ campaignsData[index] = entry; } else { campaignsData.push(entry); }
      await api('/api/campaigns', { method: 'POST', body: JSON.stringify(campaignsData) });
      overlay.classList.remove('show');
      showToast(existing ? 'Campaign updated' : 'Campaign added');
      renderCampaignsPage();
    } catch(err){
      showToast(err.message);
    } finally {
      submitBtn.disabled = false;
    }
  });
}

/* ============================================================
   PAGE: CONTACT RESPONSES
   ============================================================ */
function renderMessagesPage(){
  document.getElementById('page-messages').innerHTML = `
    <h1 class="page-title">Contact Responses</h1>
    <p class="page-sub">Everyone who's submitted the site's contact form.</p>

    <div class="panel">
      <div class="panel-head"><div><h2>Messages</h2><p>${messagesData.length} total</p></div></div>
      <div class="table-scroll">
      <table class="data-table">
        <thead><tr><th>Date</th><th>Name</th><th>Email</th><th>Talent</th><th>Message</th><th></th></tr></thead>
        <tbody id="messagesTbody"></tbody>
      </table>
      </div>
    </div>
  `;
  const tbody = document.getElementById('messagesTbody');
  if(!messagesData.length){
    tbody.innerHTML = `<tr><td colspan="6" style="color:var(--muted); padding:16px 0;">No messages yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = messagesData.map((m, i) => `
    <tr class="clickable-row" data-open="${i}">
      <td style="white-space:nowrap;">${new Date(m.receivedAt).toLocaleDateString()}</td>
      <td><b>${escapeHtml(m.name)}</b></td>
      <td>${escapeHtml(m.email)}</td>
      <td>${escapeHtml(m.talent) || '—'}</td>
      <td class="truncate">${escapeHtml(m.message)}</td>
      <td class="table-actions"><button class="btn btn-danger btn-sm" data-delete="${i}">Delete</button></td>
    </tr>
  `).join('');
  tbody.querySelectorAll('[data-open]').forEach(row => {
    row.addEventListener('click', () => openMessageModal(messagesData[Number(row.dataset.open)]));
  });
  // Delete buttons live inside a clickable row — stop the click from also
  // bubbling up and opening the modal.
  tbody.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteMessage(messagesData[Number(btn.dataset.delete)]);
    });
  });
}

async function deleteMessage(m){
  if(!m) return;
  if(!confirm(`Delete the message from "${m.name}"? This can't be undone.`)) return;
  try {
    const id = m.id || m._id;
    if(!id){ throw new Error('This message has no id — cannot delete it yet.'); }
    await api('/api/contact-messages/' + encodeURIComponent(id), { method: 'DELETE' });
    messagesData = messagesData.filter(x => (x.id || x._id) !== id);
    updateMessagesBadge();
    document.getElementById('messageModalOverlay').classList.remove('show');
    showToast('Message deleted');
    renderMessagesPage();
  } catch(err){
    showToast(err.message);
  }
}

function openMessageModal(m){
  document.getElementById('messageModal').innerHTML = `
    <button class="modal-close" data-close>&times;</button>
    <h3>${escapeHtml(m.name)}</h3>
    <p class="sub">${escapeHtml(m.email)} · ${new Date(m.receivedAt).toLocaleString()}${m.talent ? ' · Re: ' + escapeHtml(m.talent) : ''}</p>
    <p style="white-space:pre-wrap; line-height:1.5; font-size:14.5px;">${escapeHtml(m.message)}</p>
    <div class="modal-actions">
      <button type="button" class="btn btn-danger" style="width:auto; margin-right:auto;" data-delete-msg>Delete</button>
      <a class="btn btn-primary" style="width:auto; text-decoration:none;" href="${replyMailtoHref(m)}">Reply by Email</a>
    </div>
  `;
  const overlay = document.getElementById('messageModalOverlay');
  overlay.classList.add('show');
  overlay.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', () => overlay.classList.remove('show')));
  overlay.querySelector('[data-delete-msg]').addEventListener('click', () => deleteMessage(m));
}

// Builds a proper mailto: link. The previous version ran the whole address
// through encodeURIComponent(), which turns "@" into "%40" — most mail
// clients then fail to parse a recipient at all. Per RFC 6068 the address
// itself shouldn't be percent-encoded; only the query part (subject/body)
// should be.
function replyMailtoHref(m){
  const subject = 'Re: your message to BRXDGE' + (m.talent ? ` about ${m.talent}` : '');
  return `mailto:${m.email}?subject=${encodeURIComponent(subject)}`;
}

/* ============================================================
   PAGE: ADMIN PROFILE
   ============================================================ */
async function renderProfilePage(){
  try { adminsData = await api('/api/admins'); } catch(e){ adminsData = []; }

  document.getElementById('page-profile').innerHTML = `
    <h1 class="page-title">Admin Profile</h1>
    <p class="page-sub">Account settings, notes, and other admin logins.</p>

    <div class="panel">
      <div class="panel-head"><div><h2>Notes</h2><p>Private — only visible to you.</p></div></div>
      <form id="notesForm">
        <div class="field"><textarea id="notesInput" rows="5" placeholder="Anything worth remembering...">${escapeHtml(me.notes)}</textarea></div>
        <button type="submit" class="btn btn-primary" style="width:auto;">Save Notes</button>
      </form>
    </div>

    <div class="panel">
      <div class="panel-head"><div><h2>Change Password</h2></div></div>
      <form id="passwordForm">
        <div class="field-row">
          <div class="field"><label>Current Password</label><input type="password" id="currentPassword" required></div>
          <div class="field"><label>New Password</label><input type="password" id="newPassword" minlength="8" required></div>
        </div>
        <button type="submit" class="btn btn-primary" style="width:auto;">Update Password</button>
      </form>
    </div>

    <div class="panel">
      <div class="panel-head"><div><h2>Change Username</h2><p>Currently: <b>${escapeHtml(me.username)}</b></p></div></div>
      <form id="usernameForm">
        <div class="field-row">
          <div class="field"><label>New Username</label><input type="text" id="newUsername" required></div>
          <div class="field"><label>Current Password</label><input type="password" id="usernamePassword" required></div>
        </div>
        <button type="submit" class="btn btn-primary" style="width:auto;">Update Username</button>
      </form>
    </div>

    <div class="panel">
      <div class="panel-head">
        <div><h2>Other Admin Accounts</h2><p>Everyone with access to this dashboard.</p></div>
      </div>
      <div class="table-scroll" style="margin-bottom:18px;">
      <table class="data-table">
        <thead><tr><th>Username</th><th>Created</th><th></th></tr></thead>
        <tbody id="adminsTbody"></tbody>
      </table>
      </div>
      <form id="addAdminForm">
        <div class="field-row">
          <div class="field"><label>New Admin Username</label><input type="text" id="newAdminUsername" required></div>
          <div class="field"><label>Password</label><input type="password" id="newAdminPassword" minlength="8" required></div>
        </div>
        <button type="submit" class="btn btn-ghost">+ Add Admin</button>
      </form>
    </div>
  `;

  const tbody = document.getElementById('adminsTbody');
  tbody.innerHTML = adminsData.map(a => `
    <tr>
      <td><b>${escapeHtml(a.username)}</b>${a.username === me.username ? ' <span style="color:var(--muted); font-weight:400;">(you)</span>' : ''}</td>
      <td>${new Date(a.createdAt).toLocaleDateString()}</td>
      <td>${a.username === me.username ? '' : `<button class="btn btn-danger btn-sm" data-remove="${escapeHtml(a.username)}">Remove</button>`}</td>
    </tr>
  `).join('');
  tbody.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if(!confirm(`Remove admin "${btn.dataset.remove}"?`)) return;
      try {
        await api('/api/admins/' + encodeURIComponent(btn.dataset.remove), { method: 'DELETE' });
        showToast('Admin removed');
        renderProfilePage();
      } catch(err){ showToast(err.message); }
    });
  });

  document.getElementById('notesForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/me/notes', { method: 'POST', body: JSON.stringify({ notes: document.getElementById('notesInput').value }) });
      me.notes = document.getElementById('notesInput').value;
      showToast('Notes saved');
    } catch(err){ showToast(err.message); }
  });

  document.getElementById('passwordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/me/password', { method: 'POST', body: JSON.stringify({
        currentPassword: document.getElementById('currentPassword').value,
        newPassword: document.getElementById('newPassword').value,
      })});
      showToast('Password updated');
      e.target.reset();
    } catch(err){ showToast(err.message); }
  });

  document.getElementById('usernameForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const data = await api('/api/me/username', { method: 'POST', body: JSON.stringify({
        newUsername: document.getElementById('newUsername').value.trim(),
        currentPassword: document.getElementById('usernamePassword').value,
      })});
      me.username = data.username;
      document.getElementById('whoamiName').textContent = data.username;
      showToast('Username updated');
      renderProfilePage();
    } catch(err){ showToast(err.message); }
  });

  document.getElementById('addAdminForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/admins', { method: 'POST', body: JSON.stringify({
        username: document.getElementById('newAdminUsername').value.trim(),
        password: document.getElementById('newAdminPassword').value,
      })});
      showToast('Admin account created');
      renderProfilePage();
    } catch(err){ showToast(err.message); }
  });
}

/* ---------------- BOOT ---------------- */
(async function boot(){
  if(token){
    try { await enterDashboard(); } catch(e){ signOut(); }
  }
})();
