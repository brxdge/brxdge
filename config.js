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

   Auto-detects local vs. production instead of relying on manually
   toggling this URL and remembering to switch it back — running the
   backend locally while this constant still pointed at the live URL
   is exactly what made local testing look "slow" (it was quietly
   hitting the real backend's cold-start, not localhost, the whole
   time). Covers opening a file directly (file://, empty hostname) and
   serving it via a local dev server (localhost/127.0.0.1) — anything
   else (Railway, Netlify, a custom domain) falls back to the real
   backend. Adjust the local port below if the backend isn't on 3000.
========================================================= */
const IS_LOCAL = ['localhost', '127.0.0.1', ''].includes(location.hostname);
const API = IS_LOCAL ? 'http://localhost:3000' : 'https://brxdge-production.up.railway.app';