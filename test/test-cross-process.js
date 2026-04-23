'use strict';
process.env.SHMBUF_NO_WARN = '1';
const { fork } = require('child_process');
const { open, unlink } = require('..');
const assert = require('assert');
const path = require('path');

// Layout (Int32Array offsets):
// [0] parent_wrote  — set to 42 by parent, child verifies
// [1] child_wrote   — set to 99 by child, parent verifies
// [2] ready         — parent sets to 1 when segment is ready
// [3] done          — child sets to 1 when done writing

const NAME = '/shmbuf-xproc-' + process.pid;
const SIZE = 64;

if (process.argv[2] === '--child') {
  // ── Child process ────────────────────────────────────────────
  const name = process.argv[3];
  const buf = open(name, SIZE);
  const view = new Int32Array(buf);

  // Wait for parent to signal ready
  const deadline = Date.now() + 5000;
  while (Atomics.load(view, 2) !== 1) {
    if (Date.now() > deadline) { process.exit(2); }
  }

  // Verify parent's write
  const parentVal = Atomics.load(view, 0);
  if (parentVal !== 42) {
    process.stderr.write('child: expected parent_wrote=42, got ' + parentVal + '\n');
    process.exit(1);
  }

  // Write back
  Atomics.store(view, 1, 99);
  Atomics.store(view, 3, 1); // signal done
  process.exit(0);

} else {
  // ── Parent process ───────────────────────────────────────────
  console.log('Testing cross-process shared memory...');

  const buf = open(NAME, SIZE);
  const view = new Int32Array(buf);

  // Write value for child to read
  Atomics.store(view, 0, 42);

  // Spawn child
  const child = fork(process.argv[1], ['--child', NAME], { silent: true });

  child.stderr.on('data', d => process.stderr.write(d));

  // Signal ready
  Atomics.store(view, 2, 1);

  // Wait for child to signal done (up to 5s)
  const deadline = Date.now() + 5000;
  const wait = () => new Promise((resolve, reject) => {
    const iv = setInterval(() => {
      if (Atomics.load(view, 3) === 1) {
        clearInterval(iv);
        resolve();
      } else if (Date.now() > deadline) {
        clearInterval(iv);
        reject(new Error('timeout waiting for child'));
      }
    }, 5);
  });

  wait().then(() => {
    // Verify child's write
    const childVal = Atomics.load(view, 1);
    assert.strictEqual(childVal, 99, 'parent must see child write of 99');
    console.log('  parent sees child write OK (value: ' + childVal + ')');
    unlink(NAME);
    console.log('\nCross-process test passed.');
    process.exit(0);
  }).catch(err => {
    unlink(NAME);
    console.error('FAIL:', err.message);
    process.exit(1);
  });

  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error('child exited with code', code);
    }
  });
}
