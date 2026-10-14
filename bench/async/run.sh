#!/bin/sh
# Times the async benchmarks in Bun (the target to match) and, once Ore
# implements async, built by Ore with --release. Prints the best of three runs.
set -e
cd "$(dirname "$0")"
root=../..
out=$(mktemp -d)
best() {
    best=
    for _ in 1 2 3; do
        start=$(perl -MTime::HiRes=time -e 'printf "%.3f", time')
        "$@" >/dev/null
        end=$(perl -MTime::HiRes=time -e 'printf "%.3f", time')
        t=$(echo "$end - $start" | bc)
        if [ -z "$best" ] || [ "$(echo "$t < $best" | bc)" = 1 ]; then best=$t; fi
    done
    echo "$best"
}
printf '%-12s %10s %10s\n' benchmark bun ore
for src in *.ore; do
    name=${src%.ore}
    cp "$src" "$out/$name.ts"
    bun_time=$(best bun --preload "$root/tests/async/bun-shim.ts" "$out/$name.ts")
    ore_time=-
    if bun "$root/compiler/cli/src/main.ts" build --release "$src" -o "$out/$name" >/dev/null 2>&1; then
        ore_time=$(best env ORE_THREADS=1 "$out/$name")
    fi
    printf '%-12s %9ss %9ss\n' "$name" "$bun_time" "$ore_time"
done
rm -rf "$out"
