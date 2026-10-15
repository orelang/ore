#!/bin/sh
# Prints the notes of a GitHub Release: its section of CHANGELOG.md (and, for
# the first release of a minor version, the sections of that minor version),
# how to install it, and its archives and editor extensions.
#   ci/notes.sh <tag>
set -eu
tag=$1
version=${tag#v}
minor=${version%.*}
cat <<EOF
## Install

\`\`\`sh
curl -fsSL https://raw.githubusercontent.com/orelang/ore/main/install.sh | sh
\`\`\`

or \`brew install orelang/tap/ore\`; then \`ore update\` keeps it up to date.
Each archive carries its LLVM and lld.

| For | File |
|---|---|
| Linux x86-64 | \`ore-$tag-linux-amd64.tar.gz\` |
| Linux arm64 | \`ore-$tag-linux-arm64.tar.gz\` |
| macOS arm64 | \`ore-$tag-darwin-arm64.tar.gz\` |
| VS Code extension | \`ore-vscode-$tag.vsix\` |
| Zed extension | \`ore-zed-$tag.zip\` |

The editor extensions run \`ore lsp\`, so \`ore\` must be on \`PATH\`. VS Code:
install "Ore" (\`orelang.ore\`) from the Marketplace or Open VSX, or
\`code --install-extension ore-vscode-$tag.vsix\`. Zed: unzip
\`ore-zed-$tag.zip\` and pick its directory in \`zed: install dev extension\`
(Zed builds it with Rust, which must be installed with rustup).

EOF
# The sections of this version and the earlier ones of its minor version.
awk -v minor="$minor" -v version="$version" '
    /^## / {
        v = $2
        keep = (v == version) || (index(v, minor ".") == 1 && v < version) || (v == minor)
    }
    keep { print }
' CHANGELOG.md | sed 's/^## /## What is in /'
