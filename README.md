# Ore

A natively compiled, Go-like language with TypeScript syntax.

```ts
function fib(n: int): int {
    if (n < 2) return n
    return fib(n - 1) + fib(n - 2)
}

export function main() {
    const x: u8 = 200
    console.log(fib(30), x + 55, f64(x) / 3.0)
}
```

Ore keeps the syntax of TypeScript and gives it native semantics: real
`i32` / `u64` / `f32` types, untyped numeric constants, explicit conversions,
structural interfaces, errors as values and green threads. Programs compile to
C and then to a native binary with clang.

Status: early development, see [docs/PLAN.md](docs/PLAN.md) and the draft
[spec](docs/spec/00-overview.md).

## Building the compiler

Requirements: [Bun](https://bun.sh) and clang. The Boehm GC is a submodule:
clone with `--recursive` or run `git submodule update --init`.

```sh
bun install
bun run build            # standalone binary at dist/ore
bun run ore run tests/run/fib.ore   # or run from the sources
```

## Projects

An Ore project is an npm package: its `package.json` names the entry module
in `main`, and dependencies are npm packages with `.ore` files, installed with
`npm install` (or bun, pnpm, yarn) into `node_modules` and locked in
`package-lock.json` as usual.

```sh
ore init my-app          # package.json and src/main.ore
cd my-app
ore run                  # build and run package.json main
ore build --release      # native binary named after the package
ore check                # report errors
ore test                 # run tests in *.test.ore files
ore fmt                  # format .ore files (4 spaces, no semicolons)
```

Modules import each other like TypeScript: `import { x } from "./util"`,
`import * as m from "./m"`, `import { y } from "some-package"`. Standard
modules use the `ore:` prefix, such as `import { test, expect } from "ore:test"`.

C libraries are called through `declare function` declarations; a
package.json can add native code:

```json
{ "ore": { "link": ["sqlite3"], "sources": ["native/glue.c"] } }
```

## Editor support: Zed

1. Build the compiler and put it on `PATH`:
   ```sh
   bun run build
   ln -sf "$PWD/dist/ore" ~/.local/bin/ore
   ```
2. In Zed run `zed: install dev extension` and select `editors/zed`
   (requires Rust installed via rustup).

The extension highlights `.ore` files with Zed's TypeScript grammar and starts
`ore lsp` (diagnostics, hover, go to definition). A different binary can be
configured in Zed settings:

```json
{ "lsp": { "ore": { "binary": { "path": "/path/to/ore", "arguments": ["lsp"] } } } }
```

## Development

```sh
bun test                         # unit and golden tests
bun run typecheck
ORE_BLESS=1 bun test tests       # regenerate expected outputs of tests/run
```

| Path | Contents |
|---|---|
| `packages/syntax` | Parsing `.ore` with the TypeScript parser, diagnostics |
| `packages/checker` | Type checker producing IR |
| `packages/ir` | Type model and typed IR |
| `packages/codegen-c` | IR to C |
| `packages/driver` | Compilation pipeline, clang invocation, runtime cache |
| `packages/cli` | The `ore` command, including `test` and `fmt` |
| `packages/project` | Module resolution, package.json, loading programs |
| `packages/lsp` | Language server |
| `editors/zed` | Zed extension |
| `runtime/` | C runtime; Boehm GC in `runtime/third_party/bdwgc` |
| `std/` | Built-in declarations (`builtin.d.ore`) and standard modules (`ore:test`) |
| `tests/run` | Programs with expected output |
| `tests/diag` | Programs with expected diagnostics (`// error: ...`) |
