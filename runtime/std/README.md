# runtime/std

The standard library.

- `builtin.d.ore`: declarations visible in every module: the numeric types,
  `console`, `Math`, `Number`, `fs`, `Date`, `task`, `process`, `JSON`,
  `unsafe`, `Error` and `internal`. The checker implements them; built-ins
  live in namespaces, never as bare globals.
- Modules imported as `ore:<name>`: `ore:sync` (`Mutex`, `WaitGroup`),
  `ore:net` (TCP `listen`, `Listener`, `Conn`), `ore:test` (`test`,
  `expect`, used by `ore test`).

The namespace `internal` is the private interface between these modules and
the runtime; a module that starts with `//ore:internal` may use it too.
