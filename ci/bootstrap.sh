#!/bin/sh
# Builds the compiler written in Ore with itself until it reproduces itself:
#   ci/bootstrap.sh [out-dir]          (default: dist)
# Stage 0 is $ORE, an existing `ore` binary (a previous release), or, without
# it, the seed: the commit tagged `seed`, the last with the compiler in
# TypeScript, built once with Bun and kept in ~/.cache/ore. Stage 0 builds
# stage 1 from these sources, stage 1 builds stage 2 and stage 2 builds stage
# 3, in release; the LLVM IR of stages 2 and 3 must be identical, byte for
# byte: the compiler then compiles itself as it compiles anything. Stage 3 is
# installed as <out-dir>/ore.
set -e
cd "$(dirname "$0")/.."
out=${1:-dist}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
entry=compiler/src/main.ore
mkdir -p "$out"

step() { printf '%s\n' "$*" >&2; }
started=$(date +%s)
# A copy of the repository owned by another user (a container, a synced
# directory) is trusted for these reads.
git() { command git -c safe.directory="$PWD" "$@"; }
if [ -z "$ORE" ]; then
    git rev-parse -q --verify 'seed^{commit}' >/dev/null || git fetch -q --depth=1 origin tag seed
    commit=$(git rev-parse 'seed^{commit}')
    ORE=${ORE_CACHE:-$HOME/.cache/ore}/seed-$commit
    if [ ! -x "$ORE" ]; then
        step "stage 0: the seed ($commit), built once with Bun"
        command -v bun >/dev/null || { step "no \$ORE and no Bun to build the seed: set ORE to an ore binary"; exit 1; }
        mkdir -p "$work/seed" "$(dirname "$ORE")"
        git archive "$commit" | tar -x -C "$work/seed"
        (cd "$work/seed" && bun install --frozen-lockfile --ignore-scripts >/dev/null &&
            bun compiler/cli/src/main.ts build compiler/next/src/main.ore -o "$ORE.partial" --release)
        mv "$ORE.partial" "$ORE"
    fi
fi
step "stage 1: $ORE builds the compiler"
"$ORE" build "$entry" -o "$work/stage1" --release
step "stage 2: stage 1 builds the compiler"
"$work/stage1" build "$entry" -o "$work/stage2" --release --emit-llvm "$work/stage2.ll"
step "stage 3: stage 2 builds the compiler"
"$work/stage2" build "$entry" -o "$work/stage3" --release --emit-llvm "$work/stage3.ll"
if ! cmp -s "$work/stage2.ll" "$work/stage3.ll"; then
    step "the LLVM IR of stages 2 and 3 differs:"
    diff "$work/stage2.ll" "$work/stage3.ll" | head -40 >&2
    exit 1
fi
# A new file rather than one written over: macOS kills a signed binary
# replaced in place, its old signature still cached for the file.
rm -f "$out/ore"
cp "$work/stage3" "$out/ore"
step "stages 2 and 3 agree ($(wc -c <"$work/stage3.ll" | tr -d ' ') bytes of LLVM IR); $out/ore installed in $(($(date +%s) - started)) s"
