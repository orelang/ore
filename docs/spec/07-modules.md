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
  standard modules embedded in the compiler. `https://github.com/...` names
  a module of a GitHub repository (below).
- A project is an npm package: package.json `main` is the entry module, and
  dependencies are installed by npm and locked in `package-lock.json`.

## Modules from GitHub

An import specifier that is the URL of a GitHub repository imports a module
of the repository, without installing it in the project:

```ts
import { x } from "https://github.com/owner/repo"                       // its entry module
import { x } from "https://github.com/owner/repo/src/point"             // a file of it
import { x } from "https://github.com/owner/repo/tree/v1.2.0/src/point" // at a branch, tag or commit
```

- `https://github.com/<owner>/<repo>` is the repository's entry module, as
  for a package: its package.json `main`, or `index.ore`. A trailing `.git`
  or `/` is ignored.
- A path after it names a module in the repository, resolved like `./path`
  is: `path.ore`, `path` itself or `path/index.ore`.
- `/tree/<ref>/` (or `/blob/<ref>/`, as GitHub's own links have it) before
  the path picks a branch, a tag or a commit (its full 40-digit hash);
  without it, the repository's default branch. A ref with `/` in its name
  cannot be named this way; a path cannot have `.` or `..` parts.
- The repository is downloaded with `git` into the cache (`ore cache`), by
  commit: `<cache>/modules/github/<owner>/<repo>/<commit>/`. Once per
  build, the compiler asks GitHub (`git ls-remote`) which commit the branch
  or tag is at, and downloads that commit when the cache does not have it;
  the commit it resolved to is recorded in `<repo>/refs/<ref>` (`refs/HEAD`
  for the default branch). A commit named by its hash is never asked about.
- Offline, the commit recorded last is used, with a warning; a repository
  never downloaded is an error. `ore cache clean` removes the downloaded
  modules with the rest of the cache.
- Inside a downloaded module, relative imports resolve in the repository,
  and further GitHub URLs the same way.
- The language server downloads a repository as soon as an import names
  it, in the background, one repository at a time and once per session,
  reporting the download as work-done progress (`$/progress`) in the
  editor's status bar. Meanwhile the analysis uses the commit the cache
  has, if any. The hover of the import's URL tells the state of the
  download: its phase, the commit cached, or the error.

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
dependencies in `node_modules`. `"libDirs": [...]` adds directories to
search for the libraries (`-L`): a path relative to the package, or
`$(command args...)`, the output of a command run without a shell. Entries
whose directory does not exist, or whose command fails, are skipped, so a
package can list where a library is on several systems:

```json
"ore": { "link": ["LLVM"], "libDirs": ["$(llvm-config --libdir)", "/opt/homebrew/opt/llvm/lib"] }
```
