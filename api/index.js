// Vercel serverless entry point. The Express app (REST API + static game +
// Socket.IO wiring) lives in server/index.js; Vercel imports it from here.
// Accounts: the data layer probes for a writable directory (the project fs
// is read-only on Vercel, so it falls back to the OS temp dir) — guest and
// registration work out of the box, but accounts are ephemeral per instance.
// For persistent accounts set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY +
// JWT_SECRET in the Vercel project environment. For real multiplayer
// matches (long-lived Socket.IO), run the game server on Render instead
// (see render.yaml) and open the Vercel site with ?server=<its URL>.
module.exports = require('../server/index.js');
