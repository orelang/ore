# @ore/checker

Checks a program and lowers it to [IR](../ir): resolves names, infers and
checks types, narrows unions, instantiates generics, builds interface tables,
and reports diagnostics with suggestions. Its result is an `ir.Module` when
there are no errors, and `CheckInfo` (types and definitions per node) for the
language server.

The checker is one class split into layers, each file extending the one
before it; a layer calls methods of later layers through `abstract`
declarations in `base.ts`.

| File | Contents |
|---|---|
| `base.ts` | State, diagnostics, resolving types, conversions of operands |
| `declarations.ts` | Modules and imports, directives, functions, type aliases, generics |
| `classes.ts` | Classes and interfaces: members, constructors, accessors, conformance, interface tables |
| `statements.ts` | Statements, destructuring, closures, narrowing |
| `expressions.ts` | Names, operators, assignments, literals, members |
| `calls.ts` | Calls of functions, methods and closures, `new`, built-ins (`unsafe`, `JSON`), array and string methods |
| `checker.ts` | `check()` and `Checker.run()`: the passes over the program |
| `context.ts` | Types shared by the layers |
| `helpers.ts` | Tables and pure functions |
| `builtins.ts` | The root scope from [`builtin.d.ore`](../../runtime/std/builtin.d.ore) |
| `symbols.ts` | Scopes and symbols |
| `operand.ts` | The result of checking an expression: typed IR or an untyped constant |
| `fold.ts` | Constant folding of untyped numbers, as in Go |
| `assigned.ts` | Definite assignment: a flow analysis over the IR |

The checker runs in passes over all modules: declarations and imports, then
types and signatures, then top-level code and bodies, so that declarations
can be used before they appear. The rules it implements are in the
[spec](../../docs/spec).
