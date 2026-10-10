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

export function main() {
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

**Functions.** Closures capture by reference as in JavaScript, methods can be
used as values, nested functions are hoisted, and `using` disposes resources
at the end of a block, like Go's `defer`:

```ts
function copy(from: string, to: string): Error | null {
    using input = open(from)
    using output = create(to)
    ...
}
```

**Built-ins in namespaces.** `console.log`, `process.args`, `Math.sqrt`,
`Number.parseInt`, `fs.readFile`, `Date.now`. No bare globals.

**Concurrency, like Go.** Green threads running in parallel on all CPUs,
channels and select, without `async` coloring; `ore:sync` adds `Mutex` and
`WaitGroup`:

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

**C interop.** `declare function strlen(s: string): u64` calls C directly.

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

## Editor support: Zed

In Zed, run `zed: install dev extension` and select `editors/zed` (requires Rust
installed with rustup). The extension highlights `.ore` files and starts
`ore lsp` from `PATH`, which provides diagnostics, hover, go to definition and
member completion. Another binary can be set in Zed settings:

```json
{ "lsp": { "ore": { "binary": { "path": "/path/to/ore", "arguments": ["lsp"] } } } }
```

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
| 8. Escape analysis, precise GC, LLVM backend | in progress |
| 9. Self-hosting | planned |

### Known limitations

- Tasks are not preempted: a task that computes without waiting keeps its OS
  thread. Data races are not detected.
- There is no network API yet, so no netpoller; a file operation occupies a
  whole OS thread while it runs.
- A task has a fixed stack (256 KiB, 8 MiB for `main`); deep recursion in a
  task can overflow it.
- No default or rest parameters, no generic methods, no numeric literal types
  (`1 | 2`), no `JSON`; case mapping of strings covers ASCII only.
- A generic function or class that is never used is parsed but not checked.
- The language server has no rename or find references yet; only Zed has an
  extension.

## Development

```sh
bun test                         # unit and golden tests
bun run typecheck
ORE_BLESS=1 bun test tests       # regenerate expected outputs of tests/run
bench/run.sh                     # time the benchmarks in bench/ (release builds)
```

| Path | Contents |
|---|---|
| `packages/syntax` | Parsing `.ore` with the TypeScript parser, diagnostics |
| `packages/project` | Module resolution, package.json, loading programs |
| `packages/checker` | Type checker producing IR |
| `packages/ir` | Type model and typed IR |
| `packages/codegen-c` | IR to C, escape analysis |
| `packages/driver` | Compilation pipeline, clang, runtime and GC cache |
| `packages/cli` | The `ore` command, including `test` and `fmt` |
| `packages/lsp` | Language server |
| `editors/zed` | Zed extension |
| `runtime/` | C runtime; Boehm GC in `runtime/third_party/bdwgc` |
| `std/` | Built-in declarations (`builtin.d.ore`) and standard modules (`ore:test`, `ore:sync`) |
| `tests/run` | Programs with expected output; directories are multi-module programs |
| `tests/diag` | Programs with expected diagnostics (`// error: ...`) |
| `bench/` | Benchmarks |
