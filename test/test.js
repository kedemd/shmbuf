'use strict';
process.env.SHMBUF_NO_WARN = '1';
const { open, close, unlink } = require('..');
const assert = require('assert');

const NAME = '/shmbuf-test-' + process.pid;
const SIZE = 64;

console.log('Testing shmbuf...');

const buf = open(NAME, SIZE);
assert(buf instanceof SharedArrayBuffer, 'open() must return SharedArrayBuffer');
assert.strictEqual(buf.byteLength, SIZE, 'byteLength must match');
console.log('  open() OK');

const view = new Int32Array(buf);
Atomics.store(view, 0, 42);
assert.strictEqual(Atomics.load(view, 0), 42, 'Atomics.store/load must work');
console.log('  Atomics.store/load OK');

Atomics.add(view, 1, 10);
Atomics.add(view, 1, 5);
assert.strictEqual(Atomics.load(view, 1), 15, 'Atomics.add must work');
console.log('  Atomics.add OK');

const prev = Atomics.compareExchange(view, 2, 0, 99);
assert.strictEqual(prev, 0, 'CAS must return old value');
assert.strictEqual(Atomics.load(view, 2), 99, 'CAS must set new value');
console.log('  Atomics.compareExchange OK');

const buf2 = open(NAME, SIZE);
const view2 = new Int32Array(buf2);
assert.strictEqual(Atomics.load(view2, 0), 42, 'second open must see shared data');
console.log('  second open() shares data OK');

close(NAME);
close(NAME);
unlink(NAME);
unlink(NAME);
console.log('  close()/unlink() OK');

console.log('\nAll tests passed.');
