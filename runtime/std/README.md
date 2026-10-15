# runtime/std

The standard library.

- `builtin.d.ore`: declarations visible in every module: the numeric types,
  `console`, `Math`, `Number`, `fs`, `Date`, `task`, `process`, `JSON`,
  `unsafe`, `Error` and `internal`. The checker implements them; built-ins
  live in namespaces, never as bare globals.
- Namespaces written in Ore: the exports of `runtime/core/fs.ore` and
  `runtime/core/process.ore` are members of `fs` and `process`
  (`namespaceModules` in `compiler/checker/src/builtins.ts`), classes
  included; builtin.d.ore declares them too, for documentation.
  - `fs`: `readFile`, `writeFile`, `exists`, and in Ore `readDir` (sorted
    names), `mkdir(path, recursive?)`, `remove(path, recursive?)`,
    `rename`, `stat` and `lstat` (an `fs.FileInfo`: `isFile`, `isDir`,
    `isSymlink`, `size`, `mtime`, `mode`), `isFile`, `isDir`, `realpath`,
    `tempDir`, `mkdtemp(prefix?, dir?)`.
  - `process`: `args`, `getenv`, `panic`, `exit`, and in Ore `env()` (a
    `Map`), `run(program, args?)` (inherited stdio; the exit status),
    `output(program, args?)` (a `process.Output`: `stdout`, `stderr`,
    `code`, `signal`, `ok`) and `process.Command` (`cwd`, `env`,
    `clearEnv`, `stdin`; `run()`, `output()`). Children start with
    `posix_spawn`; their pipes and exits are awaited on the poller.
- Modules imported as `ore:<name>`: `ore:sync` (`Mutex`, `WaitGroup`),
  `ore:net` (TCP `listen`, `Listener`, `Conn`), `ore:test` (`test`,
  `expect`, used by `ore test`), `ore:crypto` (`sha256`, the incremental
  `Sha256`).

The namespace `internal` is the private interface between these modules and
the runtime; a module that starts with `//ore:internal` may use it too.
