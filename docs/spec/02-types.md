# Types and values

## Primitive types

| Type | Meaning |
|---|---|
| `i8` `i16` `i32` `i64` | signed integers, two's complement |
| `u8` `u16` `u32` `u64` | unsigned integers |
| `f32` `f64` | IEEE 754 floating point |
| `bool` | `true` / `false` |
| `string` | immutable UTF-8 byte sequence |
| `void` | no value |

Aliases: `int = i64`, `uint = u64`, `byte = u8`, `number = f64`,
`boolean = bool`.

Primitive types are declared in `std/builtin.d.ore`. They are nominal:
`i32` and `i64` are distinct types even though both are declared with the same
TypeScript shape.

## Numeric literals

Numeric literals are untyped constants (as in Go):

- A literal takes the type required by its context, if it fits.
- Without context, an integer literal (`5`, `0xff`, `1_000`) has type `int`,
  and a literal with a fraction or exponent (`5.0`, `1e3`) has type `f64`.
- A literal that does not fit its target type is a compile error:
  `let b: u8 = 300` is rejected.
- An integer literal may be used where a float type is expected
  (`let x: f64 = 1`). A float literal may not be used where an integer type is
  expected.

## Conversions

There are no implicit conversions between distinct numeric types. Conversions
are explicit calls of the type name:

```ts
const a: i32 = 10
const b: i64 = i64(a)
const c: f64 = f64(b) / 3.0
const d: u8 = u8(c)        // float -> int truncates toward zero
```

- Integer to narrower integer conversion keeps the low bits (`u8(300) === 44`).
- Float to integer conversion truncates toward zero and saturates at the
  bounds of the target type; NaN converts to 0.
- Converting an untyped float constant to an integer type truncates it at
  compile time and range-checks the result: `i32(2.7)` is `2`, `u8(256.5)` is
  an error.

## Arithmetic

- Binary arithmetic requires both operands to have the same type. The right
  operand of `<<` and `>>` may be any integer type.
- Integer overflow wraps around.
- Integer `/` truncates toward zero, including untyped constants: `7 / 2` is
  `3`. Write `7.0 / 2` for a float result.
- Integer division and remainder by zero panic; `MIN / -1` wraps to `MIN`.
- Shifting by the bit width or more gives `0` (`-1` for `>>` of a negative
  value). A negative shift count panics.
- `>>` is arithmetic for signed and logical for unsigned types. `>>>` is
  rejected.
- `%` on floats is the C `fmod`.
- Comparison uses `===` / `!==`. `==` and `!=` are rejected.

## Variables

- `let` declares a mutable variable, `const` an immutable one.
- `let x: i32` without an initializer starts at the zero value of its type
  (`0`, `false`, `""`, or `null` for a type that includes it).
- A variable of a type without a zero value (a class, an object type, an
  interface) may be declared without an initializer, as may `let x` without
  a type, which takes the type of its first assignment. Such a variable must
  be assigned on every path before it is read ("definite assignment", as in
  TypeScript's strict mode): a read where it may not be assigned yet is an
  error, and so is creating a closure that captures it. A top-level variable
  used by functions must have a value where it is declared.
- `const N = 10` with an untyped constant initializer declares a named
  untyped constant, usable as any numeric type it fits.
- Top-level variables are module variables; see [programs](01-programs.md).
- Destructuring works in declarations, parameters, `for-of` and assignments:
  `const { x, y: why, home: { city } } = p`, `const [first, , ...rest] = xs`,
  `function f({ x, y }: Point)`, `for (const [k, v] of pairs)`,
  `[a, b] = [b, a]`. Object patterns read fields of classes, object types and
  interfaces; array patterns read elements of arrays, with bounds checks, and
  `...rest` is a copy of the remaining elements. Default values and rest
  elements in object patterns are not supported.

## Built-in namespaces

Built-in functions live in namespaces, as in TypeScript and Node:

| Function | Meaning |
|---|---|
| `console.log(...values)` | values separated by spaces and a newline, to stdout |
| `console.write(...values)` | values separated by spaces, to stdout, without a newline |
| `console.error(...values)` | values separated by spaces and a newline, to stderr |
| `process.panic(message)` | aborts with the message and a stack trace (status 2) |
| `process.exit(code)` | exits with a status code |
| `process.args` | the command-line arguments after the program name |
| `process.getenv(name)` | an environment variable, or `null` |
| `Math.PI`, `Math.E`, `Math.sqrt(x)`, `Math.pow`, `Math.floor`, `Math.round`, … | as in JavaScript, on `f64`; `Math.round` rounds halves up |
| `Math.abs(x)`, `Math.min(a, b)`, `Math.max(a, b)` | for any numeric type, keeping it |
| `Math.random()` | a pseudo-random `f64` in [0, 1) |
| `Number.parseInt(s, radix?)`, `Number.parseFloat(s)` | like JavaScript, but `null` instead of `NaN` |
| `fs.readFile(path)` | the file as a `string`, or an `Error` |
| `fs.writeFile(path, data)` | `null`, or an `Error` |
| `fs.exists(path)` | whether a file exists |
| `Date.now()` | milliseconds since the Unix epoch |
| `JSON.stringify(value, indent?)` | the JSON text of a value |
| `JSON.parse<T>(text)` | a `T` read from JSON text, or an `Error` |

Numbers have `toString()` and `toFixed(digits)`; `bool` has `toString()`.

Printed values are numbers, `bool`, strings and unions of them (`null` prints
as `null`). Floats are printed in the shortest form that round-trips, like
JavaScript: `0.1`, `1`, `1e+21`, `1e-7`, `NaN`, `Infinity`.

JSON is typed, as in Go: the code that writes and reads a type is generated
for it. Numbers, `bool`, strings, string literal types, `null`, arrays,
`Map`s with string keys, object types, classes (all their fields) and unions
of these can be converted; interfaces and functions cannot. `JSON.parse<T>`
checks the shape: an integer must be whole and in range, a string literal
type must match, and a field must be present unless its type includes
`null`; unknown fields are ignored. Its errors name the place, e.g.
`JSON: expected a string, got a number at .tags[1]`. Fields of object types
are written in alphabetical order, fields of classes in declaration order;
non-finite floats are written as `null`.

Numeric conversions (`i32(x)`, `f64(x)`) are type names, not namespaced
functions.

## Strings

- A `string` is an immutable sequence of UTF-8 bytes.
- `a + b` and `+=` concatenate two strings. A string and a non-string cannot
  be added: use a template literal, `` `${a}${b}` ``, which formats numbers
  and `bool` like `print`.
- `s.length` is the length in bytes. `s[i]` is the byte at `i` as `u8`;
  an index out of range panics.
- `s.slice(start, end?)` takes byte offsets with JavaScript rules: negative
  offsets count from the end, out-of-range offsets are clamped.
- `<`, `<=`, `>`, `>=` compare strings byte-wise; `===` compares contents.
- `for (const r of s)` iterates runes as `i32`. Invalid UTF-8 yields
  U+FFFD (65533) for each invalid byte.
- Methods, as in JavaScript but on byte offsets: `indexOf(s, from?)`,
  `lastIndexOf`, `includes`, `startsWith`, `endsWith`, `split(sep)` (an empty
  separator splits into UTF-8 characters), `trim`, `trimStart`, `trimEnd`,
  `toUpperCase` and `toLowerCase` (ASCII letters), `replace` (the first
  occurrence), `replaceAll`, `repeat(n)`, `padStart(n, pad?)`,
  `padEnd(n, pad?)`, `substring(start, end?)`.

## Arrays

- `T[]` (or `Array<T>`) is a reference to a growable array, as in
  TypeScript: assigning an array or passing it to a function shares it.
  `===` compares identity.
- An array literal takes its element type from the context
  (`let a: u8[] = [1, 2]`), else from its first typed element, else from the
  default type of its constants (`[1, 2]` is `int[]`). `[]` requires a
  context type.
- `a[i]` reads and writes elements; an index of any integer type is allowed
  and an index out of range panics. Compound assignments (`a[i] += 1`,
  `a[i]++`) evaluate `a` and `i` once.
- `a.push(...values)` appends and returns the new length. `a.pop()` removes
  and returns the last element and panics on an empty array.
  `a.slice(start?, end?)` returns a copy with JavaScript offsets.
- `let a: T[]` without an initializer is a new empty array.
- `for (const x of a)` iterates elements; the length is re-read on every
  iteration, so elements pushed during the loop are visited.
