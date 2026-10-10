# Ore

A natively compiled, Go-like language with TypeScript syntax.

```ts
function fib(n: int): int {
  if (n < 2) return n
  return fib(n - 1) + fib(n - 2)
}

export function main() {
  const x: u8 = 200
  println(fib(30), x + 55, f64(x) / 3.0)
}
```

Ore keeps the syntax of TypeScript and gives it native semantics: real
`i32` / `u64` / `f32` types, untyped numeric constants, explicit conversions,
structural interfaces, errors as values and green threads. Programs compile to
C and then to a native binary with clang.

Status: early development, see [docs/PLAN.md](docs/PLAN.md) and the draft
[spec](docs/spec/00-overview.md).

## Usage

Requirements: [Bun](https://bun.sh) and clang.

```sh
bun install
bun run ore run tests/run/fib.ore
bun run ore build tests/run/fib.ore -o fib --release
bun run ore check file.ore
bun run build            # standalone binary at dist/ore
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
| `packages/cli` | The `ore` command |
| `runtime/` | C runtime |
| `std/` | Standard library, `builtin.d.ore` |
| `tests/run` | Programs with expected output |
| `tests/diag` | Programs with expected diagnostics (`// error: ...`) |
