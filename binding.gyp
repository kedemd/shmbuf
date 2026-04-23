{
  "targets": [{
    "target_name": "shmbuf",
    "sources": ["src/shmbuf.cpp"],
    "include_dirs": [
      "<!@(node get-include-dir.js)"
    ],
    "cflags!": ["-fno-exceptions"],
    "cflags_cc!": ["-fno-exceptions"],
    "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS", "NAPI_VERSION=8"],
    "conditions": [
      ["OS=='linux'", {
        "libraries": ["-lrt"]
      }]
    ]
  }]
}
