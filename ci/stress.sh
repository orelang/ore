#!/bin/sh
# Runs the concurrent test programs many times, built with --release, with
# the threads of their `// threads:` header (1 by default) and with 8 when
# the header allows several: ci/stress.sh [runs]
cd "$(dirname "$0")/.."
runs=${1:-20}
out=$(mktemp -d)
failed=0
for name in parallel-channels parallel-gc tasks tasks-gc select sync yield-exit escape net json; do
    src="tests/run/$name.ore"
    bun packages/cli/src/main.ts build --release "$src" -o "$out/$name" >/dev/null || { echo "$name: build failed"; failed=1; continue; }
    threads=$(sed -n 's|^// threads: *||p' "$src")
    threads=${threads:-1}
    settings=$threads
    [ "$threads" -gt 1 ] && settings="$threads 8"
    bad=0
    total=0
    for i in $(seq "$runs"); do
        for t in $settings; do
            ORE_THREADS=$t "$out/$name" >"$out/$name.out" 2>/dev/null
            cmp -s "$out/$name.out" "tests/run/$name.out" || bad=$((bad + 1))
            total=$((total + 1))
        done
    done
    echo "$name: $bad of $total runs differ (threads: $settings)"
    [ "$bad" = 0 ] || failed=1
done
rm -rf "$out"
exit $failed
