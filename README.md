# Ore

A natively compiled, Go-like language with TypeScript syntax.

Ore keeps the syntax of TypeScript and gives it native semantics: real `i32`,
`u64` and `f32` types, untyped numeric constants, explicit conversions, nominal
classes, structural interfaces, tagged unions with narrowing, errors as values,
generics by monomorphization, green threads with channels and a garbage
collector. Programs compile to C and
then to a single native binary with clang.

```ts
type Shape = { kind: "circle"; r: f64 } | { kind: "rect"; w: f64; h: f64 }

function area(s: Shape): f64 {
    switch (s.kind) {
        case "circle":
            return Math.PI * s.r * s.r
        case "rect":
            return s.w * s.h
    }
}

class ParseError {
    constructor(
        readonly message: string,
        readonly line: int,
    ) {}
}

function parseSize(text: string, line: int): int | Error {
    const n = Number.parseInt(text)
    if (n === null || n < 0) return new ParseError(`bad size '${text}'`, line)
    return n
}

const shapes: Shape[] = [
    { kind: "circle", r: 1 },
    { kind: "rect", w: 2, h: 3 },
]
const total = shapes.map(area).reduce((sum, a) => sum + a, 0.0)
console.log(`total area: ${total.toFixed(2)}`)

const lines = ["12", "-4"]
for (let i = 0; i < lines.length; i++) {
    const size = parseSize(lines[i], i + 1)
    if (size instanceof Error) {
        console.error(size.message)
        continue
    }
    const bytes: u8 = u8(size)
    console.log(bytes * 2)
}
```

```
$ ore run
total area: 9.14
24
bad size '-4'
```

Status: early development. The language described below works today; see the
[plan](docs/PLAN.md) for what comes next and the [spec](docs/spec/00-overview.md)
for the details.

## The language at a glance

**Numbers.** `i8`…`i64`, `u8`…`u64`, `f32`, `f64`; `int` is `i64` and
`number` is `f64`. Literals are untyped constants, as in Go: `let b: u8 = 255`
works, `let b: u8 = 256` is a compile error. Types never mix implicitly; convert
with `f64(x)`, `i32(y)`. Integer overflow wraps, and `7 / 2` is `3`.

**Strings and arrays.** Strings are immutable UTF-8 with JavaScript methods
(`split`, `trim`, `replaceAll`, `padStart`, …) on byte offsets. Arrays are
references with `push`, `map`, `filter`, `reduce`, `find`, `sort` and the rest;
`Map<K, V>` keeps insertion order.

**Objects.** Object types (`{ x: f64 }`) are structural records; classes are
nominal, without inheritance, with `private`, `readonly` and parameter
properties. Interfaces are structural and accept any class or object with the
members, including fields:

```ts
interface Named {
    readonly name: string
}

function greet(n: Named): string {
    return `hello, ${n.name}`
}

greet({ name: "literal" })
greet(new User("Ada"))
```

**Unions and narrowing.** `T | null`, discriminated unions, string literal
types, `typeof`, `instanceof`, `?.`, `??` and exhaustive `switch`. A narrowed
value is checked at run time, so a wrong check panics instead of corrupting
memory.

**Errors are values.** Fallible functions return `T | Error`; any class with a
`message` is an `Error`. `process.panic` is for bugs. There is no `throw`.

**Generics.** Functions, classes, interfaces and type aliases, with inferred
type arguments and `extends` constraints, compiled per instance.

**Functions.** Default, optional and rest parameters, destructuring
(`function f({ x, y }: Point)`, `[a, b] = [b, a]`), closures that capture by
reference as in JavaScript, methods as values, getters and setters, generic
methods, and `using`, which disposes resources at the end of a block, like
Go's `defer`:

```ts
function copy(from: string, to: string): Error | null {
    using input = open(from)
    using output = create(to)
    ...
}
```

`using` is not Ore's own syntax: it is the `using` declaration of the TC39
[Explicit Resource Management](https://github.com/tc39/proposal-explicit-resource-management)
proposal, shipped in
[TypeScript 5.2](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-2.html#using-declarations-and-explicit-resource-management).
Ore keeps TypeScript's syntax, so there is no `defer`; unlike Go's `defer`,
`using` is tied to a value's `[Symbol.dispose]()` method and ends with the
block, not the function, so a `using` in a loop disposes on every iteration.

**Scripts.** A program is the top-level code of its files, run in import
order; there is no `main`. Top-level variables that functions use are
globals.

**Typed JSON.** `JSON.stringify(value)` works on any data type, and
`JSON.parse<Config>(text)` returns a `Config` or an `Error` that says what is
wrong and where (`expected a string, got a number at .tags[1]`).

**Built-ins in namespaces.** `console.log`, `process.args`, `Math.sqrt`,
`Number.parseInt`, `fs.readFile`, `Date.now`. No bare globals.

**Concurrency, like Go.** Green threads running in parallel on all CPUs,
channels and select, without `async` coloring; `ore:sync` adds `Mutex` and
`WaitGroup`, and `ore:net` TCP whose waiting parks only the task:

```ts
const results = new Chan<int>()
for (let i = 1; i <= 3; i++) task.spawn(() => results.send(i * i))
let sum = 0
for (let i = 0; i < 3; i++) sum += results.receive() ?? 0

task.select([
    results.onReceive((v) => console.log("got", v)),
    task.after(100, () => console.log("timeout")),
])
```

**Fast by default.** Release builds (`ore build --release`) inline small
functions and keep objects that never leave their function on the stack
instead of the garbage-collected heap.

**C interop.** `declare function strlen(s: string): u64` calls C directly,
and `//ore:export name` makes an Ore function callable from C.

**Low level when needed.** The `unsafe` namespace has raw memory, atomics and
inline assembly, and `//ore:` directives set function attributes and
thread-local variables, so the runtime itself can be written in Ore. See
[unsafe code](docs/spec/00-overview.md#323-unsafe-code-and-directives).

What is left out on purpose: `any`, `undefined`, `var`, `==`, `throw`,
inheritance, `enum`, `namespace`, `prototype`, `eval`, `delete`. See
[differences from TypeScript](docs/spec/00-overview.md#7-differences-from-typescript-summary).

## Getting started

Requirements: [Bun](https://bun.sh) and clang. The Boehm GC is a submodule:
clone with `--recursive` or run `git submodule update --init`.

```sh
bun install
bun run build                       # the standalone compiler, dist/ore
ln -sf "$PWD/dist/ore" ~/.local/bin/ore
```

Then:

```sh
ore init my-app          # package.json and src/main.ore
cd my-app
ore run                  # build and run
ore build --release      # an optimized binary named after the package
ore check                # report errors without building
ore test                 # run the tests in *.test.ore files
ore fmt                  # format .ore files: 4 spaces, no semicolons
```

A single file works too: `ore run hello.ore`.

## Projects and packages

An Ore project is an npm package. Its `package.json` names the entry module in
`main`, and dependencies are npm packages containing `.ore` files, installed
with npm (or bun, pnpm, yarn) into `node_modules` and locked in
`package-lock.json` as usual.

Modules import each other like TypeScript: `import { x } from "./util"`,
`import * as m from "./m"`, `import { y } from "some-package"`. Only exported
declarations are visible to other modules. Standard modules use the `ore:`
prefix:

```ts
import { test, expect } from "ore:test"
import { parseSize } from "./size"

test("parses sizes", () => {
    expect(parseSize("12", 1)).toBe(12)
})
```

Native code is declared in package.json, also by dependencies:

```json
{ "ore": { "link": ["sqlite3"], "sources": ["native/glue.c"] } }
```

## Editor support

Both extensions run `ore lsp` from `PATH`, which provides diagnostics, hover,
go to definition, member completion, find references and rename.

**Zed.** Run `zed: install dev extension` and select `editors/zed` (requires
Rust installed with rustup). Another binary can be set in Zed settings:

```json
{ "lsp": { "ore": { "binary": { "path": "/path/to/ore", "arguments": ["lsp"] } } } }
```

**VS Code.** Build the extension and install it:

```sh
cd editors/vscode
npm install
npm run package                      # ore-0.1.0.vsix
code --install-extension ore-0.1.0.vsix
```

Another binary can be set with the `ore.path` setting.

## Status

| Phase | |
|---|---|
| 1. Numbers, functions, control flow, first binary | done |
| 1.5. Language server and Zed extension | done |
| 2. Strings, arrays, garbage collector | done |
| 3. Object types, classes, interfaces | done |
| 4. Unions, narrowing, errors, generics, Map | done |
| 5. Closures, array methods, `using` | done |
| 6. Modules, packages, standard library, C interop, `ore test`, `ore fmt` | done |
| 7. Concurrency: tasks, `Chan<T>`, `select` on green threads | done |
| 7.5. Multi-threaded scheduler, blocking I/O handoff, `ore:sync` | done |
| 8. Performance: escape analysis and inlining, LLVM backend (done); low-level layer, runtime in Ore, compiler in Ore, precise GC | in progress |
| 8.5. Language completeness: destructuring, default and rest parameters, generic methods, getters and setters, `JSON` | done |
| 9. Self-hosting: lexer and parser (done); the rest of the compiler in Phase 8 | in progress |

### Known limitations

- Tasks are not preempted: a task that computes without waiting keeps its OS
  thread. Data races are not detected.
- A file operation occupies a whole OS thread while it runs (the network does
  not).
- A task has a fixed stack (256 KiB, 8 MiB for the top-level code); deep
  recursion in a task can overflow it.
- No numeric literal types (`1 | 2`), static members or class inheritance;
  case mapping of strings covers ASCII only.
- A generic function or class that is never used is parsed but not checked.

## Development

```sh
bun test                         # unit and golden tests
bun run typecheck
ORE_BLESS=1 bun test tests       # regenerate expected outputs of tests/run
tests/bench/run.sh               # time the benchmarks in tests/bench/ (release builds)
ci/test-linux.sh                 # the tests in Linux containers (arm64 and amd64), with Docker
ci/stress.sh                     # run the concurrent programs many times
```

The tests run on macOS and Linux, on arm64 and x86-64.

| Path | Contents |
|---|---|
| `compiler/syntax` | Parsing `.ore` with the TypeScript parser, diagnostics |
| `compiler/project` | Module resolution, package.json, loading programs |
| `compiler/checker` | Type checker producing IR |
| `compiler/ir` | Type model and typed IR |
| `compiler/opt` | Optimizations on the IR: escape analysis, inlining |
| `compiler/codegen` | IR to LLVM IR, built by clang |
| `compiler/driver` | Compilation pipeline, clang, runtime and GC cache |
| `compiler/lsp` | Language server |
| `compiler/cli` | The `ore` command, including `test` and `fmt` |
| `compiler/next` | The compiler written in Ore, to replace the TypeScript one (so far the lexer and the parser) |
| `runtime/core` | The runtime written in Ore (`ore:runtime/...`), part of every program |
| `runtime/std` | Built-in declarations (`builtin.d.ore`) and standard modules (`ore:test`, `ore:sync`, `ore:net`) |
| `runtime/c` | The part of the runtime still in C, moving to `runtime/core` |
| `runtime/third_party/bdwgc` | The Boehm garbage collector (submodule) |
| `tests/run` | Programs with expected output, by topic; a directory with `main.ore` is one program |
| `tests/diag` | Programs with expected diagnostics (`// error: ...`), by topic |
| `tests/async` | Async tests, with references from Bun (waiting for Phase 8.6) |
| `tests/bench` | Benchmarks |
| `tests/harness` | The test runners: golden, async, the Ore compiler against TypeScript, Zed queries |
| `editors/zed` | Zed extension |
| `editors/vscode` | VS Code extension |
| `ci/` | Linux test environment and stress tests |
