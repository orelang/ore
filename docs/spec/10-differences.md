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
| `for (const c of s)` | code points as strings | runes (`i32`); `s[Symbol.iterator]()`, spread, `Array.from(s)`, `Iterator.from(s)` and `yield* s` give code points as strings, as in JavaScript |
| `7 / 2` | `3.5` | `3` (integer division) |
| `1 / 0` | `Infinity` | compile error for constants, panic for integers, `Infinity` for floats |
| `2 ** 63` in `int` | float | wraps |
| `===` on objects | identity | identity |
| `class B extends A` | inheritance through prototypes | single inheritance of fields and virtual methods; no overriding of fields or accessors |
| class compatibility | structural | nominal: a class converts to its base classes and to interfaces, not to other classes with the same members |
| `A \| B` where `B extends A` | kept as written | normalized to `A` |
| generic methods of interfaces | one function for any type arguments | an instance per type arguments that the program calls through the interface; checked against the interface's per instance; an object literal's is not a property (not printed, listed or spread) |
| `JSON.stringify(a)` of an `A` holding a `B` | the fields of `B` | the fields of `A` (the static type) |
| `===` on strings | value | value |
| `===` on a function converted to a function type with more parameters, wider ones or a wider result | the same function | a new function wrapping it at each conversion, but for a top-level function, which converts to the same one each time: keep the converted value to remove a listener |
| `obj.method` taken without a call | unbound (`this` is lost) | bound to `obj` |
| a module variable read, by a function or a field initializer, before its declaration runs | throws a `ReferenceError` | its zero value |
| a field without an annotation whose initializer uses a module variable declared below, used by top-level code before that declaration | the variable's type | compile error ([ORE5069](../errors/ORE5069.md)): annotate the field |
| the default value of a parameter without an annotation using a module variable or constant | its type | compile error ("Cannot find name"): annotate the parameter (an annotated one sees every declaration of the module) |
| integer literal `5` | `number` | `int` |
| missing value | `undefined` | `null` |
| `let x: unknown` | `undefined` | `null` |
| `typeof x === "number"` on an `unknown` | narrows to `number` | narrows to `f64`; an integer converts |
| `x instanceof I` on an `unknown`, for an interface `I` | narrows | compile error: only classes narrow it (`Error` is the class of `new Error(...)`, as `instanceof Error` is in JavaScript) |
| `x instanceof Box<int>` | tests for the class `Box` (type arguments are erased) | tests for the instance `Box<int>`, and narrows to it |
| `map.get(missing)` | `undefined` | `null` |
| a replacer function of `JSON.stringify` leaving a value out | returns `undefined` | returns `JSON.omit` (`null` writes `null`, as in JavaScript); the call returns `string \| null`, where TypeScript declares `string` |
| a reviver function of `JSON.parse` | returns `undefined` to delete a value, which leaves a hole in an array; its `context` is `{}` for an array or an object; the result is `any` | returns `JSON.omit` to delete a value, which is `null` in an array; `context` is `null` for an array or an object; the result is read as the `T` of `JSON.parse<T>`, an `Error` if it is not one |
| `JSON.parse(text)` | `any` | `JSON.parse<unknown>(text)`: an `unknown` holding numbers as `f64`s, arrays as `unknown[]`s and objects as dictionaries, or the `Error` (the type to read is required) |
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
| `new FormData(form, submitter)` | the entries of a form element | does not exist: `new FormData()` starts empty, Ore has no forms |
| `crypto.getRandomValues(array)` | an integer typed array; a `Float64Array` throws `TypeMismatchError` | an array of an integer type (`u8[]`, `i32[]`, `i64[]`, …); floats are a compile error; more than 65536 bytes panics with `QuotaExceededError` |
| `crypto.randomUUID()` | a UUID of version 4 | `crypto.randomUUIDv4()`, beside `crypto.randomUUIDv7()`; `crypto.subtle` is missing |
| `performance` | an object (an `EventTarget`) | a namespace: no value, no events; `toJSON()` is `{ timeOrigin }`; Node's `timerify`, `eventLoopUtilization` and `nodeTiming` are missing |
| `performance.mark(name, { detail })`, `measure` | `detail` is a structured clone | `detail` is the value given, an `unknown` |
| `new PerformanceMeasure(...)` | throws `TypeError: Illegal constructor` | takes the arguments of `performance.measure` and makes a measure without recording it |
| `measure(name, { start })` with a mark name, or `measure(name, mark)` | also the names of `performance.timing` (browsers) or `nodeTiming` (Node) | only marks recorded with `performance.mark` |
| `m[i]` past the end of a `RegExpMatch` | `undefined` | panics, as for arrays |
| `s.localeCompare(t)` | the locale's collation | code point order |
| `new Array(3)` | three holes | three zero values of the element type |
| `Set` methods `union`, `isSubsetOf`, … | take set-like objects | take sets |
| `[10, 9, 1].sort()` | `[1, 10, 9]` (as strings) | `[1, 9, 10]` |
| `[10n, 9n, 1n].sort()` | `[1n, 10n, 9n]` (as strings) | `[1n, 9n, 10n]` |
| `1n < 2`, `1n == 1` | compare the values | compile error: no mixing of bigints and numbers |
| `BigInt(9007199254740993)` | `9007199254740992n` (the double) | `9007199254740993n` (constants are exact) |
| `BigInt(x)` of a fraction or bad text, `1n / 0n` | throw | panic (`BigInt(1.5)` of a constant is a compile error) |
| `signal.throwIfAborted()` | throws the reason | panics with it (test `signal.aborted` and return `signal.reason` instead) |
| the reason of `abort()`, `AbortSignal.timeout(ms)` | a `DOMException` named `AbortError`, `TimeoutError` | an `Error` with that name |
| `new CustomEvent(type)` without `detail` | `detail` is `null` | compile error: `detail` is required (or use `new Event(type)`) |
| `addEventListener(type, { handleEvent })` | an object listener | compile error: a listener is a function |
| `port.addEventListener("message", (e) => e.data)` | `e` is a `MessageEvent` (overloads of the DOM's types) | `e` is an `Event`: `if (e instanceof MessageEvent<T>) e.data`; `onmessage` gets a `MessageEvent<T>` |
| `postMessage(value)` of a port or `BroadcastChannel` | `value` is `any` | of the type `T` of `MessageChannel<T>`, `BroadcastChannel<T>`: `unknown` by default, narrowed by the receiver |
| `postMessage(fn)` | throws a `DataCloneError` | compile error for a type that cannot be cloned; panics for an `unknown` holding one |
| `postMessage(value, transfer)`, posting ports | transfers buffers and ports | no transfer list: messages are clones, `ports` is empty |
| `new BroadcastChannel<A>(name)`, `new BroadcastChannel<B>(name)` | (no types) one channel | channels of other message types do not receive each other's messages |
| `structuredClone(x)` of an `unknown` (TS: of `any`) holding a function | throws a `DataCloneError` | panics with it |
| generic bodies | checked once | checked per instance |
| `setTimeout(f, ms)`, `setInterval`, `setImmediate` | a `Timeout` object (Node) or a number (browsers) | Node's `Timeout`, the class `time.Timer` of `time.timeout`: `ref`, `unref`, `hasRef`, `refresh`, but no `Symbol.toPrimitive` (not a number) |
| `clearTimeout(id)` | takes a timer, its number, `undefined` or `null` | takes a timer, `null` or nothing |
| `setTimeout(f, -1)`, `NaN`, beyond 2^31 - 1 ms | 1 ms with a warning (Node), 0 ms (browsers) | 1 ms, without a warning |
