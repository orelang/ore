# compiler/next

The Ore compiler written in Ore, which will replace the TypeScript compiler
(see the [roadmap](../../docs/roadmap.md)). So far it has the lexer, the
parser, which builds a tree in the shape of TypeScript's, and the formatter.

| File | Contents |
|---|---|
| `syntax/tokens.ore` | Token kinds (named as `ts.SyntaxKind`) and keywords |
| `syntax/lexer.ore` | Tokens of a file, with byte offsets |
| `syntax/ast.ore` | The syntax tree: a node kind, a span and children |
| `syntax/parser.ore` | The parser |
| `fmt/doc.ore` | Documents (groups, indents, lines, ifBreak, fill...) and their printer, which fits groups in the width |
| `fmt/estree.ore` | The syntax tree converted to the shape of typescript-estree's, and the comments of a file |
| `fmt/comments.ore` | Comments attached to nodes (leading, trailing, dangling), with prettier's rules, and printed |
| `fmt/print.ore` | The formatter: the tree printed as a document in the Ore style, as prettier prints it |
| `main.ore` | `ore-next tokens\|tree\|roles <file>`: prints the tokens or the tree; `ore-next fmt <file>`: prints the file formatted |

[`tests/harness/next.test.ts`](../../tests/harness/next.test.ts) builds it
and checks, on every `.ore` file of the repository, that its tokens and trees
equal those of the TypeScript scanner and parser.

[`tests/harness/fmt.test.ts`](../../tests/harness/fmt.test.ts) checks that
`ore-next fmt` formats every `.ore` file of the repository as `ore fmt`
(prettier) does, as written and in unformatted variants: lines joined or
broken, names made longer or shorter, quotes, semicolons, parentheses and
comments added. [`test/fmt-cases.ore`](test/fmt-cases.ore) has more syntax
and comments for it, and is deliberately not formatted.
