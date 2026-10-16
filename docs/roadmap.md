# Roadmap

What is done is in the [README](../README.md#status) and the
[specification](spec); this is what comes next, in order.

## 1. Runtime in Ore (done)

The whole runtime is Ore, in [`runtime/core`](../runtime/core): strings,
arrays, maps, number formatting (Ryu), JSON, the scheduler with its context
switch in assembly, channels and `select`, the network poller and sockets,
printing, panics, the `ore test` runner, files and the program's entry point.
Only libc is outside Ore. Most of it is faster than the C it
replaced, since it inlines into the program (array indexing 17 times,
float formatting 44 times), and it agrees with JavaScript where the C did
not (`toFixed`, `parseFloat`, number layout).

Still needed for the compiler in Ore: running a process and reading its
output, directories and paths. Hashing (`ore:crypto`) and files embedded at
compile time (`import x from "./f" with { type: "text" }`) are done.

## 2. Compiler in Ore (done)

The whole toolchain is Ore, in [`compiler`](../compiler): parser, checker,
IR, optimizer, the LLVM backend through LLVM's C API (no clang; lld links),
build driver (debug builds compiled on every CPU), formatter, language
server, and the `ore` command. It bootstraps (`ci/bootstrap.sh`: stages 2
and 3 emit the same LLVM IR) from the seed, the last commit with the
compiler in TypeScript, until it builds from its previous release; the test
suite runs on it (`ci/test.sh`). The compiler in TypeScript, Bun and the
oracle tests against TypeScript, prettier and Bun are gone.

Releases of `ore` (built from the previous release, on GitHub and GitLab,
with `install.sh`, Homebrew and `ore update`) are done.

## 3. Closing the gaps with TypeScript

What TypeScript has and Ore should, before the GC changes the runtime under
it. Not gaps but choices (Go's semantics): `any`, `undefined`, `var`, enums,
namespaces, exceptions, generators, `delete`, `in`, `for...in`, default
exports, type assertions (Ore converts: `i32(x)`).

- Expressions and statements, in order:
  - spread arguments: among the rest arguments, in `push`, `console.log`,
    `Math.min`/`Math.max` (any number of values), and tuples into any
    parameters (done);
  - tuples `[A, B]`: literals, constant indexing, `length`, destructuring,
    JSON as arrays; `new Map(entries)` from any array of pairs (done);
  - the constants and predicates of `Number` (done);
  - `JSON.stringify(value, null, space)` as in JavaScript (done; replacer
    functions are not supported);
  - narrowing through `||` and by assigning with `?:`;
  - object spread `{ ...o }` (done);
  - methods and accessors in object literals (done; accessors implement
    interface fields, in classes too);
  - `static` members of classes (done; not of generic classes);
  - default values in destructuring, and `...rest` in object destructuring
    (done), optional properties of object types (done);
  - optional, default and rest parameters of closures (done);
  - `**` and `satisfies` (done), `bigint` with its literals (`10n`),
    operators, conversions and the namespace `BigInt` (done);
  - overloads (several signatures of one function; done for top-level
    functions);
  - generic closures, nested generic functions (done: nested declarations
    and function literals of a `const`, called only; generic function
    types as values are not supported); default type arguments
    (`<T = X>`, done); type aliases in any order and recursive object types
    (done).
- Types:
  - `unknown` (done: boxed with its type, narrowed by `typeof` and
    `instanceof`);
  - intersections `A & B` (done, of object types and interfaces);
  - methods in object types (`{ f(): void }`, done), optional members of
    interfaces (done; not methods), generic methods in interfaces;
  - `keyof`, `typeof x` as a type, indexed access `T["k"]` (done);
  - conditional types, mapped types and template literal types, and with
    them the utility types (`Partial`, `Pick`, `Record`, `ReturnType`, ...)
    (done); numeric literal types in computations on types, `infer` in
    template literal types, `object`, `Function` and `unknown` in conditional
    types, and a library of more utility types (`DeepPartial`, `Paths`,
    `PathValue`, ...) (done); numeric literal types as types of values
    (done).
- Regular expressions: literals `/re/`, `RegExp` and the string methods
  that take one, with a backtracking engine in the runtime, lookbehind and
  the flags `d`, `u` and `v` with the string disjunctions `\q{...}` (done;
  `\p{...}` knows only the letter and number categories and four scripts).
- The methods of `String.prototype` from MDN, on byte offsets, with
  Unicode's full case mappings and the four normalization forms (done;
  `localeCompare` compares by code point, `String.raw` needs tagged
  templates).
- `globalThis`, as in JavaScript: the global names (`globalThis.console`,
  `globalThis.Math`, `globalThis.Promise`, `globalThis.time`, ...) as
  members of one value, with the type `typeof globalThis`; a module's own
  top-level declarations are not on it, as in ES modules. Adding properties
  at run time is not possible: declared names only, checked at compile
  time.
- Import attributes as in JavaScript (`import x from "./f" with { type: ... }`,
  see [MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/import/with)):
  `type: "json"` imports a JSON file as a typed value, checked against the
  declared type at compile time (done: typed as the equivalent literal, or
  by the first declaration it initializes, `const c: Config = config`, so
  that `null` and empty arrays fit); other attributes as they come (text
  imports are done).

## 4. Toolchain

- A build cache in `~/.cache/ore`: the runtime compiled once per compiler
  and target, objects of unchanged modules reused (done; loading, checking
  and emitting still run on every build).
- The language server on the checker: diagnostics with codes, hover with
  JSDoc, go to definition, completion with JSDoc, signature help,
  references and rename across the workspace, formatting, the outline,
  inlay hints of inferred types, semantic tokens, quick fixes (done);
  checking the runtime once rather than on every change (partly done: the
  runtime and the standard library are parsed once per session and only
  their declarations are checked, not their bodies; reusing their checked
  declarations needs a checker whose state for a group of modules can be
  kept and built upon).
- `console.log` of any value, as Node prints it: objects, class instances
  (`Point { x: 1, y: 2 }`), arrays, maps, sets, nested; strings inside them
  quoted, with Node's colors on a terminal (done).
- A designed command line: the output of `ore` (diagnostics, build and test
  progress, `help`) colored in the Ore brand's colors on terminals that have
  true color, the terminal's default colors otherwise, none when the output
  is not a terminal or `NO_COLOR` is set; one consistent style for headers,
  paths, codes and hints.
- Benchmarks: the same algorithms in Ore, Bun, Node and Go (numbers,
  strings, maps, allocation, JSON, channels and tasks against goroutines and
  promises, regular expressions), run by one script that prints a table of
  times and memory, kept in the repository with their results (started:
  `bench/run.sh` times and measures peak memory of numbers, strings, maps,
  allocation, JSON, channels, tasks and regular expressions; the results are
  not kept yet).
- Modules from GitHub: `import { x } from "https://github.com/owner/repo/..."`
  resolves a module of a repository by its URL, without vendoring it into
  the project: it is downloaded into the cache (`~/.cache/ore`), and
  downloaded again when it is missing or when the head of the repository's
  main branch has a new commit (the hash is checked). The language server
  downloads it as soon as the import is written, showing the progress in the
  editor's status bar (`$/progress`) and in the hover of the import (done:
  [`compiler/src/project/remote.ore`](../compiler/src/project/remote.ore),
  [Modules from GitHub](spec/07-modules.md#modules-from-github); URLs with
  a path and `/tree/<ref>`, downloads by commit with git, the check of the
  head, offline use with a warning, `ore cache clean`, and the language
  server's downloads in background tasks, one at a time).
- Diagnostics with codes (`ORE1234`) and a page per code in the
  documentation, linked from the editor (`codeDescription`) and printed by
  the command line; messages that explain the cause and the fix, with the
  related places (`relatedInformation`) (done: a diagnostic carries notes at
  related places, printed under it by the command line and sent as
  `relatedInformation` by the language server: the first declaration of a
  name declared twice, the declaration of a variable read before it is
  assigned, the parameter, variable or field a value does not convert to,
  the interface member a class or a value lacks, and the overload
  signatures of a call none of them takes).

## 5. Own garbage collector

The architecture of Go's collector, in Ore
([`runtime/core/gc.ore`](../runtime/core/gc.ore)). Done: a non-moving
mark-sweep collector that replaced Boehm, with size-classed spans, a page
table for interior pointers, per-thread allocation without locks, stopping
the world with a signal, conservative scanning of stacks and precise roots
for globals, marking on every worker in parallel; and now:

- A precise heap (done): the compiler emits a pointer map per allocated
  type (`gcdata`), allocation records it per object, and marking reads
  only the pointer words; arrays keep their element type, so buffers of
  numbers are never scanned. Left: maps, sets and channels (in progress).
- Concurrent marking (done, prototype): the world stops to scan the roots
  and turn on a snapshot-at-the-beginning write barrier (emitted before
  every store of a pointer into the heap, and around `unsafe.copy`,
  `unsafe.fill` and atomic stores), runs while the markers mark, and stops
  again to finish and sweep; objects allocated meanwhile are marked.
  Left: mark assists for tasks that allocate during marking (they wait for
  the collection now), shorter second stops.
- A pacer (done): `ORE_GOGC` and a soft limit, `ORE_MEMLIMIT`.
- Giving free pages back to the system (done); left: concurrent and lazy
  sweeping.

- GC pauses down to Go's level (to fix: on a 6 MB live heap with 16
  threads they are 0.3 + 0.8 ms per collection, worst 2.2 ms, against Go
  1.25's 0.14 + 0.05 ms, worst 0.43 ms, on the same workload and machine).
  The target is under 0.5 ms in all: acknowledging a stop with a futex
  instead of polling with 20 µs sleeps, finishing the marking on one
  thread when little is left instead of waking every marker, stopping
  threads cooperatively at safe points rather than by signal, and a
  generational or incremental scheme for allocation-heavy programs.
- The rest of the gaps the benchmarks show (bench/results): sort 2.2×,
  knucleotide 3×, bigint 2.8× (Karatsuba), fileio 2× and wordcount 4× the
  memory of Go; value types for short-lived small objects (structs).

Stacks stay scanned conservatively: precise stack maps in LLVM need
statepoints around every call, which keep LLVM from inlining Ore calls, and
the collector does not move objects, so it does not need them.

## 6. Promises and async/await

Done: promises, `async`/`await` (functions, methods, arrow functions, the
top-level code), `task.microtask`, `time.timeout`, `interval`, `immediate`,
`delay` and `sleep`, in JavaScript's order, without rejections; every test
of [`tests/async`](../tests/async) passes (see
[Concurrency](spec/06-concurrency.md#async-functions-and-promises)). An
async call runs as a fiber, a task the event loop switches to, instead of
an LLVM coroutine. Left:

- Speed: measure awaits, microtasks and timers against Bun (about 20–60 ns
  each); if fibers are far off, compile async functions to LLVM coroutines
  (state machines, no stack per call), or keep fibers and shrink their
  stacks.
- `Promise`'s internal members (`resolveWith`, `react`, `fulfill`,
  `values`) are public, as the runtime's functions use them; members
  private to a module would hide them.
- `Promise.withResolvers`, `await` of a union of a promise and other values.
- `task.sleep(ms)` and `task.after(ms)` still count milliseconds: to
  nanoseconds, as the rest of `time`.
- Generators and iterators on the same fibers.

## Later

- Escape analysis for arrays of known size.
- UDP, TLS and HTTP in the standard library.
- Semantic tokens in the language server.
- Snap package; Windows.
