#!/usr/bin/env bash
# Runs the benchmarks in bench/<name>/ with Ore, Bun, Node and Go, checks that
# every runtime prints the same output, and prints a markdown table of times.
#
# Usage: bench/run.sh [filter...]
#   filter      run only the benchmarks whose name contains one of the filters
#   ORE=path    the Ore compiler (default: ore on the PATH)
#   RUNS=n      timed runs per benchmark and runtime (default: 5)
#   RUNTIMES    the runtimes to try (default: "ore bun node go")
#
# Times are the best of RUNS runs in milliseconds, measured with hyperfine when
# it is installed and with the shell's clock otherwise. A runtime that is not
# installed is skipped; a runtime whose output differs from the others is
# reported and left out of the table.
set -u

root=$(cd "$(dirname "$0")" && pwd)
ore=${ORE:-ore}
runs=${RUNS:-5}
runtimes=${RUNTIMES:-ore bun node go}
work=$(mktemp -d "${TMPDIR:-/tmp}/ore-bench.XXXXXX") || exit 1
trap 'rm -f "$work"/*; rmdir "$work"' EXIT

say() { printf '%s\n' "$*" >&2; }

# The runtimes that exist on this machine.
available=""
for runtime in $runtimes; do
    case $runtime in
        ore) command -v "$ore" >/dev/null 2>&1 && available="$available ore" ;;
        bun | node | go) command -v "$runtime" >/dev/null 2>&1 && available="$available $runtime" ;;
        *) say "unknown runtime '$runtime'" ;;
    esac
done
for runtime in $runtimes; do
    case " $available " in
        *" $runtime "*) ;;
        *) say "skipping $runtime: not installed" ;;
    esac
done
[ -n "$available" ] || { say "no runtime to run"; exit 1; }

# The current time in microseconds, for when hyperfine is missing.
now() {
    if [ -n "${EPOCHREALTIME:-}" ]; then
        printf '%s\n' "${EPOCHREALTIME//[.,]/}"
    elif command -v perl >/dev/null 2>&1; then
        perl -MTime::HiRes=time -e 'printf "%d\n", time * 1e6'
    else
        echo $(($(date +%s) * 1000000))
    fi
}

# Prints the best time of `runs` runs of a command, in milliseconds.
measure() {
    if command -v hyperfine >/dev/null 2>&1; then
        hyperfine --warmup 1 --runs "$runs" --style none --output null \
            --export-csv "$work/hyperfine.csv" "$1" >/dev/null 2>&1 || return 1
        awk -F, 'NR == 2 { printf "%.1f\n", $7 * 1000 }' "$work/hyperfine.csv"
        return
    fi
    best=""
    i=0
    while [ "$i" -lt "$runs" ]; do
        start=$(now)
        sh -c "$1" >/dev/null 2>&1 || return 1
        end=$(now)
        elapsed=$((end - start))
        if [ -z "$best" ] || [ "$elapsed" -lt "$best" ]; then best=$elapsed; fi
        i=$((i + 1))
    done
    awk -v us="$best" 'BEGIN { printf "%.1f\n", us / 1000 }'
}

# Quotes a string for sh -c.
quote() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }

if command -v hyperfine >/dev/null 2>&1; then
    say "timing with hyperfine, best of $runs runs"
else
    say "timing without hyperfine, best of $runs runs"
fi

table=""
failed=0
for dir in "$root"/*/; do
    name=$(basename "$dir")
    [ -f "$dir/size" ] || continue
    if [ $# -gt 0 ]; then
        match=0
        for filter in "$@"; do
            case $name in *"$filter"*) match=1 ;; esac
        done
        [ "$match" = 1 ] || continue
    fi
    size=$(tr -d ' \n' <"$dir/size")
    say "== $name ($size)"

    reference=""
    row="| $name |"
    times=""
    for runtime in $available; do
        command=""
        case $runtime in
            ore)
                if "$ore" build --release "$dir/main.ore" -o "$work/$name-ore" >"$work/build.log" 2>&1; then
                    command="$(quote "$work/$name-ore") $size"
                else
                    say "  ore: build failed"
                    sed 's/^/    /' "$work/build.log" >&2
                fi
                ;;
            go)
                if (cd "$dir" && go build -o "$work/$name-go" main.go) >"$work/build.log" 2>&1; then
                    command="$(quote "$work/$name-go") $size"
                else
                    say "  go: build failed"
                    sed 's/^/    /' "$work/build.log" >&2
                fi
                ;;
            bun) command="bun $(quote "$dir/main.ts") $size" ;;
            node) command="node --experimental-strip-types --no-warnings $(quote "$dir/main.ts") $size" ;;
        esac

        time="-"
        if [ -n "$command" ]; then
            if sh -c "$command" >"$work/out-$runtime" 2>"$work/err"; then
                if [ -z "$reference" ]; then reference=$runtime; fi
                if cmp -s "$work/out-$reference" "$work/out-$runtime"; then
                    if time=$(measure "$command"); then
                        say "  $runtime: $time ms"
                    else
                        say "  $runtime: failed while timing"
                        time="-"
                        failed=1
                    fi
                else
                    say "  $runtime: output differs from $reference"
                    diff "$work/out-$reference" "$work/out-$runtime" | sed 's/^/    /' >&2
                    time="wrong"
                    failed=1
                fi
            else
                say "  $runtime: failed"
                sed 's/^/    /' "$work/err" >&2
                time="failed"
                failed=1
            fi
        fi
        times="$times $time"
    done

    # Each cell is the time and its ratio to the fastest runtime of the row.
    row=$row$(printf '%s\n' $times | awk '
        { t[NR] = $1; if ($1 ~ /^[0-9.]+$/ && (best == "" || $1 + 0 < best)) best = $1 + 0 }
        END {
            for (i = 1; i <= NR; i++) {
                if (t[i] ~ /^[0-9.]+$/) printf " %.0f ms (%.2fx) |", t[i], t[i] / best
                else printf " %s |", t[i]
            }
        }')
    table="$table$row
"
done

[ -n "$table" ] || { say "no benchmark matches"; exit 1; }

header="| benchmark |"
rule="|---|"
for runtime in $available; do
    header="$header $runtime |"
    rule="$rule---:|"
done
echo
echo "$header"
echo "$rule"
printf '%s' "$table"
exit $failed
