# Changelog

All notable changes of Ore. Versions follow [Semantic Versioning](https://semver.org);
before 1.0, a minor version may change the language.

## 0.1.0

The first release: the language, its runtime and its whole toolchain written
in Ore.

### Language

- TypeScript syntax with native semantics: sized integers (`i8` … `u64`,
  `int`, `uint`, `byte`) and floats (`f32`, `f64`), untyped numeric constants,
  explicit conversions, nominal classes with single inheritance (virtual
  methods, `super`, `protected`, abstract classes), structural interfaces,
  tagged unions with narrowing (also by assignment), generics by
  monomorphization, closures, destructuring, default and rest parameters,
  getters and setters, `using` for cleanup, errors as values.
- Collections: arrays (with `...spread` in literals), `Map` and `Set` with
  insertion order, strings as UTF-8 bytes, `JSON.stringify` and typed
  `JSON.parse`.
- Concurrency: tasks on an M:N scheduler (green threads on every CPU),
  channels, `select`, `ore:sync` (`Mutex`, `WaitGroup`), and a network poller
  on kqueue or epoll.
- Low-level code: `unsafe` (pointers, atomics, inline assembly), `//ore:`
  directives, C functions by `declare function`, `target.os` and
  `target.arch` folded at compile time.
- Modules, npm-style packages with `package.json`, files imported as text.

### Runtime

- Written in Ore, compiled with the program so that it inlines into it:
  strings, arrays, maps, number formatting (Ryu), JSON, the scheduler with
  its context switch in assembly, channels, sockets, files, processes.
- An own garbage collector in the shape of Go's: size-classed spans,
  per-thread allocation, parallel marking.
- `ORE_WATCHDOG=<seconds>` reports a stuck program with the stacks of its
  tasks and threads.

### Toolchain

- One `ore` command: `run`, `build`, `check`, `test`, `fmt`, `init`, `lsp`,
  `update`.
- The compiler is written in Ore and builds itself (`ci/bootstrap.sh`: stages
  2 and 3 emit the same LLVM IR). It calls LLVM through its C API, compiles
  debug builds on every CPU and links with lld.
- Releases for Linux (x86-64, arm64) and macOS (arm64) carry their LLVM and
  lld; `install.sh`, `brew install orelang/tap/ore` and `ore update`.
