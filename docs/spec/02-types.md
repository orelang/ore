# Types and values

## Primitive types

| Type | Meaning |
|---|---|
| `i8` `i16` `i32` `i64` | signed integers, two's complement |
| `u8` `u16` `u32` `u64` | unsigned integers |
| `f32` `f64` | IEEE 754 floating point |
| `bool` | `true` / `false` |
| `string` | immutable UTF-8 byte sequence |
| `bigint` | integer of any size, immutable (see [BigInt](#bigint)) |
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

## Numeric literal types

A numeric literal type such as `0`, `-1` or `0.5` has one number as its
value; a union of them, such as `type Angle = 0 | 90 | 180 | 270`, has
those numbers. They are subtypes of `number`:

- Representation: a value of a numeric literal type, or of a union of only
  numeric literal types, is an `f64`, as numbers are in JavaScript, also
  when the numbers are integers. In a union with other types (`"auto" | 0`,
  `Angle | null`), each literal is a member of the tagged union.
- An untyped constant fits a numeric literal type when it equals one of its
  numbers: `const a: Angle = 90`; `const b: Angle = 45` is an error.
- A value of such a type widens to `number` (`f64`), not to the other
  numeric types: `const i: int = a` needs `int(a)`. `number` absorbs
  numeric literal types in a union.
- Arithmetic, unary operators and comparisons see numbers: `a + 90` and
  `-a` are `f64`, and assigning `a + 90` back to `a` is an error.
- `a === 90` and `switch (a)` with numeric cases narrow `a` as they narrow
  unions of string literals, and a `switch` with a case for each number is
  exhaustive.

## Conversions

There are no implicit conversions between distinct numeric types. Conversions
are explicit calls of the type name, or of an alias of it (`int(x)` is
`i64(x)`, `uint(x)` is `u64(x)`, `byte(x)` is `u8(x)`):

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
- `x as T` is rejected; `x satisfies T` checks that `x` fits `T`, with `T`
  as the context of `x`, and leaves `x` its own type.

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
- `a ** b` is a power: `pow` on floats; on integers it wraps like `*`, and a
  negative exponent panics. Of untyped constants it is exact, and a negative
  exponent gives a float (`2 ** -1` is `0.5`). `**=` assigns it.
- Comparison uses `===` / `!==`. `==` and `!=` are rejected.

## BigInt

`bigint` is JavaScript's: an integer of any size.

```ts
let factorial = 1n
for (let i = 1n; i <= 25n; i++) factorial *= i
console.log(factorial, `${factorial % 1000n}`, factorial.toString(16))   // 15511210043330985984000000n 0 cd4a0619fb0907bc00000
```

- Literals end in `n`: `123n`, `0x1fn`, `0o17n`, `0b101n`, `1_000n`.
- `+ - * / % **`, unary `-`, `& | ^ ~ << >>`, the comparisons and the
  compound assignments, `++` and `--` work on two bigints. `/` truncates
  toward zero and `%` has the sign of the dividend; dividing by `0n` panics
  (`Division by zero`), and so does a negative exponent. The bitwise
  operators work on two's complement with infinitely many sign bits, as in
  JavaScript: `-12n & 10n` is `0n`, `~5n` is `-6n`. `>>` rounds toward
  negative infinity, the count of a shift is a bigint, and a negative count
  shifts the other way. `>>>` and unary `+` are rejected.
- A bigint and a number never mix, as in JavaScript (where `1n + 1` throws a
  `TypeError`): `big + 1` is a compile error that asks for `1n`, and an
  operation or comparison of a `bigint` with an `int` asks for an explicit
  conversion. An integer constant is not a bigint: `let b: bigint = 5` is an
  error.
- Values have at most 2^30 bits, as in V8; a larger result panics
  (`Maximum BigInt size exceeded`).
- `===` compares values, as do the keys of a `Map` and the elements of a
  `Set`. `typeof b` is `"bigint"`, which narrows unions. A `switch` can test
  bigints. `sort()` without a comparator orders an array of bigints by value
  (JavaScript compares their text).
- The zero value is `0n`.

Conversions:

- `BigInt(x)` of an integer type is its value. Of `f32` or `f64` it is the
  value of an integral float, and a float with a fraction, NaN or an
  infinity panics, as JavaScript's `RangeError`: `The number 1.5 cannot be
  converted to a BigInt because it is not an integer`. Of an untyped
  constant it is a constant, exact: `BigInt(2 ** 70)`, `BigInt(1e3)`
  (JavaScript rounds `9007199254740993` to a double first); `BigInt(1.5)`
  is a compile error.
- `BigInt(s)` of a string reads it as JavaScript does: white space around,
  then digits with a `0x`, `0o` or `0b` prefix, or decimal digits after a
  sign; only white space is `0n`. Other text panics, as JavaScript's
  `SyntaxError`: `Cannot convert 12x to a BigInt`. `BigInt.parse(s)` reads
  the same and returns `null` instead; `BigInt.parse(s, radix)` reads a sign
  and digits in a radix from 2 to 36.
- `i64(b)`, `u8(b)` and the other integer conversions keep the low bits of
  the value in two's complement, as `BigInt.asIntN` and `BigInt.asUintN`
  do: `u8(300n)` is `44`, `u64(-1n)` is `18446744073709551615`. `f64(b)` and
  `f32(b)` are the nearest float, ties to even, and an infinity beyond the
  range.
- `BigInt.asIntN(bits, b)` and `BigInt.asUintN(bits, b)` are `b` modulo
  2^bits, from -2^(bits-1) or from 0.
- `b.toString(radix = 10)` and template literals write the digits:
  `` `${-5n}` `` is `-5`. `console.log` writes the suffix too, as Node does:
  `console.log(5n)` prints `5n`. A radix outside 2 to 36 panics.
- JSON has no bigints: `JSON.stringify` of a type with a `bigint` is a
  compile error (JavaScript throws a `TypeError`).

A bigint is a reference to an immutable value of the runtime
(`runtime/core/bigint.ore`): the number of 32-bit limbs and its sign, then
the limbs. `0n` is the null reference, so zeroed memory holds `0n`; a
`bigint | null` is a tagged union. Constants are in the program's read-only
data. Division is Knuth's algorithm D, multiplication schoolbook.

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
  `...rest` is a copy of the remaining elements, or elements of
  [tuples](#tuples), where `...rest` is a tuple of the elements left. An
  array literal destructured by an array pattern without a rest element is
  a tuple: `const [n, s] = [1, "one"]`. `...rest` in an object pattern is a
  new object of the other public fields. A default value (`{ size = 1 }`,
  `[x = 0]`) replaces null, and an element past the end of an array; it is
  computed only then, and can use the names bound before it. A nested
  pattern can have one too: `const { inner: { c = 2 } = { c: 5 } } = o`.
  A rest element comes last, has no default value, and in an object
  pattern is a name rather than a pattern.

## Built-in namespaces

Built-in functions live in namespaces, as in TypeScript and Node:

| Function | Meaning |
|---|---|
| `console.log(...values)`, `console.info`, `console.debug` | any values separated by spaces and a newline, to stdout, as Node prints them; a first string is a format (below) |
| `console.error(...values)`, `console.warn` | the same, to stderr |
| `console.write(...values)` | values separated by spaces, to stdout, without a newline |
| `console.trace(...values)` | `Trace: ` and the values to stderr, then the stack of debug frames (`    at f (file:line)`) |
| `console.assert(condition, ...values)` | unless `condition` (a `bool`) holds, `Assertion failed` to stderr, with `: ` before a first string and the values |
| `console.dir(value)` | a value as `util.inspect` formats it, strings quoted |
| `console.table(data, properties?)` | an array, a map, a set or an object as Node's box-drawn table, with an index column; only the `properties` columns when given; other values as `log` prints them |
| `console.group(...label)`, `console.groupCollapsed`, `console.groupEnd()` | the label, as `log` prints it, then every line printed is indented by two more spaces, until `groupEnd` |
| `console.count(label?)`, `console.countReset(label?)` | `label: 3`, the times `count` was called with the label (default `"default"`) |
| `console.time(label?)`, `console.timeLog(label?, ...values)`, `console.timeEnd(label?)` | the time since `time`, as Node writes it: `label: 1.234ms`, `1.234s`, `1:02.345 (m:ss.mmm)`; `timeEnd` stops the timer |
| `process.panic(message)` | aborts with the message and a stack trace (status 2) |
| `process.exit(code)` | exits with a status code |
| `process.args` | the command-line arguments after the program name |
| `process.getenv(name)` | an environment variable, or `null` |
| `process.cwd()` | the working directory, as an absolute path |
| `process.env()` | the environment variables, as a `Map<string, string>` |
| `process.cpus()` | the number of CPUs online |
| `process.isatty(fd)` | whether a file descriptor (1 stdout, 2 stderr) is a terminal |
| `process.run(program, args?)`, `process.output(program, args?)`, `process.spawn(program, args?)` | other programs (below); `spawn` starts one without waiting: a `process.Child` |
| `process.command.run(program, args?, options?)`, `process.command.output(...)`, `process.command.spawn(...)` | the same with a `process.CommandOptions`: `cwd`, `env`, `clearEnv`, `stdin` |
| `Math.E`, `Math.LN10`, `Math.LN2`, `Math.LOG10E`, `Math.LOG2E`, `Math.PI`, `Math.SQRT1_2`, `Math.SQRT2` | `f64` constants, as in JavaScript |
| `Math.sqrt`, `cbrt`, `pow`, `exp`, `expm1`, `log`, `log1p`, `log2`, `log10`, `sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2`, `sinh`, `cosh`, `tanh`, `asinh`, `acosh`, `atanh`, `floor`, `ceil`, `round`, `trunc`, `sign`, `fround`, `f16round` | as in JavaScript, on `f64`: `round` rounds halves up and gives -0 from -0.5 to -0; `pow` (and `**`) gives NaN for a NaN exponent and for ±1 to an infinity; `fround` and `f16round` round to the nearest `f32` and 16-bit float. The transcendental functions come from the C library and may differ from V8's in the last bit |
| `Math.hypot(...values)`, `Math.clz32(x)`, `Math.imul(a, b)` | the length of a vector of any number of values (as V8 computes it); the leading zero bits and the wrapping product of 32-bit integers (each value modulo 2^32), on `f64` as in JavaScript |
| `Math.abs(x)`, `Math.min(...values)`, `Math.max(...values)` | for any numeric type, keeping it; `min` and `max` take any number of values, arrays and tuples spread in, and with none (no arguments or only empty arrays) give an infinity, or the extreme of the integer type expected (`const n: i32 = Math.max()`); -0 is below 0 |
| `Math.random()` | a pseudo-random `f64` in [0, 1) |
| `Number.parseInt(s, radix?)`, `Number.parseFloat(s)` | like JavaScript, but `null` instead of `NaN`; `parseInt` gives an `int`, and `null` for a number beyond its range |
| `Number.NaN`, `Number.POSITIVE_INFINITY`, `Number.NEGATIVE_INFINITY`, `Number.MAX_VALUE`, `Number.MIN_VALUE`, `Number.EPSILON`, `Number.MAX_SAFE_INTEGER`, `Number.MIN_SAFE_INTEGER` | `f64` constants, as in JavaScript (no global `NaN` and `Infinity`) |
| `Number.isNaN(x)`, `Number.isFinite(x)`, `Number.isInteger(x)`, `Number.isSafeInteger(x)` | predicates on an `f64`, as in JavaScript |
| `BigInt(x)`, `BigInt.parse(s, radix?)`, `BigInt.asIntN(bits, b)`, `BigInt.asUintN(bits, b)` | bigints from numbers and text, and modulo a power of two (see [BigInt](#bigint)) |
| `String.fromCharCode(...codes)`, `String.fromCodePoint(...points)` | a string of UTF-16 code units or code points (see [strings](#strings)) |
| `Array.from(items, mapFn?)`, `Array.of(...items)`, `Array.isArray(x)` | arrays from other collections and from values (see [array methods](04-functions.md#array-methods)) |
| `Map.groupBy(items, keyFn)` | the elements of an array grouped by a key (see [maps](03-objects.md#maps)) |
| `fs.readFile(path)` | the file as a `string`, or an `Error` |
| `fs.writeFile(path, data)` | `null`, or an `Error` |
| `fs.exists(path)` | whether a file exists |
| `fs.read(fd, max)` | up to `max` bytes from a file descriptor (0 is stdin), waiting for some; `""` at the end; or an `Error` |
| `fs.write(fd, data)` | writes all of `data` to a file descriptor, unbuffered; `null`, or an `Error` |
| `fs.readDir(path)` | the names in a directory, sorted, or an `Error` |
| `fs.mkdir(path, recursive?)`, `fs.remove(path, recursive?)`, `fs.rename(from, to)` | `null`, or an `Error` |
| `fs.stat(path)`, `fs.lstat(path)` | an `fs.FileInfo`, or an `Error` |
| `fs.isFile(path)`, `fs.isDir(path)` | whether `path` is a file, a directory |
| `fs.realpath(path)` | the absolute path without links, `.` and `..`, or an `Error` |
| `fs.tempDir()`, `fs.mkdtemp(prefix?, dir?)` | `$TMPDIR` or `/tmp`; a new uniquely named directory in it |
| `Date.now()` | milliseconds since the Unix epoch, an `int`: a static of the class `Date` (see [dates](#dates)) |
| `time.now()`, `time.unixNanos()` | nanoseconds on a monotonic clock (for durations); since the Unix epoch on the wall clock |
| `time.nanosecond`, `time.microsecond`, `time.millisecond`, `time.second`, `time.minute`, `time.hour`, `time.day` | durations in nanoseconds, `int` |
| `time.parse(text)`, `time.format(ns, options?)` | a duration as text and back, after the npm package `ms`, in nanoseconds (see [time](#time)) |
| `JSON.stringify(value, null?, space?)` | the JSON text of a value, indented by `space` spaces per level; the replacer must be null |
| `JSON.parse<T>(text)` | a `T` read from JSON text, or an `Error` |

Numbers of every numeric type have the methods of JavaScript's
`Number.prototype`: `toString(radix?)` (2 to 36, fractions of floats as
V8 writes them), `toFixed(digits?)`, `toPrecision(precision?)`,
`toExponential(digits?)`, `toLocaleString()` (en-US: digits grouped by
commas, at most three decimals; no locale or options yet) and `valueOf()`.
Integers keep all their digits in `toString` and `toLocaleString`; the
others convert them to `f64`. An argument out of range panics with
JavaScript's `RangeError` message. A method of an integer literal needs
parentheses or a second dot, as in JavaScript: `(255).toString(16)`,
`255..toString(16)`. `bool` has `toString()`.

Modules that a program imports by name, such as `ore:path` and
`ore:crypto`, are in [standard modules](11-standard-modules.md).

`String`, `fs`, `process`, `Number`, `Math`, `BigInt`, `Map` and `console`
are partly written in Ore, and `time` and `task` partly or wholly
(`runtime/core/string.ore`, `runtime/core/fs.ore`, `runtime/core/process.ore`,
`runtime/core/number.ore`, `runtime/core/math.ore`, `runtime/core/bigint.ore`,
`runtime/core/collections.ore`, `runtime/core/console.ore`,
`runtime/core/time.ore` and `runtime/core/tasks.ore`): the exports of these modules are members of
the namespaces, classes and types included, so `fs.FileInfo`,
`process.Child` and `process.CommandOptions` are types.

A namespace can be nested in another: `process.command` is a member of
`process`, used only through its path (`process.command.run(...)`; it is
no value). A nested namespace written in Ore has a module of its own,
whose exports are its members: `runtime/core/process-command.ore` for
`process.command`.

In the names of the standard library, only a class or a type is
capitalized, and at most one part of a path: `process.Child`,
`process.CommandOptions`; namespaces, functions, methods and fields are
lowercase. Programs are started by functions, not by creating objects.

### Files and directories

Errors are values whose message names the operation, the path and the
system's reason: `cannot remove out/a: Directory not empty`. A file system
call blocks only its OS thread; the scheduler runs the other tasks on
another one.

- `fs.mkdir(path, true)` creates the missing parents too, and a directory
  that exists already is no error; without it, an existing path is an error.
- `fs.remove(path)` removes a file, a symbolic link or an empty directory;
  `fs.remove(path, true)` removes a directory with everything in it, without
  following links. A missing path is an error in both cases.
- `fs.stat` follows symbolic links, `fs.lstat` does not. An `fs.FileInfo`
  has `isFile`, `isDir`, `isSymlink`, `size` (bytes), `mtime` (milliseconds
  since the Unix epoch) and `mode` (the permission bits).
- `fs.mkdtemp(prefix = "ore-", dir = fs.tempDir())` creates a directory
  named `prefix` and six random characters, and returns its path.

### Time

Every time and duration of `time` is an `int` of nanoseconds, as in Go:
`time.now()` reads a monotonic clock, whose zero is arbitrary, so the
difference of two readings is a duration; `time.unixNanos()` reads the
wall clock, which may jump. The constants make durations readable:
`5 * time.second`, `elapsed / time.millisecond`.

`time.parse` and `time.format` port the npm package `ms` (2.1), with
nanoseconds where `ms` has milliseconds:

```ts
time.parse("2 days")        // 172_800_000_000_000
time.parse("2.5 hrs")       // 9_000_000_000_000
time.parse("-3 days")       // -259_200_000_000_000
time.parse("100")           // 100_000_000: no unit is milliseconds, as in ms
time.parse("250us")         // 250_000, a unit beyond ms
time.parse("soon")          // null
time.format(60 * time.second)                                // "1m"
time.format(2 * time.minute, { long: true })                 // "2 minutes"
time.format(1_500_000)                                       // "1.5ms"
time.format(250 * time.microsecond)                          // "250µs"
```

- `parse` reads what `ms` reads: an optional `-`, a decimal number (`.5`
  but not `1.`), optional spaces, then an optional unit, case-insensitive:
  years (`y`, `yr`, `yrs`, `year`, `years`: 365.25 days), weeks (`w`,
  `week`, `weeks`), days (`d`, `day`, `days`), hours (`h`, `hr`, `hrs`,
  `hour`, `hours`), minutes (`m`, `min`, `mins`, `minute`, `minutes`),
  seconds (`s`, `sec`, `secs`, `second`, `seconds`) and milliseconds (`ms`,
  `msec`, `msecs`, `millisecond`, `milliseconds`); beyond `ms`, also
  microseconds (`us`, `µs`, `usec`, `usecs`, `microsecond`, `microseconds`)
  and nanoseconds (`ns`, `nsec`, `nsecs`, `nanosecond`, `nanoseconds`). A
  number without a unit is milliseconds. A whole number is exact; a
  fraction is rounded to the nearest nanosecond. Where `ms` returns
  `undefined` or throws (other text, an empty one, one longer than 100
  characters), `parse` returns `null`, and also for a duration beyond `int`
  (about 292 years).
- `format` rounds to the largest unit reached, days at most (`"3d"`,
  `"10h"`, `"1m"`, `"5s"`), half up as `Math.round`; with `{ long: true }`
  whole words, plural from 1.5 units on (`"1 second"` for 1.2 s, `"2
  seconds"` for 1.5 s, `"-1 seconds"` for -1.5 s, as `ms` does). Under a
  second it writes exact milliseconds as `ms` does (`"500ms"`, `"1.5ms"`,
  long `"500 ms"`); beyond `ms`, under a millisecond microseconds
  (`"250µs"`) and under a microsecond nanoseconds (`"80ns"`).

### Running programs

```ts
const out = process.output("git", ["status", "--short"])
if (out instanceof Error) process.panic(out.message)   // it could not start
if (!out.ok) console.error(out.stderr)
console.log(out.stdout)

// with this program's stdin, stdout and stderr
const code = process.command.run("cc", ["-c", "main.c"], { cwd: "build", env: new Map([["LANG", "C"]]) })
```

- The program is found in `PATH` unless its name has a slash. Arguments are
  passed as they are, without a shell.
- `process.run`, `process.output` and `process.spawn` take the program and
  its arguments; `process.command.run`, `output` and `spawn` take a
  `process.CommandOptions` after them, an object type whose properties may
  all be left out.
- `output()` collects standard output and error into an `process.Output`
  with `stdout`, `stderr`, `code` and `ok`; its standard input is empty.
  `run()` gives the child this program's standard input, output and error
  (what this program printed before is written out first) and returns the
  exit status. A status other than 0 is no `Error`: an `Error` means the
  program could not be started (`cannot run cc: not found in PATH`) or
  waited for. A child killed by a signal has the status 128 plus the
  signal's number, as in shells, and `Output.signal` names it.
- `spawn()` starts the program as `run()` does and returns at once a
  `process.Child`, which runs alongside this program: `pid`, `wait()` (the
  exit status, as `run()` returns it; the same again when called again) and
  `kill(signal = 15)` (SIGTERM; 9 is SIGKILL and 2 SIGINT on macOS and Linux
  alike), which sends nothing once `wait()` has collected the child. To wait
  with a timeout, wait in another task and `task.select` on its result and
  `task.after`:

  ```ts
  const server = process.spawn("./server")
  if (server instanceof Error) process.panic(server.message)
  server.kill()
  const exited = new Chan<int | Error>(1)
  task.spawn(() => exited.send(server.wait()))
  task.select([exited.onReceive((status) => {}), task.after(1000, () => server.kill(9))])
  ```
- A `process.CommandOptions` has `cwd` (this program's directory when left
  out or `""`), `env` (a `Map` of variables set over the inherited
  environment), `clearEnv` (start from an empty environment, with only
  `env`) and `stdin` (text written to the child's standard input, which is
  then closed; without it, `output()` gives the child an empty input and
  `run()` and `spawn()` this program's). The same options can be passed to
  several calls.
- Waiting for a child occupies no OS thread: the pipes are non-blocking, and
  a task waiting for output or for the child's exit parks until the
  runtime's poller sees it (kqueue, or epoll with a pidfd on Linux), as for
  sockets. Standard output and error are read at once, so a child that
  fills one while this program reads the other cannot deadlock. Many tasks
  can run programs at the same time.

`console.log` prints any value as Node's `util.inspect` does; the code that
formats a type is generated for it. Strings among the arguments are printed
as they are, and the arguments are separated by spaces. Floats are printed
in the shortest form that round-trips, like JavaScript: `0.1`, `1`, `1e+21`,
`1e-7`, `NaN`, `Infinity`, `-0`. Inside other values strings are quoted
(`'a'`, or `"it's"`, with escapes such as `\n`), and:

| Value | Printed |
|---|---|
| `null` | `null` |
| bigint | `10n` |
| array, tuple | `[ 1, 2, 3 ]`, `[]` |
| object type | `{ x: 1, y: 'a' }`, `{}`; a property that is not an identifier quoted, `{ 'a-b': 1 }` |
| class instance | `Point { x: 1, y: 2 }`, by the class of the instance (a subclass, or the class behind an interface) |
| `Map`, `Set` | `Map(2) { 'a' => 1, 'b' => 2 }`, `Set(1) { 1 }` |
| function | `[Function: name]`, `[Function (anonymous)]` for an arrow function |
| `Error` | `Error: message`, the first line of what Node prints |
| string literal union | its value, `'circle'` |

As in Node, objects nested more than two levels deep print as `[Object]`
(`[Array]`, `[Point]`, `[Map]`), at most 100 entries of an array, a map or
a set are printed and then `... 20 more items`, and an object inside
itself is `[Circular *1]`, the outer one marked `<ref *1>`. A value wider
than 80 columns, counting its indentation, or with more than three levels
nested in it, is broken into lines indented by 2 spaces, an entry per line;
arrays of more than 6 short entries are grouped in aligned columns. Two
things differ from Node: the properties of object types are printed in
alphabetical order (the order of their fields), and optional properties that
are `null` are left out, as JavaScript leaves out those not set. Channels
and C pointers cannot be printed.

A first string followed by more values is a format, as Node's
`util.format` reads it: `%s` takes the next value as a string (a string as
it is, a number or a bigint as printed, an object one level deep), `%d` as
a number (a string converted as `Number(s)` does, `true` as 1, other
objects as `NaN`), `%i` as `parseInt` and `%f` as `parseFloat` give it,
`%j` as JSON (an error when the type cannot be JSON), `%O` as `util.inspect`
formats it, `%o` four levels deep, `%c` takes a CSS style and prints
nothing, and `%%` is `%`; any other `%` stays. Values that the format does
not take follow it, separated by spaces, as without a format. The warnings
of `count`, `time` and the others (`Warning: No such label 'x' for
console.timeEnd()`) go to stderr. `console.table` formats each cell as
Node does: an object with more than two properties as `[Object]`, three
entries of an array, on one line.

An object literal's accessors print as Node prints accessor properties,
`{ a: 1, b: [Getter], c: [Getter/Setter] }`, and a `RegExpMatch` as Node
prints a match array: `[ '12', '1', index: 3, input: 'a 12', groups:
undefined ]`, with `undefined` for a group that took no part.

When the output shows colors, values are colored as Node colors them, with
the same codes: numbers, bigints and booleans yellow, strings inside values
(and quoted property names) green, `null` bold, functions, `[Object]`,
`[Circular *1]` and `<ref *1>` cyan; strings among the arguments stay as
they are. Lines are broken by the width without the colors. As in Node,
`FORCE_COLOR` turns colors on when it is empty, `1`, `2`, `3` or `true`
(off for other values) even when the output is not a terminal; otherwise
`NO_COLOR` or `NODE_DISABLE_COLORS` set, or `TERM=dumb`, turns them off,
and they are on when the stream is a terminal (standard output for
`console.log`, standard error for `console.error`) that Node gives
colors: by `TERM` (`xterm*`, `screen*`, `*color*`, `linux`, ...),
`COLORTERM`, `TERM_PROGRAM`, tmux or a known CI service. No `TERM`, or
an unknown one, has no colors; nor has piped output.

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

Strings and bytes convert as with the globals of JavaScript's hosts, which
are global names in Ore too, with `u8[]` where JavaScript has a
`Uint8Array`. `new TextEncoder().encode(s)` is the UTF-8 bytes of `s`
(a byte that is not valid UTF-8 as U+FFFD), and `encodeInto(s, bytes)`
writes the whole characters that fit into `bytes` and returns
`{ read, written }`, both in bytes. `new TextDecoder(label?, { fatal,
ignoreBOM }?)` takes only UTF-8 (`"utf-8"`, `"utf8"`,
`"unicode-1-1-utf-8"`; another label panics with `RangeError: The "x"
encoding is not supported`), and `decode(bytes?)` reads them as the
Encoding Standard does: the longest prefix of a character that is invalid
is one U+FFFD (a panic with `fatal`) and a leading byte order mark is
dropped unless `ignoreBOM`. `btoa(s)` is the base64 of a binary string,
whose characters are U+0000 to U+00FF (another panics with
`InvalidCharacterError: Invalid character`), and `atob(s)` the binary
string of base64 text, skipping ASCII whitespace, with the padding
optional.

Numeric conversions (`i32(x)`, `f64(x)`) are type names, not namespaced
functions.

## Strings

- A `string` is an immutable sequence of UTF-8 bytes.
- `a + b` and `+=` concatenate two strings. A string and a non-string cannot
  be added: use a template literal, `` `${a}${b}` ``, which formats numbers
  and `bool` as `console.log` prints them.
- `s.length` is the length in bytes. `s[i]` is the byte at `i` as `u8`;
  an index out of range panics.
- `s.slice(start?, end?)` takes byte offsets with JavaScript rules: negative
  offsets count from the end, out-of-range offsets are clamped.
- `<`, `<=`, `>`, `>=` compare strings byte-wise; `===` compares contents.
- `for (const r of s)` iterates runes as `i32`. Invalid UTF-8 yields
  U+FFFD (65533) for each invalid byte.
- The methods of `String.prototype` are JavaScript's, with byte offsets for
  positions and lengths (JavaScript counts UTF-16 code units):
  `at(i?)`, `charAt(i?)`, `charCodeAt(i?)`, `codePointAt(i?)`,
  `concat(...strings)`, `endsWith(s, end?)`, `includes(s, from?)`,
  `indexOf(s, from?)`, `lastIndexOf(s, from?)`, `isWellFormed()`,
  `localeCompare(s)`, `match`, `matchAll`, `normalize(form?)`,
  `padEnd(n, pad?)`, `padStart(n, pad?)`, `repeat(n)`, `replace`,
  `replaceAll`, `search`, `slice(start?, end?)`, `split(sep, limit?)`,
  `startsWith(s, from?)`, `substring(start, end?)`, `substr(start, length?)`,
  `toLowerCase()`, `toUpperCase()`, `toLocaleLowerCase()`,
  `toLocaleUpperCase()`, `toString()`, `toWellFormed()`, `trim()`,
  `trimStart()`, `trimEnd()`, `trimLeft()`, `trimRight()`, `valueOf()`.
  Positions are clamped and default as in JavaScript (`"abc".indexOf("", 9)`
  is 3, `"abc".lastIndexOf("c", -5)` is -1), and `split`'s limit is taken
  modulo 2^32, so -1 is no limit.
- A position names the character that starts at that byte: `"aé😀".at(-4)`
  and `charAt(3)` are `"😀"`, `codePointAt(3)` is 128512. Where no valid
  character starts (inside one), `at` and `charAt` give that one byte and
  `codePointAt` U+FFFD. `at` out of range is `null` (JavaScript's
  `undefined`). `charCodeAt(i)` is the byte at `i` — UTF-8's code unit, as
  JavaScript's is UTF-16's — or `null` out of range (JavaScript's `NaN`).
- An empty separator splits into characters, and an empty pattern of
  `replaceAll` is at the start and after each character.
- `replace` and `replaceAll` with a string pattern read `$$`, `$&`,
  `` $` `` and `$'` in the replacement (`"aXbX".replace("X", "$&$&")` is
  `"aXXbX"`); a function `(matched: string, offset: int, input: string) =>
  string` computes each replacement, as in JavaScript.
- `padStart` and `padEnd` cut the last repetition of the padding where a
  character starts, so the result may be up to 3 bytes shorter than asked
  rather than invalid UTF-8 (`"x".padStart(4, "é")` is `"éx"`).
- `trim` removes JavaScript's white space and line terminators (`\u00a0`,
  `\u2028`, `\ufeff` and the others), not only ASCII's.
- `toUpperCase` and `toLowerCase` use Unicode's full case mappings without
  a locale, as JavaScript does: `"é ß".toUpperCase()` is `"É SS"`, `"İ"`
  lowers to `"i̇"`, and a capital sigma at the end of a word lowers to
  `ς`. The `toLocale` forms take no locale and do the same.
  `normalize(form = "NFC")` gives the forms NFC, NFD, NFKC and NFKD; another
  form panics (JavaScript's `RangeError`). The data is Unicode 17.0's, as in
  node 24 (`runtime/core/unicode-tables.ore`).
- `localeCompare` compares by code point (byte-wise, like `<`): `-1`, `0`
  or `1`, where JavaScript compares by the locale's collation (`"a"` before
  `"B"`).
- `isWellFormed()` is whether the bytes are valid UTF-8, and
  `toWellFormed()` replaces each byte that is not part of a valid character
  by U+FFFD; the other methods keep such bytes as they are. `repeat` with a
  negative count panics (JavaScript's `RangeError`).
- `String.raw` is the raw text of a template; see
  [Tagged templates](04-functions.md#tagged-templates).
- `String.fromCharCode(...codes)` makes a string of UTF-16 code units, each
  taken modulo 2^16, and `String.fromCodePoint(...points)` of code points, as
  in JavaScript: a high surrogate followed by a low surrogate is one
  character (`String.fromCharCode(0xd83d, 0xde00)` is `"😀"`, 4 bytes). A lone
  surrogate, which JavaScript keeps but UTF-8 cannot encode, becomes U+FFFD.
  A code point past U+10FFFF or negative panics (JavaScript throws a
  `RangeError`). Both take `int`s: convert a rune with `i64(r)`.

## Regular expressions

```ts
const date = /(?<year>\d{4})-(?<month>\d\d)/
const m = date.exec("due 2024-05-17")
if (m !== null) console.log(m.at(0)!, m.index, m.groups.get("year")!)   // 2024-05 4 2024
console.log("a1b22".replace(/\d+/g, "[$&]"), "a, b,c".split(/\s*,\s*/).length)
```

- A regular expression literal `/pattern/flags` is read where an expression
  can start: after an operand (a name, a literal, `)`, `]`, `}`) a `/` is a
  division. It is `new RegExp("pattern", "flags")`, a new object at each
  evaluation, and its errors (`Invalid regular expression: Unterminated
  group.`) are compile-time errors. `new RegExp(pattern, flags = "")`
  compiles a pattern at run time and panics on an invalid one.
- The syntax and the matching are JavaScript's (ECMAScript with its Annex B
  without the `u` and `v` flags): characters and escapes (`\n`, `\x41`,
  `\u0041`, `\cJ`, `\0`, octal), `.`, classes `[a-z]`, `[^...]`,
  `\d \w \s \D \W \S`, anchors `^ $`, `\b \B`, groups `( )`, `(?: )`,
  named groups `(?<name> )`, alternation, quantifiers `* + ? {n} {n,} {n,m}`
  and their lazy forms, backreferences `\1` and `\k<name>`, lookahead
  `(?= )` and `(?! )`, lookbehind `(?<= )` and `(?<! )`. A lookbehind
  matches backwards from the position, as in JavaScript: its groups are
  set (`/(?<=(\d+)(\d+))$/` on `"1053"` captures `"1"` and `"053"`), and
  neither it nor, with `u`, a lookahead takes a quantifier.
- Flags: `d` (indices), `g` (global), `i` (ignore case), `m` (`^` and `$`
  at line breaks), `s` (`.` matches line breaks too), `u` (Unicode), `v`
  (Unicode sets), `y` (sticky: a match only at `lastIndex`). `re.flags`
  lists them in the order `dgimsuvy`; `re.hasIndices`, `global`,
  `ignoreCase`, `multiline`, `dotAll`, `unicode`, `unicodeSets` and
  `sticky` tell each, `re.source` is the pattern (with `/` escaped) and
  `re.toString()` is `/source/flags`.
- `u` has the syntax of JavaScript's `u` flag: `\u{1F600}`, `\p{...}` and
  `\P{...}` (not in the property), and the strict escapes and quantifier
  braces without Annex B (`/\a/u` is an error). Ignoring case compares
  simple case foldings: also `ſ` with `s`, the Kelvin sign with `k`, the Ohm
  sign with `Ω` and `ẞ` with `ß`; so `\w` and `\b` take `ſ` and the Kelvin
  sign as word characters, and `\W` takes neither. Matching is by code point
  with or without it. The properties of `\p{...}`, from Unicode 17.0: the
  General_Category values of letters and numbers (`L`, `LC`, `Lu`, `Ll`,
  `Lt`, `Lm`, `Lo`, `N`, `Nd`, `Nl`, `No`, by their short or long names,
  alone or as `gc=`/`General_Category=`), the scripts `Latin`, `Greek`,
  `Cyrillic` and `Han` (`sc=`/`Script=`, also `Latn`, `Grek`, `Cyrl`,
  `Hani`), `Any` and `ASCII`. Other properties JavaScript has (`Emoji`,
  `Script_Extensions`, other categories and scripts) are errors: `The
  property 'Emoji' is not supported`.
- `v` is `u` with JavaScript's classes of the `v` flag: nested classes
  (`[[a-z][0-9]]`), differences `[\p{L}--[a-z]]` and intersections
  `[\w&&\d]`, and the characters that must be escaped in them
  (`[(]` is an error). With `i`, each operand is closed under case before
  the operators. String disjunctions `\q{abc|d}` put strings in a class,
  which tries its longest strings first, then its characters, then the
  empty string; the operators take them too, and a negated class that may
  hold strings is an error.
- The matcher backtracks over the UTF-8 bytes a character (a code point) at
  a time: `.` and `[^a]` match a whole character, also one beyond U+FFFF
  (JavaScript matches half of its surrogate pair). Positions — `index`,
  `lastIndex`, `search` — are byte offsets, as for strings. Ignoring case
  compares the uppercase of ASCII, Latin-1, Greek and Cyrillic letters.
- `re.exec(s)` returns a `RegExpMatch` or `null`; with `g` or `y` it starts
  at `re.lastIndex` and sets it past the match, or to 0 when there is none.
  `re.test(s)` is whether `exec` finds a match.
- A `RegExpMatch` stands for JavaScript's match array: `m.at(0)` is the
  matched text and `m.at(i)` the text of group `i` (`null` when the group
  did not take part; negative `i` count from the end), `m.length` their
  number, `m.captures` the array of them, `m.index` and `m.input` as in
  JavaScript, and `m.groups` a `Map<string, string | null>` of the named
  groups (empty without names). As a match array, a match is indexed,
  `m[i]` (a `string | null`, read-only; an index out of range panics, as
  for arrays, where JavaScript gives `undefined`), destructured,
  `const [, key, value] = m`, and iterated with `for...of`, over its
  captures.
- With the `d` flag, `m.indices` is a `([int, int] | null)[]`: the start
  and end of the match and of each group (null for one that did not take
  part), byte offsets as `index`; `m.groupIndices` is a
  `Map<string, [int, int] | null>` of the named groups (JavaScript's
  `m.indices.groups`). Without the flag both are empty, where JavaScript has
  `undefined`.
- String methods that take a regular expression:
  - `s.match(re)` is `re.exec(s)`; with `g` it is a `RegExpMatch` of every
    matched text (`at(i)`, `length`; `index` is -1), or `null`.
  - `s.matchAll(re)` is an array of the matches from `re.lastIndex` on;
    `re` must have the `g` flag (a panic, as JavaScript's `TypeError`).
  - `s.replace(re, replacement)` replaces the first match, or every one
    with `g`; `s.replaceAll(re, replacement)` requires `g`. In the
    replacement, `$&` is the match, `$1`..`$99` and `$<name>` the groups,
    `` $` `` and `$'` the text before and after, `$$` a `$`. A function
    `(matched: string, match: RegExpMatch) => string` computes each
    replacement (JavaScript passes the groups, the index and the input
    instead of the match).
  - `s.split(re, limit?)` splits at the matches, with the text of the groups
    of each match between the parts (`""` for a group that did not take
    part, where JavaScript has `undefined`).
  - `s.search(re)` is the offset of the first match, or -1.
  - `match`, `matchAll` and `search` also take a pattern string, as
    `new RegExp(pattern)` (with `g` for `matchAll`).
- `RegExp` and `RegExpMatch` are classes of the runtime written in Ore
  (`runtime/core/regexp.ore`), global names as in JavaScript.

## Dates

```ts
const d = new Date(2024, 9, 15, 12, 5)            // local time
console.log(d.toISOString(), d.getDay())          // 2024-10-15T16:05:00.000Z 2 (in New York)
console.log(new Date("2024-10-15").getTime(), Date.UTC(2024, 9, 15))  // 1728950400000 1728950400000
console.log(d)                                    // 2024-10-15T16:05:00.000Z
```

`Date` is JavaScript's: a time value in milliseconds since the Unix epoch,
an `f64`, which is NaN for an invalid date, within 8.64e15 ms of the epoch,
on the proleptic Gregorian calendar with days of 86 400 000 ms.

- `new Date()` is now; `new Date(ms)` a time value (truncated, NaN past
  the limits); `new Date(string)` what `Date.parse` reads; `new Date(date)`
  a copy; `new Date(year, monthIndex, day?, hours?, minutes?, seconds?,
  ms?)` a local time: years 0 to 99 are 1900 to 1999, and fields out of
  range carry over (`new Date(2024, 13, 1)` is February 2025).
- Statics: `Date.now()` (an `int`), `Date.parse(s)`, and `Date.UTC(year,
  monthIndex?, day?, hours?, minutes?, seconds?, ms?)`, which gives the
  time value of a time in UTC.
- Getters, in local time and in UTC: `getFullYear`/`getUTCFullYear`,
  `getMonth` (from 0), `getDate`, `getDay` (0 is Sunday), `getHours`,
  `getMinutes`, `getSeconds`, `getMilliseconds`, and `getTime`,
  `valueOf`, `getTimezoneOffset` (the minutes UTC is ahead of local time),
  `getYear`. Each is an `f64`, NaN for an invalid date.
- Setters, in local time and in UTC: `setFullYear(year, month?, date?)`,
  `setMonth(month, date?)`, `setDate`, `setHours(hours, minutes?,
  seconds?, ms?)`, `setMinutes(minutes, seconds?, ms?)`,
  `setSeconds(seconds, ms?)`, `setMilliseconds`, and `setTime`, `setYear`.
  Each returns the new time value; fields out of range carry over
  (`setDate(0)` is the last day of the month before). An invalid date
  stays invalid, but `setFullYear` starts it from the epoch.
- Strings: `toISOString()` (`2024-10-15T16:05:00.000Z`, `+275760-...`
  past year 9999; it panics with `RangeError: Invalid time value` for an
  invalid date, as JavaScript throws), `toJSON()` (the same, `null` for an
  invalid date), `toString()` (`Tue Oct 15 2024 12:05:00 GMT-0400 (Eastern
  Daylight Time)`), `toDateString()`, `toTimeString()`, `toUTCString()`
  (`Tue, 15 Oct 2024 16:05:00 GMT`) and `toGMTString()`. An invalid date
  is `Invalid Date`.
- `toLocaleString()`, `toLocaleDateString()` and `toLocaleTimeString()`
  give the format of `en-US`, the only locale (`10/15/2024, 12:05:00 PM`),
  and take no arguments.
- `Date.parse` reads the date time string format of ECMAScript
  (`2024-10-15`, `2024-10-15T12:05`, `2024-10-15T12:05:00.000Z`,
  `+002024-10-15T12:05-04:00`; a date alone is UTC, a date and time
  without an offset local), then, as V8, other forms: what `toString` and
  `toUTCString` print, `Oct 15 2024 12:05 GMT+0200`, `15 Oct 2024`,
  `10/15/2024`, `2024/10/15`, with `AM`/`PM` and the zones `UTC`, `GMT`,
  `Z` and `EST` to `PDT`. Anything else is NaN.
- Local time is the zone of the `TZ` environment variable — a name of
  `/usr/share/zoneinfo` (`America/New_York`), a path to a TZif file, or a
  POSIX rule (`EST5EDT,M3.2.0,M11.1.0`) — else of `/etc/localtime`, else
  UTC. It is read once, on first use. A local time that happens twice is
  the earlier one; one that is skipped is read with the offset before the
  change (`new Date(2024, 2, 10, 2, 30)` is 3:30 in New York), as in
  JavaScript.
- `console.log` prints a date as Node does: its ISO string, or
  `Invalid Date` (an instance of a subclass after its class name).
  `JSON.stringify` writes its `toJSON()`, the ISO string or `null`.
- Differences from JavaScript: `Date.now()` is an `int` (its arguments
  and the others are `f64`, so `new Date(Date.now())` needs
  `f64(Date.now())`); arguments are not coerced (`new Date(2024, "1")`,
  `d.setHours(1, "2")` are errors, and `new Date(string, month)` panics);
  `null` stands for a missing argument, so `new Date(null)` is now (it is
  the epoch in JavaScript); dates do not convert to numbers or strings by
  themselves, so `d1 - d2` and `d1 < d2` are written with `getTime()`;
  the name of a zone in
  `toString` comes from its abbreviation (`EDT` is `Eastern Daylight
  Time`) for the common zones of North America, Europe, Japan, Korea,
  Hong Kong, Australia, New Zealand and South Africa, and is otherwise
  `GMT+04:00`, where V8 has ICU's names (`Gulf Standard Time`);
  `toLocale*String` know only `en-US`; `Symbol.toPrimitive` and
  `toTemporalInstant` are missing.
- `Date` is a class of the runtime written in Ore (`runtime/core/date.ore`),
  a global name as in JavaScript.

## Arrays

- `T[]` (or `Array<T>`) is a reference to a growable array, as in
  TypeScript: assigning an array or passing it to a function shares it.
  `===` compares identity.
- An array literal takes its element type from the context: an array type
  (`let a: u8[] = [1, 2]`), or a union with exactly one array type
  (`let a: Shape[] | null = [new Square(2), new Circle(1)]`), each element
  converting to it. Without one, it takes the type of its first typed
  element, else the default type of its constants (`[1, 2]` is `int[]`).
  `[]` requires a context type.
- `a[i]` reads and writes elements; an index of any integer type is allowed
  and an index out of range panics. Compound assignments (`a[i] += 1`,
  `a[i]++`) evaluate `a` and `i` once.
- `a.push(...values)` appends and returns the new length; arrays and tuples
  spread in (`a.push(...b)`) append all their elements. `a.pop()` removes
  and returns the last element and panics on an empty array; `a.shift()`
  does the same with the first element. `a.unshift(...values)` inserts at
  the start and returns the new length. `a.splice(start, count?,
  ...values)` removes `count` elements from `start` (all of them to the end
  without `count`), inserts the values in their place and returns the
  removed elements as a new array; a negative start counts from the end and
  both are clamped to the array, as in JavaScript. Arrays spread in add all
  their elements, as with `push`; every reference to the array sees the
  change.
- `a.slice(start?, end?)` returns a copy with JavaScript offsets.
- `let a: T[]` without an initializer is a new empty array.
- `new Array<T>(n)` (or `new Array(n)` with an array type as the context)
  is an array of `n` zero values of `T`, each its own: 0, `false`, `""`, a
  new empty array, map or set, or `null` for a type that includes it; a
  negative `n` panics with `Invalid array length`. JavaScript leaves holes
  there, so element types without a zero value (classes, interfaces,
  tuples, functions) are rejected: `Array.from({ length: n }, (_, i) =>
  ...)` makes such elements. With no arguments, several, or one that is not
  an integer, `new Array<T>(...)` is an array of the arguments.
- The other methods and `Array.from`, `Array.of` and `Array.isArray` are in
  [Array methods](04-functions.md#array-methods).
- `for (const x of a)` iterates elements; the length is re-read on every
  iteration, so elements pushed during the loop are visited.

## Tuples

- `[A, B]` is a tuple type: a reference to a fixed number of elements, each
  of its own type. Like an array, assigning it shares it.
- An array literal is a tuple in the context of a tuple type with as many
  elements (`const p: [string, int] = ["x", 1]`, a return value, an
  argument), where `...t` spreads another tuple's elements in; and when
  destructured by an array pattern (see [variables](#variables)). Generic
  parameters such as `t: [A, B]` infer from tuples.
- `t[0]` reads and writes an element; the index must be a constant within
  the tuple. `t.length` is a constant.
- Tuples are the entries of maps: `new Map(entries)` takes an array of
  `[K, V]` tuples (or another map), and `map.entries()` returns them.
- `...t` spreads a tuple's elements into the arguments of any call, built-in
  functions, methods and conversions too (`m.set(...entry)`), and into
  array literals. JSON encodes a tuple as an array and decodes an array of
  exactly its length.

## unknown

- `unknown` is the type of any value: every value converts to it
  implicitly, `null` too, and a union with it is `unknown`. A variable of
  type `unknown` without an initializer starts as `null`.
- The value is boxed with the type it has at run time: a string literal as
  a `string`, a union as the member it holds, an interface value as the
  instance it refers to, and an instance of a class as one of the class it
  was made by. `console.log` prints it as that type (a string at the top as
  it is).
- Nothing else can be done with an `unknown` until it is narrowed: no
  properties, methods, elements, calls or operators (`Object is of type
  'unknown'.`). It can be compared with `===` and `!==` (true for the same
  type and value, or for numbers of any types with the same value, and for
  two nulls), tested with `x === null`, given a fallback with `??`, passed
  where an `unknown` is expected, and printed.
- Checks narrow it: `typeof x === "string"` to `string`, `"number"` to
  `number` (`f64`, which a number of any type converts to), `"boolean"` to
  `bool`, `"bigint"` to `bigint`, and `x instanceof C` to the class `C` or
  a subclass. A narrowed read unboxes the value. `typeof x` is also
  `"function"` or `"object"`, which tell no type: such a value stays
  `unknown`.
- `typeof x === "object"` is true for `null`, arrays, maps, sets and
  objects, as in JavaScript.
- An `unknown` cannot be formatted in a template literal, converted to or
  from JSON, or be a `Map` key or a `Set` element.
