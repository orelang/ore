# tests

End-to-end tests of the language, and benchmarks. The unit tests of each
compiler package are in its own `test/` directory. `bun test` runs all.

| Directory | Contents |
|---|---|
| `run/<topic>/` | Programs built and run; stdout must equal the `.out` file |
| `diag/<topic>/` | Programs that must fail to check, with `// error: <message>` on the lines of the errors |
| `async/` | Async programs with outputs from Bun (`bun-shim.ts`), until Ore has async |
| `bench/` | Benchmarks: `bench/run.sh`, `bench/async/run.sh` |
| `harness/` | The runners: `golden.test.ts` (run and diag), `async.test.ts`, `next.test.ts` (the Ore compiler against TypeScript), `lsp-next.test.ts` (its language server over stdio), `zed-queries.test.ts` |

Topics: `basics`, `types`, `collections`, `functions`, `errors`,
`concurrency`, `library`, `runtime`, `modules`. A directory with a `main.ore`
is one program of several modules.

Header comments of a run test: `// exit: N`, `// stderr: <substring>`,
`// threads: N` (OS threads for tasks; 1 by default, for a stable order).

`ORE_BLESS=1 bun test tests` rewrites the `.out` files from the actual output.
[`ci/stress.sh`](../ci/stress.sh) runs the concurrent programs many times.
