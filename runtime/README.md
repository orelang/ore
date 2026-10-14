# runtime

Everything compiled into an Ore program besides its own code.

| Directory | Contents |
|---|---|
| [`core`](core) | The runtime written in Ore (`ore:runtime/...`), in every program |
| [`std`](std) | The standard library: built-in declarations and `ore:*` modules |
| [`c`](c) | The part of the runtime still in C, moving to `core` part by part |
| `third_party/bdwgc` | The Boehm garbage collector (git submodule) |

The C runtime and the GC are embedded in the compiler and compiled once into
a cache; `core` and `std` are Ore modules compiled with the program, so their
functions inline into it.
