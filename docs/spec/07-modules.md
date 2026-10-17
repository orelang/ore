# Modules, packages and C

## Modules and packages

- Each `.ore` file is a module. `export` marks declarations visible to other
  modules; everything else is private to its module. `export { a, b as c }`
  exports declared or imported names, also from another module
  (`export { x } from "./m"`). Default exports are rejected.
- `export * from "./m"` re-exports every export of `./m`, and
  `export * as ns from "./m"` exports the module as the namespace `ns`
  (`import { ns } from ...; ns.f()`). A name the module exports itself takes
  precedence over `export *`. Two `export *` that give the same name from
  different declarations make it ambiguous, as in TypeScript: it is not
  exported, and the later `export *` is an error
  ([ORE6073](../errors/ORE6073.md)); re-exporting it explicitly resolves it.
  The same declaration reached through two `export *` is not ambiguous, and
  cycles of `export *` are allowed.
- `import { a, b as c } from "./m"` imports names; `import * as m from "./m"`
  imports a module, used as `m.f()`, `m.value`, `m.Type` and `new m.Class()`.
  Modules may import each other in cycles; top-level constants are evaluated
  with imported modules first.
- Specifiers resolve like Node: `./x` and `../x` to `x.ore` or, when
  there is no such file, the directory's `x/index.ore` (a file wins over a
  directory of the same name); `./x/`, `.` and `..` to the directory's
  `index.ore`; a package name to `node_modules/<name>` in the directory of
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
  commit: `<cache>/modules/github/<owner>/<repo>/<commit>/`. A repository
  the lock file has (below) is taken at its locked commit. Otherwise, once
  per build, the compiler asks GitHub (`git ls-remote`) which commit the
  branch or tag is at, and downloads that commit when the cache does not
  have it; the commit it resolved to is recorded in `<repo>/refs/<ref>`
  (`refs/HEAD` for the default branch). A commit named by its hash is never
  asked about.
- Offline, the commit recorded last is used, with a warning; a repository
  never downloaded is an error. With `--offline`, git is never run: the
  cache alone is used, and a repository it does not have is an error.
  `ore cache clean` removes the downloaded modules with the rest of the
  cache.
- Inside a downloaded module, relative imports resolve in the repository,
  and further GitHub URLs the same way.
- The language server downloads a repository as soon as an import names
  it, in the background, one repository at a time and once per session,
  reporting the download as work-done progress (`$/progress`) in the
  editor's status bar. Meanwhile the analysis uses the commit the cache
  has, if any. A download that failed is tried again a minute later, when
  an analysis looks the repository up, or at once when a document that
  imports it is saved. The hover of the import's URL tells the state of
  the download: its phase, the commit cached, or the error.

### The lock file

So that a build does not change when someone pushes to a repository it
imports, the commits are locked in `ore.lock`, a JSON file next to the
package.json of the program's package, or next to the entry file when it
has none. It is meant to be committed with the program. For each
repository and ref imported — the default branch, or the `/tree/<ref>` of
the URL — it records the commit and a hash of the files of that commit:

```json
{
  "version": 1,
  "github": {
    "https://github.com/acme/geo": {
      "commit": "0123456789abcdef0123456789abcdef01234567",
      "hash": "sha256-9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
    },
    "https://github.com/acme/geo/tree/v1.2.0": {
      "commit": "89abcdef0123456789abcdef0123456789abcdef",
      "hash": "sha256-60303ae22b998861bce3b28f33eec1be758a213c86c93c076dbe9f558c11c752"
    }
  }
}
```

The keys are sorted and the formatting fixed, so that the file changes only
where a lock does. The hash is `sha256-` and the SHA-256 of a line per file
of the commit, in the order of their paths: the SHA-256 of the file's
contents, two spaces and its path in the repository, and a newline.

- A build (`ore run`, `build`, `check`, `test`, `doc`) takes a locked
  repository at its locked commit: from the cache without the network, or
  downloaded by its hash. When its files do not have the locked hash, the
  import is an error that names the repository and both hashes: the cache,
  or the lock, was tampered with.
- A repository the lock does not have is taken where its branch is now, as
  above, and added to the lock, which the build writes. Builds running at
  the same time each add their entries to the file as it is when they
  write it. Entries no import uses any more are kept; delete them by hand.
- `ore lock [file.ore]` loads the program (by default the `main` of the
  nearest package.json) as a build does: it downloads the locked commits
  the cache does not have, checks their hashes and adds what is missing,
  without compiling.
- `ore lock --update [repos...]` first moves every locked repository, or
  those named (as `owner/repo`, or by URL, with a `/tree/<ref>` to name one
  ref), to the commit its branch or tag is at now on GitHub. A repository
  imported at a commit's hash stays where it is.
- `--frozen`, for CI, fails instead of changing the lock: a repository the
  lock does not have is an error at its import. `--offline` never runs git:
  a commit the cache does not have is an error. `ore run`, `build`,
  `check`, `test` and `lock` take both (`ore run` before the file).
- The language server reads the lock of each document's program the same
  way, downloading the locked commits in the background, but never writes
  it: a repository the lock does not have is taken where its branch is
  now, and the next build adds it. Running `ore lock --update` while the
  editor is open moves the analyses to the new commits.

## Files as text

`import name from "./file" with { type: "text" }` reads a file, relative to
the importing module, when the program is compiled, and declares `name` as a
string constant with its contents. The file is embedded in the program; it is
not needed at run time. The syntax is TypeScript's import attributes, as Bun
reads them.

## JSON files

`import name from "./file.json" with { type: "json" }` reads and parses a
JSON file, relative to the importing module, when the program is compiled,
and declares `name` as a constant with its value. The value is typed as the
same literal written in Ore: objects are object types with the properties of
the file, arrays have the element type of an array literal (`[1, 2.5]` is
`float[]`), strings are `string`, numbers `int` or `float` as written, `true`
and `false` `bool`, and `null` `null`. Using the value where a type is
declared checks it against that type: `const server: Server = config.server`
compiles when the JSON object has exactly the properties of `Server`, with
their types. A JSON value that has no Ore type, such as an empty array or an
array of strings and numbers, is an error at its place in the JSON file, as
are JSON syntax errors. Importing a file twice gives the same value, one for
the program.

To give the value a type of its own, initialize a declaration with the
imported name:

```ts
import config from "./config.json" with { type: "json" }

type Config = { name: string; owner: string | null; tags: string[] }
const settings: Config = config
```

The first top-level declaration of an importing module whose initializer is
the imported name alone, and which has a type annotation, gives the value
its type: the JSON value is checked against that type as the same literal
would be in `const settings: Config = { ... }`. So `null` is a value of
`string | null`, `[]` an empty `string[]`, and `2` a `number`; an object
must have exactly the properties of its type. Errors are reported at their
place in the JSON file. The imported name then has that type too, and is the
same value as the declaration. Among the modules that import the file, the
first in the order of the program that has such a declaration decides; other
declarations, and declarations in functions, are checked against the type
it gave. The form is plain TypeScript: there, the declaration checks the
type TypeScript infers from the file against the annotation.

The attribute `type` is `"text"` or `"json"`; other types and attributes are
errors.

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

The garbage collector stops the threads that run Ore code with a signal (see
[Concurrency](06-concurrency.md)), which interrupts what a thread does in C
too. A C function that may wait, for a lock, a condition variable, I/O or
another thread, is declared `//ore:blocking`:

```ts
//ore:blocking
declare function pthread_rwlock_wrlock(lock: ptr): i32
```

Its thread is parked while it runs: the collector scans its stack without
stopping it, and the thread waits for a collection in progress when the
call returns. A signal would break the wait of some C code: on macOS, a
thread interrupted in `pthread_rwlock_rdlock` or `pthread_rwlock_wrlock`
can miss its wakeup and wait forever. Parking costs two atomic operations
per call, which C functions that never wait need not pay. The directive
applies to functions with fixed parameters, not variadic ones
([ORE6088](../errors/ORE6088.md)). The arguments, strings and `ptr` values
into the heap among them, stay reachable for the time of the call.

C may call back Ore code, a function passed by `unsafe.functionAddress` or
one marked `//ore:export`, during a blocking call: the thread runs unparked
for the time of the Ore code, which may allocate and wait as any other.

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
