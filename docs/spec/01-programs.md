# Programs

## Source files

- Extension: `.ore`. Encoding: UTF-8.
- Syntax is exactly the TypeScript syntax. Ore adds no new syntax; it only
  restricts it and assigns native semantics.
- A file is a module. Imports and exports use ES module syntax; see [modules](07-modules.md).

## Programs

```ts
const name = process.args[0] ?? "world"
console.log(`hello, ${name}`)
```

- A program is the top-level code of its modules, as in a script: when it
  starts, each module's top-level statements run in order, every module after
  the modules it imports and the entry file last. The program ends when the
  entry file's code ends, or with `process.exit()`. `return` is not allowed
  at the top level. `main` is an ordinary name.
- Function, class, interface and type declarations are hoisted: they can be
  used anywhere in their module, before or after the declaration.
- A top-level `const` made of literals and other such constants (`const
  size = 64 * 1024`) is a compile-time constant, known before any code runs.
- Other top-level `let` and `const` declarations are module variables. Used
  by functions of the module (or exported), they are global variables, zero
  until their declaration runs; tasks share them, so concurrent access needs
  channels or `ore:sync`, as in Go. Variables used only by the top-level code
  itself are ordinary locals of it.
