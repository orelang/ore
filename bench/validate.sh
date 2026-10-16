#!/usr/bin/env bash
# Checks that the benchmarks measure what they claim, for every runtime:
#   - each runtime prints the same output at two sizes, not only at the size
#     bench/run.sh uses, so that no runtime matches by luck or by a constant;
#   - the time grows from the small size to the full one about as much for
#     Ore as for C and Go: a runtime that skipped or folded away the work
#     would barely grow.
# It prints, per benchmark, the time at each size and the ratio full/small.
#
# Usage: bench/validate.sh [filter...]
#   ORE=path   the Ore compiler (default: ore on the PATH)
#   CC=path    the C compiler (default: cc)
#   RUNS=n     timed runs per size and runtime, the best is kept (default: 3)
set -u
cd "$(dirname "$0")"
root=$(pwd)
ore=${ORE:-ore}
cc=${CC:-cc}
runs=${RUNS:-3}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# The small size of each benchmark: half the work or so; recursive and
# exponential ones step their parameter down instead.
small() {
    case $1 in
        fib) echo 35 ;;
        fannkuch-redux) echo 10 ;;
        nqueens) echo 11 ;;
        binary-trees) echo 14 ;;
        startup) echo "" ;;
        *) echo $(($2 / 2)) ;;
    esac
}

now() { perl -MTime::HiRes=time -e 'printf "%.0f\n", time * 1000'; }

best() {
    local b="" i t start
    for ((i = 0; i < runs; i++)); do
        start=$(now)
        eval "$1" >/dev/null 2>&1 || { echo "-"; return; }
        t=$(($(now) - start))
        if [ -z "$b" ] || [ "$t" -lt "$b" ]; then b=$t; fi
    done
    echo "$b"
}

failed=0
printf '%-15s %-6s %10s %10s %7s\n' benchmark runtime small_ms full_ms ratio
for dir in "$root"/*/; do
    name=$(basename "$dir")
    [ -f "$dir/size" ] || continue
    if [ $# -gt 0 ]; then
        match=0
        for f in "$@"; do case $name in *"$f"*) match=1 ;; esac; done
        [ "$match" = 1 ] || continue
    fi
    full=$(tr -d ' \n' <"$dir/size")
    little=$(small "$name" "$full")
    [ -n "$little" ] || continue
    commands=()
    runtimes=()
    if "$ore" build --release "$dir/main.ore" -o "$work/$name-ore" >/dev/null 2>&1; then
        runtimes+=(ore); commands+=("$work/$name-ore")
    fi
    if "$cc" -std=c17 -O2 -march=native -pthread -o "$work/$name-c" "$dir/main.c" -lm >/dev/null 2>&1; then
        runtimes+=(c); commands+=("$work/$name-c")
    fi
    if command -v go >/dev/null && (cd "$dir" && go build -o "$work/$name-go" main.go) >/dev/null 2>&1; then
        runtimes+=(go); commands+=("$work/$name-go")
    fi
    if command -v node >/dev/null; then
        runtimes+=(node); commands+=("node --experimental-strip-types --no-warnings $dir/main.ts")
    fi
    for size in "$little" "$full"; do
        reference=""
        for i in "${!runtimes[@]}"; do
            eval "${commands[$i]} $size" >"$work/out-${runtimes[$i]}" 2>/dev/null
            if [ -z "$reference" ]; then
                reference=${runtimes[$i]}
            elif ! cmp -s "$work/out-$reference" "$work/out-${runtimes[$i]}"; then
                echo "$name: ${runtimes[$i]} prints something else than $reference at size $size" >&2
                failed=1
            fi
        done
    done
    for i in "${!runtimes[@]}"; do
        a=$(best "${commands[$i]} $little")
        b=$(best "${commands[$i]} $full")
        ratio=$(awk -v a="$a" -v b="$b" 'BEGIN { if (a > 0 && b != "-") printf "%.2f", b / a; else print "-" }')
        printf '%-15s %-6s %10s %10s %7s\n' "$name" "${runtimes[$i]}" "$a" "$b" "$ratio"
    done
done
exit $failed
