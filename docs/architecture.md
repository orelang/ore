# Architecture

Ore is a natively compiled, Go-like language with TypeScript syntax. There is
no JavaScript underneath: Ore keeps the syntax of TS and gives it native
semantics, closer to Go, Swift or Kotlin Native. The hard part is not
compilation but the semantic decisions TS never had to make, because JS was
always underneath; they are in the [specification](spec).

## Principles

1. **TS syntax as-is, no new syntax.** Only the semantics change. This reuses
   the TS parser, tree-sitter-typescript, TextMate grammars, formatters and
   the habits of TS developers. Where Ore needs more (attributes,
   thread-locals), it uses comments: `//ore:` directives.
2. **Go-like in spirit.** One `ore` binary (`build`, `run`, `test`, `fmt`,
   `check`, `lsp`), fast compilation, static binaries, a GC, structural
   interfaces, errors as values, simplicity over expressiveness.
3. **Own type checker.** `tsc` is not used as a checker: Ore has its own
   types (`i64`, `u8`, …) and rules. From TypeScript it takes only the parser,
   which accepts any text and keeps the spelling of literals (`5` vs `5.0`).
4. **Own IR between the checker and the backend**, so that a backend is one
   package: the C backend was replaced by LLVM this way.

## Pipeline

```
.ore ─ syntax ─ project ─ checker ─ IR ─ opt ─ codegen ─ LLVM IR ─ clang ─ binary
                                                              │
                         runtime: core (Ore, with the GC) + std (Ore)
```

- **syntax** parses each file with `ts.createSourceFile`.
- **project** resolves imports like Node (`node_modules`, package.json) and
  orders modules so that each comes after its imports; the runtime modules
  come first.
- **checker** resolves names and types and lowers to a typed, structured IR:
  generics are instantiated per type arguments, closures list their captures,
  unions are tagged, interfaces are `(data, itab)` pairs as in Go. It also
  produces the facts the language server needs.
- **opt** runs escape analysis (objects that never outlive their function go
  on the stack) and, in release builds, inlining of small functions.
- **codegen** writes textual LLVM IR; **driver** builds it with clang together
  with the runtime and the GC, cached in `~/.cache/ore`.

The compiler is written in TypeScript on Bun, so it gets the TS parser for
free, shares one codebase with the language server, and compiles to a single
binary with `bun build --compile`. It is being rewritten in Ore
(`compiler/next`); see the [roadmap](roadmap.md).

## Runtime

Everything a program needs at run time is in [`runtime/`](../runtime):

- **Memory**: a non-moving mark-sweep collector in Ore
  ([`gc.ore`](../runtime/core/gc.ore)), in the shape of Go's: pages of 8 KB
  in spans of one size class, a page table for pointers into objects, each
  thread allocating from its own spans without locks. A collection stops the
  world with a signal, scans stacks conservatively and globals from a table
  the compiler emits, and objects allocated as bytes not at all. Strings are immutable UTF-8 `{ptr, len}`; arrays are references
  to `{data, len, cap}`; maps are insertion-ordered hash tables.
- **Tasks**: an M:N scheduler of green threads (stackful, with an assembly
  context switch on arm64 and x86-64) on `ORE_THREADS` OS threads, a shared
  run queue, channels with a lock each, `select` claimed by compare-and-swap,
  a handoff for blocking file operations, and a netpoller (kqueue / epoll)
  for sockets. The collector scans the stacks of suspended tasks.
- **Panics** print a message and, in debug builds, a stack trace from a
  shadow stack of frames kept by generated code.

The runtime is written in Ore: a function in `runtime/core` marked
`//ore:runtime ore_rt_name` is what generated code calls for `ore_rt_name`.
Being in the same LLVM module as the program, it inlines into it. Only libc
is outside Ore. The tools for writing the runtime in Ore
are the `unsafe` namespace, `//ore:` directives, variadic C declarations and
`target.os` / `target.arch` ([spec](spec/09-unsafe.md)).

## Testing

- Golden tests ([`tests/`](../tests)): programs with expected output, and
  programs with expected diagnostics, grouped by topic.
- The Ore compiler (`compiler/next`) is checked against the TypeScript
  scanner and parser on every `.ore` file of the repository.
- Async tests take their expected outputs from Bun running the same files.
- CI (GitLab, x86-64 Linux) runs everything, then the concurrent programs
  many times with 1 and 8 threads (`ci/stress.sh`). Locally the tests run on
  macOS and, through Docker, on Linux arm64 and amd64.

## Risks

- **The TS parser accepts what Ore rejects.** The checker rejects it; these
  are diagnostics, with hints.
- **Type inference grows out of control.** Inference stays local, as in Go:
  contextual typing for literals and lambdas only.
- **JS expectations** (string length in bytes, wrapping integers, `===` on
  objects). The spec has a chapter on the [differences](spec/10-differences.md).
