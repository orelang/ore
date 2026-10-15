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
  computed only then, and can use the names bound before it.

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
| `process.cwd()` | the working directory, as an absolute path |
| `process.env()` | the environment variables, as a `Map<string, string>` |
| `process.cpus()` | the number of CPUs online |
| `process.run(program, args?)`, `process.output(program, args?)`, `new process.Command(program, args?)` | other programs (below), also started without waiting: `process.Child` |
| `Math.PI`, `Math.E`, `Math.sqrt(x)`, `Math.pow`, `Math.floor`, `Math.round`, … | as in JavaScript, on `f64`; `Math.round` rounds halves up |
| `Math.abs(x)`, `Math.min(...values)`, `Math.max(...values)` | for any numeric type, keeping it; `min` and `max` take one or more values, arrays and tuples spread in, and of only empty arrays give an infinity or the integer type's extreme |
| `Math.random()` | a pseudo-random `f64` in [0, 1) |
| `Number.parseInt(s, radix?)`, `Number.parseFloat(s)` | like JavaScript, but `null` instead of `NaN` |
| `Number.NaN`, `Number.POSITIVE_INFINITY`, `Number.NEGATIVE_INFINITY`, `Number.MAX_VALUE`, `Number.MIN_VALUE`, `Number.EPSILON`, `Number.MAX_SAFE_INTEGER`, `Number.MIN_SAFE_INTEGER` | `f64` constants, as in JavaScript (no global `NaN` and `Infinity`) |
| `Number.isNaN(x)`, `Number.isFinite(x)`, `Number.isInteger(x)`, `Number.isSafeInteger(x)` | predicates on an `f64`, as in JavaScript |
| `String.fromCharCode(...codes)`, `String.fromCodePoint(...points)` | a string of UTF-16 code units or code points (see [strings](#strings)) |
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
| `Date.now()` | milliseconds since the Unix epoch |
| `JSON.stringify(value, null?, space?)` | the JSON text of a value, indented by `space` spaces per level; the replacer must be null |
| `JSON.parse<T>(text)` | a `T` read from JSON text, or an `Error` |

Numbers have `toString()` and `toFixed(digits)`; `bool` has `toString()`.

`String`, `fs` and `process` are partly written in Ore
(`runtime/core/string.ore`, `runtime/core/fs.ore` and
`runtime/core/process.ore`): the exports of these modules are members of
the namespaces, classes included, so `fs.FileInfo` and `process.Command`
are types and `new process.Command(...)` creates one.

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

### Running programs

```ts
const out = process.output("git", ["status", "--short"])
if (out instanceof Error) process.panic(out.message)   // it could not start
if (!out.ok) console.error(out.stderr)
console.log(out.stdout)

const cc = new process.Command("cc", ["-c", "main.c"])
cc.cwd = "build"
cc.env.set("LANG", "C")
const code = cc.run()   // with this program's stdin, stdout and stderr
```

- The program is found in `PATH` unless its name has a slash. Arguments are
  passed as they are, without a shell.
- `output()` collects standard output and error into an `process.Output`
  with `stdout`, `stderr`, `code` and `ok`; its standard input is empty.
  `run()` gives the child this program's standard input, output and error
  (what this program printed before is written out first) and returns the
  exit status. A status other than 0 is no `Error`: an `Error` means the
  program could not be started (`cannot run cc: not found in PATH`) or
  waited for. A child killed by a signal has the status 128 plus the
  signal's number, as in shells, and `Output.signal` names it.
- `spawn()` starts the command as `run()` does and returns at once a
  `process.Child`, which runs alongside this program: `pid`, `wait()` (the
  exit status, as `run()` returns it; the same again when called again) and
  `kill(signal = 15)` (SIGTERM; 9 is SIGKILL and 2 SIGINT on macOS and Linux
  alike), which sends nothing once `wait()` has collected the child. To wait
  with a timeout, wait in another task and `task.select` on its result and
  `task.after`:

  ```ts
  const server = new process.Command("./server").spawn()
  if (server instanceof Error) process.panic(server.message)
  server.kill()
  const exited = new Chan<int | Error>(1)
  task.spawn(() => exited.send(server.wait()))
  task.select([exited.onReceive((status) => {}), task.after(1000, () => server.kill(9))])
  ```
- A `Command` has `cwd` (`""` for this program's directory), `env`
  (variables set over the inherited environment), `clearEnv` (start from an
  empty environment) and `stdin` (text written to the child's standard
  input, which is then closed). It can run several times.
- Waiting for a child occupies no OS thread: the pipes are non-blocking, and
  a task waiting for output or for the child's exit parks until the
  runtime's poller sees it (kqueue, or epoll with a pidfd on Linux), as for
  sockets. Standard output and error are read at once, so a child that
  fills one while this program reads the other cannot deadlock. Many tasks
  can run programs at the same time.

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
- `s.codePointAt(i)` is the code point (`int | null`) of the character that
  starts at byte `i`: U+FFFD if no valid character starts there, `null` if
  `i` is out of range (JavaScript's `undefined`).
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
- The syntax and the matching are JavaScript's (ECMAScript with its Annex B,
  without the `u` flag): characters and escapes (`\n`, `\x41`, `A`,
  `\cJ`, `\0`, octal), `.`, classes `[a-z]`, `[^...]`, `\d \w \s \D \W \S`,
  anchors `^ $`, `\b \B`, groups `( )`, `(?: )`, named groups
  `(?<name> )`, alternation, quantifiers `* + ? {n} {n,} {n,m}` and their
  lazy forms, backreferences `\1` and `\k<name>`, lookahead `(?= )` and
  `(?! )`. Lookbehind and the flags `u`, `v` and `d` are errors for now.
- Flags: `g` (global), `i` (ignore case), `m` (`^` and `$` at line breaks),
  `s` (`.` matches line breaks too), `y` (sticky: a match only at
  `lastIndex`). `re.flags` lists them in the order `gimsy`; `re.global`,
  `ignoreCase`, `multiline`, `dotAll` and `sticky` tell each, `re.source` is
  the pattern (with `/` escaped) and `re.toString()` is `/source/flags`.
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
  groups (empty without names).
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
- `a.push(...values)` appends and returns the new length; arrays spread in
  (`a.push(...b)`) append all their elements. `a.pop()` removes
  and returns the last element and panics on an empty array.
  `a.slice(start?, end?)` returns a copy with JavaScript offsets.
- `let a: T[]` without an initializer is a new empty array.
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
- `...t` spreads a tuple's elements into the arguments of any call and into
  array literals. JSON encodes a tuple as an array and decodes an array of
  exactly its length.
