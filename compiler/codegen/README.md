# @ore/codegen

Generates textual LLVM IR from the [IR](../ir); the [driver](../driver)
builds it with clang.

The emitter is one class split into layers, each file extending the one
before it, as in the checker:

| File | Contents |
|---|---|
| `emit.ts` | `emitModule`: assembles the module (types, globals, functions, `ore_entry`) |
| `base.ts` | State, LLVM types (`%ore.str`, `%ore.iface`, `%S.<id>` for structs, `%U.<id>` for unions), constants, runtime calls, memory, locals |
| `functions.ts` | Functions (with the shadow stack of frames in debug builds) and statements |
| `expressions.ts` | Expressions and unions |
| `calls.ts` | Calls and closures, strings and printing, built-ins (`unsafe`, inline assembly) |
| `collections.ts` | Arrays, maps, channels, interface tables |
| `json.ts` | JSON encoders and decoders generated per type |
| `context.ts`, `helpers.ts` | Shared names and types, pure functions |

- `ll.ts`: building LLVM IR text: a function builder with blocks and
  temporaries, and constants (integers, exact hexadecimal floats, strings).
