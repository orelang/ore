#!/bin/sh
# Differential testing with random programs: tests/fuzz/gen.ts writes a
# program for each seed, Node runs it, Ore builds it in debug and in release
# and runs it, and every output must be Node's. A program Ore rejects or runs
# differently is kept in $FUZZ (default .fuzz/), as seed-N.ts with what each
# printed, for the bug it shows (or for the generator, when it wrote what the
# languages do differently on purpose).
#
#   tests/fuzz/run.sh [first-seed] [count]      (default: 1 200)
# ORE is the compiler, NODE the node command. The status is 1 on a failure.
set -u
cd "$(dirname "$0")/../.."
first=${1:-1}
count=${2:-200}
ore=${ORE:-ore}
node=${NODE:-node}
keep=${FUZZ:-$(pwd)/.fuzz}
mkdir -p "$keep"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
run() { perl -e 'alarm 30; exec @ARGV' "$@"; }
passed=0
failed=0
skipped=0
seed=$first
while [ "$seed" -lt $((first + count)) ]; do
    p="$work/p$seed"
    "$node" --experimental-transform-types --no-warnings tests/fuzz/gen.ts "$seed" >"$p.ts"
    cp "$p.ts" "$p.ore"
    if ! run "$node" --experimental-transform-types --no-warnings "$p.ts" >"$p.node" 2>/dev/null; then
        skipped=$((skipped + 1))
        seed=$((seed + 1))
        continue
    fi
    problem=""
    if ! "$ore" build "$p.ore" -o "$p.debug" >"$p.build" 2>&1; then
        problem="does not build"
    elif ! run "$p.debug" >"$p.out-debug" 2>&1 || ! cmp -s "$p.node" "$p.out-debug"; then
        problem="debug output differs"
    elif ! "$ore" build --release "$p.ore" -o "$p.release" >>"$p.build" 2>&1; then
        problem="does not build in release"
    elif ! run "$p.release" >"$p.out-release" 2>&1 || ! cmp -s "$p.node" "$p.out-release"; then
        problem="release output differs"
    fi
    if [ -z "$problem" ]; then
        passed=$((passed + 1))
    else
        failed=$((failed + 1))
        echo "seed $seed: $problem"
        for f in "$p".ts "$p".node "$p".build "$p".out-debug "$p".out-release; do
            [ -f "$f" ] && cp "$f" "$keep/seed-$seed${f#"$p"}"
        done
    fi
    seed=$((seed + 1))
done
echo "random programs: $passed as Node, $failed differ or fail, $skipped not run by Node"
[ "$failed" = 0 ]
