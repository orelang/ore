# Ore Language Specification — Overview

Status: draft. This document is normative for the compiler; anything not
described here is either unsupported or follows TypeScript syntax rules.

## 1. Source files

- Extension: `.ore`. Encoding: UTF-8.
- Syntax is exactly the TypeScript syntax. Ore adds no new syntax; it only
  restricts it and assigns native semantics.
- A file is a module. Imports and exports use ES module syntax.

## 2. Program entry

```ts
export function main() {
  console.log("hello")
}
```

- A program has exactly one `main` function exported from the entry file.
- The top level of a file may contain only declarations: `function`, `class`,
  `interface`, `type`, `const`, `import`, `export`, `declare`.
  Top-level statements with side effects are rejected.

## 3. Types

### 3.1 Primitive types

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

### 3.2 Numeric literals

Numeric literals are untyped constants (as in Go):

- A literal takes the type required by its context, if it fits.
- Without context, an integer literal (`5`, `0xff`, `1_000`) has type `int`,
  and a literal with a fraction or exponent (`5.0`, `1e3`) has type `f64`.
- A literal that does not fit its target type is a compile error:
  `let b: u8 = 300` is rejected.
- An integer literal may be used where a float type is expected
  (`let x: f64 = 1`). A float literal may not be used where an integer type is
  expected.

### 3.3 Conversions

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

### 3.4 Arithmetic

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

### 3.5 Variables

- `let` declares a mutable variable, `const` an immutable one.
- A variable needs a type annotation or an initializer. `let x: i32` without
  an initializer starts at the zero value (`0`, `false`, `""`).
- `const N = 10` with an untyped constant initializer declares a named
  untyped constant, usable as any numeric type it fits.
- At the top level only `const` with a constant initializer is allowed.

### 3.6 Built-in namespaces

Built-in functions live in namespaces, as in TypeScript and Node:

| Function | Meaning |
|---|---|
| `console.log(...values)` | values separated by spaces and a newline, to stdout |
| `console.write(...values)` | values separated by spaces, to stdout, without a newline |
| `console.error(...values)` | values separated by spaces and a newline, to stderr |
| `process.panic(message)` | aborts with the message and a stack trace (status 2) |
| `process.exit(code)` | exits with a status code |

Printed values are numbers, `bool`, strings and unions of them (`null` prints
as `null`). Floats are printed in the shortest form that round-trips, like
JavaScript: `0.1`, `1`, `1e+21`, `1e-7`, `NaN`, `Infinity`.

Numeric conversions (`i32(x)`, `f64(x)`) are type names, not namespaced
functions.

### 3.7 Strings

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

### 3.8 Arrays

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

### 3.9 Object types

- An object type `{ x: f64; readonly id: int }` describes a record on the
  heap, used through references: assignment shares the object and `===`
  compares identity.
- Object types are structural: two object types with the same fields (names,
  types and `readonly`) are the same type, regardless of field order.
- An object literal for a known object type must have exactly its fields.
  Without a context type, the literal's type is inferred from its values;
  shorthand properties (`{ name }`) are allowed.
- Variables of object, class and interface types must be initialized: there
  is no `null` yet.

### 3.10 Classes

- A class declares a nominal type: two classes are different types even with
  the same members. There is no inheritance (`extends`); use composition and
  interfaces.
- Members: fields (with a type annotation, an initializer, or both), one
  constructor, and methods. Constructor parameters with `public`, `private`
  or `readonly` declare fields. Static members, getters and setters are not
  supported yet.
- `new C(...)` allocates an instance, assigns parameter properties, runs
  field initializers in order, then the constructor body. Field initializers
  cannot use `this`.
- A field without an initializer starts at its zero value. A field of a type
  without a zero value (class, object or interface) must be assigned at the
  top level of the constructor.
- `private` members are accessible only inside the class. `readonly` fields
  can be assigned only by the constructor of the class.
- Methods are called on instances; method values (`obj.method` without a
  call) are not supported yet.
- `class C implements I` checks that `C` has the members of `I`.

### 3.11 Interfaces

- An interface lists fields and methods. Any class or object type that has
  them, with the same types, converts implicitly to the interface: at
  assignments, arguments, returns and array elements. Private members do not
  count, and a `readonly` field cannot satisfy a writable one.
- Interfaces are structural: interfaces with the same members are the same
  type. An interface converts implicitly to an interface with a subset of its
  members. `interface A extends B` includes the members of `B`.
- An interface value refers to the original object: fields read and written
  through the interface are the object's fields, and `===` compares the
  objects.
- An object literal for an interface may only have fields of the interface.
- Object types (`type P = { ... }`) and interfaces differ on purpose: an
  object type is an exact record, an interface accepts any record or class
  with the members.

### 3.12 Evaluation order

Operands, arguments and the receiver of a method call are evaluated left to
right, as in TypeScript.

### 3.13 Statements

- `if`, `while`, `do...while`, `for`, `for...of`, `break`, `continue` and
  `return` work as in TypeScript. `for...in` is rejected.
- Loops may be labeled for `break label` and `continue label`; labels on
  other statements are rejected.
- A function with a return type must return a value on every path. A path
  ending in an infinite loop or a `process.panic(...)` call needs no return.

### 3.14 Panics

A panic prints its message and exits with status 2. Debug builds (the default)
print the Ore call stack with source lines:

```
panic: integer divide by zero

  div at main.ore:9
  main at main.ore:14
```

Release builds (`--release`) keep no call stack information.

## 4. Errors

Errors are values. A fallible function returns a union with an error type:

```ts
function parse(s: string): int | ParseError { ... }

const r = parse(input)
if (r instanceof Error) return r
// r: int here
```

`process.panic(message)` aborts the program with a stack trace. It is reserved for
bugs and unrecoverable states. `throw`, `try`, `catch`, `finally` are
rejected.

Scope-exit cleanup uses `using` declarations (`Symbol.dispose`), the Ore
equivalent of Go's `defer`.

## 5. Concurrency

Ore uses green threads without function coloring:

- `spawn(fn)` starts a green thread.
- `Chan<T>` is a typed channel; `select(...)` waits on several channels.
- Blocking operations (I/O, channel receive) park the current green thread.

`async`, `await` and `Promise` are rejected.

## 6. Removed TypeScript features

`any`, `var`, `==` / `!=`, `eval`, `delete`, `with`, `arguments`,
`prototype`, computed and dynamic property keys on structs, decorators,
`enum` (use unions of literals), `namespace` (use modules), `throw` / `try`,
`async` / `await`.

`unknown` is allowed as an explicitly boxed value that must be narrowed before
use.

## 7. Differences from TypeScript (summary)

| Construct | TypeScript | Ore |
|---|---|---|
| `"abc".length` | UTF-16 code units | bytes |
| `for (const c of s)` | code points as strings | runes (`i32`) |
| `7 / 2` | `3.5` | `3` (integer division) |
| `1 / 0` | `Infinity` | compile error for constants, panic for integers, `Infinity` for floats |
| `2 ** 63` in `int` | float | wraps |
| `===` on objects | identity | identity |
| `class B extends A` | inheritance | rejected; use composition and interfaces |
| class compatibility | structural | nominal; convert to an interface instead |
| `===` on strings | value | value |
| integer literal `5` | `number` | `int` |
