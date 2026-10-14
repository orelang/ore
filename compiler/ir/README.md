# @ore/ir

The typed IR between the checker and the backend: structured (blocks, loops,
`switch`, `using`; no gotos), with names resolved and every expression typed.
Generics are already instantiated, closures list their captures, and unions,
interfaces and their tables are explicit.

- `types.ts`: the type model (`int`, `float`, `string`, `struct`, `union`,
  `interface`, `func`, `array`, `map`, `chan`, `ptr`, …), `typeToString`,
  `sameType` and the representation of unions.
- `nodes.ts`: `Module`, `Func`, `Local`, statements and expressions. A node
  is a plain object with a kind `k`.
