# shmbuf

Cross-platform shared memory for Node.js. Returns a `SharedArrayBuffer` backed by OS shared memory (`shm_open`+`mmap` on Linux/macOS, `CreateFileMapping`+`MapViewOfFile` on Windows). Multiple Node.js processes opening the same named segment share the same physical memory pages — writes are instantly visible across processes with no IPC, no fsync, no serialization.

Use `Atomics` directly for lock-free cross-process coordination.

## Install

```bash
npm install shmbuf
```

## Usage

```js
const { open, close, unlink } = require('shmbuf');

const buf = open('/myapp-lock', 64);
const view = new Int32Array(buf);

Atomics.add(view, 0, 1);
Atomics.compareExchange(view, 1, 0, 1);
const gen = Atomics.load(view, 2);

close('/myapp-lock');
unlink('/myapp-lock');
```

## API

### `open(name, size)` → `SharedArrayBuffer`
Creates or opens a named segment of `size` bytes. On POSIX, `name` must start with `'/'`.

### `close(name)`
Unmaps this process's view. The segment persists until `unlink()` is called.

### `unlink(name)`
Destroys the named segment. No-op on Windows.

## Fallback
If the native build fails at install time, falls back to in-process `SharedArrayBuffer`. Cross-process sharing will not work. A warning is emitted.

## License
MIT
