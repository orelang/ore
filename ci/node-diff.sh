#!/bin/sh
# Node as the oracle: every program of tests/run and tests/async that Node
# can run as TypeScript (with --experimental-transform-types) must print what its
# .out file says, which Ore prints. A program Node cannot run (Ore's own
# names, such as task.spawn or i32(...), or a header `// reference: none`) is
# counted as not portable; one that runs and prints something else is a
# difference, shown with its diff: a bug of Ore, or a difference of the
# language (docs/spec/10-differences.md) that the program states in a header
# `// node: why`, such as null where JavaScript has undefined.
#
#   ci/node-diff.sh [filter...]     (a filter keeps the paths that contain it)
# NODE is the node command (default: node). The status is 1 on a difference.
set -u
cd "$(dirname "$0")/.."
node=${NODE:-node}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
same=0
different=0
foreign=0
documented=0
for out in $(find tests/run tests/async -name '*.out' | sort); do
    source=${out%.out}.ore
    [ -f "$source" ] || continue
    if [ $# -gt 0 ]; then
        match=0
        for f in "$@"; do case $source in *"$f"*) match=1 ;; esac; done
        [ "$match" = 1 ] || continue
    fi
    # Not for Node: marked so, or a program that ends in a panic, which Node runs past.
    if grep -q '^// reference: none' "$source" || grep -q '^// exit: [1-9]' "$source"; then
        foreign=$((foreign + 1))
        continue
    fi
    # A difference documented by a header `// node: why`, such as null for undefined.
    if grep -q '^// node: ' "$source"; then
        documented=$((documented + 1))
        continue
    fi
    # Its environment, from `// env: NAME=value` headers; FORCE_COLOR=0 unless one says otherwise, as the runner does.
    vars="FORCE_COLOR=0 $(sed -n 's|^// env: ||p' "$source" | tr '\n' ' ')"
    ts="$work/$(echo "$source" | tr '/' '_' | sed 's/\.ore$/.ts/')"
    cp "$source" "$ts"
    # shellcheck disable=SC2086
    if ! env $vars perl -e 'alarm 60; exec @ARGV' "$node" --experimental-transform-types --no-warnings "$ts" >"$work/out" 2>"$work/err"; then
        foreign=$((foreign + 1))
        continue
    fi
    if cmp -s "$work/out" "$out"; then
        same=$((same + 1))
    else
        different=$((different + 1))
        echo "== $source"
        diff "$out" "$work/out" | head -20
    fi
done
echo "node prints the same: $same, prints something else: $different, documented differences: $documented, cannot run it: $foreign"
[ "$different" = 0 ]
