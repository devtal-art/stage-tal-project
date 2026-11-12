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

// Routes
app.use('/api', apiRoutes);
app.use('/api/projects', projectsRoutes);

// Health check - no auth, no DB access, no side effects. Used by Render (or
// any uptime/monitoring check) to confirm the process is up and responsive.
app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    status: 'healthy',
    service: 'attendance-and-project-record',
    timestamp: new Date().toISOString(),
  });
});

// Database Connection
const mongoUri = process.env.MONGODB_URI;
if (!mongoUri) {
  console.error('FATAL: MONGODB_URI is not set in .env');
  process.exit(1);
}

const mongoOptions = {
  tls: true,
  serverSelectionTimeoutMS: 15000,
  retryWrites: true,
};

console.log('Connecting to MongoDB Atlas...');
const dbReady = mongoose.connect(mongoUri, mongoOptions)
  .then(() => console.log('✅ Connected to MongoDB Atlas'))
  .catch((error) => {
    console.error('❌ MongoDB connection error:', error.message);
    console.error('   Code:', error.code || 'N/A');
    // Locally, fail fast. On Vercel, let the function report the error per
    // request instead of crashing the whole instance.
    if (!process.env.VERCEL) process.exit(1);
  });

// Local / traditional hosting: start listening once the DB is connected.
// On Vercel the platform imports the exported app and handles HTTP itself.
if (!process.env.VERCEL) {
  dbReady.then(() => {
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  });
}

module.exports = app;
