# compiler/next

The Ore compiler written in Ore, which will replace the TypeScript compiler
(see the [roadmap](../../docs/roadmap.md)). So far it has the lexer
and the parser, which build a tree in the shape of TypeScript's, and the IR
of `@ore/ir`, which the checker, the optimizer and the backend will share.

| File | Contents |
|---|---|
| `syntax/tokens.ore` | Token kinds (named as `ts.SyntaxKind`) and keywords |
| `syntax/lexer.ore` | Tokens of a file, with byte offsets |
| `syntax/ast.ore` | The syntax tree: a node kind, a span and children |
| `syntax/parser.ore` | The parser |
| `ir/types.ore` | The type model (`compiler/ir/src/types.ts`): `Type`, `types`, `sameType`, `typeToString`, `typeKey`, `unionRepr` |
| `ir/nodes.ore` | The IR nodes (`compiler/ir/src/nodes.ts`): `Module`, `Func`, `Local`, statements and expressions |
| `ir/dump.ore` | `dump(module)`: the canonical text of a module, the same as `dump` of `compiler/ir/src/dump.ts` |
| `main.ore` | `ore-next tokens|tree <file>`: prints the tokens or the tree |

[`tests/harness/next.test.ts`](../../tests/harness/next.test.ts) builds it
and checks, on every `.ore` file of the repository, that its tokens and trees
equal those of the TypeScript scanner and parser, and runs the tests of
`test/*.test.ore` (also run by `bun run ore test compiler/next/test`).
`test/ir-dump.test.ore` and `compiler/ir/test/dump.test.ts` build the same
IR module by hand and check that their dumps both equal `test/ir-dump.txt`
(`UPDATE=1 bun test compiler/ir` rewrites it after a change of the format).

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
first (`const args: Type[] = [...]`); a default parameter value cannot refer to
module-level names, so use `x: T | null = null` and `x ?? value` in the body;
union types cannot be `Map` keys (key by `typeKey(t)` or an id instead).
