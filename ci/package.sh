#!/bin/sh
# Packs a bootstrapped `ore` as a release archive:
#   ci/package.sh <version> <os> <arch> <ore-binary> <out-dir>
# writes <out-dir>/ore-<version>-<os>-<arch>.tar.gz, holding
# ore-<version>-<os>-<arch>/bin/ore, the README and the license.
set -e
version=$1
os=$2
arch=$3
binary=$4
out=$5
name=ore-$version-$os-$arch
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/$name/bin" "$out"
cp "$binary" "$work/$name/bin/ore"
cp README.md "$work/$name/"
[ -f LICENSE ] && cp LICENSE "$work/$name/"
tar -czf "$out/$name.tar.gz" -C "$work" "$name"
echo "$out/$name.tar.gz"
