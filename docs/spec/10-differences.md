# Differences from TypeScript

## Removed TypeScript features

`any`, `var`, `==` / `!=`, `eval`, `delete`, `with`, `arguments`,
`prototype`, computed and dynamic property keys on structs, decorators,
`#name` private fields (use `private`),
`enum` and `const enum` (use unions of literals), index signatures (use
`Map`), `namespace` (use modules), `throw` / `try`.

Not supported yet, and planned (see the [roadmap](../roadmap.md)): `async` /
`await` and `Promise`.

## Changed semantics

| Construct | TypeScript | Ore |
|---|---|---|
| `"abc".length` | UTF-16 code units | bytes |
| `for (const c of s)` | code points as strings | runes (`i32`) |
| `7 / 2` | `3.5` | `3` (integer division) |
| `1 / 0` | `Infinity` | compile error for constants, panic for integers, `Infinity` for floats |
| `2 ** 63` in `int` | float | wraps |
| `===` on objects | identity | identity |
| `class B extends A` | inheritance through prototypes | single inheritance of fields and virtual methods; no overriding of fields or accessors |
| class compatibility | structural | nominal: a class converts to its base classes and to interfaces, not to other classes with the same members |
| `A \| B` where `B extends A` | kept as written | normalized to `A` |
| `JSON.stringify(a)` of an `A` holding a `B` | the fields of `B` | the fields of `A` (the static type) |
| `===` on strings | value | value |
| integer literal `5` | `number` | `int` |
| missing value | `undefined` | `null` |
| `let x: unknown` | `undefined` | `null` |
| `typeof x === "number"` on an `unknown` | narrows to `number` | narrows to `f64`; an integer converts |
| `x instanceof I` on an `unknown`, for an interface `I` | narrows | compile error: only classes narrow it |
| `map.get(missing)` | `undefined` | `null` |
| `a.length = n` | truncates, or grows with holes | truncates; a larger `n` panics (no holes) |
| `map.keys()` | iterator | array |
| `[10, 9, 1].sort()` | `[1, 10, 9]` (as strings) | `[1, 9, 10]` |
| `[10n, 9n, 1n].sort()` | `[1n, 10n, 9n]` (as strings) | `[1n, 9n, 10n]` |
| `1n < 2`, `1n == 1` | compare the values | compile error: no mixing of bigints and numbers |
| `BigInt(9007199254740993)` | `9007199254740992n` (the double) | `9007199254740993n` (constants are exact) |
| `BigInt(x)` of a fraction or bad text, `1n / 0n` | throw | panic (`BigInt(1.5)` of a constant is a compile error) |
| generic bodies | checked once | checked per instance |
