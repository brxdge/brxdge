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
   serving it via a local dev server (localhost/127.0.0.1).

   THE SAME DRIFT BUG HAPPENED AGAIN, ONE LEVEL UP: this file's own
   production fallback used to be hardcoded to
   'https://brxdge-production.up.railway.app'. That was fine while that
   was the only address the site answered to, but once a custom domain
   (brxdge.ca) got pointed at this same backend, every fetch() call from
   admin.js/script.js kept going to the OLD Railway subdomain instead of
   wherever the page actually loaded from — so the admin dashboard was
   silently reading/writing through a stale deployment again, the exact
   failure mode this file was written to prevent in the first place.
   Fixed for good this time: talent-backend/index.js serves the API AND
   the static frontend from the same Express process/origin, so there's
   no reason for this to ever be a different host than the page itself.
   An empty string here means every fetch(API + '/api/...') call becomes
   a same-origin relative request — it always hits whatever domain is
   currently serving the page, so a future domain change (or a second
   custom domain, or Railway regenerating its default subdomain) can
   never make this drift out of sync again. Only truly local dev (a
   separate backend process on its own port) still needs an absolute URL.
========================================================= */
const IS_LOCAL = ['localhost', '127.0.0.1', ''].includes(location.hostname);
const API = IS_LOCAL ? 'http://localhost:3000' : '';
