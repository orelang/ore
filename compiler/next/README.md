# compiler/next

The Ore compiler written in Ore, which will replace the TypeScript compiler
(see the [roadmap](../../docs/roadmap.md)). So far it has the lexer
and the parser, which build a tree in the shape of TypeScript's, and the
loading of a program's modules.

| File | Contents |
|---|---|
| `syntax/tokens.ore` | Token kinds (named as `ts.SyntaxKind`) and keywords |
| `syntax/lexer.ore` | Tokens of a file, with byte offsets |
| `syntax/ast.ore` | The syntax tree: a node kind, a span and children |
| `syntax/parser.ore` | The parser |
| `syntax/source.ore` | A parsed file: path, text, tree; line and column of an offset |
| `syntax/diagnostic.ore` | Diagnostics and their `path:line:col: error: message` format |
| `syntax/imports.ore` | Module specifiers, string literal values, text imports |
| `syntax/parse.ore` | A file parsed into a `Source`, syntax errors as diagnostics |
| `project/resolve.ore` | The `ore:` modules embedded in the compiler, the runtime's load order, import resolution |
| `project/load.ore` | `loadProgram`: the entry file and every module it imports |
| `main.ore` | `ore-next tokens\|tree\|roles\|modules <file>`: prints the tokens, the tree, or the modules of a program |

[`tests/harness/next.test.ts`](../../tests/harness/next.test.ts) builds it
and checks, on every `.ore` file of the repository, that its tokens and trees
equal those of the TypeScript scanner and parser, and, on every program of
`tests/`, that the modules it loads equal those of `@ore/project`.

Differences from the TypeScript packages: offsets are bytes of the UTF-8 text
(columns still count UTF-16 code units, as TypeScript and LSP do); syntax
errors have the parser's messages, not TypeScript's; I/O errors are values
(`loadProgram` returns `Program | Error`), and an invalid package.json is a
diagnostic at the import instead of an exception.
