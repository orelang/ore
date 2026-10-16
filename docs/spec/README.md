# Ore language specification

Status: draft. The specification is normative for the compiler; anything not
described here is either unsupported or follows TypeScript syntax rules.

| Chapter | Contents |
|---|---|
| [Programs](01-programs.md) | Source files, top-level code, module variables |
| [Types and values](02-types.md) | Primitive types, literals, conversions, arithmetic, bigints, variables, built-in namespaces (files, time, running programs, `console.log`, JSON), strings, regular expressions, arrays, tuples, `unknown` |
| [Objects, classes, interfaces and generics](03-objects.md) | Object types, classes, inheritance, interfaces, unions and null, narrowing, generics, computed types, maps, sets |
| [Functions and statements](04-functions.md) | Functions and closures, array methods, resources (`using`), evaluation order, statements, panics |
| [Errors](05-errors.md) | Errors as values |
| [Concurrency](06-concurrency.md) | Tasks, channels, `select`, stacks, `ore:sync`, `ore:net` |
| [Modules, packages and C](07-modules.md) | Imports and exports, package.json, modules from GitHub, text and JSON files, external C functions |
| [Tests](08-tests.md) | `ore test` and `ore:test` |
| [Unsafe code and directives](09-unsafe.md) | The `unsafe` namespace, `//ore:` directives, the target |
| [Differences from TypeScript](10-differences.md) | Removed features and changed semantics |
| [Standard modules](11-standard-modules.md) | The `ore:` modules: `ore:crypto`, `ore:path`, and where the others are described |

The pages of [diagnostics](../errors/README.md) link to the sections that
state the rules they enforce.
