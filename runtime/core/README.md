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
| `string.ore` | Comparison, concatenation, UTF-8 decoding, search, slicing, split and join, trim, case, replace, repeat, pad |
| `array.ore` | New arrays, push and pop, slicing, reverse, stable sort |
| `map.ore` | Insertion-ordered hash maps, hashing of keys |
| `format.ore` | Integers and booleans as strings |

Next: printing and number formatting, JSON, the network, the scheduler.
