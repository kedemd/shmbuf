'use strict';

let native = null;
try {
  native = require('../build/Release/shmbuf.node');
} catch {
  if (process.env.SHMBUF_NO_WARN !== '1') {
    process.emitWarning(
      'shmbuf: native build unavailable, falling back to in-process mode. Cross-process sharing will not work.',
      'ShmbufFallback'
    );
  }
}

const segments = new Map();

function open(name, size) {
  if (native) return native.open(name, size);
  if (!segments.has(name)) segments.set(name, new SharedArrayBuffer(size));
  return segments.get(name);
}

function close(name) {
  if (native) { native.close(name); return; }
}

function unlink(name) {
  if (native) { native.unlink(name); return; }
  segments.delete(name);
}

module.exports = { open, close, unlink };
