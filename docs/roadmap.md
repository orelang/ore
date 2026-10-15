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
  - methods and accessors in object literals;
  - `static` members of classes (done; not of generic classes);
  - default values in destructuring, and `...rest` in object destructuring
    (done), optional properties of object types (done);
  - optional, default and rest parameters of closures (done);
  - `**` and `satisfies` (done), `bigint` literals (`10n`);
  - overloads (several signatures of one function; done for top-level
    functions);
  - generic closures, nested generic functions; default type arguments
    (`<T = X>`, done).
- Types:
  - `unknown`;
  - intersections `A & B`;
  - methods in object types (`{ f(): void }`), optional members of
    interfaces (done; not methods), generic methods in interfaces;
  - `keyof`, `typeof x` as a type, indexed access `T["k"]`;
  - conditional types, mapped types and template literal types, and with
    them the utility types (`Partial`, `Pick`, `Record`, `ReturnType`, ...).
- Regular expressions: literals `/re/` and an engine in the standard
  library.

## 4. Toolchain

- A build cache in `~/.cache/ore`: the runtime compiled once per compiler
  and target, objects of unchanged modules reused.
- The language server on the checker: diagnostics, hover with JSDoc, go to
  definition, completion, references and rename (done); signature help,
  JSDoc in completion, workspace-wide references, analysis off the
  keystroke path.
- Diagnostics with codes (`ORE1234`) and a page per code in the
  documentation, linked from the editor (`codeDescription`) and printed by
  the command line; messages that explain the cause and the fix, with the
  related places (`relatedInformation`).

## 5. Own garbage collector

The architecture of Go's collector, in Ore
([`runtime/core/gc.ore`](../runtime/core/gc.ore)). Done: a non-moving
mark-sweep collector that replaced Boehm, with size-classed spans, a page
table for interior pointers, per-thread allocation without locks, stopping
the world with a signal, conservative scanning of stacks and precise roots
for globals, marking on every worker in parallel. Next, in order:

- A precise heap: the compiler emits a bitmap of pointer words per type, as
  Go's `gcdata`, and allocation takes it.
- Concurrent marking: a hybrid write barrier emitted on every store of a
  pointer into the heap (and in bulk copies of the runtime), the world
  stopped only to turn it on and to finish; mark assists for tasks that
  allocate, and a pacer (`GOGC`, a memory limit).
- Concurrent and lazy sweeping; returning free pages to the system.

Stacks stay scanned conservatively: precise stack maps in LLVM need
statepoints around every call, which keep LLVM from inlining Ore calls, and
the collector does not move objects, so it does not need them.

## 6. Promises and async/await

- Promises and `async`/`await` in the JavaScript order of microtasks and
  timers, without exceptions: a promise only resolves, failures are values
  (`Promise<T | Error>`).
- `time.timeout`, `interval`, `immediate`, `delay` (a promise) and `sleep`
  (blocks the task; moved from `task`); timers are cancelled with
  `cancel()`; `task.microtask`.
- Async functions compile to LLVM coroutines (state machines, no stack per
  call) and run synchronously until their first `await`, on one event loop:
  async code is single-threaded, `task.spawn` is parallel. The target is
  Bun's speed: about 20–60 ns per await, microtask or timer.
- The tests are ready in [`tests/async`](../tests/async), with outputs from
  Bun. They decide: a promise resolved from a task wakes the event loop; an
  async function called from a task runs on the event loop; waiting on a
  channel blocks the loop; the program ends when the loop has nothing left
  (pending timers keep it, unsettled promises do not, running tasks are
  stopped); an unsettled top-level await with nothing pending exits with
  status 13 as in Node; a deadlock with tasks panics.

## Later

- Escape analysis for arrays of known size.
- Per-thread run queues with work stealing, if the shared queue becomes a
  bottleneck.
- UDP, TLS and HTTP in the standard library.
- Semantic tokens in the language server.
- `unshift` on arrays.
- Snap package; Windows.
