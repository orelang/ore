#!/bin/sh
# Builds every benchmark with --release and prints its best time of three runs.
set -e
cd "$(dirname "$0")"
out=$(mktemp -d)
for src in *.ore; do
    name=${src%.ore}
    bun ../packages/cli/src/main.ts build --release "$src" -o "$out/$name" >/dev/null
    best=
    for _ in 1 2 3; do
        start=$(perl -MTime::HiRes=time -e 'printf "%.3f", time')
        ORE_THREADS=1 "$out/$name" >/dev/null
        end=$(perl -MTime::HiRes=time -e 'printf "%.3f", time')
        t=$(echo "$end - $start" | bc)
        if [ -z "$best" ] || [ "$(echo "$t < $best" | bc)" = 1 ]; then best=$t; fi
    done
    printf '%-12s %ss\n' "$name" "$best"
done
rm -rf "$out"
