# runtime

Everything compiled into an Ore program besides its own code.

| Directory | Contents |
|---|---|
| [`core`](core) | The runtime written in Ore (`ore:runtime/...`), in every program |
| [`std`](std) | The standard library: built-in declarations and `ore:*` modules |

`core` and `std` are Ore modules compiled with the program, so their
functions inline into it, the garbage collector (`core/gc.ore`) included.
Nothing else is C: the runtime reaches libc through `declare function`.
