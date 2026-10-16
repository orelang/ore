# Benchmarks

The same algorithms written in Ore, TypeScript (run by Bun and by Node) and
Go, timed by one script.

```sh
bench/run.sh                 # every benchmark with every installed runtime
bench/run.sh fib nbody       # only the benchmarks whose name contains a filter
ORE=./ore1 bench/run.sh      # with a given Ore compiler
RUNS=10 bench/run.sh         # 10 timed runs instead of 5
RUNTIMES="ore go" bench/run.sh
ALL=1 bench/run.sh           # also the benchmarks that have a SKIP file
bench/run.sh strings         # a skipped benchmark, named exactly
```

The script builds Ore with `ore build --release` and Go with `go build`,
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

## Benchmarks

| Name | What it measures | Size |
|---|---|---|
| `fib` | naive recursive Fibonacci: calls and integer arithmetic | n |
| `binary-trees` | the Benchmarks Game's binary trees: allocation of short-lived objects | maximum depth |
| `nbody` | the Benchmarks Game's n-body simulation: floating point and fields | steps |
| `channels` | a pipeline of three tasks over buffered channels (goroutines in Go, async functions and promises in TypeScript) | values sent |
| `tasks` | spawning many tasks that each compute a little and joining them (a `WaitGroup` in Ore and Go, `Promise.all` in TypeScript) | tasks |
| `regex` | regular expressions over a generated log: tests, groups, a global match, a replacement and a split | lines |

## Skipped benchmarks

A benchmark whose directory has a file `SKIP` is left out unless `ALL=1` is
set or a filter is exactly its name; the first line of the file says why, and
the script prints it. `strings` is skipped until `s += x` in Ore stops copying
the whole string each time; remove its `SKIP` file once it does.

## Adding a benchmark

A benchmark is a directory `bench/<name>/` with:

- `main.ore`, the Ore program;
- `main.ts`, one file run by both `bun main.ts` and
  `node --experimental-strip-types main.ts`: plain TypeScript without imports
  (only erasable type syntax);
- `main.go`, `package main` using only the standard library;
- `size`, a one-line file with the default problem size.

Each program reads the problem size from its first argument (`process.args[0]`
in Ore, `process.argv[2]` in TypeScript, `os.Args[1]` in Go), falling back to
the same default as `size`, and prints a deterministic result that is the same
in every language, so that the outputs can be compared byte for byte. The
programs implement the same algorithm the same way: the point is to compare
the runtimes, not the cleverness of each version.
