#!/bin/sh
# The programs of the suite (tests/run, tests/async) in other modes of the
# compiler and the runtime, one after the other, each with a test cache of
# its own; checking and formatting do not depend on them, so they run once,
# in ci/test.sh. A mode is a set of the runner's variables:
#   release   ORE_TEST_RELEASE=1: release builds (panicking programs skipped)
#   threads   ORE_TEST_THREADS=16: every program on 16 threads, not 1
#   gc        ORE_GOGC=1: a collection whenever the heap grows by 1%
#   gcstw     ORE_GCSTW=1 ORE_GOGC=10: stop-the-world marking, often
#   stress    16 threads and ORE_GOGC=1: concurrent marking under load
#
#   ci/matrix.sh [mode...] [-- filter...]     (default: every mode, run/ async/)
# ORE is the compiler, as for ci/test.sh. The status is 1 if a mode fails.
set -u
cd "$(dirname "$0")/.."
modes=""
while [ $# -gt 0 ] && [ "$1" != "--" ]; do
    modes="$modes $1"
    shift
done
[ "${1:-}" = "--" ] && shift
[ -n "$modes" ] || modes="release threads gc gcstw stress"
[ $# -gt 0 ] || set -- run/ async/
status=0
for mode in $modes; do
    case $mode in
        release) vars="ORE_TEST_RELEASE=1" ;;
        threads) vars="ORE_TEST_THREADS=16" ;;
        gc) vars="ORE_TEST_ENV=ORE_GOGC=1" ;;
        gcstw) vars="ORE_TEST_ENV=ORE_GCSTW=1,ORE_GOGC=10" ;;
        stress) vars="ORE_TEST_THREADS=16 ORE_TEST_ENV=ORE_GOGC=1" ;;
        *) echo "matrix: unknown mode $mode" >&2; exit 2 ;;
    esac
    echo "== $mode ($vars)"
    cache=${ORE_TEST_CACHE:-$HOME/.cache/ore/test}-$mode
    log=$(mktemp)
    # shellcheck disable=SC2086
    env $vars ORE_TEST_CACHE="$cache" ci/test.sh --timeout "${TIMEOUT:-1200}" "$@" >"$log" 2>&1 || status=1
    grep -v "^  ✓" "$log"
    rm -f "$log"
done
exit $status
