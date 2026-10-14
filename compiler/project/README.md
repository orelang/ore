# @ore/project

Turns an entry file into a program: every module it imports, in order.

- `loadProgram(entry)` parses the entry and, recursively, its imports, each
  module after the ones it imports (the entry last). The runtime modules
  (`ore:runtime/...`) always come first, so their top-level code runs first.
- `resolveImport(specifier, from)` resolves like Node: relative paths,
  packages in `node_modules` (package.json `main`, or `index.ore`), and the
  standard library `ore:name`.
- `stdModules` are the modules of [`runtime/std`](../../runtime/std) and
  [`runtime/core`](../../runtime/core), embedded in the compiler as text.
- package.json's `"ore": { "link", "sources" }` adds C libraries and sources.
