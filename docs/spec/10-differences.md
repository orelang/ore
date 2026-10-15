# Differences from TypeScript

## Removed TypeScript features

`any`, `var`, `==` / `!=`, `eval`, `delete`, `with`, `arguments`,
`prototype`, computed and dynamic property keys on structs, decorators,
`enum` and `const enum` (use unions of literals), index signatures (use
`Map`), `namespace` (use modules), `throw` / `try`,
`async` / `await`.

`unknown` is allowed as an explicitly boxed value that must be narrowed before
use.

## Changed semantics

| Construct | TypeScript | Ore |
|---|---|---|
| `"abc".length` | UTF-16 code units | bytes |
| `for (const c of s)` | code points as strings | runes (`i32`) |
| `7 / 2` | `3.5` | `3` (integer division) |
| `1 / 0` | `Infinity` | compile error for constants, panic for integers, `Infinity` for floats |
| `2 ** 63` in `int` | float | wraps |
| `===` on objects | identity | identity |
| `class B extends A` | inheritance through prototypes | single inheritance of fields and virtual methods; no static members, no overriding of fields or accessors |
| class compatibility | structural | nominal: a class converts to its base classes and to interfaces, not to other classes with the same members |
| `A \| B` where `B extends A` | kept as written | normalized to `A` |
| `JSON.stringify(a)` of an `A` holding a `B` | the fields of `B` | the fields of `A` (the static type) |
| `===` on strings | value | value |
| integer literal `5` | `number` | `int` |
| missing value | `undefined` | `null` |
| `map.get(missing)` | `undefined` | `null` |
| `map.keys()` | iterator | array |
| `[10, 9, 1].sort()` | `[1, 10, 9]` (as strings) | `[1, 9, 10]` |
| generic bodies | checked once | checked per instance |
