# runtime/core

The runtime written in Ore. Every file is a module `ore:runtime/<name>`,
loaded first into every program.

A function marked `//ore:runtime ore_rt_name` implements the runtime function
`ore_rt_name` that generated code calls. Generated code calls it directly,
in the same LLVM module, so it inlines into the program.

Rules for this code:

- It works on raw memory through `unsafe`, and must not use the operations it
  implements: comparing strings inside `strEq` would call `strEq`.
- It keeps no stack frames, as when it was C: stack traces show the
  program's code.
- A new file is added to `runtimeModules` and `stdModules` in
  [`compiler/src/project/resolve.ore`](../../compiler/src/project/resolve.ore),
  which embeds it as text.

| Module | Contents |
|---|---|
| `frames.ore` | `ore_rt_top`, the top of the shadow stack of debug builds, per OS thread |
| `string.ore` | Comparison, concatenation, search, slicing, split and join, trim, replace, repeat, pad: the methods of `String.prototype` on bytes |
| `unicode.ore` | UTF-8 decoding and encoding, full case mapping with the final sigma, the normalization forms NFC, NFD, NFKC and NFKD |
| `unicode-tables.ore` | The Unicode data of `unicode.ore`, generated from node by [`ci/unicode-tables.js`](../../ci/unicode-tables.js) |
| `array.ore` | New arrays, push, pop, shift, unshift and splice, slicing, reverse, stable sort |
| `map.ore` | Insertion-ordered hash maps, hashing of keys |
| `collections.ore` | The methods of `Map` and `Set` that take callbacks or other sets (`forEach`, `union`, `isSubsetOf`...), generic functions the checker calls with the receiver first; the namespace `Map` (`Map.groupBy`) |
| `object.ore` | The namespace `Object` on dictionaries (`fromEntries`, `groupBy`), and the copying and freezing of dictionaries that the checker calls for `Object.assign` and `Object.freeze` |
| `format.ore` | Integers and booleans as strings |
| `float.ore` | Floats as strings: the shortest decimal that reads back, laid out as in JavaScript (Ryu for f64) |
| `float-tables.ore` | The 128-bit powers of 5 that Ryu multiplies by, generated with exact integers |
| `inspect.ore` | Formatting values as `console.log` prints them, as Node's `util.inspect` does: the layout and colors that the formatter the compiler generates for each type calls |
| `json.ore` | The string builder, the JSON parser and the helpers of the generated encoders and decoders |
| `bigint.ore` | `bigint`: arithmetic, Knuth's division, shifts and bitwise operations in two's complement, comparison, hashing, conversions to and from numbers and text in radixes 2 to 36; the namespace `BigInt` |
| `number.ore` | `parseInt`, `parseFloat`, `toString(radix)`, `toFixed`, `toPrecision`, `toExponential` and `toLocaleString` as JavaScript computes them, `Math.round`, `Math.cbrt`, `Math.pow`, `process.getenv`; the namespace `Number` |
| `math.ore` | The namespace `Math` beyond libm: `hypot`, `clz32`, `imul`, `fround`, `f16round` |
| `os.ore` | libc, pthreads and signals, with the sizes and constants of each platform |
| `gc.ore` | The garbage collector: size-classed spans, per-thread allocation, a precise heap (a pointer map per type from the compiler), marking alongside the program behind a write barrier with two short stops, a pacer, sweeping, and giving free pages back to the system. Settings: `ORE_GOGC` (percent the heap grows between collections, 100; `off`), `ORE_MEMLIMIT` (a soft heap limit, e.g. `512M`), `ORE_GCPROCS` (markers), `ORE_GCSTW=1` (mark with the world stopped), `ORE_GCTRACE=1` (print each collection) |
| `task.ore` | The M:N scheduler: tasks on mapped stacks, the context switch in assembly, workers, timers, the collector's view of task stacks; per-worker state of the clock and `Math.random` |
| `sys.ore` | Allocation (`ore_rt_alloc`, inlined into every `new`), files, `Math.random`, C strings, conversion of interface values to narrower interfaces |
| `iterator.ore` | Generators on fibers of their own, the iteration protocol, the iterators of arrays, maps and sets, and the iterator helpers of `IteratorObject` (`map`, `filter`, `take`, `flatMap`...) |
| `iterator-from.ore` | The namespace `Iterator` (`Iterator.from`) |
| `chan.ore` | Channels and `select` |
| `poll.ore` | Waiting for sockets, pipes and the exit of children: the kqueue or epoll poller thread |
| `fs.ore` | The namespace `fs` in Ore: directories, `stat`, `remove`, `rename`, `realpath`, temporary directories, with the `stat` and `dirent` layouts of each platform |
| `regexp-syntax.ore` | Regular expressions parsed and compiled into programs for the matcher, with JavaScript's syntax and errors; also imported by the compiler, which checks literals with it, so it uses only what stage 0 of the bootstrap compiles |
| `regexp.ore` | The global classes `RegExp` and `RegExpMatch`: the backtracking matcher over UTF-8, `exec`, `test`, `lastIndex`, and the string methods that take a regular expression (`s.match(re)` calls `re`'s private `stringMatch`) |
| `date.ore` | The global class `Date`: the calendar arithmetic of ECMAScript, the local time zone from `TZ` or `/etc/localtime` (TZif files and POSIX rules), `Date.parse`, the string forms, and how `console.log` and `JSON.stringify` write a date |
| `text.ore` | The global classes `TextEncoder` and `TextDecoder` (UTF-8 as the Encoding Standard reads it) and the global functions `atob` and `btoa` (base64 of binary strings) |
| `url.ore` | The global classes `URL` and `URLSearchParams`: the WHATWG URL Standard's parser and its state overrides for the setters, IPv4 and IPv6 hosts, percent-encoding, the form encoding of queries, and how `console.log` and `JSON.stringify` write them |
| `spawn.ore` | Starting programs with `posix_spawn`, their output through non-blocking pipes, their exit through the poller: for `process` and `process.command` |
| `process.ore` | The namespace `process` in Ore: `run`, `output` and `spawn` without options, `Child`, `Output`, `CommandOptions`, the environment |
| `process-command.ore` | The namespace `process.command`, nested in `process`: `run`, `output` and `spawn` with a `process.CommandOptions` |
| `net.ore` | TCP on non-blocking sockets: listen, connect, accept, read, write, with the socket layouts and constants of each platform |
| `io.ore` | Printing through one shared buffer, and the end of the program |
| `time.ore` | The namespace `time`: the clocks and durations in nanoseconds, `parse` and `format` |
| `types.ore` | The utility types of TypeScript (`Partial`, `Pick`, `Record`...) and more (`DeepPartial`, `Paths`...), global names in every module |
| `program.ore` | The entry point (`main`), arguments, panics with their stack trace, and what `ore:test` needs: a body run in a task whose panic is caught, and a call when the top-level code ends |
