// Helper for binding.gyp — outputs node-addon-api include dir
// with forward slashes (safe on all platforms including Windows)
const p = require('node-addon-api').include_dir;
process.stdout.write(p.replace(/\\/g, '/'));
