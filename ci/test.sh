#!/bin/sh
# The test suite without Bun: builds the runner of tests/runner, which holds
# the compiler in Ore, and runs it from the root of the repository.
#
#   ci/test.sh [--jobs N] [--timeout SECONDS] [FILTER...]
#
# The runner compiles every test program in-process, builds and runs the
# tests of the compiler (compiler/next/test/*.test.ore), checks the
# formatting of every .ore file, and exits with 1 if a case fails.
#
# ORE             the command of the compiler that builds the runner, run as
#                 `$ORE build <entry> -o <output>`: by default `bun run ore`
#                 (the TypeScript compiler), later an Ore binary such as the
#                 bootstrap compiler. ORE_RELEASE=1 builds the runner with
#                 --release (much longer to build, faster to run).
# ORE_TEST_CACHE  where the runner is kept, named by a hash of its sources and
#                 of the compiler command (default ~/.cache/ore/test).
# ORE_BLESS=1     rewrites the .out files of tests/run from the actual output.
set -e
cd "$(dirname "$0")/.."
ore=${ORE:-bun run ore}
release=
[ "${ORE_RELEASE:-}" = 1 ] && release=--release
cache=${ORE_TEST_CACHE:-$HOME/.cache/ore/test}
mkdir -p "$cache"

# The sources the runner is built from, and those of the TypeScript compiler
# while it builds it: their names and contents.
files=$(find compiler runtime tests/runner -type f \( -name '*.ore' -o -name '*.ts' -o -name '*.json' -o -name '*.c' \) \
    ! -path '*/node_modules/*' ! -path '*/test/*' | LC_ALL=C sort)
hash=$({ echo "$ore $release"; echo "$files"; echo "$files" | xargs cat; } | cksum | tr ' ' '-')
runner="$cache/runner-$hash"

if [ ! -x "$runner" ]; then
    echo "building the runner with $ore" >&2
    start=$(date +%s)
    # shellcheck disable=SC2086
    $ore build tests/runner/main.ore -o "$runner.partial.$$" $release
    mv "$runner.partial.$$" "$runner"
    echo "built in $(($(date +%s) - start)) s" >&2
    # Runners built from other sources are of no more use.
    for old in "$cache"/runner-*; do
        [ "$old" = "$runner" ] || case $old in *.partial.*) ;; *) rm -f "$old" ;; esac
    done
fi
# The runner checks formatting in processes of its own executable.
ORE_TEST_RUNNER=$runner
export ORE_TEST_RUNNER
exec "$runner" "$@"
