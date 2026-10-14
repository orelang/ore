# compiler/next

The Ore compiler written in Ore, which will replace the TypeScript compiler
(see the [roadmap](../../docs/roadmap.md)). So far it has the lexer
and the parser, which build a tree in the shape of TypeScript's, and the
language server, which reports syntax errors until the checker is ported.

| File | Contents |
|---|---|
| `syntax/tokens.ore` | Token kinds (named as `ts.SyntaxKind`) and keywords |
| `syntax/lexer.ore` | Tokens of a file, with byte offsets |
| `syntax/ast.ore` | The syntax tree: a node kind, a span and children |
| `syntax/parser.ore` | The parser, with its syntax errors and their spans |
| `lsp/jsonrpc.ore` | JSON-RPC over the LSP base protocol: `Content-Length` framing, a reader task, cancellation, error codes |
| `lsp/text.ore` | LSP positions (UTF-16) to byte offsets and back, file URIs |
| `lsp/analysis.ore` | What the server knows of a document: syntax diagnostics now; hover, definition, completion and references are TODOs for the checker |
| `lsp/server.ore` | The language server of `compiler/lsp`: lifecycle, documents with incremental changes, diagnostics and the language features |
| `main.ore` | `ore-next tokens|tree|roles <file>`: prints the tokens or the tree; `ore-next lsp`: the language server on stdio |

[`tests/harness/next.test.ts`](../../tests/harness/next.test.ts) builds it
and checks, on every `.ore` file of the repository, that its tokens and trees
equal those of the TypeScript scanner and parser.
[`tests/harness/lsp-next.test.ts`](../../tests/harness/lsp-next.test.ts) speaks
LSP to `ore-next lsp`.
