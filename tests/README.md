# tests

End-to-end tests of the language, its runner, and benchmarks. The tests of
the compiler in Ore are in [`compiler/test`](../compiler/test).

## Running them

```sh
ci/bootstrap.sh dist          # dist/ore, which the runner is built with
ci/test.sh                    # everything
ci/test.sh run/basics/ fmt/   # the cases whose names start with these
ORE_BLESS=1 ci/test.sh run/   # rewrite the .out files from the actual output
```

[`ci/test.sh`](../ci/test.sh) builds the runner,
[`runner/main.ore`](runner/main.ore), with `$ORE build` (`dist/ore` by
default, as [`ci/bootstrap.sh`](../ci/bootstrap.sh) makes it), keeps it in `~/.cache/ore/test` by a hash of its
sources, and runs it from the root of the repository. The runner holds the
compiler in Ore (`compiler/src`): it compiles the test programs in its
own process, in one task per CPU, and runs them; the builds share a build
cache of their own in the runner's temporary directory, so that the
runtime is compiled by LLVM once per run. Each case runs as a test of
`"ore:test"`, so a failure, even a panic of the compiler, fails only that
case; it prints `✓` or `✗` and the reason for each case, then the skipped
groups, the failed cases and the counts, and exits with 1 if a case failed.
Options: `--jobs N` (`ORE_TEST_JOBS`), `--timeout SECONDS` (`ORE_TEST_TIMEOUT`,
300 by default: a case that runs longer stops the suite), `ORE_RELEASE=1`
for a release build of the runner.

| Directory | Contents | Cases |
|---|---|---|
| `run/<topic>/` | Programs built and run; stdout must equal the `.out` file | `run/...` |
| `diag/<topic>/` | Programs that must fail to check, with `// error: <message>` on the lines of the errors | `diag/...` |
| `async/` | Async programs with their expected outputs (recorded from Bun), skipped until Ore has async | `async/...` |
| `runner/` | The runner: `main.ore`, `golden.ore` (programs), `fmt.ore` (formatting), `cases.ore` | |
| `bench/` | Benchmarks: `bench/run.sh`, `bench/async/run.sh` | |

Topics: `basics`, `types`, `collections`, `functions`, `errors`,
`concurrency`, `library`, `runtime`, `modules`. A directory with a `main.ore`
is one program of several modules; its output is `main.out`, its
annotations can be in any of its modules.

Header comments of a run test: `// exit: N`, `// stderr: <substring>`
(repeatable), `// threads: N` (OS threads for tasks; 1 by default, for a
stable order), `// env: NAME=value` (repeatable; a program runs with
`FORCE_COLOR=0` unless one sets it). In a diag test, an annotation alone on its line belongs to the
nearest line above with code or an `//ore:` directive, as `ore fmt` moves
comments after `{` into the block; every diagnostic must match an
annotation of its line, and every annotation a diagnostic.

The other cases of the runner:

- `unit/NAME.test.ore`: the tests of `compiler/test`, built and run as
  `ore test` runs them (the checker, the optimizer, the backend's constants,
  module loading, native code, the parser, IR dumps, the language server).
- `fmt/FILE`: every `.ore` file of `tests`, `runtime` and `compiler` must
  be formatted already (but `compiler/test/fmt-cases.ore`, unformatted on
  purpose); on the file and on unformatted variants of it (indentation
  removed, lines joined or broken, single quotes, semicolons, parentheses,
  longer and shorter names, block and line comments), the formatter must keep
  the code and the comments and give the same text when run on its own
  output. `runner --variant NAME FILE` prints a variant. Each file is checked
  in a process of its own (`runner --fmt FILE`): threads that allocate much
  in one process wait for each other's collections.
- `selfhost/`: the compiler in Ore builds itself, and the `ore` it builds
  formats a file and builds a program that runs.
- `watchdog/`: `ORE_WATCHDOG` reports a program blocked on its input.
- `object/`: an executable from LLVM IR and C sources, and IR that does not
  verify.
- `watch/`: `ore run --watch`, as the runner runs itself as `ore`
  (`runner --ore ARGS...`): a program runs again when a module or a text it
  imports changes, a build error is reported and the program runs once it
  is fixed, and the running program is stopped when a file changes.
- `cache/`: the build cache: a second build takes every object from it and
  works, another program takes the runtime's, editing one file of a program
  recompiles that file's part only, and a release build takes its object.

[`ci/stress.sh`](../ci/stress.sh) runs the concurrent programs many times.
