# Ore — Plan

Ore is a natively compiled, Go-like language with TypeScript syntax.
Source files use the `.ore` extension. There is no JavaScript underneath:
Ore keeps the syntax of TS and gives it native semantics, closer to Go,
Swift or Kotlin Native. The closest relative in spirit is AssemblyScript,
which targets wasm instead of native code.

The hard part is not compilation itself but the semantic decisions TS never
had to make, because JS was always underneath.

## 0. Principles

1. **TS syntax as-is, no new syntax.** Only the semantics change. This lets us
   reuse the TS parser, tree-sitter-typescript, TextMate grammars, formatters
   and the habits of TS developers.
2. **Go-like in spirit.** A single `ore` binary (`build`, `run`, `test`, `fmt`,
   `check`, `lsp`), fast compilation, static binaries, GC, structural
   interfaces, errors as values, simplicity over expressiveness.
3. **Own type checker from day one.** Since Ore has its own extension, its own
   language server and real `i64`, `tsc` is not used as a checker. From
   TypeScript we take only the parser (`ts.createSourceFile`), which accepts
   any text and preserves literal spelling (`5` vs `5.0`).
4. **Own IR between checker and backend.** Moving from C to LLVM or Cranelift
   later replaces exactly one package.

**Implementation language:** TypeScript on Bun. We get the TS parser for free,
the compiler and the language server share one codebase, and
`bun build --compile` produces a single binary. The compiler moves to Ore
(Phase 8, step 4) once the runtime is in Ore.

## 1. Semantics (draft spec, lives in `docs/spec/`)

| Area | Decision |
|---|---|
| Primitives | `i8 i16 i32 i64 u8 u16 u32 u64 f32 f64 bool string`. Aliases: `int = i64`, `uint = u64`, `byte = u8`, `number = f64`. Declared in `std/builtin.d.ore` via `declare type`. |
| Literals | Untyped constants, as in Go: they adapt to context. `let x = 5` is `int`, `let y = 5.0` is `f64`, `let z: u8 = 300` is a compile error. |
| Conversions | Explicit only: `i32(x)`, `f64(n)`. A type name is also a conversion function (types and values live in separate namespaces in TS, so this is valid syntax). No implicit widening. |
| Arithmetic | Integer overflow wraps (as in Go). Division by zero panics. `==` is rejected; only `===` is allowed. |
| Strings | Immutable UTF-8. `s.length` is the length in bytes, `for (const r of s)` iterates runes. A deliberate divergence from JS, documented in the spec. |
| Arrays | `T[]` is a slice (ptr, len, cap), as in Go. Bounds checks panic. `push` / `slice` are methods. |
| Maps | `Map<K, V>` and `Record<K, V>` are real hash maps. Index signatures become maps. |
| Objects | Classes and object literals are heap references. An object literal is an anonymous struct with a known layout. `===` on objects compares identity, on strings compares value. Value structs may come later (`@struct` JSDoc tag). |
| Interfaces | Structural. An interface value is `(data, itab)`, as in Go. The itab is built at the conversion site and cached per (type, interface) pair. |
| Generics | Monomorphization, as in Rust and C++. Constraints via `extends`. Conditional and mapped types are type-level only, initially rejected. |
| Unions | `T \| null` is a nullable pointer. Discriminated unions are tagged unions. `string \| i64` is a tagged union with an implicit tag. Narrowing via `typeof`, `instanceof` and `switch (x.kind)` (a switch on the tag). |
| Errors | Errors as values via unions: `function read(p: string): string \| IoError`, then `if (r instanceof Error) return r`. No unwinding needed. `process.panic()` for unrecoverable failures. `throw` / `try` rejected for now, possibly added later. |
| Defer | `using f = open(...)`: TS 5.2 explicit resource management, calls `[Symbol.dispose]`. A direct analogue of Go's `defer` with valid syntax. |
| Concurrency | Go-style, without function coloring: green threads (`spawn(() => ...)`), `Chan<T>`, `select([...])`. Blocking I/O parks the green thread. `async` / `await` are rejected. |
| Entry point | The top-level code of the entry file, as in a script; modules run their top-level code on startup, imports first. |
| FFI | `declare function` with a JSDoc tag `/** @extern("c") */`, plus `cstring` and `ptr<T>` types. Link flags in the manifest. |
| Removed | `any`, `prototype`, `eval`, `delete`, dynamic keys, `with`, `arguments`, `var`, `==`. `unknown` stays as an explicitly boxed value with a type check. |

## 2. Repository layout (Bun workspaces monorepo)

```
ore/
  package.json            # workspaces
  packages/
    syntax/               # wrapper over ts.createSourceFile, AST facade, positions
    checker/              # name resolution, types, literals, inference, narrowing, diagnostics
    ir/                   # typed IR + lowering (monomorphization, unions, closures, itabs)
    opt/                  # IR optimizations: escape analysis, inlining
    codegen-llvm/         # IR -> LLVM IR
    driver/               # pipeline, cache, clang invocation, runtime linking
    cli/                  # the `ore` binary
    lsp/                  # language server (vscode-languageserver over stdio), uses checker
  runtime/                # C: GC wrapper, string, slice, map, panic, itab, scheduler
  std/                    # builtin.d.ore + fmt, strings, math, os, fs, io, time
  editors/
    zed/                  # Zed extension: language config, tree-sitter queries, LSP launcher
  tests/
    run/                  # *.ore + expected stdout
    diag/                 # *.ore + expected diagnostics (// error: ...)
  docs/
    spec/
```

The runtime is plain C built by the driver with clang. Boehm GC (bdwgc) is
vendored in `runtime/third_party` rather than installed from Homebrew, so
builds are reproducible.

## 3. Editor support: Zed first

The first editor target is **Zed**. VS Code and others come later; the
language server itself is editor-agnostic (LSP over stdio).

The Zed extension (`editors/zed/`) consists of:

- `extension.toml` registering the `Ore` language and the language server.
- `languages/ore/config.toml` with `path_suffixes = ["ore"]`, comment
  tokens and brackets.
- **Grammar:** reuse `tree-sitter-typescript` (referenced by repository and
  revision in `extension.toml`). Since Ore adds no syntax, no custom grammar is
  needed.
- `highlights.scm`, `brackets.scm`, `indents.scm`, `outline.scm` adapted from
  Zed's built-in TypeScript queries, plus Ore-specific highlighting of builtin
  types (`i32`, `u8`, ...).
- A small Rust extension (compiled to wasm by Zed) whose
  `language_server_command` launches `ore lsp`, found on `PATH` or configured
  in settings. Requires Rust installed via rustup for development.

Development loop: `zed: install dev extension` pointing at `editors/zed/`.

## 4. Phases

Each phase ends when its golden tests pass.

### Phase 0: Scaffolding (~1 week)
- Monorepo, `ore` CLI stub, golden test runner, CI.
- Draft spec from section 1, `std/builtin.d.ore` with primitive declarations.

### Phase 1: First binary (2–3 weeks)
- Integer and float types, `bool`, functions, `let` / `const`,
  `if` / `while` / `for` / `break` / `continue`, `println`.
- Checker: untyped literals, explicit conversions, mixed-type errors.
- IR, C codegen, `ore run file.ore`.
- Done when fib, fizzbuzz and primes run, and `tests/diag` catches `i32 + f64`.

### Phase 1.5: Language server MVP + Zed extension (~1 week, in parallel)
- `ore lsp`: document sync and diagnostics from the checker.
- Zed extension: `.ore` language registration, tree-sitter-typescript
  highlighting, LSP launch.
- Done early so the rest of the language is developed in its own editor.

### Phase 2: Memory and data (3 weeks)
- Boehm GC, strings, template literals, arrays, `for...of`, bounds checks,
  `panic` with a stack trace.
- `Map` moves to Phase 4: `get` returns `V | undefined`, which needs unions.

### Phase 3: Objects (3–4 weeks)
- Classes, methods, constructors, object literals, structural interfaces with
  itabs.
- LSP: hover, go-to-definition, member completion.

### Phase 4: Type system (4 weeks)
- Generic monomorphization, unions, nullables, narrowing, discriminated
  unions with exhaustiveness checks in `switch`.
- `Map<K, V>` with `get` returning `V | undefined`.
- Errors as values: `Error` type in std.

**Phases 1–4 yield a genuinely useful language in about 3–4 months of focused
work.**

### Phase 5: First-class functions (2–3 weeks)
- Closures (captured variables moved into heap env structs), arrow functions,
  function types, `using` / dispose.

### Phase 6: Modules and tooling (3–4 weeks)
- ES imports; projects are npm packages: `package.json` (`main`, dependencies in
  `node_modules`, `package-lock.json`); standard modules as `ore:*`; FFI.
- `ore test` (`*.test.ore`, `test("name", t => ...)`).
- `ore fmt` (initially Prettier / dprint with the TS parser on `.ore`).
- Done: LSP find references and rename. Next: semantic tokens.
- Done: VS Code extension (the TypeScript grammar of VS Code + an LSP client).

### Phase 7: Concurrency (4–6 weeks)
- Done: M:1 scheduler with stackful tasks (assembly context switch on arm64
  and x86_64, mmap'ed stacks with guard pages), `task.spawn` / `sleep` /
  `yield`, `Chan<T>`, `task.select` with timeouts, deadlock detection. The
  GC scans suspended task stacks through a push-roots hook.
- Done (7.5): M:N scheduler on `ORE_THREADS` OS threads (one per CPU by
  default) with a shared run queue, Boehm GC built with GC_THREADS and
  parallel marking, a lock per channel, select claimed by compare-and-swap,
  and a handoff for blocking file operations (another thread takes over the
  other tasks). `ore:sync` with `Mutex` and `WaitGroup`.
- Done: `ore:net` (TCP) on non-blocking sockets with a netpoller thread
  (kqueue / epoll) that resumes parked tasks.
- Next: per-thread run queues with work stealing if the shared queue becomes
  a bottleneck; UDP, TLS and HTTP in the standard library.

### Phase 8: Performance and maturity
- Done: escape analysis. Object literals, constructor calls, closures and
  boxes of captured locals that cannot outlive their function get a slot in
  its stack frame (`packages/opt/src/escape.ts`); benchmarks in
  `bench/`.
- Done: inlining of small functions (a single `return`) in release builds,
  so that objects they return can stay on the caller's stack.
- Next for escape analysis: stack arrays of known size.
- `try` / `catch` will not be added: errors are values.

The road from here, in this order:

1. **LLVM backend** (`packages/codegen-llvm`, done): the same IR compiled to
   textual LLVM IR, built by clang, calling the C runtime through generated
   `ore_abi_*` wrappers. It passed every test on both platforms, and the C
   backend was removed.
2. **Low-level layer** (done) for the standard library, like Go's `unsafe`:
   the `unsafe` namespace (raw memory, pointer arithmetic, typed loads and
   stores, sizes, atomics, inline assembly) and `//ore:` directives
   (`noinline`, `inline`, `cold`, `export`, `threadlocal`); spec section 3.23.
3. **Runtime in Ore**: strings, arrays and maps, printing and JSON, the
   network, then the scheduler and channels, ported from C part by part until
   `runtime/src/*.c` is gone. The runtime and the program are one LLVM module,
   so runtime functions inline into user code. Only libc and the Boehm GC stay
   outside Ore.
   This step also brings the system std the compiler needs: running a
   process with its output, directories and paths, hashing, and files
   embedded in the binary.
4. **Compiler in Ore**: every package of `packages/` rewritten in Ore, the
   checker over the self-hosted parser of `selfhost/` (through typed
   accessors over its generic nodes). `try`/`finally` becomes `using`,
   internal `throw` becomes `process.panic`, I/O errors become values. `ore fmt`
   gets its own printer instead of prettier, and the LSP its own JSON-RPC
   instead of `vscode-languageserver`. Bootstrap: the TypeScript compiler
   builds stage 1, stage 1 builds stage 2, stage 2 builds stage 3, and CI
   checks that stages 2 and 3 emit the same LLVM IR. Then the TypeScript
   compiler is removed and the compiler builds from the previous release.
   Only the oracle tests stay in TypeScript: the parser compared with
   TypeScript's and the async references from Bun. Done before the GC and
   async, so that both are written once, in Ore.
5. **Own garbage collector** in Ore, precise, with LLVM stack maps, replacing
   Boehm.
6. **Promises and async/await** (Phase 8.6) on LLVM coroutines, against the
   tests already in `tests/async/`.

### Phase 8.5: Language completeness (done)
- Destructuring of objects and arrays in declarations, parameters, `for-of`
  and assignments.
- Default and rest parameters.
- Generic methods.
- Getters and setters.
- `JSON.parse` / `JSON.stringify`.

### Phase 8.6: Async
- Promises and `async`/`await` in the JavaScript order of microtasks and
  timers, without exceptions: a promise only resolves, failures are values
  (`Promise<T | Error>`).
- `time.timeout`, `interval`, `immediate`, `delay` (a promise), `sleep`
  (blocks the task; moved from `task`), timers cancelled with `cancel()`;
  `task.microtask`.
- Async functions compile to LLVM coroutines (state machines, no stack per
  call), run synchronously until their first `await`, on one event loop:
  async code is single-threaded, `task.spawn` is parallel. Comes after the
  LLVM backend, the runtime in Ore, the compiler in Ore and the own GC
  (Phase 8).
- Done: the test suite `tests/async/`, whose expected outputs come from Bun
  running the same files (`tests/async/bun-shim.ts` maps `time` and `task`
  to Web APIs), and benchmarks in `bench/async/` with Bun's times as the
  target (about 20-60 ns per await, microtask or timer). Tests with tasks,
  channels and the end of the program have hand-written outputs.
- Decided by the tests: a promise resolved from a task wakes the event loop;
  an async function called from a task runs on the event loop; waiting on a
  channel blocks the loop; the program ends when the loop has nothing left
  (pending timers keep it, unsettled promises do not, running tasks are
  stopped); an unsettled top-level await with nothing pending exits with
  status 13 as in Node, and a deadlock with tasks panics as before.

### Phase 9: Self-hosting
- Rewrite the compiler in Ore, the best stress test of the language, in
  `selfhost/`.
- Done: the lexer and the parser (`selfhost/src/lexer.ore`, `parser.ore`).
  `tests/selfhost.test.ts` checks, on every .ore file of the repository, that
  the tokens equal the TypeScript scanner's and the tree (kinds, spans and
  children) equals the TypeScript parser's.
- Next: the whole compiler (Phase 8, step 4), after the runtime in Ore and
  before the own GC and async.
- Language gaps found so far: definite assignment (now supported); arrays
  have no `unshift`.

## 5. Risks and mitigations

- **The TS parser accepts what Ore rejects.** Fine: the checker rejects it,
  these are just more diagnostics.
- **Type inference grows out of control.** Keep inference local, as in Go:
  parameter and return types of exported functions are mandatory. Contextual
  typing only for literals and lambdas.
- **JS developer expectations** (string length in bytes, wrapping integers,
  identity `===`). A dedicated "Differences from TypeScript" chapter in the
  spec, plus diagnostics with hints.
- **Green threads vs Boehm GC.** Goroutine stacks must be registered with the
  GC; validate early with a prototype before Phase 7.

## 6. Immediate next steps

1. Root `package.json` with workspaces, empty packages from section 2.
2. `docs/spec/00-overview.md` from section 1.
3. Golden test runner and `tests/run/hello.ore` with expected output.
4. End-to-end path: `export function main() { console.log(42) }` → C → clang →
   binary.
