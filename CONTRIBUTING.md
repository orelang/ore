# Contributing to Ore

Thanks for your interest. Ore is young and changes fast: before a large
change, open an issue to talk about it.

## Building

The compiler is written in Ore and builds itself. You need LLVM 19 or newer
and lld (`apt install llvm-22-dev lld-22`, `brew install llvm lld`):

```sh
ORE=~/.ore/bin/ore ci/bootstrap.sh dist   # from an installed ore (install.sh)
ci/bootstrap.sh dist                      # without one: from the seed, built once with Bun
```

`dist/ore` is then the compiler built from your tree; the bootstrap fails if
it does not reproduce itself (stages 2 and 3 must emit the same LLVM IR).

The compiler cannot use a language feature that stage 0 (the previous
release) lacks: add the feature first, use it in the compiler after the next
release.

## Testing

```sh
ci/test.sh                    # every test, with dist/ore
ci/test.sh run/basics/        # the cases whose names start with this
ORE_BLESS=1 ci/test.sh run/   # rewrite the expected outputs of tests/run
ci/stress.sh                  # the concurrent programs, many times
```

A change to the language comes with tests in `tests/run` (a program and its
expected output) and `tests/diag` (`// error: ...` annotations), and with
its description in the [specification](docs/spec). Every `.ore` file is
formatted: `dist/ore fmt <paths>`.

## Commits

Commits follow [Conventional Commits](https://www.conventionalcommits.org):
`feat(checker): ...`, `fix(runtime): ...`, `docs(spec): ...`, `ci: ...`. One
change per commit, with a message that says why.

## License

Ore is licensed under either of MIT or Apache-2.0, at your option.

Contributions are accepted under the [Contributor License Agreement](CLA.md):
you assign the copyright in them to the Ore Team, who keep them in Ore under
an open source license and may license Ore under other terms too. On your
first pull request, a bot asks you to sign it with a comment.

## Layout

| Path | Contents |
|---|---|
| [`compiler`](compiler) | The compiler and the `ore` command |
| [`runtime`](runtime) | The runtime (`core`) and the standard library (`std`) |
| [`tests`](tests) | The test programs and the test runner |
| [`docs`](docs) | The specification, the architecture and the roadmap |
| [`ci`](ci) | Bootstrap, tests, packaging and release scripts |
| [`editors`](editors) | Extensions for VS Code and Zed |
