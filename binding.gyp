{
  "targets": [{
    "target_name": "shmbuf",
    "sources": ["src/shmbuf.cpp"],
    "include_dirs": [
      "<!@(node -p \"require('node-addon-api').include_dir\")"
    ],
    "dependencies": [
      "<!@(node -p \"require('node-addon-api').gyp\")"
    ],
    "cflags!": ["-fno-exceptions"],
    "cflags_cc!": ["-fno-exceptions"],
    "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
    "conditions": [
      ["OS=='linux'", {
        "libraries": ["-lrt"]
      }]
    ]
  }]
}
