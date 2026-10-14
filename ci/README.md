# ci

- `Dockerfile`: the Linux test image (Bun and clang).
- `test-linux.sh`: runs the tests in Linux containers, arm64 and amd64.
- `stress.sh`: builds the concurrent tests with `--release` and runs them
  many times, with 1 and 8 threads, printing the first differing output.

The GitLab pipeline is [`.gitlab-ci.yml`](../.gitlab-ci.yml): typecheck, all
tests, then `stress.sh`, on x86-64 Linux.
