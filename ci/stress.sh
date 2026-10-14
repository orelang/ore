#!/bin/sh
# Runs the concurrent test programs many times, built with --release, with
# the threads of their `// threads:` header (1 by default) and with 8 when
# the header allows several: ci/stress.sh [runs]
cd "$(dirname "$0")/.."
runs=${1:-20}
out=$(mktemp -d)
failed=0
for test in concurrency/parallel-channels concurrency/parallel-gc concurrency/tasks concurrency/tasks-gc concurrency/select \
    concurrency/sync concurrency/yield-exit concurrency/net runtime/escape library/json; do
    src="tests/run/$test.ore"
    expected="tests/run/$test.out"
    name=${test##*/}
    bun compiler/cli/src/main.ts build --release "$src" -o "$out/$name" >/dev/null || { echo "$name: build failed"; failed=1; continue; }
    threads=$(sed -n 's|^// threads: *||p' "$src")
    threads=${threads:-1}
    settings=$threads
    [ "$threads" -gt 1 ] && settings="$threads 8"
    bad=0
    total=0
    for i in $(seq "$runs"); do
        for t in $settings; do
            ORE_THREADS=$t "$out/$name" >"$out/$name.out" 2>"$out/$name.err"
            if ! cmp -s "$out/$name.out" "$expected"; then
                # Show the first bad run, to have something to go on.
                [ "$bad" = 0 ] && {
                    echo "$name: run $i with $t threads differs:"
                    diff "$out/$name.out" "$expected" | head -20
                    echo "stderr:"
                    head -20 "$out/$name.err"
                }
                bad=$((bad + 1))
            fi
            total=$((total + 1))
        done
    done
    echo "$name: $bad of $total runs differ (threads: $settings)"
    [ "$bad" = 0 ] || failed=1
done
rm -rf "$out"
exit $failed
