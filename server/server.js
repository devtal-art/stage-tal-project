require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const apiRoutes = require('./routes/api.routes');
const projectsRoutes = require('./routes/projects.routes');

const app = express();

// Middleware
// CLIENT_URL restricts CORS to specific origin(s) (comma-separated) once set,
// e.g. the deployed Vercel URL. Left unset, all origins are allowed - keeps
// local dev and any interim deployment working out of the box.
const allowedOrigins = (process.env.CLIENT_URL || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
app.use(cors(allowedOrigins.length ? { origin: allowedOrigins } : undefined));
app.use(express.json());

// Database Connection
const mongoUri = process.env.MONGODB_URI;
const isVercel = Boolean(process.env.VERCEL);

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
      .then(() => {
        lastDbError = null;
        console.log('✅ Connected to MongoDB Atlas');
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
    timestamp: new Date().toISOString(),
  });
});

// Every other API route needs the DB - wait for it, or return a clear error
// instead of crashing the function.
app.use('/api', async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (error) {
    res.status(503).json({ message: 'Database unavailable', error: lastDbError || error.message });
  }
});

// Routes
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
