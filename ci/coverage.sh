#!/bin/sh
# Line coverage of the compiler, the runtime and the standard library by the
# test suite.
#
#   ci/coverage.sh run [filter...]    build a compiler that counts (ORE_COVERAGE=1
#                                     makes every program it builds count the runs
#                                     of its statements), run the suite with it, and
#                                     report; the counts go to $COVERAGE (default
#                                     .coverage/), one lcov file per process
#   ci/coverage.sh report [dir]       the coverage per file, least covered first,
#                                     from the lcov files of dir
#   ci/coverage.sh lines FILE [dir]   the lines of FILE that never ran
#
# The suite's runner holds the compiler, so its counts are the compiler's; the
# programs it builds count the runtime's and the library's. A file is named as
# in the repository: `ore:runtime/x` is runtime/core/x.ore and `ore:x`
# runtime/std/x.ore. ORE is the compiler that builds the counting one.
set -eu
cd "$(dirname "$0")/.."
dir=${COVERAGE:-$(pwd)/.coverage}

# Every DA line of every record, as `file line count`, files named as in the repository.
counts() {
    cat "$1"/*.lcov 2>/dev/null | awk -v root="$(pwd)/" '
        /^SF:/ {
            file = substr($0, 4)
            if (file ~ /^ore:runtime\//) file = "runtime/core/" substr(file, 13) ".ore"
            else if (file ~ /^ore:/) file = "runtime/std/" substr(file, 5) ".ore"
            else if (index(file, root) == 1) file = substr(file, length(root) + 1)
            next
        }
        /^DA:/ { split(substr($0, 4), d, ","); print file, d[1], d[2] }'
}

case ${1:-} in
    run)
        shift
        rm -rf "$dir"
        mkdir -p "$dir"
        work=$(mktemp -d)
        "${ORE:-ore}" build compiler/src/main.ore -o "$work/ore"
        ORE_COVERAGE=1 ORE_COVERAGE_DIR="$dir" ORE="$work/ore" ORE_TEST_CACHE="$work/cache" \
            ci/test.sh --timeout "${TIMEOUT:-1800}" "$@" || true
        rm -rf "$work"
        "$0" report "$dir"
        ;;
    report)
        from=${2:-$dir}
        # A line ran if any process ran it; per file: lines, lines run, percent.
        counts "$from" | awk '
            { key = $1 " " $2; if (!(key in seen)) { seen[key] = 1; total[$1]++ } if ($3 > 0 && !(key in ran)) { ran[key] = 1; hit[$1]++ } }
            END {
                for (f in total) { all += total[f]; covered += hit[f]; printf "%6.1f%% %6d %6d  %s\n", 100 * hit[f] / total[f], hit[f] + 0, total[f], f }
                printf "%6.1f%% %6d %6d  (all)\n", 100 * covered / all, covered, all
            }' | sort -n
        ;;
    lines)
        file=$2
        from=${3:-$dir}
        counts "$from" | awk -v f="$file" '
            $1 == f { key = $2; seen[key] = 1; if ($3 > 0) ran[key] = 1 }
            END { for (k in seen) if (!(k in ran)) print k }' | sort -n | awk '
            NR == 1 { start = $1; end = $1; next }
            $1 == end + 1 { end = $1; next }
            { print (start == end ? start : start "-" end); start = $1; end = $1 }
            END { if (NR > 0) print (start == end ? start : start "-" end) }'
        ;;
    *)
        sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
        exit 2
        ;;
esac
