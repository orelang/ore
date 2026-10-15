#!/bin/sh
# Packs the editor extensions of a release:
#   ci/extensions.sh <tag> <out-dir>
# writes
#
#   <out-dir>/ore-vscode-<tag>.vsix   the VS Code extension, as the Marketplace
#                                     and Open VSX take it (needs Node and npm)
#   <out-dir>/ore-zed-<tag>.zip       the Zed extension's sources, which unpack
#                                     into ore-zed-<tag>/ for
#                                     `zed: install dev extension`
#
# The extensions must carry the tag's version (ci/versions.sh <tag>).
set -eu
tag=$1
out=$2
root=$(cd "$(dirname "$0")/.." && pwd)
mkdir -p "$out"
out=$(cd "$out" && pwd)
"$root/ci/versions.sh" "$tag" >/dev/null
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# VS Code: a copy of editors/vscode with its dependencies (the language
# client; the extension is plain JavaScript, with no build step) and a
# LICENSE, which the Marketplace shows: Ore's two licenses, at the user's
# option.
vscode=$work/vscode
mkdir "$vscode"
(cd "$root/editors/vscode" && cp -R README.md extension.js language-configuration.json package.json package-lock.json .vscodeignore syntaxes "$vscode/")
{
    echo "The Ore extension for Visual Studio Code is licensed under either of the"
    echo "MIT license or the Apache License, Version 2.0, at your option; both follow."
    echo
    cat "$root/LICENSE-MIT"
    echo
    cat "$root/LICENSE-APACHE"
} > "$vscode/LICENSE"
(cd "$vscode" && npm ci --no-audit --no-fund --loglevel=error && npx vsce package --out "$out/ore-vscode-$tag.vsix")

# Zed: what `zed: install dev extension` builds from (Zed compiles src/ to
# WebAssembly itself, so no build output goes in).
zed=$work/ore-zed-$tag
mkdir "$zed"
(cd "$root/editors/zed" && cp -R extension.toml Cargo.toml Cargo.lock src languages LICENSE-GPL README.md "$zed/")
rm -f "$out/ore-zed-$tag.zip"
(cd "$work" && zip -qrX "$out/ore-zed-$tag.zip" "ore-zed-$tag")
echo "$out/ore-zed-$tag.zip"
