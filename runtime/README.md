# runtime

Everything compiled into an Ore program besides its own code.

| Directory | Contents |
|---|---|
| [`core`](core) | The runtime written in Ore (`ore:runtime/...`), in every program |
| [`std`](std) | The standard library: built-in declarations and `ore:*` modules |
| `third_party/bdwgc` | The Boehm garbage collector (git submodule) |

`core` and `std` are Ore modules compiled with the program, so their
functions inline into it. The GC is compiled once into a cache. Nothing else
is C: the runtime reaches libc and the GC through `declare function`.
