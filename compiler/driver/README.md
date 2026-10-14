# @ore/driver

Builds programs.

- `compileToIr(entry)`: load, check and generate LLVM IR.
- `build(entry, options)`: also compiles the IR, the C sources of packages,
  the runtime and the GC into a binary with clang. Debug builds use `-O0 -g`
  and stack traces; `--release` uses `-O2` and inlining.
- `runtime.ts`: the C runtime is embedded in the compiler; it is written to
  `~/.cache/ore` (or `$ORE_CACHE`) and compiled once per version and flags.
- `gc.ts`, `build-gc.ts`: the Boehm GC from
  [`runtime/third_party/bdwgc`](../../runtime/third_party), compiled once into
  an object file (also prebuilt into `dist/` for the standalone compiler).
- `clang.ts`: runs `$CC` (clang by default).
