# @ore/codegen

Generates textual LLVM IR from the [IR](../ir); the [driver](../driver)
builds it with clang.

- `emit.ts`: `emitModule`. Ore types map to LLVM types (`%ore.str`,
  `%ore.iface`, `%S.<id>` for structs, `%U.<id>` for unions); functions,
  statements and expressions; runtime calls; maps, channels, JSON coders;
  the `unsafe` functions and inline assembly. Debug builds keep a shadow
  stack of frames for stack traces.
- `ll.ts`: building LLVM IR text: a function builder with blocks and
  temporaries, and constants (integers, exact hexadecimal floats, strings).
- `abi.ts`: calls into the part of the runtime still in C. Every function
  of [`ore.h`](../../runtime/c/ore.h) gets a C wrapper `ore_abi_*` that takes
  structs by pointer and integers as 64 bits, a convention that is the same
  in LLVM IR on every target. A runtime function written in Ore
  (`//ore:runtime`) is called directly instead.
