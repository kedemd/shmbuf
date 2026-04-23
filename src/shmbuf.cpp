#include <napi.h>
#include <v8.h>
#include <string>
#include <unordered_map>
#include <cstring>

#ifdef _WIN32
  #include <windows.h>
#else
  #include <sys/mman.h>
  #include <sys/stat.h>
  #include <fcntl.h>
  #include <unistd.h>
#endif

// ── Deleter context ───────────────────────────────────────────────────────────
struct DeleterCtx {
  void*  ptr;
  size_t size;
#ifdef _WIN32
  HANDLE handle;
#endif
};

static void SabDeleter(void* /*data*/, size_t /*len*/, void* hint) {
  auto* ctx = static_cast<DeleterCtx*>(hint);
#ifdef _WIN32
  UnmapViewOfFile(ctx->ptr);
  CloseHandle(ctx->handle);
#else
  munmap(ctx->ptr, ctx->size);
#endif
  delete ctx;
}

// ── Region tracking (for close/unlink) ───────────────────────────────────────
#ifdef _WIN32
struct Region { void* ptr; size_t size; HANDLE handle; };
#else
struct Region { void* ptr; size_t size; };
#endif
static std::unordered_map<std::string, Region> g_regions;

// ── Helper: wrap a raw pointer as a SharedArrayBuffer ────────────────────────
// Uses napi_create_external_arraybuffer then reinterprets as SAB.
// The backing store owns the memory — freed by SabDeleter when V8 GCs the SAB.
static Napi::Value WrapAsSharedArrayBuffer(Napi::Env env, void* ptr, size_t size, DeleterCtx* ctx) {
  v8::Isolate* isolate = v8::Isolate::GetCurrent();
  v8::HandleScope scope(isolate);

  auto backing = v8::SharedArrayBuffer::NewBackingStore(
      ptr, size, SabDeleter, static_cast<void*>(ctx));

  v8::Local<v8::SharedArrayBuffer> sab =
      v8::SharedArrayBuffer::New(isolate, std::move(backing));

  // Convert v8::Local to napi_value via the v8::Value base class
  return Napi::Value(env, reinterpret_cast<napi_value>(
      static_cast<v8::Value*>(*sab)));
}

// ─────────────────────────────────────────────────────────────────────────────
Napi::Value Open(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[0].IsString() || !info[1].IsNumber()) {
    Napi::TypeError::New(env, "open(name: string, size: number)").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  std::string name = info[0].As<Napi::String>().Utf8Value();
  size_t size = (size_t)info[1].As<Napi::Number>().Uint32Value();
  if (size == 0 || size > 64 * 1024 * 1024) {
    Napi::RangeError::New(env, "size must be between 1 and 67108864 bytes").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  void* ptr = nullptr;
  auto* ctx = new DeleterCtx();
  ctx->size = size;

#ifdef _WIN32
  HANDLE h = CreateFileMappingA(INVALID_HANDLE_VALUE, NULL, PAGE_READWRITE, 0, (DWORD)size, name.c_str());
  if (!h) { delete ctx; Napi::Error::New(env, "CreateFileMapping failed: " + std::to_string(GetLastError())).ThrowAsJavaScriptException(); return env.Undefined(); }
  ptr = MapViewOfFile(h, FILE_MAP_ALL_ACCESS, 0, 0, size);
  if (!ptr) { CloseHandle(h); delete ctx; Napi::Error::New(env, "MapViewOfFile failed: " + std::to_string(GetLastError())).ThrowAsJavaScriptException(); return env.Undefined(); }
  ctx->ptr = ptr; ctx->handle = h;
  g_regions[name] = { ptr, size, h };
#else
  int fd = shm_open(name.c_str(), O_CREAT | O_EXCL | O_RDWR, 0600);
  if (fd >= 0) {
    if (ftruncate(fd, (off_t)size) < 0) {
      int e = errno; close(fd); shm_unlink(name.c_str()); delete ctx;
      Napi::Error::New(env, std::string("ftruncate failed: ") + strerror(e)).ThrowAsJavaScriptException();
      return env.Undefined();
    }
  } else if (errno == EEXIST) {
    fd = shm_open(name.c_str(), O_RDWR, 0600);
    if (fd < 0) { delete ctx; Napi::Error::New(env, std::string("shm_open (existing) failed: ") + strerror(errno)).ThrowAsJavaScriptException(); return env.Undefined(); }
  } else {
    delete ctx; Napi::Error::New(env, std::string("shm_open failed: ") + strerror(errno)).ThrowAsJavaScriptException(); return env.Undefined();
  }
  ptr = mmap(nullptr, size, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
  close(fd);
  if (ptr == MAP_FAILED) { delete ctx; Napi::Error::New(env, std::string("mmap failed: ") + strerror(errno)).ThrowAsJavaScriptException(); return env.Undefined(); }
  ctx->ptr = ptr;
  g_regions[name] = { ptr, size };
#endif

  return WrapAsSharedArrayBuffer(env, ptr, size, ctx);
}

Napi::Value Close(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "close(name: string)").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  // Remove tracking — actual munmap/CloseHandle happens in SabDeleter when V8 GCs the SAB
  g_regions.erase(info[0].As<Napi::String>().Utf8Value());
  return env.Undefined();
}

Napi::Value Unlink(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "unlink(name: string)").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  std::string name = info[0].As<Napi::String>().Utf8Value();
  g_regions.erase(name);
#ifndef _WIN32
  shm_unlink(name.c_str());
#endif
  return env.Undefined();
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("open",   Napi::Function::New(env, Open));
  exports.Set("close",  Napi::Function::New(env, Close));
  exports.Set("unlink", Napi::Function::New(env, Unlink));
  return exports;
}

NODE_API_MODULE(shmbuf, Init)
