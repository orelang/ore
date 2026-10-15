# @ore/driver

Builds programs.

- `compileToIr(entry)`: load, check and generate LLVM IR.
- `build(entry, options)`: also compiles the IR (which holds the runtime and
  its garbage collector, written in Ore) and the C sources of packages into a
  binary with clang. Debug builds use `-O0 -g` and stack traces; `--release`
  uses `-O2` and inlining.
- `nativeCode(paths)`: the libraries, C sources and library directories that
  the packages of a program ask for in `"ore"` of their package.json;
  `libDirs` entries are paths or `$(command ...)`, skipped when missing.
- `clang.ts`: runs `$CC` (clang by default).
