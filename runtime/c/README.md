# runtime/c

No C is left in the runtime: everything moved to [`runtime/core`](../core).
What remains is `ore.h`, the interface that generated code still reaches
through C:

| File | Contents |
|---|---|
| `ore.h` | Types, and inline helpers of interface values and of integer arithmetic |

Generated code calls the functions of `ore.h` through the `ore_abi_*`
wrappers made from it (see [`compiler/codegen/src/abi.ts`](../../compiler/codegen/src/abi.ts)),
which the driver compiles with clang. The functions that `ore.h` still
declares and that the runtime in Ore implements (such as `ore_rt_run_main`)
are exported from Ore with `//ore:export`.
