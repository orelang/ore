# Roadmap

What is done is in the [README](../README.md#status) and the
[specification](spec); this is what comes next, in order.

## 1. Runtime in Ore (in progress)

Port the C runtime ([`runtime/c`](../runtime/c)) to Ore
([`runtime/core`](../runtime/core)) part by part, deleting each C function
once its Ore version passes the tests. Only libc and the GC stay outside Ore.

- Done: strings (comparison, concatenation, UTF-8 decoding, search, slicing,
  split and join, trim, case, replace, repeat, pad), about 18% faster on a
  string benchmark; arrays (new, push, pop, slice, reverse, stable sort),
  about 1.9 times faster on an array benchmark; maps and hashing, about 15%
  faster; integers and booleans as strings, about 2.4 times faster in
  template literals. The speed comes from inlining into the program.
  Floats as strings, for printing, template literals and JSON: the same as
  JavaScript in every case (the C version wrote `1e-6` where JavaScript
  writes `0.000001`), with Ryu about 44 times faster than the C version and
  close to Bun.
  JSON: the string builder, the parser and the decoding helpers, the same
  as the C version in every message and as fast. Numbers: `parseInt`,
  `parseFloat` and `toFixed` now as JavaScript computes them (the C version
  rounded `(2.5).toFixed(0)` to `2` and read `parseFloat("0x10")` as 16).
  The scheduler: tasks with the context switch in assembly, workers,
  timers, channels, `select` and the network poller, about as fast as the C
  version. Allocation, inlined into every `new`, at least as fast as the C
  version; files, the clock, `Math.random`, C strings and the conversion of
  interface values.
- Next: printing, panics and the test runner, the network functions and the
  program's entry;
  printing moves with the scheduler, since the C runtime's own output
  (panics, `ore test`) must keep its order with it.
- Also: the system part of the standard library that the compiler in Ore
  will need: running a process with its output, directories and paths,
  hashing, files embedded in the binary.

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

A precise collector in Ore, with LLVM stack maps, replacing Boehm.

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
