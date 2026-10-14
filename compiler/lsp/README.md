# @ore/lsp

The language server, started by `ore lsp` over stdio.

- `analysis.ts`: checks the program of an open file (with the editor's
  unsaved texts) and answers questions on it: diagnostics, hover (types and
  signatures), go to definition (also into `builtin.d.ore`), references,
  rename and completion after `.`.
- `server.ts`: the LSP protocol, with `vscode-languageserver`.

The end-to-end test through `ore lsp` is in [`cli/test`](../cli/test).
