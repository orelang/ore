#!/bin/sh
# Random regular expressions and ASCII subjects, matched by Ore and by Node:
# every exec in a loop (g, y), with indices and groups, and replace, must be
# Node's; a pattern Node takes and Ore rejects shows as `rejected:`.
#   tests/fuzz/regexp/run.sh [count] [seed]      (default: 20000 1)
set -eu
cd "$(dirname "$0")/../../.."
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
"${NODE:-node}" tests/fuzz/regexp/gen.mjs "$work/cases.jsonl" "${1:-20000}" "${2:-1}" >"$work/node.txt"
"${ORE:-ore}" build --release tests/fuzz/regexp/check.ore -o "$work/check"
"$work/check" "$work/cases.jsonl" >"$work/ore.txt"
if cmp -s "$work/node.txt" "$work/ore.txt"; then
    echo "regular expressions: ${1:-20000} cases as Node"
else
    diff "$work/node.txt" "$work/ore.txt" | head -40
    exit 1
fi
