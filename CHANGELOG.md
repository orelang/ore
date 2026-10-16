# Changelog

All notable changes of Ore. Versions follow [Semantic Versioning](https://semver.org);
before 1.0, a minor version may change the language.

## Unreleased

- Conditional types `T extends U ? X : Y`, distributed over unions, with
  `infer`; mapped types `{ [K in keyof T]?: T[K] }` with `readonly`, `?`,
  `-`/`+` and `as`; template literal types and `Uppercase` and the other
  intrinsic string types. The utility types `Partial`, `Required`,
  `Readonly`, `Pick`, `Omit`, `Record`, `Exclude`, `Extract`, `NonNullable`,
  `ReturnType` and `Parameters` are global names.
- Types computed from others: `keyof T`, indexed access `T["k"]`,
  `T["a" | "b"]` and `T[number]`, and `typeof x` (or `typeof x.y`) as a type.
- Benchmarks in `bench/`: the same algorithms in Ore, TypeScript (Bun and
  Node) and Go, built and timed by `bench/run.sh`, which checks that every
  runtime prints the same output and prints a markdown table of times;
  `fib`, `binary-trees` and `nbody` to start with.
- Arrays have `shift()`, `unshift(...values)` and `splice(start, count?,
  ...values)` as in JavaScript; `shift` panics on an empty array, like `pop`.
- Modules from GitHub: `import { x } from "https://github.com/owner/repo"`,
  with a path in the repository and `/tree/<ref>` for a branch, tag or
  commit. The repository is downloaded with git into the cache
  (`~/.cache/ore/modules/github/<owner>/<repo>/<commit>`), and again when
  its branch has a new commit; offline, the cached commit is used with a
  warning. `ore cache` counts the downloaded modules, `ore cache clean`
  removes them.
- `ore run --watch` builds and runs the program again whenever one of its
  files changes (its modules, the files they import as text, package.json),
  stopping the one that runs; a build error is printed and the next change
  builds again. `ore build --watch` and `ore test --watch` too.
- Breaking: `new process.Command(...)` is gone. Programs are run by
  functions: `process.run`, `process.output` and the new `process.spawn`
  take the program and its arguments, and the nested namespace
  `process.command` has `run`, `output` and `spawn` with a third parameter,
  a `process.CommandOptions` (`cwd`, `env`, `clearEnv`, `stdin`, each
  optional): `process.command.run("make", [], { cwd: "build" })`.
- `process.spawn` and `process.command.spawn` start a program without
  waiting for it: a `process.Child` with `pid`, `wait()` and `kill(signal)`.
- Built-in namespaces can be nested, as `process.command` in `process`.
- Diagnostics have codes (`error[ORE2033]`) and a page each in
  `docs/errors`, linked from the command line and the language server.
- The language server runs the checker: type errors, hover with the
  signature or type and the JSDoc comment, go to definition (also into the
  standard library), completion after `.` with the members' comments,
  signature help, references and rename across the workspace, formatting,
  the outline, the inferred types of variables as inlay hints, semantic
  tokens from the checker, and quick fixes for the errors that say their fix
  (an explicit conversion, `===`, `let`, a misspelled name, an extra `!`).
- The language server parses the runtime and the standard library once per
  session and checks only their declarations, not the bodies of their
  functions and classes: an analysis of a small file takes about half the
  time.
- A build cache in `~/.cache/ore` (`$ORE_CACHE`, `$XDG_CACHE_HOME`;
  `ORE_CACHE=off` turns it off): LLVM's object files are kept by a hash of
  their IR, the compiler and the target. Debug builds are split by source
  file, so that the runtime is compiled once per compiler and an edit
  recompiles only the files it changes; release builds reuse the object of
  an unchanged program. `ore cache` prints its size, `ore cache clean`
  empties it.
- The editor extensions are released with Ore and carry its version: each
  release has `ore-vscode-vX.Y.Z.vsix`, also published to the Visual Studio
  Marketplace and Open VSX, and `ore-zed-vX.Y.Z.zip`, to install in Zed as a
  dev extension.
- Tuples `[A, B]`: literals in their context, constant indexing, `length`,
  destructuring (an array literal destructured by an array pattern is one),
  inference of generic parameters, JSON as arrays. `new Map(entries)` from
  any array of `[K, V]` tuples or another map, and `map.entries()`.
- Spread arguments: arrays among the rest arguments (`f(1, ...xs, 2)`) and
  into `push`, `console.log`, `Math.min` and `Math.max`, which take any number
  of values; tuples into any parameters, array literals and tuples.
- Object spread `{ ...o, x: 1 }`.
- `**` and `**=`, and `satisfies`.
- Static members of classes: `C.count`, `C.make()`.
- Optional, default and rest parameters of closures and function types.
- Overload signatures of top-level functions.
- Default type arguments: `<T, C = T[]>`.
- Intersections `A & B` of object types and interfaces.
- Methods in object literals (`{ add(n: int) { this.count += n } }`) and in
  object types, which are structural interfaces.
- Type aliases in any order, and recursive object types
  (`type Tree = { value: int; children: Tree[] }`).
- `typeof` of a function is `"function"`.
- `JSON.stringify(value, null, space)` takes its arguments as in JavaScript;
  `JSON.stringify(value, 2)` is now an error.
- Optional properties of object types and interfaces (`name?: T`), default values in
  destructuring (`{ size = 1 }`, `[x = 0]`) and `...rest` in object patterns.
- `??=`, `||=` and `&&=`; an assigned `?:` narrows to its branches' types.
- `Number.NaN`, the infinities and the other constants of `Number`, and
  `Number.isNaN`, `isFinite`, `isInteger`, `isSafeInteger`.
- Regular expressions as in JavaScript: literals `/ab+c/gi` (their errors at
  compile time), `new RegExp(pattern, flags)`, `test`, `exec` and `lastIndex`
  with the flags `g`, `i`, `m`, `s` and `y`, and `match`, `matchAll`,
  `replace`, `replaceAll` (with `$1`, `$<name>` and functions), `split` and
  `search` on strings; a backtracking engine written in Ore in the runtime.
- Building a string by appending (`s += piece` in a loop) takes linear time
  instead of quadratic: a concatenation's buffer has room after its text, and
  the next append to the string that ends it writes in place, growing the
  buffer twice as large when it is full, like Go's `append`.

## 0.1.1

- Code is generated for the baseline CPU of the architecture instead of the
  building machine's (`ORE_CPU=native` opts in): the Linux x86-64 release of
  0.1.0, built on CI with that machine's instructions, crashed with an
  illegal instruction on other processors.

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
