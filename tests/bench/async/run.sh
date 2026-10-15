#!/bin/sh
# Times the async benchmarks, once Ore implements async, built with --release
# by $ORE (ore by default). Prints the best of three runs; the target is
# Bun's speed (see the roadmap).
set -e
cd "$(dirname "$0")"
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
printf '%-12s %10s\n' benchmark ore
for src in *.ore; do
    name=${src%.ore}
    ore_time=-
    if "${ORE:-ore}" build --release "$src" -o "$out/$name" >/dev/null 2>&1; then
        ore_time=$(best env ORE_THREADS=1 "$out/$name")
    fi
    printf '%-12s %9ss\n' "$name" "$ore_time"
done
rm -rf "$out"
