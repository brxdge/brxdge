/* =========================================================
   SHARED BACKEND CONFIG
   Loaded by BOTH index.html (public site, via script.js) and
   admin.html (admin dashboard, via admin.js) — this is the single
   place the backend URL lives, on purpose.

   Before this file existed, script.js and admin.js each hardcoded
   their own separate copy of the API URL. They drifted apart: admin.js
   was still pointed at an old, dead Render deployment while script.js
   had already moved to Railway, so the admin dashboard was silently
   reading/writing a stale, disconnected copy of the data (different
   roster, different messages, different admin accounts) instead of
   what visitors actually saw on the live site. One shared file means
   there's nowhere left for the two to quietly disagree.

   Production uses a relative/same-origin path ('') rather than a
   hardcoded absolute URL. The old version hardcoded a specific Railway
   deployment subdomain here — harmless while that deployment was live,
   but it meant every future migration (new Railway project, new custom
   domain, etc.) required remembering to come back and update this one
   line, and forgetting to would silently break every API call and
   image upload once the old deployment was ever taken down. Since the
   frontend and backend are always served from the same origin in
   production, a relative path works everywhere automatically and
   removes this whole class of bug for good.
========================================================= */
const IS_LOCAL = ['localhost', '127.0.0.1', ''].includes(location.hostname);
const API = IS_LOCAL ? 'http://localhost:3000' : '';
