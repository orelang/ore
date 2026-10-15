# editors

Editor support. Both extensions run the language server `ore lsp`, so the
`ore` binary must be on `PATH`.

| Directory | Contents |
|---|---|
| [`vscode`](vscode) | VS Code: a TextMate grammar and the language client |
| [`zed`](zed) | Zed: tree-sitter queries and the language server launcher |

The extensions carry the version of Ore and are released with it (see
[ci](../ci/README.md#releases)): each release has `ore-vscode-vX.Y.Z.vsix`,
also published to the Visual Studio Marketplace and Open VSX as
`orelang.ore`, and `ore-zed-vX.Y.Z.zip`, the Zed extension to install as a
dev extension. `ci/extensions.sh <tag> <out-dir>` packs both locally.
