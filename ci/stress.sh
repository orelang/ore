#!/bin/sh
# Runs the concurrent test programs many times, built with --release, with
# the threads of their `// threads:` header (1 by default) and with 8 when
# the header allows several: ci/stress.sh [runs]. A run that takes longer than
# $STRESS_TIMEOUT seconds (30 by default) counts as hung and fails; the
# watchdog (ORE_WATCHDOG) prints the stacks of a run stuck for 20 seconds.
cd "$(dirname "$0")/.."
runs=${1:-20}
timeout=${STRESS_TIMEOUT:-30}
out=$(mktemp -d)
failed=0
for test in concurrency/parallel-channels concurrency/parallel-gc concurrency/tasks concurrency/tasks-gc concurrency/select \
    concurrency/sync concurrency/yield-exit concurrency/net concurrency/spawn-many runtime/escape library/json; do
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
            # perl's alarm: a hung run is killed by SIGALRM (status 142).
            ORE_WATCHDOG=20 ORE_THREADS=$t perl -e 'alarm shift; exec @ARGV' "$timeout" "$out/$name" >"$out/$name.out" 2>"$out/$name.err"
            status=$?
            [ "$status" = 142 ] && echo "hung after ${timeout}s" >>"$out/$name.err"
            if [ "$status" = 142 ] || ! cmp -s "$out/$name.out" "$expected"; then
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
