# @ore/driver

Builds programs.

- `compileToIr(entry)`: load, check and generate LLVM IR.
- `build(entry, options)`: also compiles the IR (which holds the runtime,
  written in Ore) and the C sources of packages, and links the GC, into a
  binary with clang. Debug builds use `-O0 -g` and stack traces; `--release`
  uses `-O2` and inlining.
- `runtime.ts`: the cache directory, `~/.cache/ore` (or `$ORE_CACHE`).
- `gc.ts`, `build-gc.ts`: the Boehm GC from
  [`runtime/third_party/bdwgc`](../../runtime/third_party), compiled once into
  an object file (also prebuilt into `dist/` for the standalone compiler).
- `clang.ts`: runs `$CC` (clang by default).
