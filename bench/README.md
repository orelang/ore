# Benchmarks

The same algorithms written in Ore, C, Go and TypeScript (run by Bun and by
Node), timed by one script.

```sh
bench/run.sh                 # every benchmark with every installed runtime
bench/run.sh fib nbody       # only the benchmarks whose name contains a filter
ORE=./ore1 bench/run.sh      # with a given Ore compiler
CC=gcc-14 bench/run.sh       # with a given C compiler (default: cc)
RUNS=10 bench/run.sh         # 10 timed runs instead of 5
RUNTIMES="ore c go" bench/run.sh
ALL=1 bench/run.sh           # also the benchmarks that have a SKIP file
bench/run.sh <name>          # a skipped benchmark, named exactly
bench/run.sh -o out.md       # also write the markdown to out.md (or RESULTS=out.md)
```

The script builds Ore with `ore build --release`, C with
`$CC -std=c17 -O2 -march=native -pthread` and Go with `go build`,
runs each program once and checks that every runtime printed the same output,
then times each one and prints two markdown tables: the best time of `RUNS`
runs in milliseconds and its ratio to the fastest runtime of the row, and the
peak memory (maximum resident set size) of the checking run in megabytes and
its ratio to the smallest of the row. The memory is read from `/usr/bin/time`
(`-l` on macOS, `-v` with GNU time on Linux, the `time` package on Debian and
Ubuntu); without it the memory cells are `-`. It uses
[hyperfine](https://github.com/sharkdp/hyperfine) when it is installed (one
warmup run) and the shell's clock otherwise. A runtime that is not installed
is skipped; one whose output differs is shown as `wrong`, and the script then
exits with 1. Node needs version 22.6 or later for `--experimental-strip-types`.
The columns are always in the order ore, c, go, bun, node, whatever the
order of `RUNTIMES`.

The output is markdown. Before the tables comes a header: the date, the
machine (CPU model, cores and threads, memory, OS and kernel, read with
`sysctl` and `sw_vers` on macOS and from `lscpu`, `/proc/cpuinfo`,
`/proc/meminfo` and `/etc/os-release` on Linux), the commit of the
repository, the exact version of each toolchain (`ore version`,
`cc --version`, `go version`, `bun --version`, `node --version`), `RUNS` and
how the times and the memory were measured. With `-o path` or `RESULTS=path`
the same markdown is written to that file too.

## Results

Runs worth keeping are committed by the maintainer under
`bench/results/<date>-<host-label>.md`, for example
`bench/results/2026-10-16-m4-mac.md`: the file written by
`bench/run.sh -o`, unchanged, with a short label for the machine that is the
same from one run to the next. Contributors do not commit results; numbers
from different machines are not comparable, which is why each file carries
its header.

## Benchmarks

| Name | What it measures | Size |
|---|---|---|
| `fib` | naive recursive Fibonacci: calls and integer arithmetic | n |
| `binary-trees` | the Benchmarks Game's binary trees: allocation of short-lived objects | maximum depth |
| `nbody` | the Benchmarks Game's n-body simulation: floating point and fields | steps |
| `channels` | a pipeline of three tasks over buffered channels (goroutines in Go, async functions and promises in TypeScript) | values sent |
| `tasks` | spawning many tasks that each compute a little and joining them (a `WaitGroup` in Ore and Go, `Promise.all` in TypeScript) | tasks |
| `regex` | regular expressions over a generated log: tests, groups, a global match, a replacement and a split | lines |
| `fannkuch-redux` | the Benchmarks Game's fannkuch-redux: permutations of small integer arrays | n |
| `spectral-norm` | the Benchmarks Game's spectral norm: floating-point loops over arrays | n |
| `strings` | concatenating, joining, splitting, scanning and searching strings | pieces |
| `map` | inserting, looking up, deleting and iterating integer and string keys | keys |
| `json` | writing an array of objects as JSON text and reading it back | objects |
| `sort` | sorting pseudo-random integers, then strings, with the built-in sort | integers |
| `matmul` | naive multiplication of f64 matrices in flat arrays | n |
| `mandelbrot` | the Benchmarks Game's Mandelbrot bitmap, hashed: floating point and bit operations | n |
| `nqueens` | counting n-queens solutions over arrays and over bitmasks: recursion | n |
| `sha256` | a hand-written SHA-256 over a buffer: 32-bit integer operations | rounds |
| `knucleotide` | the Benchmarks Game's k-nucleotide: counting k-mers in string-keyed maps | nucleotides |
| `wordcount` | splitting a generated text into words and counting them in a map | words |
| `dispatch` | calls through an interface to methods of four classes: dynamic dispatch | passes |
| `closures` | chains of map, filter and reduce with capturing callbacks | rounds |
| `structs` | moving particles with an immutable vector type: short-lived objects in Ore and TypeScript, value types in Go and C | steps |
| `bigint` | a factorial by multiplication and a Fibonacci number by addition | n |
| `fileio` | writing a file of numbers, reading it back and summing them | lines |
| `startup` | hello world: starting a process and the runtime | lines |

The C versions use only the C17 standard library and POSIX, as a C program
without dependencies would: `channels` is a mutex and condition-variable
bounded queue between pthreads, `tasks` a fixed pool of one thread per CPU
with a task queue, `regex` POSIX extended expressions from `regex.h` (with
`[0-9]`, `[A-Za-z0-9_]` and `[[:space:]]` for `\d`, `\w` and `\s`), `map` an
open-addressing hash table and `json` a writer and a reader written for its
one shape. Memory is freed with `free` where the others have a collector.

## Skipped benchmarks

A benchmark whose directory has a file `SKIP` is left out unless `ALL=1` is
set or a filter is exactly its name; the first line of the file says why, and
the script prints it.

## Adding a benchmark

A benchmark is a directory `bench/<name>/` with:

- `main.ore`, the Ore program;
- `main.ts`, one file run by both `bun main.ts` and
  `node --experimental-strip-types main.ts`: plain TypeScript without imports
  (only erasable type syntax);
- `main.go`, `package main` using only the standard library;
- `main.c`, C17 with only the C library, POSIX and pthreads, built with
  `$CC -std=c17 -O2 -march=native -pthread main.c -lm`;
- `size`, a one-line file with the default problem size.

Each program reads the problem size from its first argument (`process.args[0]`
in Ore, `process.argv[2]` in TypeScript, `os.Args[1]` in Go, `argv[1]` in C), falling back to
the same default as `size`, and prints a deterministic result that is the same
in every language, so that the outputs can be compared byte for byte. The
programs implement the same algorithm the same way: the point is to compare
the runtimes, not the cleverness of each version.
