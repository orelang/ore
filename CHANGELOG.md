# Changelog

All notable changes of Ore. Versions follow [Semantic Versioning](https://semver.org);
before 1.0, a minor version may change the language.

## Unreleased

- The collector marks alongside the program: two short stops (scanning
  the roots, then finishing) instead of one for the whole collection, with
  a write barrier the compiler emits before stores of pointers into the
  heap. It scans objects precisely, by a pointer map of their type, and
  never scans arrays of numbers; it gives free pages back to the system;
  and its pace is set by `ORE_GOGC` and `ORE_MEMLIMIT`. `ORE_GCSTW=1`
  marks with the world stopped, as before.
- `ore doc [file.ore | dirs...]` prints the API of modules: their exported
  functions, classes with their public members, interfaces, type aliases
  and variables, with their signatures as the hover shows them and their
  JSDoc (`@param`, `@returns`, `@example` and other tags), after the `//`
  comment the module starts with. On a terminal it is a colored listing;
  `--md` makes Markdown (with `-o dir`, a file per module and an
  `index.md`), `--json` a JSON dump for tools.
- `ore:test` grows toward `bun:test`: `describe` groups (their names prefix
  their tests', `math > adds`), the hooks `beforeAll`, `afterAll`,
  `beforeEach` and `afterEach`, `skip`, `only` and `todo` (Ore functions
  have no properties, so not `test.skip`), `.not`, and the matchers
  `toEqual` (deep), `toBeNull`, `toBeTruthy`, `toBeFalsy`, `toContain`,
  `toHaveLength`, `toBeGreaterThan(OrEqual)`, `toBeLessThan(OrEqual)`,
  `toBeCloseTo`, `toMatch` and `toPanic` (Ore's `toThrow`: the function
  runs in a task whose panic is caught). Failures show the matcher and the
  expected and received values, as a diff of lines when they take several.
  The tests of a file now run when its top-level code ends, so that `only`
  can apply; a test declared in another task still runs at once. `ore test
  -t <pattern>` runs only the tests whose full names match. The summary
  counts skipped and todo tests.
- The type parameters of generic methods may have defaults
  (`size<U = T>(): int`), as those of functions do; ORE5019 is no longer
  reported. A generic method is checked only for the calls it has, so such
  a method of a generic class can use what only some of its instances have.
- Diagnostics point at the places related to them: the first declaration of
  a name declared twice, the declaration of a variable read before it is
  assigned, the parameter, variable or field a value does not convert to,
  the interface member that is missing or differs, and the overload
  signatures of a call. The command line prints each as a `note:` with its
  position and source line under the error; the language server sends them
  as `relatedInformation`.
- `unknown` as the type of values: any value converts to it, boxed with
  its type, and `console.log` prints it as that type. It can be compared
  with `===`, tested for `null` and narrowed with `typeof` (to `string`,
  `f64`, `bool` or `bigint`) and `instanceof` (to a class), which unbox it;
  anything else is an error, `Object is of type 'unknown'.` (ORE3078).
- Numeric literal types are types of values: `const n: 1 | 2 = 1`,
  `function rotate(d: 0 | 90 | 180 | 270)`, `type Dice = 1 | 2 | 3 | 4 | 5 | 6`.
  Their values are numbers held as an `f64`; they widen to `number`, and
  arithmetic and comparisons see numbers. A constant fits when it equals a
  member (ORE2067); `===` and `switch` narrow them, and a `switch` with a
  case for each is exhaustive. ORE2066 now concerns only `never` inside
  tuples and object types.
- Generic nested functions (`function id<T>(x: T): T` in a function body)
  and generic function literals of a `const` (`const id = <T>(x: T): T =>
  x`): each list of type arguments makes an instance, a closure that
  captures the variables of the enclosing functions like other nested
  functions. They can only be called; used as a value without a call, such
  a function is an error (ORE6071), and one that calls itself needs a
  return type annotation (ORE6072).
- Getters and setters, of classes and of object literals, implement
  interface fields: a getter a `readonly` field, a getter and a setter a
  writable one. Reads and writes through the interface (and through a union
  with interface members) call them. Fields of names that no accessor
  implements are read and written through interfaces as before; the others
  test the table entry first.
- `console.log` colors follow Node's rules for the terminal too: with no
  `TERM`, or one Node does not know, a terminal shows no colors, unless
  `COLORTERM`, `TERM_PROGRAM`, tmux or a known CI service says it does.
- The checker parses `builtin.d.ore` once per process instead of on every
  check, which the language server runs on every change.
- The language server tries a GitHub repository whose download failed
  again a minute later, or at once when a document importing it is saved,
  instead of never in the session.
- `Math.min()` and `Math.max()` with no arguments are `Infinity` and
  `-Infinity`, as in JavaScript (they were ORE4019), or the extreme of the
  integer type expected, as with only empty arrays spread in.
- Regular expressions of the `v` flag take string disjunctions
  (`[\q{abc|d}x]`), longest strings first, in their set operations too; a
  negated class that may hold strings is an error. With `u` (or `v`) and
  `i`, `\w`, `\W`, `\b` and `\B` count `ſ` and the Kelvin sign as word
  characters, as in JavaScript.
- Numeric literal types in computations on types (`Prev[D]`,
  `D extends number = 10`, `[D] extends [never]`); `infer` in template
  literal types; `unknown`, `object`, `Function` and `readonly unknown[]`
  in conditional types; `{}` matched structurally; members of
  intersections narrowed to the types common to their parts. With them, a
  library of utility types is global: `DeepPartial`, `DeepReadonly`,
  `Paths`, `PathValue`, `KeysOfType`, `PickByValueType`, `Merge`,
  `Assign`, `RequiredKeys`, `OptionalKeys`, `Exact` and more.
- `import config from "./config.json" with { type: "json" }` imports a JSON
  file as a constant, parsed when the program is compiled and typed as the
  same literal written in Ore; JSON syntax and type errors point into the
  file, and go to definition leads there. Unknown import types and
  attributes are errors (ORE6067 to ORE6070).
- The value of a JSON import takes the type of the first top-level
  declaration that it initializes, `const c: Config = config`: the file is
  checked against `Config` as an annotated literal would be, so `null` fits
  `string | null` and `[]` fits `string[]`, and errors point into the file.
- Conditional types `T extends U ? X : Y`, distributed over unions, with
  `infer`; mapped types `{ [K in keyof T]?: T[K] }` with `readonly`, `?`,
  `-`/`+` and `as`; template literal types and `Uppercase` and the other
  intrinsic string types. The utility types `Partial`, `Required`,
  `Readonly`, `Pick`, `Omit`, `Record`, `Exclude`, `Extract`, `NonNullable`,
  `ReturnType` and `Parameters` are global names.
- Getters and setters in object literals (`{ get x(): int { ... }, set x(v:
  int) { ... } }`), as in classes: closures whose `this` is the object,
  called by reads and writes of the property; a property with only a getter
  is read-only.
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
- `console.log` prints any value as Node's `util.inspect` does: arrays
  `[ 1, 2, 3 ]`, objects `{ x: 1, y: 'a' }`, class instances
  `Point { x: 1, y: 2 }` (by the class of the instance, also behind an
  interface), `Map(2) { 'a' => 1, 'b' => 2 }`, `Set(1) { 1 }`, tuples,
  functions `[Function: name]`, errors `Error: message`; strings inside
  values quoted, objects deeper than two levels as `[Object]`, at most 100
  entries, cycles as `[Circular *1]`, and Node's line breaking at 80
  columns with arrays of short entries grouped in columns. The code that
  formats a type is generated for it. `-0` prints as `-0`.
- `console.log` colors values as Node does when the output is a terminal:
  numbers, bigints and booleans yellow, strings inside values green, `null`
  bold, functions and `[Circular *1]` cyan, with Node's codes; lines are
  broken by the width without the colors. `FORCE_COLOR` and `NO_COLOR` are
  respected as in Node, `console.error` colors by standard error, and piped
  output stays the same.

- `bigint`, as in JavaScript: literals (`10n`, `0x1fn`), arithmetic with
  truncating division, `**`, shifts and bitwise operations in two's
  complement, comparison by value (also as `Map` keys and `Set` elements),
  `BigInt(x)` from integers, integral floats and text, `i64(b)`, `f64(b)` and
  the other conversions back, `toString(radix)`, `BigInt.parse`,
  `BigInt.asIntN` and `BigInt.asUintN`. Bigints and numbers do not mix:
  `1n + 1` is a compile error (`ORE2065`). `console.log` prints `10n`, as
  Node does.
- The command line prints in Ore's colors on a terminal: the labels,
  carets and links of diagnostics, the commands and headings of `ore help`,
  the ✓ and ✗ of `ore test`. `NO_COLOR` turns them off, `FORCE_COLOR` on;
  24-bit with `COLORTERM=truecolor`, the nearest of 256 with a `256color`
  TERM, the 16 basic colors otherwise. Piped output is unchanged.
- `process.isatty(fd)`: whether a file descriptor is a terminal.
  `fib`, `binary-trees` and `nbody` to start with. The script also prints a
  table of peak memory (from `/usr/bin/time`), skips a benchmark that has a
  `SKIP` file unless `ALL=1` or it is named exactly (`strings` for now), and
  there are `channels`, `tasks` and `regex` benchmarks.
- The language server downloads the repositories imported from GitHub in
  the background, once per session, with work-done progress in the
  editor's status bar; the hover of the import's URL tells the phase of the
  download, the commit cached, or the error.
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
  of values; tuples into any parameters (of built-in functions, methods and
  conversions too: `m.set(...entry)`), array literals and tuples.
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
- Errors for a rest element in a destructuring pattern that is not last
  (ORE7042), has a default value (ORE7043), or in an object pattern is a
  pattern itself (ORE7044); they were accepted before.
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
- Regular expressions: lookbehind `(?<=...)` and `(?<!...)`, matched
  backwards as in JavaScript; the `u` flag (`\u{...}`, `\p{...}` for the
  letter and number categories and the Latin, Greek, Cyrillic and Han
  scripts, the strict syntax, case folding), the `v` flag (nested classes,
  `--` and `&&`) and the `d` flag (`m.indices`, `m.groupIndices`).
- A narrowing `return` inside a loop body no longer narrows after the loop,
  which may run zero times or skip the `return` with `continue` or `break`.
- Maps, sets and channels are scanned precisely by the collector: the
  compiler passes the pointer maps of their keys, values and entries, map
  entries and channel buffers are allocated with them (never scanned when
  they hold no pointers), and the arrays of `keys()` and `values()` carry
  the pointer map of their elements.

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
