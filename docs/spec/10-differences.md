# Differences from TypeScript

## Removed TypeScript features

`any`, `var`, `==` / `!=`, `eval`, `with`, `arguments`, `prototype`,
`for...in` (use `for...of` over `Object.keys(o)`), dynamic property keys on
objects (use a [dictionary](03-objects.md#dictionaries); `delete` and `in`
work on dictionaries only), index signatures as members of classes, of
generic interfaces and of interfaces that extend others, decorators, `#name` private
fields (use `private`), `enum` and `const enum` (use unions of literals),
`namespace` (use modules), `throw` / `try`.

Promises never reject: there is no `reject`, `catch` or `Promise.allSettled`;
a failure is a value (`Promise<T | Error>`), and a panic in an async function
ends the program (see [Concurrency](06-concurrency.md#async-functions-and-promises)).

## Changed semantics

| Construct | TypeScript | Ore |
|---|---|---|
| order of an object's properties (printing, JSON, `Object.keys`) | the order they were added to each object | the same for literals, spreads and rests; an optional property assigned after the object was made has the place it had as null, not the last; a spread of an interface value adds its fields by name, and one in a literal with methods or accessors in the order of the spread object's type; `JSON.parse<T>` takes the text's order only when the program makes objects of `T` in it, otherwise the type's |
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
| a replacer function of `JSON.stringify` leaving a value out | returns `undefined` | returns `JSON.omit` (`null` writes `null`, as in JavaScript); the call returns `string \| null`, where TypeScript declares `string` |
| `d[k]` of `{ [k: string]: V }` | `V` (`V \| undefined` with `noUncheckedIndexedAccess`) | `V \| null` |
| `d[k] += 1` on a dictionary | `NaN` when missing | compile error: `d[k] = (d[k] ?? 0) + 1` |
| `Object.groupBy(...)` | an object with a null prototype | a dictionary, printed as an object |
| `Object.freeze(o)` of an object or class instance | freezes it | returns it unchanged; `readonly` fields are the frozen ones |
| `a.pop()`, `a.shift()` of an empty array | `undefined` | panics, as reading null would (check `a.length` first) |
| `a.length = n` | truncates, or grows with holes | truncates; a larger `n` panics (no holes) |
| `generator.next()` after the generator returned `v` | `{ value: undefined, done: true }` | `{ value: v, done: true }` (the value of `return()` after it) |
| `generator.throw(e)` | throws `e` at the `yield` | does not exist (no exceptions) |
| `s.charCodeAt(i)`, `s.slice(i)`, other string positions | UTF-16 code units | bytes of UTF-8 (`charCodeAt` is the byte at `i`) |
| `Uint8Array` (`TextEncoder`, `TextDecoder`) | a typed array | `u8[]`, printed as an array |
| `encoder.encodeInto(s, bytes).read` | UTF-16 code units | bytes of UTF-8 |
| `blob.arrayBuffer()` | `Promise<ArrayBuffer>` | `Promise<u8[]>`, as `blob.bytes()` |
| `new Blob([x])` of a number, an object, ... | converts it to a string | compile error: parts are strings, `u8[]` and blobs |
| `blob.slice(0, null)` | `null` is 0: an empty blob | `null` is a missing end: the whole blob |
| `blob.stream()`, `URL.createObjectURL(blob)`, `FileReader` | exist | do not exist |
| an invalid header name or value given to `Headers` | throws a `TypeError` | panics with its message: `TypeError: Headers.append: "a b" is an invalid header name.` |
| a header value with characters above U+00FF | throws a `TypeError` (not a `ByteString`) | kept, as UTF-8 |
| `m[i]` past the end of a `RegExpMatch` | `undefined` | panics, as for arrays |
| `s.localeCompare(t)` | the locale's collation | code point order |
| `new Array(3)` | three holes | three zero values of the element type |
| `Set` methods `union`, `isSubsetOf`, … | take set-like objects | take sets |
| `[10, 9, 1].sort()` | `[1, 10, 9]` (as strings) | `[1, 9, 10]` |
| `[10n, 9n, 1n].sort()` | `[1n, 10n, 9n]` (as strings) | `[1n, 9n, 10n]` |
| `1n < 2`, `1n == 1` | compare the values | compile error: no mixing of bigints and numbers |
| `BigInt(9007199254740993)` | `9007199254740992n` (the double) | `9007199254740993n` (constants are exact) |
| `BigInt(x)` of a fraction or bad text, `1n / 0n` | throw | panic (`BigInt(1.5)` of a constant is a compile error) |
| generic bodies | checked once | checked per instance |
| `setTimeout(f, ms)`, `setInterval`, `setImmediate` | a `Timeout` object (Node) or a number (browsers) | Node's `Timeout`, the class `time.Timer` of `time.timeout`: `ref`, `unref`, `hasRef`, `refresh`, but no `Symbol.toPrimitive` (not a number) |
| `clearTimeout(id)` | takes a timer, its number, `undefined` or `null` | takes a timer, `null` or nothing |
| `setTimeout(f, -1)`, `NaN`, beyond 2^31 - 1 ms | 1 ms with a warning (Node), 0 ms (browsers) | 1 ms, without a warning |
