# runtime/c

The part of the runtime still in C, moving to [`runtime/core`](../core).

| File | Contents |
|---|---|
| `ore.h` | The runtime's interface: types and every function generated code calls |
| `runtime.c` | Panics, the test runner, printing, the program's arguments and entry |
| `net.c` | TCP sockets |

Generated code calls these functions through the `ore_abi_*` wrappers made
from `ore.h` (see [`compiler/codegen/src/abi.ts`](../../compiler/codegen/src/abi.ts)).
When a function moves to Ore, its prototype leaves `ore.h`.

The C code allocates from the Boehm GC directly (`alloc`, `alloc_atomic`):
the allocation functions of generated code are Ore functions
(`runtime/core/sys.ore`) with Ore's conventions, not callable from C.
