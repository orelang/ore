# runtime/std

The standard library.

- `builtin.d.ore`: declarations visible in every module: the numeric types,
  `console`, `Math`, `Number`, `fs`, `Date`, `time`, `task`, `process`, `JSON`,
  `unsafe`, `Error` and `internal`. The checker implements them; built-ins
  live in namespaces, never as bare globals.
- Namespaces written in Ore: the exports of `runtime/core/fs.ore`,
  `runtime/core/process.ore`, `runtime/core/process-command.ore` and
  `runtime/core/time.ore` are members of `fs`, `process`, the nested
  `process.command` and `time`
  (`namespaceModule` in `compiler/src/checker/builtins.ore`), classes and
  types included; builtin.d.ore declares them too, for documentation.
  - `fs`: `readFile`, `writeFile`, `exists`, and in Ore `appendFile`,
    `readDir` (sorted names), `mkdir(path, recursive?)`,
    `remove(path, recursive?)`, `rename`, `stat` and `lstat` (an `fs.FileInfo`: `isFile`, `isDir`,
    `isSymlink`, `size`, `mtime`, `mode`), `isFile`, `isDir`, `realpath`,
    `tempDir`, `mkdtemp(prefix?, dir?)`.
  - `process`: `args`, `platform`, `arch`, `getenv`, `panic`, `exit`, and
    in Ore `env()` (a `Map`), `cpus()`, `run(program, args?)` (inherited stdio; the exit
    status), `output(program, args?)` (a `process.Output`: `stdout`,
    `stderr`, `code`, `signal`, `ok`), `spawn(program, args?)` (a
    `process.Child`: `pid`, `wait()`, `kill(signal?)`), and the same with
    options in `process.command`: `run`, `output` and `spawn(program,
    args?, options?)`, with a `process.CommandOptions` (`cwd`, `env`,
    `clearEnv`, `stdin`). Children start with `posix_spawn`
    (`runtime/core/spawn.ore`); their pipes and exits are awaited on the
    poller.
  - `time`: everything in nanoseconds as `int`, as in Go: `now()` (a
    monotonic clock), `unixNanos()` (the wall clock), the durations
    `nanosecond`, `microsecond`, `millisecond`, `second`, `minute`, `hour`,
    `day`, and `parse(text)` / `format(ns, options?)` (a `time.FormatOptions`:
    `long`), a port of the npm package `ms` that returns and takes
    nanoseconds where `ms` has milliseconds (`parse("1m")` is
    60_000_000_000, `format(60 * second)` is "1m"); its texts are those of
    `ms`, so a number without a unit is milliseconds, and it also knows
    `us`/`µs` and `ns`.
- Modules imported as `ore:<name>`: `ore:sync` (`Mutex`, `WaitGroup`),
  `ore:net` (TCP `listen`, `Listener`, `Conn`), `ore:test` (`test`,
  `describe`, the hooks, `expect` and its matchers, used by `ore test`), `ore:crypto` (`sha256`, the incremental
  `Sha256`, and `randomUUIDv4`, `randomUUIDv7` of RFC 9562 from the
  system's secure random numbers, getentropy(3)), `ore:path` (`join`, `dirname`, `basename`, `extname`,
  `normalize`, `isAbsolute`, `resolve`, `relative`, `sep`, `delimiter`,
  with the POSIX semantics of Node's `node:path`).

The namespace `internal` is the private interface between these modules and
the runtime; a module that starts with `//ore:internal` may use it too.
