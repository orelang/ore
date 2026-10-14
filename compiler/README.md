# compiler

The Ore compiler, in TypeScript on Bun: one Bun workspace package per stage.
It is the bootstrap compiler; `next/` is its replacement written in Ore.

```
.ore files ─ syntax ─ project ─ checker ─ ir ─ opt ─ codegen ─ driver ─ native binary
                                   │                     (clang + runtime + GC)
                                   └─ lsp (editor features)        cli (the `ore` command)
```

| Package | Role |
|---|---|
| [`syntax`](syntax) | Parses a file with the TypeScript parser; source positions and diagnostics |
| [`project`](project) | Resolves imports and package.json, loads a program's modules in order |
| [`checker`](checker) | Resolves names, checks types and lowers the program to IR |
| [`ir`](ir) | The typed IR and its type model |
| [`opt`](opt) | Optimizations on the IR: escape analysis and inlining |
| [`codegen`](codegen) | IR to textual LLVM IR |
| [`driver`](driver) | Builds a binary: LLVM IR, the runtime and the GC through clang, with a cache |
| [`lsp`](lsp) | Language server: diagnostics, hover, definitions, references, rename, completion |
| [`cli`](cli) | The `ore` command: run, build, check, test, fmt, init, lsp |
| [`next`](next) | The compiler written in Ore (lexer and parser so far) |

`imports.d.ts` declares the files the compiler embeds as text (`.ore`, `.c`, `.h`).
Each package keeps its unit tests in `test/`; the end-to-end tests of the
language are in [`tests/`](../tests).
