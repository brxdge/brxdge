/* =========================================================
   TALENT WIZARD — shared phase-by-phase "Add / Edit Talent" form.

   Used by BOTH the admin dashboard (admin.html/admin.js) and the public
   site's manager-facing "+ Add Talent" button (index.html/script.js).
   Before this file existed, each page had its OWN full copy of this form
   — same fields, same YouTube/TikTok fetch buttons, slowly drifting apart
   every time one got edited and the other didn't (the exact bug pattern
   config.js's header describes for the API URL). One shared implementation
   means there's nowhere left for the two to quietly disagree.

   Usage (see admin.js / script.js for the actual call sites):

     openTalentWizard({
       container,        // DOM element the wizard fully owns (innerHTML)
       existing,         // talent object being edited, or null to add new
       uploadImage,       // async (File) => url
       fetchYouTube,       // async (channelUrl, count) => { posts, stats }
       fetchTikTok,        // async (videoUrl) => { thumbnail_url, title }
       onSave,             // async (entry, isEditing) => void — persist + close
       onCancel,           // () => void
     });

   This module intentionally doesn't know about `rosterData` or how each
   host talks to the API — that stays host-specific. It only owns the
   step-by-step UI and produces one finished talent object on save.
========================================================= */
(function () {
  const PLATFORMS = ['Instagram', 'TikTok', 'YouTube', 'Twitter / X', 'Facebook', 'Snapchat', 'Twitch', 'LinkedIn', 'Pinterest', 'Threads', 'Other'];
  const NICHE_SUGGESTIONS = ['Lifestyle', 'Gaming', 'Comedy', 'Food', 'Music', 'Fashion', 'Fitness', 'Beauty', 'Travel', 'Tech', 'Parenting', 'Education'];
  const CONTENT_FORMAT_OPTIONS = ['Short-form video', 'Long-form video', 'UGC', 'Reels', 'Lifestyle', 'Product integration', 'Livestreams', 'Photography', 'Written content'];
  const AVAILABLE_FOR_GROUPS = [
    { group: 'Sponsored Content', items: ['TikTok videos', 'Instagram Reels', 'Instagram Stories', 'UGC', 'Product demonstrations', 'Testimonials', 'Lifestyle content', 'Unboxing'] },
    { group: 'Campaigns', items: ['Product launches', 'Brand awareness', 'Seasonal campaigns', 'Long-term ambassador'] },
    { group: 'Events', items: ['Appearances', 'Launch events', 'Meet & greets'] },
  ];
  const BOOKING_OPTIONS_LIST = ['TikTok Integration', 'Instagram Reel', 'Instagram Story', 'UGC Package', 'Multi-platform Campaign', 'Brand Ambassador', 'Event Appearance'];
  const GALLERY_CATEGORIES = ['Lifestyle', 'Fashion', 'Fitness', 'Branded', 'UGC', 'Other'];
  const WHY_CARD_DEFAULTS = [
    { title: 'High Engagement', description: '' },
    { title: 'Authentic Content', description: '' },
    { title: 'Youth Reach', description: '' },
    { title: 'Brand Friendly', description: '' },
  ];

  function esc(str) {
    return (typeof window.escapeHtml === 'function') ? window.escapeHtml(str) : String(str == null ? '' : str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  let uidCounter = 0;
  function uid() { uidCounter += 1; return 'tw' + uidCounter; }

  // Shared with script.js's media kit renderer so the public "What They Can
  // Book" section groups availableFor/bookingOptions exactly the way this
  // wizard collected them — one taxonomy, not two copies that could drift.
  window.TALENT_TAXONOMY = {
    PLATFORMS, CONTENT_FORMAT_OPTIONS, AVAILABLE_FOR_GROUPS, BOOKING_OPTIONS_LIST, GALLERY_CATEGORIES,
  };

  window.openTalentWizard = function (opts) {
    const container = opts.container;
    const existing = opts.existing || null;

    // ---- state (mutated in place by each step; nothing is re-read from
    // the DOM at save time except plain text/select inputs, which write
    // straight into this object via oninput/onchange) ----
    const state = {
      name: existing?.name || '',
      niche: existing?.niche || '',
      gender: existing?.gender || '',
      location: existing?.location || '',
      // Private contact info — never sent to logged-out visitors (see the
      // GET /api/roster stripping in talent-backend/index.js). Its one job
      // right now is letting a Brand Report creator entry be matched back
      // to this talent's real analytics by email instead of by name.
      email: existing?.email || '',
      bio: existing?.bio || '',
      photo: existing?.photo || '',
      coverPhoto: existing?.coverPhoto || '',
      _photoFile: null,
      _coverFile: null,
      contentFormats: [...(existing?.contentFormats || [])],
      audienceAgeRange: existing?.audienceAgeRange || '',
      audienceGenderMale: existing?.audienceGenderMale || '',
      audienceGenderFemale: existing?.audienceGenderFemale || '',
      audienceAgeBreakdown: (existing?.audienceAgeBreakdown || []).map(r => ({ ...r })),
      audienceTopLocations: (existing?.audienceTopLocations || []).map(r => ({ ...r })),
      audienceInterests: (existing?.audienceInterests || []).map(r => ({ ...r })),
      whyCards: existing?.whyCards?.length ? existing.whyCards.map(c => ({ ...c })) : WHY_CARD_DEFAULTS.map(c => ({ ...c })),
      availableFor: [...(existing?.availableFor || [])],
      bookingOptions: [...(existing?.bookingOptions || [])],
      socials: (existing?.socials || []).map(s => ({ ...s, posts: s.posts ? [...s.posts] : [] })),
      gallery: (existing?.gallery || []).map(g => ({ ...g })),
      testimonials: (existing?.testimonials || []).map(t => ({ ...t })),
    };
    if (!state.socials.length) state.socials.push({ platform: 'Instagram', url: '', followers: '', posts: [] });

    let stepIndex = 0;

    const STEPS = [
      { key: 'basics', label: 'Basics', render: renderBasics },
      { key: 'snapshot', label: 'Creator Snapshot', render: renderSnapshot },
      { key: 'audience', label: 'Audience Analytics', render: renderAudience },
      { key: 'why', label: `Why ${state.name ? esc(state.name.split(' ')[0]) : 'This Talent'}?`, render: renderWhy, dynamicLabel: true },
      { key: 'booking', label: 'What They Can Book', render: renderBooking },
      { key: 'socials', label: 'Social Platforms', render: renderSocials },
      { key: 'portfolio', label: 'Content Portfolio', render: renderPortfolio },
      { key: 'testimonials', label: 'Client Feedback', render: renderTestimonials },
    ];

    container.innerHTML = `
      <div class="tw-wizard">
        <button type="button" class="tw-close" data-tw-cancel aria-label="Close">&times;</button>
        <div class="tw-head">
          <h3>${existing ? 'Edit Talent' : 'Add Talent'}</h3>
          <p class="tw-sub">${existing ? esc(existing.name) : 'Build this creator’s media kit, phase by phase.'}</p>
        </div>
        <div class="tw-progress" id="twProgress"></div>
        <div class="tw-body" id="twBody"></div>
        <div class="tw-nav">
          <button type="button" class="tw-btn tw-btn-ghost" id="twBack">Back</button>
          <div class="tw-nav-right">
            <button type="button" class="tw-btn tw-btn-ghost" data-tw-cancel>Cancel</button>
            <button type="button" class="tw-btn tw-btn-primary" id="twNext">Next</button>
          </div>
        </div>
      </div>
    `;

    container.querySelectorAll('[data-tw-cancel]').forEach(el => el.addEventListener('click', () => {
      if (typeof opts.onCancel === 'function') opts.onCancel();
    }));

    const bodyEl = container.querySelector('#twBody');
    const progressEl = container.querySelector('#twProgress');
    const backBtn = container.querySelector('#twBack');
    const nextBtn = container.querySelector('#twNext');

    backBtn.addEventListener('click', () => { if (stepIndex > 0) { stepIndex -= 1; renderStep(); } });
    nextBtn.addEventListener('click', async () => {
      if (stepIndex === 0 && !state.name.trim()) {
        showFieldError('twName', 'This talent needs a name before you can continue.');
        return;
      }
      if (stepIndex < STEPS.length - 1) {
        stepIndex += 1;
        renderStep();
      } else {
        await saveWizard();
      }
    });

    function showFieldError(id, msg) {
      const el = document.getElementById(id);
      if (el) { el.focus(); el.classList.add('tw-invalid'); }
      if (typeof window.showToast === 'function') window.showToast(msg);
    }

    function renderProgress() {
      progressEl.innerHTML = STEPS.map((s, i) => `
        <div class="tw-progress-step ${i === stepIndex ? 'tw-active' : ''} ${i < stepIndex ? 'tw-done' : ''}">
          <span class="tw-progress-dot">${i < stepIndex ? '✓' : i + 1}</span>
          <span class="tw-progress-label">${s.dynamicLabel ? `Why ${state.name.trim().split(' ')[0] || 'This Talent'}?` : s.label}</span>
        </div>
      `).join('');
    }

    function renderStep() {
      renderProgress();
      bodyEl.innerHTML = '';
      bodyEl.scrollTop = 0;
      STEPS[stepIndex].render(bodyEl);
      backBtn.style.visibility = stepIndex === 0 ? 'hidden' : 'visible';
      nextBtn.textContent = stepIndex === STEPS.length - 1 ? (existing ? 'Save Changes' : 'Add Talent') : 'Next';
    }

    // ---------------- STEP 1: BASICS ----------------
    function renderBasics(root) {
      root.innerHTML = `
        <p class="tw-step-intro">The essentials — this is what appears first on the roster card and the top of the media kit.</p>
        <div class="tw-field-row">
          <div class="tw-field"><label>Name</label><input type="text" id="twName" value="${esc(state.name)}" placeholder="e.g. Kobe Alvarez"></div>
          <div class="tw-field"><label>Niche</label><input type="text" id="twNiche" list="twNicheList" value="${esc(state.niche)}" placeholder="e.g. Lifestyle / Fitness">
            <datalist id="twNicheList">${NICHE_SUGGESTIONS.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
          </div>
        </div>
        <div class="tw-field-row">
          <div class="tw-field"><label>Gender</label>
            <select id="twGender">
              <option value="">— Not set —</option>
              <option value="Male" ${state.gender === 'Male' ? 'selected' : ''}>Male</option>
              <option value="Female" ${state.gender === 'Female' ? 'selected' : ''}>Female</option>
            </select>
          </div>
          <div class="tw-field"><label>Location</label><input type="text" id="twLocation" value="${esc(state.location)}" placeholder="e.g. Philippines"></div>
        </div>
        <div class="tw-field"><label>Email <span class="tw-optional">(private — used to match this talent to their real analytics on Brand Reports)</span></label><input type="email" id="twEmail" value="${esc(state.email)}" placeholder="e.g. kobe@example.com"></div>
        <div class="tw-field"><label>Bio</label><textarea id="twBio" rows="3" placeholder="One or two sentences on who they are and what they make.">${esc(state.bio)}</textarea></div>
        <div class="tw-field-row">
          <div class="tw-field"><label>Profile Photo</label>
            <input type="file" id="twPhotoFile" accept="image/*">
            ${state.photo ? `<img class="tw-photo-preview" src="${esc(state.photo)}" alt="">` : ''}
          </div>
          <div class="tw-field"><label>Cover Photo (media kit hero)</label>
            <input type="file" id="twCoverFile" accept="image/*">
            ${state.coverPhoto ? `<img class="tw-photo-preview" src="${esc(state.coverPhoto)}" alt="">` : ''}
            <p class="tw-hint">Optional — falls back to the profile photo if left blank.</p>
          </div>
        </div>
      `;
      root.querySelector('#twName').addEventListener('input', e => { state.name = e.target.value; e.target.classList.remove('tw-invalid'); });
      root.querySelector('#twNiche').addEventListener('input', e => state.niche = e.target.value);
      root.querySelector('#twGender').addEventListener('change', e => state.gender = e.target.value);
      root.querySelector('#twLocation').addEventListener('input', e => state.location = e.target.value);
      root.querySelector('#twEmail').addEventListener('input', e => state.email = e.target.value);
      root.querySelector('#twBio').addEventListener('input', e => state.bio = e.target.value);
      root.querySelector('#twPhotoFile').addEventListener('change', e => { if (e.target.files[0]) state._photoFile = e.target.files[0]; });
      root.querySelector('#twCoverFile').addEventListener('change', e => { if (e.target.files[0]) state._coverFile = e.target.files[0]; });
    }

    // ---------------- STEP 2: CREATOR SNAPSHOT ----------------
    function renderSnapshot(root) {
      const platformNames = [...new Set(state.socials.map(s => s.platform).filter(Boolean))];
      root.innerHTML = `
        <p class="tw-step-intro">The at-a-glance card shown right under the media kit's hero image — lets a brand manager tell in five seconds if this creator fits their campaign.</p>
        <div class="tw-field">
          <label>Content Formats</label>
          <div class="tw-chip-grid" id="twContentFormats">
            ${CONTENT_FORMAT_OPTIONS.map(opt => `
              <label class="tw-chip"><input type="checkbox" value="${esc(opt)}" ${state.contentFormats.includes(opt) ? 'checked' : ''}><span>${esc(opt)}</span></label>
            `).join('')}
          </div>
          <input type="text" id="twContentFormatsCustom" placeholder="Add a custom format and press Enter" class="tw-custom-input">
        </div>
        <div class="tw-field">
          <label>Audience Age Range <span class="tw-optional">(shown as a single range here — the full breakdown is next)</span></label>
          <input type="text" id="twAudienceAgeRange" value="${esc(state.audienceAgeRange)}" placeholder="e.g. 18–34">
        </div>
        <div class="tw-field">
          <label>Platforms <span class="tw-optional">(pulled automatically from the Social Platforms step)</span></label>
          <div class="tw-readonly-chips">${platformNames.length ? platformNames.map(p => `<span class="tw-chip-static">${esc(p)}</span>`).join('') : '<span class="tw-hint">No platforms added yet.</span>'}</div>
        </div>
      `;
      root.querySelectorAll('#twContentFormats input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', () => {
          state.contentFormats = Array.from(root.querySelectorAll('#twContentFormats input:checked')).map(i => i.value)
            .concat(state.contentFormats.filter(c => !CONTENT_FORMAT_OPTIONS.includes(c)));
        });
      });
      root.querySelector('#twContentFormatsCustom').addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const val = e.target.value.trim();
          if (val && !state.contentFormats.includes(val)) { state.contentFormats.push(val); renderSnapshot(root); }
          e.target.value = '';
        }
      });
      root.querySelector('#twAudienceAgeRange').addEventListener('input', e => state.audienceAgeRange = e.target.value);
    }

    // ---------------- STEP 3: AUDIENCE ANALYTICS ----------------
    function renderAudience(root) {
      root.innerHTML = `
        <p class="tw-step-intro">This is what turns "125K followers" into "reaches exactly the audience we're trying to reach." Manually entered — pull these from each platform's own analytics.</p>
        <div class="tw-field-row">
          <div class="tw-field"><label>Audience — Male %</label><input type="number" min="0" max="100" id="twAudMale" value="${esc(state.audienceGenderMale)}" placeholder="e.g. 68"></div>
          <div class="tw-field"><label>Audience — Female %</label><input type="number" min="0" max="100" id="twAudFemale" value="${esc(state.audienceGenderFemale)}" placeholder="e.g. 32"></div>
        </div>

        <div class="tw-field"><label>Age Breakdown</label><div class="tw-rows" id="twAgeRows"></div>
          <button type="button" class="tw-add-row" data-add="age">+ Add age range</button>
        </div>
        <div class="tw-field"><label>Top Locations <span class="tw-optional">(first one is the headline stat)</span></label><div class="tw-rows" id="twLocRows"></div>
          <button type="button" class="tw-add-row" data-add="loc">+ Add location</button>
        </div>
        <div class="tw-field"><label>Top Audience Interests</label><div class="tw-rows" id="twIntRows"></div>
          <button type="button" class="tw-add-row" data-add="int">+ Add interest</button>
        </div>
      `;
      root.querySelector('#twAudMale').addEventListener('input', e => state.audienceGenderMale = e.target.value);
      root.querySelector('#twAudFemale').addEventListener('input', e => state.audienceGenderFemale = e.target.value);

      function renderRows(containerEl, arr, fields, placeholders) {
        containerEl.innerHTML = arr.map((row, i) => `
          <div class="tw-row" data-i="${i}">
            <input type="text" class="tw-row-a" value="${esc(row[fields[0]])}" placeholder="${placeholders[0]}">
            <input type="number" min="0" max="100" class="tw-row-b" value="${esc(row[fields[1]])}" placeholder="${placeholders[1]}">
            <button type="button" class="tw-row-remove" data-i="${i}">&times;</button>
          </div>
        `).join('');
        containerEl.querySelectorAll('.tw-row').forEach(rowEl => {
          const i = Number(rowEl.dataset.i);
          rowEl.querySelector('.tw-row-a').addEventListener('input', e => arr[i][fields[0]] = e.target.value);
          rowEl.querySelector('.tw-row-b').addEventListener('input', e => arr[i][fields[1]] = e.target.value);
        });
        containerEl.querySelectorAll('.tw-row-remove').forEach(btn => btn.addEventListener('click', () => {
          arr.splice(Number(btn.dataset.i), 1);
          renderRows(containerEl, arr, fields, placeholders);
        }));
      }

      const ageRowsEl = root.querySelector('#twAgeRows');
      const locRowsEl = root.querySelector('#twLocRows');
      const intRowsEl = root.querySelector('#twIntRows');
      renderRows(ageRowsEl, state.audienceAgeBreakdown, ['range', 'pct'], ['Range e.g. 18-24', '% e.g. 42']);
      renderRows(locRowsEl, state.audienceTopLocations, ['location', 'pct'], ['Location e.g. Philippines', '% e.g. 78']);
      renderRows(intRowsEl, state.audienceInterests, ['interest', 'pct'], ['Interest e.g. Fitness', '% e.g. 80']);

      root.querySelector('[data-add="age"]').addEventListener('click', () => { state.audienceAgeBreakdown.push({ range: '', pct: '' }); renderRows(ageRowsEl, state.audienceAgeBreakdown, ['range', 'pct'], ['Range e.g. 18-24', '% e.g. 42']); });
      root.querySelector('[data-add="loc"]').addEventListener('click', () => { state.audienceTopLocations.push({ location: '', pct: '' }); renderRows(locRowsEl, state.audienceTopLocations, ['location', 'pct'], ['Location e.g. Philippines', '% e.g. 78']); });
      root.querySelector('[data-add="int"]').addEventListener('click', () => { state.audienceInterests.push({ interest: '', pct: '' }); renderRows(intRowsEl, state.audienceInterests, ['interest', 'pct'], ['Interest e.g. Fitness', '% e.g. 80']); });
    }

    // ---------------- STEP 4: WHY [NAME]? ----------------
    function renderWhy(root) {
      const firstName = (state.name.trim().split(' ')[0]) || 'This Talent';
      root.innerHTML = `
        <p class="tw-step-intro">Don't make the brand manager figure out why they should hire ${esc(firstName)} — tell them. 3–4 short cards, this is the sales pitch.</p>
        <div class="tw-rows tw-why-rows" id="twWhyRows"></div>
        <button type="button" class="tw-add-row" id="twWhyAdd">+ Add a card</button>
      `;
      const whyRowsEl = root.querySelector('#twWhyRows');
      function render() {
        whyRowsEl.innerHTML = state.whyCards.map((c, i) => `
          <div class="tw-why-row" data-i="${i}">
            <input type="text" class="tw-why-title" value="${esc(c.title)}" placeholder="Card title e.g. High Engagement">
            <textarea class="tw-why-desc" rows="2" placeholder="One or two sentences making the case.">${esc(c.description)}</textarea>
            <button type="button" class="tw-row-remove" data-i="${i}">&times;</button>
          </div>
        `).join('');
        whyRowsEl.querySelectorAll('.tw-why-row').forEach(rowEl => {
          const i = Number(rowEl.dataset.i);
          rowEl.querySelector('.tw-why-title').addEventListener('input', e => state.whyCards[i].title = e.target.value);
          rowEl.querySelector('.tw-why-desc').addEventListener('input', e => state.whyCards[i].description = e.target.value);
        });
        whyRowsEl.querySelectorAll('.tw-row-remove').forEach(btn => btn.addEventListener('click', () => { state.whyCards.splice(Number(btn.dataset.i), 1); render(); }));
      }
      render();
      root.querySelector('#twWhyAdd').addEventListener('click', () => { state.whyCards.push({ title: '', description: '' }); render(); });
    }

    // ---------------- STEP 5: WHAT THEY CAN BOOK ----------------
    function renderBooking(root) {
      const customAvailable = state.availableFor.filter(a => !AVAILABLE_FOR_GROUPS.some(g => g.items.includes(a)));
      root.innerHTML = `
        <p class="tw-step-intro">Don't make brands guess what's on offer — spell it out. Prices stay off the page; the CTA is "Request Campaign Pricing".</p>
        <div class="tw-field"><label>Available For</label>
          ${AVAILABLE_FOR_GROUPS.map(g => `
            <p class="tw-group-label">${esc(g.group)}</p>
            <div class="tw-chip-grid">
              ${g.items.map(item => `<label class="tw-chip"><input type="checkbox" value="${esc(item)}" ${state.availableFor.includes(item) ? 'checked' : ''}><span>${esc(item)}</span></label>`).join('')}
            </div>
          `).join('')}
          <input type="text" id="twAvailCustom" class="tw-custom-input" placeholder="Add something else and press Enter" value="">
          <div class="tw-readonly-chips" id="twAvailCustomChips">${customAvailable.map(c => `<span class="tw-chip-static tw-removable" data-val="${esc(c)}">${esc(c)} &times;</span>`).join('')}</div>
        </div>
        <div class="tw-field"><label>Booking Options <span class="tw-optional">(the packages shown under "Request Campaign Pricing")</span></label>
          <div class="tw-chip-grid">
            ${BOOKING_OPTIONS_LIST.map(opt => `<label class="tw-chip"><input type="checkbox" value="${esc(opt)}" ${state.bookingOptions.includes(opt) ? 'checked' : ''}><span>${esc(opt)}</span></label>`).join('')}
          </div>
        </div>
      `;
      function syncAvailableFor() {
        const checked = Array.from(root.querySelectorAll('.tw-chip-grid input:checked')).map(i => i.value)
          .filter(v => AVAILABLE_FOR_GROUPS.some(g => g.items.includes(v)));
        const custom = state.availableFor.filter(a => !AVAILABLE_FOR_GROUPS.some(g => g.items.includes(a)));
        state.availableFor = [...checked, ...custom];
      }
      root.querySelectorAll('.tw-chip-grid input[type="checkbox"]').forEach(cb => {
        // Distinguish "Available For" checkboxes from "Booking Options" ones by their parent field.
        const isBooking = BOOKING_OPTIONS_LIST.includes(cb.value);
        cb.addEventListener('change', () => {
          if (isBooking) {
            state.bookingOptions = Array.from(root.querySelectorAll('.tw-chip-grid input:checked')).map(i => i.value).filter(v => BOOKING_OPTIONS_LIST.includes(v));
          } else {
            syncAvailableFor();
          }
        });
      });
      root.querySelector('#twAvailCustom').addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const val = e.target.value.trim();
          if (val && !state.availableFor.includes(val)) { state.availableFor.push(val); renderBooking(root); }
          e.target.value = '';
        }
      });
      root.querySelectorAll('.tw-removable').forEach(chip => chip.addEventListener('click', () => {
        state.availableFor = state.availableFor.filter(a => a !== chip.dataset.val);
        renderBooking(root);
      }));
    }

    // ---------------- STEP 6: SOCIAL PLATFORMS ----------------
    function renderSocials(root) {
      root.innerHTML = `<div class="tw-rows" id="twSocialRows"></div><button type="button" class="tw-add-row" id="twSocialAdd">+ Add Platform</button>`;
      const listEl = root.querySelector('#twSocialRows');

      function statsFieldsHTML(s) {
        const stats = s.stats || {};
        return `
          <p class="tw-hint" style="margin-top:10px;">Stats shown on "View statistics" (optional):</p>
          <div class="tw-field-row">
            <input type="text" class="tw-stat-avgviews" placeholder="Avg. views e.g. 850K" value="${esc(stats.avgViews)}">
            <input type="text" class="tw-stat-avglikes" placeholder="Avg. likes e.g. 62K" value="${esc(stats.avgLikes)}">
          </div>
          <div class="tw-field-row">
            <input type="text" class="tw-stat-engagement" placeholder="Engagement rate e.g. 7.2%" value="${esc(stats.engagementRate)}">
            <input type="text" class="tw-stat-growth" placeholder="Growth (30d) e.g. +4.1%" value="${esc(stats.growth)}">
          </div>
        `;
      }

      function render() {
        listEl.innerHTML = state.socials.map((s, i) => `
          <div class="tw-social-row" data-i="${i}">
            <div class="tw-field-row">
              <select class="tw-s-platform">${PLATFORMS.map(p => `<option value="${esc(p)}" ${s.platform === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select>
              <input type="text" class="tw-s-followers" placeholder="Followers e.g. 1.2M" value="${esc(s.followers)}">
              <input type="url" class="tw-s-url" placeholder="Profile URL" value="${esc(s.url)}">
              <button type="button" class="tw-row-remove" data-i="${i}">&times;</button>
            </div>
            <div class="tw-social-extra" data-i="${i}"></div>
          </div>
        `).join('');

        listEl.querySelectorAll('.tw-social-row').forEach(rowEl => {
          const i = Number(rowEl.dataset.i);
          const s = state.socials[i];
          rowEl.querySelector('.tw-s-platform').addEventListener('change', e => { s.platform = e.target.value; s.posts = []; renderExtra(i); });
          rowEl.querySelector('.tw-s-followers').addEventListener('input', e => s.followers = e.target.value);
          rowEl.querySelector('.tw-s-url').addEventListener('input', e => s.url = e.target.value);
          renderExtra(i);
        });
        listEl.querySelectorAll('.tw-row-remove').forEach(btn => btn.addEventListener('click', () => { state.socials.splice(Number(btn.dataset.i), 1); render(); }));
      }

      function renderExtra(i) {
        const s = state.socials[i];
        const extra = listEl.querySelector(`.tw-social-extra[data-i="${i}"]`);
        if (!extra) return;
        if (s.platform === 'YouTube') {
          extra.innerHTML = `<button type="button" class="tw-fetch-btn" data-action="fetch-yt">↻ Fetch latest 4 videos</button><div class="tw-post-thumbs"></div>${statsFieldsHTML(s)}`;
          renderPostThumbs(extra, s);
          bindStatFields(extra, s);
          extra.querySelector('[data-action="fetch-yt"]').addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            if (!s.url.trim()) { if (window.showToast) window.showToast('Enter the YouTube channel URL first'); return; }
            const label = btn.textContent; btn.disabled = true; btn.textContent = 'Fetching…';
            try {
              const result = await opts.fetchYouTube(s.url.trim(), 4);
              s.posts = result.posts || [];
              renderPostThumbs(extra, s);
              if (result.stats) {
                const setIfEmpty = (sel, val) => { const el = extra.querySelector(sel); if (el && !el.value.trim() && val) el.value = val; };
                setIfEmpty('.tw-stat-avgviews', result.stats.avgViews);
                setIfEmpty('.tw-stat-avglikes', result.stats.avgLikes);
                setIfEmpty('.tw-stat-engagement', result.stats.engagementRate);
                s.stats = s.stats || {};
                s.stats.avgViews = extra.querySelector('.tw-stat-avgviews').value.trim();
                s.stats.avgLikes = extra.querySelector('.tw-stat-avglikes').value.trim();
                s.stats.engagementRate = extra.querySelector('.tw-stat-engagement').value.trim();
              }
              if (window.showToast) window.showToast('Latest videos fetched');
            } catch (err) {
              if (window.showToast) window.showToast('Could not fetch latest videos — check the channel URL');
            } finally { btn.disabled = false; btn.textContent = label; }
          });
        } else if (s.platform === 'TikTok') {
          extra.innerHTML = `
            <p class="tw-hint">TikTok doesn't allow auto-fetching a profile's posts — paste up to 4 video links:</p>
            ${[0, 1, 2, 3].map(n => `<input type="url" class="tw-tt-video" data-n="${n}" placeholder="TikTok video URL ${n + 1}" value="${esc(s.posts?.[n]?.sourceUrl)}">`).join('')}
            <button type="button" class="tw-fetch-btn" data-action="fetch-tt">↻ Preview these videos</button>
            <div class="tw-post-thumbs"></div>${statsFieldsHTML(s)}
          `;
          renderPostThumbs(extra, s);
          bindStatFields(extra, s);
          extra.querySelector('[data-action="fetch-tt"]').addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            const urls = Array.from(extra.querySelectorAll('.tw-tt-video')).map(inp => inp.value.trim()).filter(Boolean);
            if (!urls.length) { if (window.showToast) window.showToast('Paste at least one TikTok video URL'); return; }
            const label = btn.textContent; btn.disabled = true; btn.textContent = 'Fetching…';
            try {
              const fetched = [];
              for (const url of urls) {
                const info = await opts.fetchTikTok(url);
                fetched.push({ thumbnail: info.thumbnail_url, title: info.title || '', link: url, sourceUrl: url });
              }
              s.posts = fetched;
              renderPostThumbs(extra, s);
              if (window.showToast) window.showToast('Video previews fetched');
            } catch (err) {
              if (window.showToast) window.showToast('Could not preview one or more videos — check the links');
            } finally { btn.disabled = false; btn.textContent = label; }
          });
        } else {
          extra.innerHTML = '';
          s.posts = [];
        }
      }

      function bindStatFields(extra, s) {
        const avgViews = extra.querySelector('.tw-stat-avgviews');
        if (!avgViews) return;
        s.stats = s.stats || {};
        const sync = () => {
          s.stats = {
            avgViews: extra.querySelector('.tw-stat-avgviews').value.trim(),
            avgLikes: extra.querySelector('.tw-stat-avglikes').value.trim(),
            engagementRate: extra.querySelector('.tw-stat-engagement').value.trim(),
            growth: extra.querySelector('.tw-stat-growth').value.trim(),
          };
        };
        ['.tw-stat-avgviews', '.tw-stat-avglikes', '.tw-stat-engagement', '.tw-stat-growth'].forEach(sel => extra.querySelector(sel).addEventListener('input', sync));
      }

      function renderPostThumbs(extra, s) {
        const el = extra.querySelector('.tw-post-thumbs');
        if (!el) return;
        el.innerHTML = (s.posts || []).map(p => `<a class="tw-post-thumb" href="${esc(p.link)}" target="_blank" rel="noopener" title="${esc(p.title)}"><img src="${esc(p.thumbnail)}" alt=""></a>`).join('');
      }

      render();
      root.querySelector('#twSocialAdd').addEventListener('click', () => { state.socials.push({ platform: 'Instagram', url: '', followers: '', posts: [] }); render(); });
    }

    // ---------------- STEP 7: CONTENT PORTFOLIO ----------------
    function renderPortfolio(root) {
      root.innerHTML = `
        <p class="tw-step-intro">Organize the gallery into categories instead of a pile of random photos — this powers the filterable portfolio on the media kit. Images and videos both work.</p>
        <div class="tw-field"><label>Upload Photos / Videos</label><input type="file" id="twGalleryFiles" accept="image/*,video/*" multiple></div>
        <div class="tw-field">
          <label>Or add a hosted video/image URL</label>
          <div class="tw-field-row">
            <input type="url" id="twGalleryUrl" placeholder="https://...">
            <select id="twGalleryUrlType"><option value="image">Image</option><option value="video">Video</option></select>
            <select id="twGalleryUrlCat">${GALLERY_CATEGORIES.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select>
            <button type="button" class="tw-btn tw-btn-ghost" id="twGalleryUrlAdd" style="width:auto;">Add</button>
          </div>
        </div>
        <div class="tw-gallery-grid" id="twGalleryGrid"></div>
      `;
      const gridEl = root.querySelector('#twGalleryGrid');

      function render() {
        gridEl.innerHTML = state.gallery.map((g, i) => {
          const previewSrc = g._localPreview || g.url;
          const media = g.mediaType === 'video'
            ? (previewSrc ? `<video src="${esc(previewSrc)}" muted></video>` : `<div class="tw-gallery-placeholder">Video</div>`)
            : (previewSrc ? `<img src="${esc(previewSrc)}" alt="">` : `<div class="tw-gallery-placeholder">Image</div>`);
          return `
            <div class="tw-gallery-card" data-i="${i}">
              <div class="tw-gallery-thumb">${media}</div>
              <select class="tw-gallery-cat" data-i="${i}">
                <option value="">Uncategorized</option>
                ${GALLERY_CATEGORIES.map(c => `<option value="${esc(c)}" ${g.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
              </select>
              <button type="button" class="tw-row-remove" data-i="${i}">&times;</button>
            </div>
          `;
        }).join('') || `<p class="tw-hint">No portfolio items yet.</p>`;

        gridEl.querySelectorAll('.tw-gallery-cat').forEach(sel => sel.addEventListener('change', e => { state.gallery[Number(e.target.dataset.i)].category = e.target.value; }));
        gridEl.querySelectorAll('.tw-row-remove').forEach(btn => btn.addEventListener('click', () => { state.gallery.splice(Number(btn.dataset.i), 1); render(); }));
      }
      render();

      root.querySelector('#twGalleryFiles').addEventListener('change', e => {
        Array.from(e.target.files || []).forEach(file => {
          state.gallery.push({
            url: '', category: '', mediaType: file.type.startsWith('video') ? 'video' : 'image',
            _file: file, _localPreview: URL.createObjectURL(file),
          });
        });
        e.target.value = '';
        render();
      });
      root.querySelector('#twGalleryUrlAdd').addEventListener('click', () => {
        const url = root.querySelector('#twGalleryUrl').value.trim();
        if (!url) { if (window.showToast) window.showToast('Paste a URL first'); return; }
        state.gallery.push({ url, category: root.querySelector('#twGalleryUrlCat').value, mediaType: root.querySelector('#twGalleryUrlType').value });
        root.querySelector('#twGalleryUrl').value = '';
        render();
      });
    }

    // ---------------- STEP 8: CLIENT FEEDBACK ----------------
    function renderTestimonials(root) {
      root.innerHTML = `
        <p class="tw-step-intro">Optional — add a quote from a brand this talent has worked with. This section is skipped on the media kit entirely if left empty.</p>
        <div class="tw-rows" id="twTestiRows"></div>
        <button type="button" class="tw-add-row" id="twTestiAdd">+ Add a quote</button>
      `;
      const listEl = root.querySelector('#twTestiRows');
      function render() {
        listEl.innerHTML = state.testimonials.map((t, i) => `
          <div class="tw-testi-row" data-i="${i}">
            <textarea class="tw-testi-quote" rows="2" placeholder="The quote itself">${esc(t.quote)}</textarea>
            <div class="tw-field-row">
              <input type="text" class="tw-testi-author" placeholder="Author name" value="${esc(t.author)}">
              <input type="text" class="tw-testi-role" placeholder="Role, Company" value="${esc(t.role)}">
            </div>
            <button type="button" class="tw-row-remove" data-i="${i}">&times;</button>
          </div>
        `).join('');
        listEl.querySelectorAll('.tw-testi-row').forEach(rowEl => {
          const i = Number(rowEl.dataset.i);
          rowEl.querySelector('.tw-testi-quote').addEventListener('input', e => state.testimonials[i].quote = e.target.value);
          rowEl.querySelector('.tw-testi-author').addEventListener('input', e => state.testimonials[i].author = e.target.value);
          rowEl.querySelector('.tw-testi-role').addEventListener('input', e => state.testimonials[i].role = e.target.value);
        });
        listEl.querySelectorAll('.tw-row-remove').forEach(btn => btn.addEventListener('click', () => { state.testimonials.splice(Number(btn.dataset.i), 1); render(); }));
      }
      render();
      root.querySelector('#twTestiAdd').addEventListener('click', () => { state.testimonials.push({ quote: '', author: '', role: '' }); render(); });
    }

    // ---------------- SAVE ----------------
    async function saveWizard() {
      nextBtn.disabled = true;
      const originalLabel = nextBtn.textContent;
      nextBtn.textContent = 'Saving…';
      try {
        if (state._photoFile) state.photo = await opts.uploadImage(state._photoFile);
        if (state._coverFile) state.coverPhoto = await opts.uploadImage(state._coverFile);
        for (const g of state.gallery) {
          if (g._file) {
            try { g.url = await opts.uploadImage(g._file); }
            catch (err) { if (window.showToast) window.showToast('One or more portfolio files failed to upload.'); }
          }
        }
        const gallery = state.gallery.filter(g => g.url).map(g => ({ url: g.url, category: g.category || '', mediaType: g.mediaType || 'image' }));
        const testimonials = state.testimonials.filter(t => t.quote && t.quote.trim()).map(t => ({ quote: t.quote.trim(), author: t.author || '', role: t.role || '', logo: t.logo || '' }));
        const socials = state.socials.filter(s => s.url || s.followers).map(s => ({
          platform: s.platform, url: s.url || '', followers: s.followers || '', posts: s.posts || [],
          ...(s.stats && (s.stats.avgViews || s.stats.avgLikes || s.stats.engagementRate || s.stats.growth) ? { stats: s.stats } : {}),
        }));
        const entry = {
          id: existing ? existing.id : ('t' + Date.now()),
          name: state.name.trim(),
          niche: state.niche.trim(),
          gender: state.gender,
          location: state.location.trim(),
          email: state.email.trim(),
          bio: state.bio.trim(),
          photo: state.photo,
          coverPhoto: state.coverPhoto,
          contentFormats: state.contentFormats,
          audienceAgeRange: state.audienceAgeRange.trim(),
          audienceGenderMale: String(state.audienceGenderMale || '').trim(),
          audienceGenderFemale: String(state.audienceGenderFemale || '').trim(),
          audienceAgeBreakdown: state.audienceAgeBreakdown.filter(r => r.range && r.pct !== ''),
          audienceTopLocations: state.audienceTopLocations.filter(r => r.location && r.pct !== ''),
          audienceInterests: state.audienceInterests.filter(r => r.interest && r.pct !== ''),
          whyCards: state.whyCards.filter(c => c.title && c.title.trim()),
          availableFor: state.availableFor,
          bookingOptions: state.bookingOptions,
          socials,
          gallery,
          testimonials,
          // Preserve the admin's Hide/Show choice across an edit — this
          // wizard rebuilds `entry` from scratch rather than spreading
          // `existing`, so without this an edited talent would silently
          // come back out of the save as visible again even if an admin
          // had hidden them. New talents (no `existing`) default to
          // visible, matching the database column's own default.
          hidden: existing ? !!existing.hidden : false,
        };
        await opts.onSave(entry, !!existing);
      } catch (err) {
        console.error(err);
        if (window.showToast) window.showToast(err && err.message ? err.message : 'Could not save this talent.');
        nextBtn.disabled = false;
        nextBtn.textContent = originalLabel;
      }
    }

    renderStep();
  };
})();
