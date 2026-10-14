# runtime/c

The part of the runtime still in C, moving to [`runtime/core`](../core).

| File | Contents |
|---|---|
| `ore.h` | The runtime's interface: types and every function generated code calls |
| `runtime.c` | Allocation, panics, printing, interfaces, process and file functions |
| `net.c` | TCP sockets |

Generated code calls these functions through the `ore_abi_*` wrappers made
from `ore.h` (see [`compiler/codegen/src/abi.ts`](../../compiler/codegen/src/abi.ts)).
When a function moves to Ore, its prototype leaves `ore.h`.
