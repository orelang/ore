#!/bin/sh
# Random doubles printed and parsed by Ore and by Node: String(x),
# JSON.stringify(x) and x.toFixed(3) must be Node's text, and
# Number.parseFloat of Node's text must give the same bits.
#   tests/fuzz/numbers/run.sh [count] [seed]      (default: 1000000 1)
set -eu
cd "$(dirname "$0")/../../.."
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
"${NODE:-node}" tests/fuzz/numbers/gen.mjs "${1:-1000000}" "${2:-1}" >"$work/numbers.txt"
"${ORE:-ore}" build --release tests/fuzz/numbers/check.ore -o "$work/check"
"$work/check" "$work/numbers.txt" | tee "$work/out"
grep -q ", 0 differ$" "$work/out"
