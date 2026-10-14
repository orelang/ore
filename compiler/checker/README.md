# @ore/checker

Checks a program and lowers it to [IR](../ir): resolves names, infers and
checks types, narrows unions, instantiates generics, builds interface tables,
and reports diagnostics with suggestions. Its result is an `ir.Module` when
there are no errors, and `CheckInfo` (types and definitions per node) for the
language server.

| File | Contents |
|---|---|
| `checker.ts` | The checker: declarations, statements, expressions, calls, generics, classes, directives, `unsafe`, JSON |
| `builtins.ts` | The root scope from [`builtin.d.ore`](../../runtime/std/builtin.d.ore) |
| `symbols.ts` | Scopes and symbols |
| `operand.ts` | The result of checking an expression: typed IR or an untyped constant |
| `fold.ts` | Constant folding of untyped numbers, as in Go |
| `assigned.ts` | Definite assignment: a flow analysis over the IR |

The checker runs in passes over all modules: declarations and imports, then
types and signatures, then top-level code and bodies, so that declarations
can be used before they appear. The rules it implements are in the
[spec](../../docs/spec).
