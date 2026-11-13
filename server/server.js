require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const apiRoutes = require('./routes/api.routes');
const projectsRoutes = require('./routes/projects.routes');
const authRoutes = require('./routes/auth.routes');
const { requireAuth } = require('./middleware/auth');
const User = require('./models/User');
const { parseAllowedOrigins } = require('./utils/corsOrigins');

const isVercel = Boolean(process.env.VERCEL);

// Login is OFF unless AUTH_ENABLED=true. When off, the API is open (no token
// required), JWT_SECRET is not needed and no admin is seeded.
// Must match VITE_AUTH_ENABLED on the client.
const AUTH_ENABLED = process.env.AUTH_ENABLED === 'true';

// Startup config problems. Locally we fail fast; on Vercel a crashing function
// gives an opaque FUNCTION_INVOCATION_FAILED, so we report the problem per
// request instead (see /api/health and the DB gate below).
let configError = null;
if (AUTH_ENABLED && !process.env.JWT_SECRET) {
  configError = 'AUTH_ENABLED=true but JWT_SECRET is not set';
  console.error(`FATAL: ${configError} in .env`);
  if (!isVercel) process.exit(1);
}

const app = express();

// Middleware
// CLIENT_URL restricts CORS to specific origin(s) (comma-separated) once set,
// e.g. the deployed Vercel URL. Left unset, all origins are allowed - keeps
// local dev and any interim deployment working out of the box. Entries may use
// '*' as a wildcard (see utils/corsOrigins.js).
const originMatchers = parseAllowedOrigins(process.env.CLIENT_URL);
app.use(cors({
  ...(originMatchers.length ? { origin: originMatchers } : {}),
  // Lets the client read the filename of Excel exports downloaded via XHR.
  exposedHeaders: ['Content-Disposition'],
}));
app.use(express.json());

// Uploads go to utils/uploadDir (./uploads locally, /tmp on Vercel).

// Creates the first admin from ADMIN_USERNAME / ADMIN_PASSWORD when the users
// collection is empty, so a fresh deployment always has a way in.
async function seedAdmin() {
  if ((await User.estimatedDocumentCount()) > 0) return;
  const username = (process.env.ADMIN_USERNAME || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';
  if (!username || !password) {
    console.warn('⚠️  No users exist. Set ADMIN_USERNAME and ADMIN_PASSWORD in .env (or run scripts/createUser.js) so someone can log in.');
    return;
  }
  await User.create({
    username,
    name: 'Administrator',
    role: 'admin',
    passwordHash: await bcrypt.hash(password, 12),
  });
  console.log(`👤 Created initial admin user "${username}"`);
}

// Database Connection
const mongoUri = process.env.MONGODB_URI;

const mongoOptions = {
  tls: true,
  serverSelectionTimeoutMS: 15000,
  retryWrites: true,
};

// Cached connection promise. On failure it is cleared so the next request
// retries (serverless instances are reused across requests).
let dbPromise = null;
let lastDbError = null;
const connectDB = () => {
  if (!mongoUri) {
    lastDbError = 'MONGODB_URI is not set';
    return Promise.reject(new Error(lastDbError));
  }
  if (!dbPromise) {
    console.log('Connecting to MongoDB Atlas...');
    dbPromise = mongoose.connect(mongoUri, mongoOptions)
      .then(async () => {
        lastDbError = null;
        console.log('✅ Connected to MongoDB Atlas');
        if (AUTH_ENABLED) await seedAdmin();
        console.log(`🔐 Login ${AUTH_ENABLED ? 'ENABLED' : 'DISABLED (API is open)'}`);
      })
      .catch((error) => {
        lastDbError = `${error.name}: ${error.message}`;
        console.error('❌ MongoDB connection error:', error.message);
        console.error('   Code:', error.code || 'N/A');
        dbPromise = null;
        throw error;
      });
  }
  return dbPromise;
};

// Health check - no auth, no side effects. Reports DB state so deployment
// problems (missing env var, Atlas IP allowlist, bad credentials) are visible.
app.get('/api/health', (req, res) => {
  const dbStates = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  res.status(200).json({
    success: true,
    status: 'healthy',
    service: 'attendance-and-project-record',
    db: dbStates[mongoose.connection.readyState] || 'unknown',
    mongoUriSet: Boolean(mongoUri),
    dbError: lastDbError,
    configError,
    authEnabled: AUTH_ENABLED,
    // Diagnostics: env var NAMES only (never values) + which deployment runs.
    mongoEnvNames: Object.keys(process.env).filter((k) => /mongo/i.test(k)),
    vercelEnv: process.env.VERCEL_ENV || null,
    commit: (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || null,
    timestamp: new Date().toISOString(),
  });
});

// Every other API route needs config + DB - wait for it, or return a clear
// error instead of crashing the function.
app.use('/api', async (req, res, next) => {
  if (configError) {
    return res.status(500).json({ message: 'Server misconfigured', error: configError });
  }
  try {
    await connectDB();
    next();
  } catch (error) {
    res.status(503).json({ message: 'Database unavailable', error: lastDbError || error.message });
  }
});

// Public auth endpoints (login). When auth is enabled, everything registered
// after the requireAuth line below needs a valid login token.
if (AUTH_ENABLED) {
  app.use('/api/auth', authRoutes);
  app.use('/api', requireAuth);
}

// App routes
app.use('/api', apiRoutes);
app.use('/api/projects', projectsRoutes);

if (isVercel) {
  // Warm the connection on cold start; errors surface per request above.
  connectDB().catch(() => {});
} else {
  // Local / traditional hosting: fail fast if the DB is unreachable.
  if (!mongoUri) {
    console.error('FATAL: MONGODB_URI is not set in .env');
    process.exit(1);
  }
  connectDB()
    .then(() => {
      const PORT = process.env.PORT || 5000;
      app.listen(PORT, () => {
        console.log(`🚀 Server running on port ${PORT}`);
      });
    })
    .catch(() => process.exit(1));
}

module.exports = app;
