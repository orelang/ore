#!/bin/sh
# Builds the compiler written in Ore with itself until it reproduces itself:
#   ci/bootstrap.sh [out-dir]          (default: dist)
# Stage 1 is built by $ORE, an existing `ore` binary (the previous release),
# or, without it, by the TypeScript compiler. Stage 1 builds stage 2 and
# stage 2 builds stage 3, both in release; the LLVM IR of stages 2 and 3 must
# be identical, byte for byte: the compiler then compiles itself as it
# compiles anything. Stage 3 is installed as <out-dir>/ore.
set -e
cd "$(dirname "$0")/.."
out=${1:-dist}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
entry=compiler/next/src/main.ore
mkdir -p "$out"

step() { printf '%s\n' "$*" >&2; }
started=$(date +%s)
if [ -n "$ORE" ]; then
    step "stage 1: $ORE build"
    "$ORE" build "$entry" -o "$work/stage1" --release
else
    step "stage 1: the TypeScript compiler"
    bun compiler/cli/src/main.ts build "$entry" -o "$work/stage1" --release
fi
step "stage 2: stage 1 builds the compiler"
"$work/stage1" build "$entry" -o "$work/stage2" --release --emit-llvm "$work/stage2.ll"
step "stage 3: stage 2 builds the compiler"
"$work/stage2" build "$entry" -o "$work/stage3" --release --emit-llvm "$work/stage3.ll"
if ! cmp -s "$work/stage2.ll" "$work/stage3.ll"; then
    step "the LLVM IR of stages 2 and 3 differs:"
    diff "$work/stage2.ll" "$work/stage3.ll" | head -40 >&2
    exit 1
fi
cp "$work/stage3" "$out/ore"
step "stages 2 and 3 agree ($(wc -c <"$work/stage3.ll" | tr -d ' ') bytes of LLVM IR); $out/ore installed in $(($(date +%s) - started)) s"
