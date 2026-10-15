# compiler/next

The Ore compiler written in Ore, which will replace the TypeScript compiler
(see the [roadmap](../../docs/roadmap.md)). So far it has the lexer
and the parser, which build a tree in the shape of TypeScript's, the loading
of a program's modules, the IR of `@ore/ir`, which the checker, the optimizer
and the backend will share, the formatter, and the language server, which
reports syntax errors until the checker is ported.

| File | Contents |
|---|---|
| `syntax/tokens.ore` | Token kinds (named as `ts.SyntaxKind`) and keywords |
| `syntax/lexer.ore` | Tokens of a file, with byte offsets |
| `syntax/ast.ore` | The syntax tree: a node kind, a span and children |
| `syntax/parser.ore` | The parser, with its syntax errors and their spans |
| `syntax/source.ore` | A parsed file: path, text, tree; line and column of an offset |
| `syntax/diagnostic.ore` | Diagnostics and their `path:line:col: error: message` format |
| `syntax/imports.ore` | Module specifiers, string literal values, text imports |
| `syntax/parse.ore` | A file parsed into a `Source`, syntax errors as diagnostics |
| `project/resolve.ore` | The `ore:` modules embedded in the compiler, the runtime's load order, import resolution |
| `project/load.ore` | `loadProgram`: the entry file and every module it imports |
| `ir/types.ore` | The type model (`compiler/ir/src/types.ts`): `Type`, `types`, `sameType`, `typeToString`, `typeKey`, `unionRepr` |
| `ir/nodes.ore` | The IR nodes (`compiler/ir/src/nodes.ts`): `Module`, `Func`, `Local`, statements and expressions |
| `ir/dump.ore` | `dump(module)`: the canonical text of a module, the same as `dump` of `compiler/ir/src/dump.ts` |
| `fmt/doc.ore` | Documents (groups, indents, lines, ifBreak, fill...) and their printer, which fits groups in the width |
| `fmt/estree.ore` | The syntax tree converted to the shape of typescript-estree's, and the comments of a file |
| `fmt/comments.ore` | Comments attached to nodes (leading, trailing, dangling), with prettier's rules, and printed |
| `fmt/print.ore` | The formatter: the tree printed as a document in the Ore style, as prettier prints it |
| `lsp/jsonrpc.ore` | JSON-RPC over the LSP base protocol: `Content-Length` framing, a reader task, cancellation, error codes |
| `lsp/text.ore` | LSP positions (UTF-16) to byte offsets and back, file URIs |
| `lsp/analysis.ore` | What the server knows of a document: syntax diagnostics now; hover, definition, completion and references are TODOs for the checker |
| `lsp/server.ore` | The language server of `compiler/lsp`: lifecycle, documents with incremental changes, diagnostics and the language features |
| `main.ore` | `ore-next tokens\|tree\|roles\|modules\|fmt <file>`: prints the tokens, the tree, the modules of a program, or the file formatted; `ore-next lsp`: the language server on stdio |

[`tests/harness/next.test.ts`](../../tests/harness/next.test.ts) builds it
and checks, on every `.ore` file of the repository, that its tokens and trees
equal those of the TypeScript scanner and parser; on every program of
`tests/`, that the modules it loads equal those of `@ore/project`; and runs
the tests of `test/*.test.ore` (also run by `bun run ore test compiler/next/test`).
`test/ir-dump.test.ore` and `compiler/ir/test/dump.test.ts` build the same
IR module by hand and check that their dumps both equal `test/ir-dump.txt`
(`UPDATE=1 bun test compiler/ir` rewrites it after a change of the format).
[`tests/harness/lsp-next.test.ts`](../../tests/harness/lsp-next.test.ts) speaks
LSP to `ore-next lsp`.
[`tests/harness/fmt.test.ts`](../../tests/harness/fmt.test.ts) checks that
`ore-next fmt` formats every `.ore` file of the repository as `ore fmt`
(prettier) does, as written and in unformatted variants: lines joined or
broken, names made longer or shorter, quotes, semicolons, parentheses and
comments added. [`test/fmt-cases.ore`](test/fmt-cases.ore) has more syntax
and comments for it, and is deliberately not formatted.

Differences from the TypeScript packages: offsets are bytes of the UTF-8 text
(columns still count UTF-16 code units, as TypeScript and LSP do); syntax
errors have the parser's messages, not TypeScript's; I/O errors are values
(`loadProgram` returns `Program | Error`), and an invalid package.json is a
diagnostic at the import instead of an exception.

## How TypeScript maps to Ore in this port

Ports keep the names of the TypeScript sources (types, fields, kinds,
functions), so that code translates line by line. Where TypeScript has no
equivalent in Ore:

| TypeScript | Ore |
|---|---|
| `interface X { k: "a"; ... }`, a member of a discriminated union | `class X` with `readonly k: "a" = "a"`; the union is a union of classes, narrowed by `switch (x.k)`, `x.k === "a"` or `instanceof` |
| object literal `{ k: "a", f, g }` | `new X(f, g)`: the constructor takes the required fields in declaration order, then the optional ones |
| inline object types (`{ test?, body }`, `{ k: "field", ... }` of `InterfaceMember` or `LValue`) | a named class: `SwitchClause`, `InterfaceField` / `InterfaceMethod`, `LocalLValue` / `ElementLValue` / `FieldLValue` / `IfaceFieldLValue`, `FieldInit`, `BindLocal`, `BuiltinError`, `StringsRepr` / `NullableRepr` / `TaggedRepr` |
| optional field `x?: T` | `x: T \| null`, a constructor parameter with default `null` (`undefined` checks become `!== null`) |
| optional flag `x?: boolean` | `x: bool`, default `false` |
| `line?: number` of statements (`StmtBase`) | `line: int \| null = null`, not a constructor parameter; on a `Stmt` union use `setLine(stmt, line)`, since Ore reads but does not assign a field common to union members |
| `readonly` field | `readonly` field; a field named with a reserved word (`else`, `readonly`, `private`) is declared in the class body and assigned by the constructor |
| `number` (ids, lines, indices, arity) | `int` |
| `bits: 8 \| 16 \| 32 \| 64` (numeric literal types) | `int` |
| string literal unions (`IntName`, `ArithOp`, inline `op` unions) | kept; inline ones get a name (`MapOpName`, `ChanOpName`) |
| `bigint` of `IntLit` | `i64` holding the bits: a `u64` constant above the `i64` range is negative (print it with `u64(value)`) |
| `intRange(t): [bigint, bigint]` | `intRange(t): IntRange` with `min: i64` and `max: u64` |
| `T \| undefined` results (`findField`) | `T \| null` |
| `readonly T[]` | `T[]` |
| `try` / `finally` | explicit cleanup on every path |

Ore limitations to keep in mind: an array literal passed where `T[] | null` is
expected takes its type from its first element, so declare it with a type
first (`const args: Type[] = [...]`); a default parameter value that
constructs a class needs a type annotation (`o: O = new O()`); union types cannot be `Map` keys (key by `typeKey(t)` or an id instead).
