const fs = require('fs');
const os = require('os');
const path = require('path');

// Uploaded files are parsed then deleted, so they only need a scratch folder.
// Vercel functions have a read-only filesystem except /tmp, so use the OS temp
// dir there; locally keep the existing ./uploads folder.
const UPLOAD_DIR = process.env.VERCEL
  ? path.join(os.tmpdir(), 'uploads')
  : path.join(__dirname, '..', 'uploads');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

module.exports = UPLOAD_DIR;
