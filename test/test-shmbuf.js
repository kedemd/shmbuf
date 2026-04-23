'use strict';
process.env.SHMBUF_NO_WARN = '1';

const { open, close, unlink } = require('..');
const assert = require('assert');
const { fork } = require('child_process');

const PID = process.pid;

function makeSegName(tag) { return `/shmbuf-test-${tag}-${PID}`; }

function cleanup(...names) {
  for (const n of names) {
    try { close(n); } catch {}
    try { unlink(n); } catch {}
  }
}

let passed = 0, failed = 0;

function test(label, fn) {
  try {
    fn();
    console.log(`  ✓  ${label}`);
    passed++;
  } catch (err) {
    console.error(`  ✗  ${label}`);
    console.error(`     ${err.message}`);
    failed++;
  }
}

// ── 1. open() basics ─────────────────────────────────────────────────────────
console.log('\n── 1. open() basics ──');
{
  const NAME = makeSegName('basic');
  try {
    const buf = open(NAME, 128);
    test('returns SharedArrayBuffer', () => assert(buf instanceof SharedArrayBuffer));
    test('byteLength matches requested size', () => assert.strictEqual(buf.byteLength, 128));
    test('buffer is zero-initialised', () => {
      const view = new Uint8Array(buf);
      for (let i = 0; i < view.length; i++) assert.strictEqual(view[i], 0, `byte ${i}`);
    });
  } finally { cleanup(NAME); }
}

// ── 2. Atomics ───────────────────────────────────────────────────────────────
console.log('\n── 2. Atomics operations ──');
{
  const NAME = makeSegName('atomics');
  try {
    const view = new Int32Array(open(NAME, 64));
    test('Atomics.store / load', () => { Atomics.store(view,0,42); assert.strictEqual(Atomics.load(view,0),42); });
    test('Atomics.add', () => { Atomics.store(view,1,0); Atomics.add(view,1,10); Atomics.add(view,1,5); assert.strictEqual(Atomics.load(view,1),15); });
    test('Atomics.sub', () => { Atomics.store(view,2,20); Atomics.sub(view,2,7); assert.strictEqual(Atomics.load(view,2),13); });
    test('Atomics.compareExchange – success', () => { Atomics.store(view,3,0); const p=Atomics.compareExchange(view,3,0,99); assert.strictEqual(p,0); assert.strictEqual(Atomics.load(view,3),99); });
    test('Atomics.compareExchange – fail leaves value', () => { Atomics.store(view,4,10); const p=Atomics.compareExchange(view,4,0,77); assert.strictEqual(p,10); assert.strictEqual(Atomics.load(view,4),10); });
    test('Atomics.exchange', () => { Atomics.store(view,5,55); assert.strictEqual(Atomics.exchange(view,5,66),55); assert.strictEqual(Atomics.load(view,5),66); });
    test('Atomics.and / or / xor', () => {
      Atomics.store(view,6,0b1100); Atomics.and(view,6,0b1010); assert.strictEqual(Atomics.load(view,6),0b1000,'AND');
      Atomics.store(view,7,0b1100); Atomics.or(view,7,0b0011);  assert.strictEqual(Atomics.load(view,7),0b1111,'OR');
      Atomics.store(view,8,0b1010); Atomics.xor(view,8,0b1100); assert.strictEqual(Atomics.load(view,8),0b0110,'XOR');
    });
  } finally { cleanup(NAME); }
}

// ── 3. Same-process re-open ──────────────────────────────────────────────────
console.log('\n── 3. same-process re-open ──');
{
  const NAME = makeSegName('reopen');
  try {
    const v1 = new Int32Array(open(NAME, 64)); Atomics.store(v1,0,42);
    const v2 = new Int32Array(open(NAME, 64));
    test('second open sees first write', () => assert.strictEqual(Atomics.load(v2,0),42));
    test('second write visible in first', () => { Atomics.store(v2,1,77); assert.strictEqual(Atomics.load(v1,1),77); });
  } finally { cleanup(NAME); }
}

// ── 4. close() / unlink() ────────────────────────────────────────────────────
console.log('\n── 4. close() / unlink() ──');
{
  test('open + close + unlink do not throw', () => { const N=makeSegName('lc'); open(N,32); close(N); unlink(N); });
  test('double close() is a no-op', () => { const N=makeSegName('dc'); open(N,32); close(N); close(N); unlink(N); });
  test('double unlink() is a no-op', () => { const N=makeSegName('du'); open(N,32); unlink(N); unlink(N); });
}

// ── 5. Segment isolation ─────────────────────────────────────────────────────
console.log('\n── 5. multiple independent segments ──');
{
  const A=makeSegName('seg-a'), B=makeSegName('seg-b');
  try {
    const vA=new Int32Array(open(A,64)), vB=new Int32Array(open(B,64));
    test('segments do not bleed into each other', () => {
      Atomics.store(vA,0,111); Atomics.store(vB,0,222);
      assert.strictEqual(Atomics.load(vA,0),111); assert.strictEqual(Atomics.load(vB,0),222);
    });
  } finally { cleanup(A, B); }
}

// ── 6. Cross-process sharing ─────────────────────────────────────────────────
console.log('\n── 6. cross-process sharing ──');

let nativeAvailable = false;
try { require(require('path').join(__dirname, '../build/Release/shmbuf.node')); nativeAvailable = true; } catch {}

if (process.argv[2] === '--child-xproc') {
  const view = new Int32Array(open(process.argv[3], 64));
  const dl = Date.now() + 5000;
  while (Atomics.load(view,2) !== 1) { if (Date.now()>dl) process.exit(2); }
  const pv = Atomics.load(view,0);
  if (pv !== 42) { process.stderr.write(`child: expected 42 got ${pv}\n`); process.exit(1); }
  Atomics.store(view,1,99); Atomics.store(view,3,1); process.exit(0);

} else if (!nativeAvailable) {
  console.log('  SKIP  cross-process sharing (native build unavailable)');
  runSection7();
} else {
  const XNAME = makeSegName('xproc');
  const view = new Int32Array(open(XNAME, 64));
  Atomics.store(view,0,42);
  const child = fork(__filename, ['--child-xproc', XNAME], { silent: true });
  child.stderr.on('data', d => process.stderr.write(d));
  Atomics.store(view,2,1);
  const dl = Date.now()+5000;
  const poll = setInterval(() => {
    if (Atomics.load(view,3)===1) {
      clearInterval(poll);
      test('child process sees parent write; parent sees child write', () => assert.strictEqual(Atomics.load(view,1),99));
      cleanup(XNAME); runSection7();
    } else if (Date.now()>dl) {
      clearInterval(poll);
      test('cross-process handshake within 5s', () => { throw new Error('timeout'); });
      cleanup(XNAME); runSection7();
    }
  }, 5);
}

// ── 7. High-contention multi-process performance ─────────────────────────────
const PERF_WORKERS=8, PERF_ITER=50_000;
const PERF_SEG_SIZE=(3+PERF_WORKERS)*4;
const OFF_COUNTER=0, OFF_CAS=1, OFF_GATE=2, OFF_READY=3;

if (process.argv[2]==='--perf-worker') {
  const view = new Int32Array(open(process.argv[3], PERF_SEG_SIZE));
  const iter=parseInt(process.argv[4],10), mySlot=parseInt(process.argv[5],10);
  while (Atomics.load(view,OFF_GATE)!==1) {}
  for (let i=0;i<iter;i++) Atomics.add(view,OFF_COUNTER,1);
  for (let i=0;i<iter;i++) { let o; do { o=Atomics.load(view,OFF_CAS); } while (Atomics.compareExchange(view,OFF_CAS,o,o+1)!==o); }
  Atomics.store(view,OFF_READY+mySlot,1); process.exit(0);
}

function runSection7() {
  console.log('\n── 7. high-contention multi-process performance ──');
  if (!nativeAvailable) { console.log('  SKIP  (native build unavailable)'); return printSummary(); }

  const totalOps = PERF_WORKERS*PERF_ITER;
  console.log(`   workers=${PERF_WORKERS}  iters/worker=${PERF_ITER.toLocaleString()}  total ops=${(totalOps*2).toLocaleString()}`);

  const PNAME = makeSegName('perf');
  const pview = new Int32Array(open(PNAME, PERF_SEG_SIZE));

  for (let i=0;i<PERF_WORKERS;i++) {
    const w=fork(__filename,['--perf-worker',PNAME,String(PERF_ITER),String(i)],{silent:true});
    w.stderr.on('data', d=>process.stderr.write(d));
  }

  setTimeout(()=>{
    const t0=process.hrtime.bigint();
    Atomics.store(pview,OFF_GATE,1);
    const dl=Date.now()+30_000;
    const poll=setInterval(()=>{
      let done=true;
      for (let i=0;i<PERF_WORKERS;i++) if (Atomics.load(pview,OFF_READY+i)!==1){done=false;break;}
      if (!done&&Date.now()<=dl) return;
      clearInterval(poll);
      const ms=Number(process.hrtime.bigint()-t0)/1e6;
      cleanup(PNAME);
      if (!done) { test('all workers finished within 30s',()=>{throw new Error('timeout');}); return printSummary(); }
      const ops=n=>Math.round(n/(ms/1000)).toLocaleString();
      test(`Atomics.add counter == ${totalOps.toLocaleString()} (no lost updates)`,()=>{
        const got=Atomics.load(pview,OFF_COUNTER); assert.strictEqual(got,totalOps,`lost ${totalOps-got}`);
      });
      test(`CAS-loop counter == ${totalOps.toLocaleString()} (no lost updates)`,()=>{
        const got=Atomics.load(pview,OFF_CAS); assert.strictEqual(got,totalOps,`lost ${totalOps-got}`);
      });
      test(`completed in time (${ms.toFixed(0)} ms < 30 000 ms)`,()=>assert(ms<30_000));
      console.log(`\n   ┌─ Results ────────────────────────────────────`);
      console.log(`   │  elapsed           : ${ms.toFixed(1)} ms`);
      console.log(`   │  Atomics.add       : ${ops(totalOps)} ops/s`);
      console.log(`   │  CAS-loop          : ${ops(totalOps)} ops/s`);
      console.log(`   │  combined          : ${ops(totalOps*2)} ops/s`);
      console.log(`   └──────────────────────────────────────────────`);
      printSummary();
    },10);
  },200);
}

function printSummary() {
  console.log(`\n${'─'.repeat(50)}`);
  if (failed===0) console.log(`All ${passed} tests passed ✓`);
  else { console.log(`${passed} passed, ${failed} FAILED`); process.exitCode=1; }
}
