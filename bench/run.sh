#!/usr/bin/env bash
# Runs the benchmarks in bench/<name>/ with Ore, C, Go, Bun and Node, checks
# that every runtime prints the same output, and prints markdown: a header
# describing the machine, the toolchains and the method, a table of times and
# one of peak memory.
#
# Usage: bench/run.sh [-o path] [filter...]
#   filter      run only the benchmarks whose name contains one of the filters
#   -o path     also write the markdown to a file (the same as RESULTS=path)
#   ORE=path    the Ore compiler (default: ore on the PATH)
#   CC=path     the C compiler (default: cc)
#   RUNS=n      timed runs per benchmark and runtime (default: 5)
#   RUNTIMES    the runtimes to try (default: "ore c go bun node"); the
#               columns are always in that order
#   RESULTS     a file to write the markdown to as well
#   ALL=1       also run the benchmarks that have a SKIP file
#
# Times are the best of RUNS runs in milliseconds, measured with hyperfine when
# it is installed and with the shell's clock otherwise. Memory is the maximum
# resident set size of the run that checks the output, in megabytes, read from
# /usr/bin/time (`-l` on macOS, `-v` on Linux). A runtime that is not
# installed is skipped; a runtime whose output differs from the others is
# reported and left out of the table. A benchmark whose directory has a SKIP
# file (its first line says why) runs only with ALL=1 or when a filter is its
# exact name.
#
# The C programs are built with $CC -std=c17 -O2 -march=native -pthread.
# The markdown starts with the date, the machine (CPU, cores and threads,
# memory, OS and kernel), the version of each toolchain and the timing
# method, so that a run can be committed as it is under bench/results/.
set -u

root=$(cd "$(dirname "$0")" && pwd)
ore=${ORE:-ore}
cc=${CC:-cc}
runs=${RUNS:-5}
runtimes=${RUNTIMES:-ore c go bun node}
results=${RESULTS:-}
work=$(mktemp -d "${TMPDIR:-/tmp}/ore-bench.XXXXXX") || exit 1
trap 'rm -f "$work"/*; rmdir "$work"' EXIT

say() { printf '%s\n' "$*" >&2; }

# The options, anywhere among the filters.
filters=()
while [ $# -gt 0 ]; do
    case $1 in
        -o)
            [ $# -ge 2 ] || { say "-o needs a path"; exit 2; }
            results=$2
            shift 2
            ;;
        -o*)
            results=${1#-o}
            shift
            ;;
        --)
            shift
            filters+=("$@")
            break
            ;;
        *)
            filters+=("$1")
            shift
            ;;
    esac
done
set -- ${filters[@]+"${filters[@]}"}

# The runtimes that exist on this machine, in the order of the columns.
for runtime in $runtimes; do
    case $runtime in
        ore | c | go | bun | node) ;;
        *) say "unknown runtime '$runtime'" ;;
    esac
done
available=""
for runtime in ore c go bun node; do
    case " $runtimes " in *" $runtime "*) ;; *) continue ;; esac
    case $runtime in
        ore) program=$ore ;;
        c) program=$cc ;;
        *) program=$runtime ;;
    esac
    if command -v "$program" >/dev/null 2>&1; then
        available="$available $runtime"
    else
        say "skipping $runtime: $program is not installed"
    fi
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

# The flag that makes /usr/bin/time print the maximum resident set size:
# -l on macOS and the BSDs (in bytes), -v with GNU time (in kilobytes).
timeflag=""
if [ -x /usr/bin/time ]; then
    if /usr/bin/time -l true >/dev/null 2>&1; then
        timeflag=-l
    elif /usr/bin/time -v true >/dev/null 2>&1; then
        timeflag=-v
    fi
fi
[ -n "$timeflag" ] || say "not measuring memory: no /usr/bin/time with -l or -v"

# Runs a command once with its output in $work/out-$2, its errors and the
# report of /usr/bin/time in $work/err, and prints its peak memory in
# megabytes, or "-" when it cannot be measured. Fails when the command fails.
run_once() {
    if [ -z "$timeflag" ]; then
        sh -c "$1" >"$work/out-$2" 2>"$work/err" || return 1
        echo "-"
        return
    fi
    # Without sh -c in between, so that the memory is the program's own.
    eval "/usr/bin/time $timeflag $1" >"$work/out-$2" 2>"$work/err" || return 1
    awk -v flag="$timeflag" '
        flag == "-l" && /maximum resident set size/ { mb = $1 / 1048576 }
        flag == "-v" && /Maximum resident set size/ { mb = $NF / 1024 }
        END { if (mb == "") print "-"; else printf "%.1f\n", mb }' "$work/err"
}

# Quotes a string for sh -c.
quote() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }

cflags="-std=c17 -O2 -march=native -pthread"

# The first line a command prints, or "unknown".
first() {
    line=$("$@" 2>&1 | sed -n '/./{p;q;}')
    printf '%s\n' "${line:-unknown}"
}

# Prints a number of bytes in gibibytes.
gib() { awk -v bytes="$1" 'BEGIN { printf "%.0f GiB\n", bytes / 1073741824 }'; }

# Prints the machine: the CPU, its cores and threads, the memory, the OS and
# the kernel, as markdown list items.
machine() {
    case $(uname -s) in
        Darwin)
            cpu=$(sysctl -n machdep.cpu.brand_string 2>/dev/null)
            cores="$(sysctl -n hw.physicalcpu 2>/dev/null) cores"
            threads=$(sysctl -n hw.logicalcpu 2>/dev/null)
            performance=$(sysctl -n hw.perflevel0.physicalcpu 2>/dev/null)
            efficiency=$(sysctl -n hw.perflevel1.physicalcpu 2>/dev/null)
            if [ -n "$performance" ] && [ -n "$efficiency" ]; then
                cores="$cores ($performance performance, $efficiency efficiency)"
            fi
            memory=$(gib "$(sysctl -n hw.memsize 2>/dev/null)")
            system="$(sw_vers -productName 2>/dev/null) $(sw_vers -productVersion 2>/dev/null) ($(sw_vers -buildVersion 2>/dev/null))"
            ;;
        Linux)
            cpu=""
            command -v lscpu >/dev/null 2>&1 && cpu=$(LC_ALL=C lscpu | sed -n 's/^Model name: *//p' | head -n 1)
            [ -n "$cpu" ] || cpu=$(sed -n 's/^model name[[:space:]]*: *//p' /proc/cpuinfo | head -n 1)
            threads=$(getconf _NPROCESSORS_ONLN 2>/dev/null || grep -c '^processor' /proc/cpuinfo)
            if command -v lscpu >/dev/null 2>&1; then
                cores=$(lscpu -p=core,socket 2>/dev/null | grep -v '^#' | sort -u | wc -l | tr -d ' ')
            else
                cores=$(awk -F: '/^physical id/ { s = $2 } /^core id/ { print s "/" $2 }' /proc/cpuinfo | sort -u | wc -l | tr -d ' ')
            fi
            [ "${cores:-0}" -gt 0 ] || cores=$threads
            cores="$cores cores"
            memory=$(gib "$(awk '/^MemTotal:/ { print $2 * 1024 }' /proc/meminfo)")
            system=$(. /etc/os-release 2>/dev/null && printf '%s' "${PRETTY_NAME:-Linux}")
            ;;
        *)
            cpu=$(uname -p)
            cores="unknown cores"
            threads=unknown
            memory=unknown
            system=$(uname -s)
            ;;
    esac
    echo "- Machine: ${cpu:-unknown CPU}, $cores, $threads threads, $memory memory"
    echo "- OS: ${system:-unknown}, kernel $(uname -s) $(uname -r)"
}

# Prints the version of a runtime.
version() {
    case $1 in
        ore) echo "ore $(first "$ore" version) ($(command -v "$ore"))" ;;
        c) echo "$(first "$cc" --version) (\`$cc $cflags\`)" ;;
        go) first go version ;;
        bun) echo "bun $(first bun --version)" ;;
        node) echo "node $(first node --version) (\`--experimental-strip-types\`)" ;;
    esac
}

if command -v hyperfine >/dev/null 2>&1; then
    method="the best of $runs runs after one warmup run, timed by $(first hyperfine --version)"
else
    method="the best of $runs runs, timed by the shell's clock (no hyperfine)"
fi
if [ -n "$timeflag" ]; then
    method="$method; peak memory is the maximum resident set size of the run that checks the output, from \`/usr/bin/time $timeflag\`"
else
    method="$method; peak memory not measured (no \`/usr/bin/time\` with -l or -v)"
fi

report="# Benchmarks

- Date: $(date -u '+%Y-%m-%d %H:%M UTC')
$(machine)
- Commit: $(git -C "$root" describe --always --dirty 2>/dev/null || echo unknown)
- Runs: $method

| runtime | version |
|---|---|
$(for runtime in $available; do echo "| $runtime | $(version "$runtime") |"; done)
"
printf '%s\n' "$report"
say "timing: $method"

# Prints the cells of a table row: each number with a unit and its ratio to
# the smallest number of the row, anything else as it is.
cells() {
    unit=$1
    format=$2
    shift 2
    printf '%s\n' "$@" | awk -v unit="$unit" -v format="$format" '
        { t[NR] = $1; if ($1 ~ /^[0-9.]+$/ && (best == "" || $1 + 0 < best)) best = $1 + 0 }
        END {
            for (i = 1; i <= NR; i++) {
                if (t[i] ~ /^[0-9.]+$/) {
                    printf " " format " %s", t[i], unit
                    if (best > 0) printf " (%.2fx)", t[i] / best
                    printf " |"
                } else printf " %s |", t[i]
            }
        }'
}

table=""
memtable=""
failed=0
for dir in "$root"/*/; do
    name=$(basename "$dir")
    [ -f "$dir/size" ] || continue
    exact=0
    if [ $# -gt 0 ]; then
        match=0
        for filter in "$@"; do
            case $name in *"$filter"*) match=1 ;; esac
            [ "$name" = "$filter" ] && exact=1
        done
        [ "$match" = 1 ] || continue
    fi
    if [ -f "$dir/SKIP" ] && [ "${ALL:-0}" != 1 ] && [ "$exact" = 0 ]; then
        say "== $name: skipped, $(head -n 1 "$dir/SKIP") (run it with ALL=1 or bench/run.sh $name)"
        continue
    fi
    size=$(tr -d ' \n' <"$dir/size")
    say "== $name ($size)"

    reference=""
    times=""
    memories=""
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
            c)
                # shellcheck disable=SC2086
                if "$cc" $cflags -o "$work/$name-c" "$dir/main.c" -lm >"$work/build.log" 2>&1; then
                    command="$(quote "$work/$name-c") $size"
                else
                    say "  c: build failed"
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
        memory="-"
        if [ -n "$command" ]; then
            if memory=$(run_once "$command" "$runtime"); then
                if [ -z "$reference" ]; then reference=$runtime; fi
                if cmp -s "$work/out-$reference" "$work/out-$runtime"; then
                    if time=$(measure "$command"); then
                        say "  $runtime: $time ms, $memory MB"
                    else
                        say "  $runtime: failed while timing"
                        time="-"
                        failed=1
                    fi
                else
                    say "  $runtime: output differs from $reference"
                    diff "$work/out-$reference" "$work/out-$runtime" | sed 's/^/    /' >&2
                    time="wrong"
                    memory="wrong"
                    failed=1
                fi
            else
                say "  $runtime: failed"
                sed 's/^/    /' "$work/err" >&2
                time="failed"
                memory="failed"
                failed=1
            fi
        fi
        times="$times $time"
        memories="$memories $memory"
    done

    # Each cell is the time and its ratio to the fastest runtime of the row,
    # and the memory and its ratio to the smallest.
    # shellcheck disable=SC2086
    table="$table| $name |$(cells ms "%.0f" $times)
"
    # shellcheck disable=SC2086
    memtable="$memtable| $name |$(cells MB "%.1f" $memories)
"
done

[ -n "$table" ] || { say "no benchmark matches"; exit 1; }

header="| benchmark |"
rule="|---|"
for runtime in $available; do
    header="$header $runtime |"
    rule="$rule---:|"
done
tables="## Time (best of $runs runs)

$header
$rule
$table
## Peak memory (maximum resident set size)

$header
$rule
$memtable"
printf '\n%s' "$tables"
if [ -n "$results" ]; then
    if printf '%s\n%s' "$report" "$tables" >"$results"; then
        say "wrote $results"
    else
        say "could not write $results"
        failed=1
    fi
fi
exit $failed
