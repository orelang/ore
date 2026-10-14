# Ore language specification

Status: draft. The specification is normative for the compiler; anything not
described here is either unsupported or follows TypeScript syntax rules.

| Chapter | Contents |
|---|---|
| [Programs](01-programs.md) | Source files, top-level code, module variables |
| [Types and values](02-types.md) | Primitive types, literals, conversions, arithmetic, variables, built-in namespaces, strings, arrays |
| [Objects, classes, interfaces and generics](03-objects.md) | Object types, classes, interfaces, unions and null, narrowing, generics, maps |
| [Functions and statements](04-functions.md) | Functions and closures, array methods, resources (`using`), evaluation order, statements, panics |
| [Errors](05-errors.md) | Errors as values |
| [Concurrency](06-concurrency.md) | Tasks, channels, `select` |
| [Modules, packages and C](07-modules.md) | Imports and exports, package.json, external C functions |
| [Tests](08-tests.md) | `ore test` |
| [Unsafe code and directives](09-unsafe.md) | The `unsafe` namespace and `//ore:` directives |
| [Differences from TypeScript](10-differences.md) | Removed features and changed semantics |
