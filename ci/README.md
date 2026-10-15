# ci

- `bootstrap.sh`: builds the compiler in Ore with itself until stages 2 and 3
  emit the same LLVM IR, into `dist/ore`; stage 0 is `$ORE`, or the seed (the
  commit tagged `seed`, the last with the compiler in TypeScript, built once
  with Bun and cached).
- `test.sh`: builds the test runner with `$ORE` (`dist/ore`) and runs every
  test (see [tests](../tests/README.md)).
- `stress.sh`: builds the concurrent tests with `--release` and runs them
  many times, with 1 and 8 threads, printing the first differing output; a
  run stuck for 20 s gets the watchdog's stacks, one stuck for 30 s fails.
- `remote.sh`: runs a command (by default the bootstrap and the tests) in a
  copy of the working tree on a Linux machine.
- `test-linux.sh` and `Dockerfile`: the bootstrap and the tests in Linux
  containers, arm64 and amd64.

The GitLab pipeline is [`.gitlab-ci.yml`](../.gitlab-ci.yml): the bootstrap,
all tests, then `stress.sh`, on x86-64 Linux.
