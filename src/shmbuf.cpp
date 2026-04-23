#include <napi.h>
#include <v8.h>
#include <string>
#include <unordered_map>
#include <cstring>

#ifdef _WIN32
  #include <windows.h>
  static std::unordered_map<std::string, HANDLE> g_handles;
#else
  #include <sys/mman.h>
  #include <sys/stat.h>
  #include <fcntl.h>
  #include <unistd.h>
  struct MappedRegion { void* ptr; size_t size; };
  static std::unordered_map<std::string, MappedRegion> g_regions;
#endif

static napi_value MakeSharedArrayBuffer(Napi::Env env, void* ptr, size_t size) {
  v8::Isolate* isolate = v8::Isolate::GetCurrent();
  // Create a backing store that does NOT free memory on GC —
  // we manage the lifetime ourselves in Close/Unlink.
  auto backing = v8::SharedArrayBuffer::NewBackingStore(
      ptr, size,
      [](void*, size_t, void*) {},  // no-op deleter
      nullptr
  );
  v8::Local<v8::SharedArrayBuffer> sab =
      v8::SharedArrayBuffer::New(isolate, std::move(backing));
  return reinterpret_cast<napi_value>(*sab);
}

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
#ifdef _WIN32
  HANDLE h = CreateFileMappingA(INVALID_HANDLE_VALUE, NULL, PAGE_READWRITE, 0, (DWORD)size, name.c_str());
  if (!h) {
    Napi::Error::New(env, "CreateFileMapping failed: " + std::to_string(GetLastError())).ThrowAsJavaScriptException();
    return env.Undefined();
  }
  ptr = MapViewOfFile(h, FILE_MAP_ALL_ACCESS, 0, 0, size);
  if (!ptr) {
    CloseHandle(h);
    Napi::Error::New(env, "MapViewOfFile failed: " + std::to_string(GetLastError())).ThrowAsJavaScriptException();
    return env.Undefined();
  }
  g_handles[name] = h;
#else
  int fd = shm_open(name.c_str(), O_CREAT | O_RDWR, 0600);
  if (fd < 0) {
    Napi::Error::New(env, std::string("shm_open failed: ") + strerror(errno)).ThrowAsJavaScriptException();
    return env.Undefined();
  }
  if (ftruncate(fd, (off_t)size) < 0) {
    close(fd);
    shm_unlink(name.c_str());
    Napi::Error::New(env, std::string("ftruncate failed: ") + strerror(errno)).ThrowAsJavaScriptException();
    return env.Undefined();
  }
  ptr = mmap(nullptr, size, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
  close(fd);
  if (ptr == MAP_FAILED) {
    Napi::Error::New(env, std::string("mmap failed: ") + strerror(errno)).ThrowAsJavaScriptException();
    return env.Undefined();
  }
  g_regions[name] = { ptr, size };
#endif
  return Napi::Value(env, MakeSharedArrayBuffer(env, ptr, size));
}

Napi::Value Close(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "close(name: string)").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  std::string name = info[0].As<Napi::String>().Utf8Value();
#ifdef _WIN32
  auto it = g_handles.find(name);
  if (it != g_handles.end()) { CloseHandle(it->second); g_handles.erase(it); }
#else
  auto it = g_regions.find(name);
  if (it != g_regions.end()) { munmap(it->second.ptr, it->second.size); g_regions.erase(it); }
#endif
  return env.Undefined();
}

Napi::Value Unlink(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "unlink(name: string)").ThrowAsJavaScriptException();
    return env.Undefined();
  }
#ifndef _WIN32
  std::string name = info[0].As<Napi::String>().Utf8Value();
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
