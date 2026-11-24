// Vercel serverless entry point. The Express app (REST API + static game +
// Socket.IO wiring) lives in server/index.js; Vercel imports it from here.
// Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (+ JWT_SECRET) in the Vercel
// project environment — serverless filesystems are ephemeral, so the local
// JSON database cannot persist accounts there.
module.exports = require('../server/index.js');
