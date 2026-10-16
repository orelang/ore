# Environment variables

The variables that change what `ore` and the programs it builds do. Sizes
take a unit `K`, `M` or `G` (powers of 1024), as in `ORE_STACK=64M`.

## Programs

Read by every program when it starts.

| Variable | Effect |
| --- | --- |
| `ORE_THREADS` | The number of OS threads that run tasks; one per CPU by default ([concurrency](spec/06-concurrency.md)) |
| `ORE_STACK` | The size of every task's stack, the top-level code's included; 1 MiB for tasks and 8 MiB for the top-level code by default, at least 64 KiB ([concurrency](spec/06-concurrency.md)) |
| `ORE_WATCHDOG` | Seconds without progress after which the program prints the state of its tasks and threads and exits with status 3, for tests ([concurrency](spec/06-concurrency.md)) |
| `ORE_GOGC` | How much the heap grows between collections, in percent of the live heap: 100 by default, `off` to collect only as the heap nears `ORE_MEMLIMIT` |
| `ORE_MEMLIMIT` | A soft limit of the heap's size, such as `512M`, above which the collector runs more often |
| `ORE_GCPROCS` | The number of threads that mark; one per CPU by default |
| `ORE_GCSTW` | When set, the collector marks with the program stopped instead of alongside it |
| `ORE_GCTRACE` | When set, each collection prints a line of statistics |
| `FORCE_COLOR`, `NO_COLOR`, `NODE_DISABLE_COLORS` | Colors of `console.log` and `console.error`, as in Node ([built-in namespaces](spec/02-types.md#built-in-namespaces)) |
| `ORE_TEST_NAME_PATTERN` | In a test program, runs only the tests whose full names match this regular expression; set by `ore test -t` ([tests](spec/08-tests.md)) |

## The compiler

Read by `ore`.

| Variable | Effect |
| --- | --- |
| `ORE_CACHE` | The directory of the build cache, or `off` to turn the cache off; by default `$XDG_CACHE_HOME/ore` or `~/.cache/ore` |
| `ORE_CPU` | `native` builds for the CPU of this machine instead of the baseline of its architecture |
| `ORE_LD` | The linker to use instead of the `ld.lld` or `ld64.lld` found beside `ore`, in `PATH` or in LLVM's directories |
| `ORE_DOCS` | The address of the page of a diagnostic code, with `{code}` for the code; by default the pages in [`errors`](errors/README.md) on GitHub |
| `ORE_RELEASES` | The GitHub repository `ore update` takes releases from; `orelang/ore` by default |
| `FORCE_COLOR`, `NO_COLOR` | Colors of diagnostics, `ore help` and `ore test` on a terminal; `COLORTERM=truecolor` gives 24-bit colors |
