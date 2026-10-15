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

## 2. Compiler in Ore

Rewrite every package of [`compiler/`](../compiler) in Ore, in
[`compiler/next`](../compiler/next), whose lexer and parser are done.

- The checker works on the parser's tree through typed accessors over its
  generic nodes.
- `try`/`finally` becomes `using`, internal `throw` becomes
  `process.panic`, I/O errors become values.
- `ore fmt` gets its own printer instead of prettier; the language server its
  own JSON-RPC instead of `vscode-languageserver`.
- Bootstrap: the TypeScript compiler builds stage 1, stage 1 builds stage 2,
  stage 2 builds stage 3, and CI checks that stages 2 and 3 emit the same
  LLVM IR. Then the TypeScript compiler is removed, and the compiler builds
  from the previous release.
- Only the oracle tests stay in TypeScript: the parser against TypeScript's,
  and the async references from Bun.

This comes before the GC and async, so that both are written once, in Ore.

## 3. Own garbage collector

The architecture of Go's collector, in Ore
([`runtime/core/gc.ore`](../runtime/core/gc.ore)). Done: a non-moving
mark-sweep collector that replaced Boehm, with size-classed spans, a page
table for interior pointers, per-thread allocation without locks, stopping
the world with a signal, conservative scanning of stacks and precise roots
for globals. Next, in order:

- Marking on every worker in parallel.
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

## 4. Promises and async/await

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
- Methods in object literals, and `unshift` on arrays.
