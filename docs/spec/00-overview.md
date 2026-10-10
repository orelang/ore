# Ore Language Specification — Overview

Status: draft. This document is normative for the compiler; anything not
described here is either unsupported or follows TypeScript syntax rules.

## 1. Source files

- Extension: `.ore`. Encoding: UTF-8.
- Syntax is exactly the TypeScript syntax. Ore adds no new syntax; it only
  restricts it and assigns native semantics.
- A file is a module. Imports and exports use ES module syntax; see §8.

## 2. Programs

```ts
const name = process.args[0] ?? "world"
console.log(`hello, ${name}`)
```

- A program is the top-level code of its modules, as in a script: when it
  starts, each module's top-level statements run in order, every module after
  the modules it imports and the entry file last. The program ends when the
  entry file's code ends, or with `process.exit()`. `return` is not allowed
  at the top level. `main` is an ordinary name.
- Function, class, interface and type declarations are hoisted: they can be
  used anywhere in their module, before or after the declaration.
- A top-level `const` made of literals and other such constants (`const
  size = 64 * 1024`) is a compile-time constant, known before any code runs.
- Other top-level `let` and `const` declarations are module variables. Used
  by functions of the module (or exported), they are global variables, zero
  until their declaration runs; tasks share them, so concurrent access needs
  channels or `ore:sync`, as in Go. Variables used only by the top-level code
  itself are ordinary locals of it.

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
- Top-level variables are module variables; see §2.
- Destructuring works in declarations, parameters, `for-of` and assignments:
  `const { x, y: why, home: { city } } = p`, `const [first, , ...rest] = xs`,
  `function f({ x, y }: Point)`, `for (const [k, v] of pairs)`,
  `[a, b] = [b, a]`. Object patterns read fields of classes, object types and
  interfaces; array patterns read elements of arrays, with bounds checks, and
  `...rest` is a copy of the remaining elements. Default values and rest
  elements in object patterns are not supported.

### 3.6 Built-in namespaces

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

Numbers have `toString()` and `toFixed(digits)`; `bool` has `toString()`.

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
- Methods, as in JavaScript but on byte offsets: `indexOf(s, from?)`,
  `lastIndexOf`, `includes`, `startsWith`, `endsWith`, `split(sep)` (an empty
  separator splits into UTF-8 characters), `trim`, `trimStart`, `trimEnd`,
  `toUpperCase` and `toLowerCase` (ASCII letters), `replace` (the first
  occurrence), `replaceAll`, `repeat(n)`, `padStart(n, pad?)`,
  `padEnd(n, pad?)`, `substring(start, end?)`.

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

### 3.12 Unions and null

- `A | B` is a union type. Unions are normalized: nested unions are
  flattened, duplicates removed, and `string` absorbs string literal types.
- `null` is a value only of unions that contain `null`. A variable of such a
  type without an initializer starts as `null`. There is no `undefined`.
- A string literal type such as `"circle"` has strings as values. A string
  literal expression takes the literal type its context asks for.
- A value converts implicitly to a union containing its type. A class or
  object converts to a union member that is an interface it implements, if
  exactly one does.
- Representation: a reference type with `null` is a nullable reference; a
  union of string literals is a string; other unions are tagged values.

### 3.13 Narrowing

Checks narrow the type of a variable, of `this`, or of a field path such as
`this.head.next`:

- `x !== null` and `x === null`;
- `x === "lit"` for a union of literal types, and `x.kind === "lit"` for a
  union of objects whose `kind` fields have literal types (discriminated
  unions);
- `typeof x === "string" | "number" | "boolean" | "object"`;
- `x instanceof C` for a class `C` (also on interface values, which then
  narrow to the class) and `x instanceof I` for an interface member of a
  union.

Narrowing applies inside `if` / `else`, `while` and `for` bodies, the operands
of `&&`, `||` and `?:`, `switch` clauses on a literal (clauses reached by
falling through code are not narrowed), and after an `if` whose branch always
exits (`if (x === null) return`). An assignment narrows to the assigned
value's type until the next assignment. Loops forget facts about variables
they assign.

A narrowed read is checked at run time and panics if the value is not of the
narrowed type, so a check made stale by a call cannot corrupt memory.

`x?.f`, `x?.m()` and `x?.[i]` give `null` when `x` is null. `x ?? y` gives
`y` when `x` is null. `x!` asserts that `x` is not null and panics otherwise.

A `switch` over a union of string literals with a case for every literal is
exhaustive: like a `default`, it lets a function end without `return`.

### 3.14 Generics

- Functions, classes, interfaces and type aliases may have type parameters,
  optionally constrained: `function longest<T extends Named>(items: T[]): T`.
- Type arguments are written (`id<int>(5)`, `new Box<string>()`) or inferred
  from the arguments, also through arrays, unions, generic classes,
  interfaces and aliases (`map(xs, new Doubler())` infers `Mapper<A, B>`).
- Each set of type arguments creates a separate instance (monomorphization),
  checked with the concrete types: inside `longest<City>`, `T` is `City`. The
  constraint is checked where the instance is created. Errors inside a
  generic name the instance, e.g. `(in 'twice<string>')`. A generic that is
  never instantiated is only parsed.
- Class methods can have their own type parameters
  (`map<U>(f: (x: T) => U): Box<U>`), instantiated per call like generic
  functions; they cannot be used as values, and interface methods cannot be
  generic. Default type arguments are not supported.
- A function literal passed for a parameter like `f: (x: T) => U` gets its
  parameter types from the type arguments inferred from the other arguments,
  and its result binds the rest: `box.map((n) => n * 2)`.

### 3.15 Maps

- `Map<K, V>` is a reference to a hash map that iterates in insertion order.
  `new Map<K, V>()` creates one; the type arguments may come from the context
  (`const m: Map<string, int> = new Map()`). A variable without an
  initializer starts as a new empty map.
- `get(key)` returns `V | null`; `set(key, value)` returns the map;
  `has`, `delete` (returns whether the key was present), `clear`, `size`.
  `keys()` and `values()` return arrays in insertion order.
- `for (const [key, value] of map)` iterates entries in insertion order.
- Keys compare like SameValueZero: numbers and strings by value (`NaN`
  equals `NaN`, `-0` equals `0`), objects, arrays and interface values by
  identity. Unions cannot be keys yet.

### 3.16 Functions and closures

- A function type `(a: int, b: string) => bool` describes function values.
  Function values are top-level functions used by name, methods taken
  without a call (`const f = obj.method`, bound to `obj`), arrow functions,
  function expressions and nested function declarations. `===` compares
  identity; a function type can be in a union with `null`, and `f?.(x)`
  calls it unless it is null.
- Closures capture variables by reference, as in JavaScript: changes are
  seen by the closure and by the enclosing function. Each iteration of
  `for (let ...)` has its own copy of the loop variable.
- Parameters of a function literal take their types from the context
  (`xs.map((x) => x * 2)`) or from annotations. The return type comes from
  an annotation or the context, or is inferred from the first `return`.
- Arrow functions keep `this` of the enclosing method; function expressions
  have no `this`.
- Nested function declarations are hoisted: they can be called anywhere in
  their block, call each other recursively, and use every variable of the
  block. Arrow functions can only use variables declared before them.
- Top-level functions, methods and constructors can have optional
  parameters after the required ones: `b = 1` (its type may come from the
  value), or `b?: T`, which is `T | null` and `null` when missing. A default
  value is computed at each call that omits it, after the given arguments,
  and can use the parameters before it. A last rest parameter `...xs: T[]`
  receives the extra arguments as an array; `f(...array)` passes an array as
  all of them. As values, such functions take all their parameters, and
  closures cannot have optional or rest parameters.

### 3.17 Array methods

`forEach`, `map`, `filter`, `reduce` (with an initial value), `find`
(`T | null`), `findIndex`, `some`, `every`, `includes`, `indexOf`,
`join(separator = ",")`, `reverse` and `sort(compare?)` work as in
JavaScript. Callbacks receive `(element, index)` (`reduce`: accumulator
first) and may declare fewer parameters. `sort` is stable; without a
comparator it sorts numbers by value and strings by bytes (JavaScript sorts
everything as strings). `includes` finds `NaN`, `indexOf` does not.

### 3.18 Resources

`using x = resource` declares a resource whose type has a
`[Symbol.dispose](): void` method (the built-in interface `Disposable`).
When the rest of the block ends, also by `return`, `break` or `continue`,
`x[Symbol.dispose]()` is called; several resources are disposed in reverse
order, and a null resource is skipped. Panics do not dispose resources.

### 3.19 Evaluation order

Operands, arguments and the receiver of a method call are evaluated left to
right, as in TypeScript.

### 3.20 Statements

- `if`, `while`, `do...while`, `for`, `for...of`, `switch`, `break`,
  `continue` and `return` work as in TypeScript. `for...in` is rejected.
- `switch` compares with `===`, evaluates case expressions in order until one
  matches, and falls through until `break`. It works on numbers, `bool`,
  strings and unions of string literals.
- Loops and switches may be labeled for `break label`, and loops for
  `continue label`; labels on other statements are rejected.
- A function with a return type must return a value on every path. A path
  ending in an infinite loop or a `process.panic(...)` call needs no return.

### 3.21 Panics

A panic prints its message and exits with status 2. Debug builds (the default)
print the Ore call stack with source lines:

```
panic: integer divide by zero

  div at main.ore:9
  main at main.ore:14
```

Release builds (`--release`) keep no call stack information.

### 3.22 External C functions

`declare function name(params): result` at the top level of a module declares
a C function named `name`. Parameters and results may be numbers, `bool`,
`string` and `ptr`, an opaque pointer for handles. A `string` is passed as a
NUL-terminated copy (`const char *`); a returned `const char *` is copied
into an Ore string (NULL gives `""`). External functions cannot be used as
values.

In package.json, `"ore": { "link": [...], "sources": [...] }` adds libraries
to link (`-l`) and C files, relative to the package, to compile into the
program. This applies to every package of the program, including
dependencies in `node_modules`.

## 4. Errors

Errors are values. The built-in interface `Error` has a `message`; any class
with a `message: string` field is an `Error`, and `new Error(message)`
creates a basic one. A fallible function returns a union with `Error`:

```ts
class ParseError {
  constructor(readonly message: string, readonly position: int) {}
}

function parse(s: string): int | Error {
  if (s.length === 0) return new ParseError("empty input", 0)
  ...
}

const r = parse(input)
if (r instanceof Error) return r
// r: int here
if (r instanceof ParseError) console.log(r.position)
```

`process.panic(message)` aborts the program with a stack trace. It is reserved for
bugs and unrecoverable states. `throw`, `try`, `catch`, `finally` are
rejected.

Scope-exit cleanup uses `using` declarations (`Symbol.dispose`), the Ore
equivalent of Go's `defer`.

## 5. Concurrency

Ore uses green threads ("tasks") without function coloring, like Go:

```ts
const results = new Chan<string>()
task.spawn(() => results.send(work()))
console.log(results.receive())
```

- `task.spawn(fn)` starts a task. Tasks run in parallel on several OS
  threads, one per CPU by default (set with the `ORE_THREADS` environment
  variable). A thread switches tasks when one waits on a channel, sleeps
  (`task.sleep(ms)`) or calls `task.yield()`; there is no preemption, so a
  task computing without waiting keeps its thread. The program ends when
  the entry file's top-level code ends, as when `main` returns in Go. When every task waits, the program panics with a
  deadlock.
- Tasks share memory. As in Go, unsynchronized access to the same variable
  from several tasks, with at least one write, is a data race and its result
  is undefined; communicate through channels or use `ore:sync`.
- `Chan<T>` is a channel: `new Chan<T>()` hands values over directly (send
  waits for a receiver), `new Chan<T>(n)` buffers `n` values. `send(v)`
  waits for room and panics on a closed channel; `receive()` waits for a
  value and returns `null` once the channel is closed and empty; `close()`
  wakes all waiting tasks. `for (const v of ch)` receives until the channel
  is closed.
- `task.select(cases, otherwise?)` runs the handler of one case that can
  proceed, choosing at random among several, or else waits for the first
  one. Cases are `ch.onReceive((v) => ...)` (`v` is `null` once closed),
  `ch.onSend(value, () => ...)` and `task.after(ms, () => ...)`. With
  `otherwise`, it runs instead of waiting when no case is ready.
- Each task has a fixed stack (256 KiB; 8 MiB for the top-level code) with a guard page:
  overflowing it crashes the program.
- A file operation blocks only its OS thread: the scheduler starts another
  thread for the other tasks meanwhile. `async`, `await` and `Promise` are
  rejected.

The standard module `ore:sync` provides `Mutex` (`lock`, `unlock`, and
`acquire()` for `using guard = mutex.acquire()`) and `WaitGroup` (`add`,
`done`, `wait`), both built on channels.

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
| missing value | `undefined` | `null` |
| `map.get(missing)` | `undefined` | `null` |
| `map.keys()` | iterator | array |
| `[10, 9, 1].sort()` | `[1, 10, 9]` (as strings) | `[1, 9, 10]` |
| generic bodies | checked once | checked per instance |

## 8. Modules and packages

- Each `.ore` file is a module. `export` marks declarations visible to other
  modules; everything else is private to its module. `export { a, b as c }`
  exports declared or imported names, also from another module
  (`export { x } from "./m"`). Default exports and `export *` are rejected.
- `import { a, b as c } from "./m"` imports names; `import * as m from "./m"`
  imports a module, used as `m.f()`, `m.value`, `m.Type` and `new m.Class()`.
  Modules may import each other in cycles; top-level constants are evaluated
  with imported modules first.
- Specifiers resolve like Node: `./x` and `../x` to `x.ore` or
  `x/index.ore`; a package name to `node_modules/<name>` in the directory of
  the importing file or above, using its package.json `main` (or
  `index.ore`); `name/sub/path` to a file of the package. `ore:` names
  standard modules embedded in the compiler.
- A project is an npm package: package.json `main` is the entry module, and
  dependencies are installed by npm and locked in `package-lock.json`.

## 9. Tests

A test file `*.test.ore` imports from `"ore:test"`:

```ts
import { test, expect, fail } from "ore:test"

test("adds", () => {
  expect(add(1, 2)).toBe(3)
})
```

A test file is a program like any other: its top-level `test(...)` calls run
the tests in order. A test fails when it panics, for example in a failed expectation
(`toBe`, `notToBe`, `fail`); the other tests still run. `ore test` runs every
test file below the given paths, skipping `node_modules`, and exits with
status 1 if any test fails.
