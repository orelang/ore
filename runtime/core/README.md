# runtime/core

The runtime written in Ore. Every file is a module `ore:runtime/<name>`,
loaded first into every program.

A function marked `//ore:runtime ore_rt_name` implements the runtime function
`ore_rt_name` that generated code calls; once it is written here, its C
version in [`runtime/c`](../c) is deleted. Generated code calls it directly,
in the same LLVM module, so it inlines into the program.

Rules for this code:

- It works on raw memory through `unsafe`, and must not use the operations it
  implements: comparing strings inside `strEq` would call `strEq`.
- It keeps no stack frames, as when it was C: stack traces show the
  program's code.
- A new file is added to `runtimeModules` and `stdModules` in
  [`compiler/project/src/resolve.ts`](../../compiler/project/src/resolve.ts).

| Module | Contents |
|---|---|
| `frames.ore` | `ore_rt_top`, the top of the shadow stack of debug builds, per OS thread |
| `string.ore` | Comparison, concatenation, UTF-8 decoding, search, slicing, split and join, trim, case, replace, repeat, pad |
| `array.ore` | New arrays, push and pop, slicing, reverse, stable sort |
| `map.ore` | Insertion-ordered hash maps, hashing of keys |
| `format.ore` | Integers and booleans as strings |
| `float.ore` | Floats as strings: the shortest decimal that reads back, laid out as in JavaScript (Ryu for f64) |
| `float-tables.ore` | The 128-bit powers of 5 that Ryu multiplies by, generated with exact integers |
| `json.ore` | The string builder, the JSON parser and the helpers of the generated encoders and decoders |
| `number.ore` | `parseInt`, `parseFloat` and `toFixed` as JavaScript computes them, `Math.round`, `Math.cbrt`, `process.getenv` |
| `os.ore` | libc, pthreads and signals, with the sizes and constants of each platform |
| `gc.ore` | The garbage collector: size-classed spans, per-thread allocation, stopping the world with a signal, mark and sweep; `ORE_GCTRACE=1` prints each collection |
| `task.ore` | The M:N scheduler: tasks on mapped stacks, the context switch in assembly, workers, timers, the collector's view of task stacks; per-worker state of the clock and `Math.random` |
| `sys.ore` | Allocation (`ore_rt_alloc`, inlined into every `new`), files, `Date.now`, `Math.random`, C strings, conversion of interface values to narrower interfaces |
| `chan.ore` | Channels and `select` |
| `poll.ore` | Waiting for sockets, pipes and the exit of children: the kqueue or epoll poller thread |
| `fs.ore` | The namespace `fs` in Ore: directories, `stat`, `remove`, `rename`, `realpath`, temporary directories, with the `stat` and `dirent` layouts of each platform |
| `process.ore` | The namespace `process` in Ore: running programs with `posix_spawn`, their output through non-blocking pipes, their exit through the poller, the environment |
| `net.ore` | TCP on non-blocking sockets: listen, connect, accept, read, write, with the socket layouts and constants of each platform |
| `io.ore` | Printing through one shared buffer, and the end of the program |
| `program.ore` | The entry point (`main`), arguments, panics with their stack trace, and the `ore test` runner |
