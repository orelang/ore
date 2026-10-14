# Modules, packages and C

## Modules and packages

- Each `.ore` file is a module. `export` marks declarations visible to other
  modules; everything else is private to its module. `export { a, b as c }`
  exports declared or imported names, also from another module
  (`export { x } from "./m"`). Default exports and `export *` are rejected.
- `import { a, b as c } from "./m"` imports names; `import * as m from "./m"`
  imports a module, used as `m.f()`, `m.value`, `m.Type` and `new m.Class()`.
  Modules may import each other in cycles; top-level constants are evaluated
  with imported modules first.
- Specifiers resolve like Node: `./x` and `../x` to `x.ore` or
  `x/index.ore`; a package name to `node_modules/<name>` in the directory of
  the importing file or above, using its package.json `main` (or
  `index.ore`); `name/sub/path` to a file of the package. `ore:` names
  standard modules embedded in the compiler.
- A project is an npm package: package.json `main` is the entry module, and
  dependencies are installed by npm and locked in `package-lock.json`.

## Files as text

`import name from "./file" with { type: "text" }` reads a file, relative to
the importing module, when the program is compiled, and declares `name` as a
string constant with its contents. The file is embedded in the program; it is
not needed at run time. The syntax is TypeScript's import attributes, as Bun
reads them.

## External C functions

`declare function name(params): result` at the top level of a module declares
a C function named `name`. Parameters and results may be numbers, `bool`,
`string` and `ptr`, an opaque pointer for handles. A `string` is passed as a
NUL-terminated copy (`const char *`); a returned `const char *` is copied
into an Ore string (NULL gives `""`). External functions cannot be used as
values.

A rest parameter declares a variadic C function, such as
`declare function snprintf(buffer: ptr, size: u64, format: string, ...args: i64[]): i32`.
Its element type is `i64`, `f64` or `ptr`, the types C promotes variadic
arguments to, and each argument after the fixed ones converts to it.

In package.json, `"ore": { "link": [...], "sources": [...] }` adds libraries
to link (`-l`) and C files, relative to the package, to compile into the
program. This applies to every package of the program, including
dependencies in `node_modules`.
