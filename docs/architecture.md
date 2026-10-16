# Architecture

Ore is a natively compiled, Go-like language with TypeScript syntax. There is
no JavaScript underneath: Ore keeps the syntax of TS and gives it native
semantics, closer to Go, Swift or Kotlin Native. The hard part is not
compilation but the semantic decisions TS never had to make, because JS was
always underneath; they are in the [specification](spec).

## Principles

1. **TS syntax as-is, no new syntax.** Only the semantics change. This reuses
   tree-sitter-typescript, TextMate grammars and the habits of TS developers;
   the compiler's own parser builds TypeScript's tree. Where Ore needs more (attributes,
   thread-locals), it uses comments: `//ore:` directives.
2. **Go-like in spirit.** One `ore` binary (`build`, `run`, `test`, `fmt`,
   `check`, `lsp`), fast compilation, static binaries, a GC, structural
   interfaces, errors as values, simplicity over expressiveness.
3. **Own type checker.** `tsc` is not used as a checker: Ore has its own
   types (`i64`, `u8`, …) and rules. Its parser accepts the TypeScript
   grammar and keeps the spelling of literals (`5` vs `5.0`).
4. **Own IR between the checker and the backend**, so that a backend is one
   package: the C backend was replaced by LLVM this way.

## Pipeline

```
.ore ─ syntax ─ project ─ checker ─ IR ─ opt ─ codegen ─ LLVM IR ─ LLVM ─ lld ─ binary
                                                              │
                         runtime: core (Ore, with the GC) + std (Ore)
```

- **syntax** parses each file into a tree in the shape of TypeScript's, with
  the role of each child in its parent.
- **project** resolves imports like Node (`node_modules`, package.json) and
  orders modules so that each comes after its imports; the runtime modules
  come first.
- **checker** resolves names and types and lowers to a typed, structured IR:
  generics are instantiated per type arguments, closures list their captures,
  unions are tagged, interfaces are `(data, itab)` pairs as in Go. It also
  produces the facts the language server needs.
- **opt** finds value classes (small immutable classes whose identity the
  program never observes: their instances are kept in registers and inside
  the objects that hold them, never on the heap), runs escape analysis
  (objects that never outlive their function go on the stack) and, in
  release builds, inlining of small functions.
- **llvm** writes textual LLVM IR, with the runtime in the same module so
  that it inlines; **driver** hands it to LLVM through its C API (parsed in
  memory, optimized by LLVM's pass pipeline, in debug builds one module per
  source file, compiled on every CPU) and links the objects with lld. A C
  compiler is only needed for the C sources of packages.
- **The build cache** (`~/.cache/ore`) keeps LLVM's object files by a hash
  of their IR, the compiler and the target: the runtime's parts of a debug
  build are compiled once, and an edit recompiles the parts of the files it
  changes.

The compiler is written in Ore ([`compiler`](../compiler)) and builds itself:
`ci/bootstrap.sh` checks that stages 2 and 3 emit the same LLVM IR. It was
first written in TypeScript; the last commit with that compiler, tagged
`seed`, starts the bootstrap until a release of `ore` exists.

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
  context switch on arm64 and x86-64) on `ORE_THREADS` OS threads, a run
  queue per thread with work stealing and a global one, channels with a lock each, `select` claimed by compare-and-swap,
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
- The runner ([`tests/runner`](../tests/runner), `ci/test.sh`), written in
  Ore, compiles them in-process on every CPU, runs the compiler's own tests
  (`compiler/test/*.test.ore`), checks that every `.ore` file is formatted
  and that the formatter is idempotent, and that the compiler builds itself.
- Async tests have their expected outputs, recorded from Bun.
- CI (GitLab, x86-64 Linux) bootstraps, runs everything, then the concurrent programs
  many times with 1 and 8 threads (`ci/stress.sh`). Locally the tests run on
  macOS and, through Docker, on Linux arm64 and amd64.

## Risks

- **The TS grammar accepts what Ore rejects.** The checker rejects it; these
  are diagnostics, with hints.
- **Type inference grows out of control.** Inference stays local, as in Go:
  contextual typing for literals and lambdas only.
- **JS expectations** (string length in bytes, wrapping integers, `===` on
  objects). The spec has a chapter on the [differences](spec/10-differences.md).
