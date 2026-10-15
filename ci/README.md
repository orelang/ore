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

## Releases

A tag `vX.Y.Z` runs [`release.yml`](../.github/workflows/release.yml) on
GitHub and the `release` job of the GitLab pipeline. Its scripts:

- `versions.sh`: the version of Ore is `compiler/package.json`'s, and the
  editor extensions carry the same (`editors/vscode/package.json` and its
  lock, `editors/zed/extension.toml`, `Cargo.toml` and `Cargo.lock`).
  Without arguments it checks that they agree and prints the version; with
  `vX.Y.Z` it checks that they all are `X.Y.Z`; `--set X.Y.Z` sets them all.
- `package.sh`: packs a bootstrapped `ore` with its LLVM and lld as
  `ore-vX.Y.Z-<os>-<arch>.tar.gz`.
- `extensions.sh <tag> <out-dir>`: packs `ore-vscode-<tag>.vsix` (with npm
  and vsce) and `ore-zed-<tag>.zip` (the Zed extension's sources).
- `notes.sh <tag>`: the release notes, from `CHANGELOG.md`.
- `formula.sh <tag> <SHA256SUMS>`: the Homebrew formula.

The workflow fails unless `ore version` and every extension carry the tag's
version. It bootstraps and tests on Linux (amd64, arm64) and macOS (arm64),
packs the archives and the extensions, makes the GitHub Release with them
and `SHA256SUMS`, updates `orelang/homebrew-tap` (secret `HOMEBREW_TAP_KEY`)
and publishes the `.vsix` to the Visual Studio Marketplace (secret
`VSCE_PAT`, publisher `ore-lang`) and to Open VSX (secret `OVSX_PAT`,
namespace `ore-lang`); a publish whose secret is not set is skipped. The
GitLab job waits for the GitHub Release, checks its files against
`SHA256SUMS` and copies them to the package registry and a GitLab Release.

To release `X.Y.Z`:

1. `ci/versions.sh --set X.Y.Z`
2. In `CHANGELOG.md`, rename `## Unreleased` to `## X.Y.Z` (the notes are
   that section) and start a new `## Unreleased` above it.
3. Commit (`chore: release X.Y.Z`), tag `vX.Y.Z` on that commit, and push
   `main` and the tag to both remotes (`github`, which builds the release,
   and `origin`, whose pipeline copies it).
