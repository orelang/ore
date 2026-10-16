# compiler

The Ore compiler, written in Ore: `dist/ore`. It builds itself
(`ci/bootstrap.sh`: stages 2 and 3 must emit the same LLVM IR). The pipeline:
the parser builds a tree in the shape of TypeScript's (`syntax/`), the
modules of a program are loaded (`project/`), the checker lowers them to a
typed IR (`checker/`, `ir/`), the optimizer runs escape analysis and inlining
(`opt/`), the backend writes LLVM IR (`llvm/`), and the driver compiles it
through LLVM's C API and links with lld (`driver/`). `fmt/` is the
formatter, `lsp/` the language server, `cli/` the `ore` command.

## The `ore` command

`cli/` holds the commands, with these exit statuses (0 on success, 1 for errors in the program or a failing
tool, 2 for a wrong command line):

| Command | |
|---|---|
| `ore run [file.ore] [args...]` | builds into a temporary directory and runs the program with the same stdio, with its exit status |
| `ore run --watch [file.ore] [args...]` | the same, and again after each change of a file of the program (below), until interrupted |
| `ore build [file.ore] [-o out] [--release] [--emit-llvm f.ll] [--time] [--watch]` | an executable named after the file or the package; `--time` prints the time of each step; `--watch` builds again after each change |
| `ore check [file.ore \| paths...]` | the diagnostics of a program; given directories, of each `.ore` file in them as an entry, skipping files a program checked before has loaded, each diagnostic once |
| `ore test [--watch] [paths...]` | builds and runs every `*.test.ore` file below the paths (default `.`, without `node_modules` and hidden directories), in parallel, one task per CPU, each build in a child process of the same `ore`; prints each file's output in order, then `All N test file(s) passed.` or `F of N test file(s) failed.` (status 1) |
| `ore fmt [--check] [--stdout] [paths...]` | formats `.ore` files in place; `--check` lists the unformatted ones (status 1), `--stdout` prints them formatted |
| `ore doc [paths...] [--md \| --json] [-o out]` | the API of modules: their exports (functions, classes with their public members, interfaces, type aliases, variables) with the signatures the hover shows and their JSDoc (description, `@param`, `@returns`, `@example`, other tags), and the `//` comment each module starts with; a colored listing, Markdown (`-o dir`: a file per module and `index.md`) or JSON |
| `ore init [dir]` | `package.json` (name from the directory) and `src/main.ore` |
| `ore cache [clean]` | where the build cache is, its object files and their size; `clean` removes them |
| `ore lsp`, `ore version`, `ore help` | |

Without a file, `run`, `build` and `check` take the `main` of the nearest
package.json. `ore test` prints a file's output once it is done (its stdout,
then its stderr). The language server checks the program of each open
document with its unsaved text.

With `--watch` (`-w`; for `run`, before the file), `cli/watch.ore` watches
the files the program is made of: its modules but the embedded `ore:` ones,
the files they import as text, the package.json of their packages and the
C sources of the packages, taken again from each build. It looks at their
modification times and sizes every 100 ms; once a change is followed by
50 ms without another, it prints `[ore] restarting: src/main.ore changed`
on stderr, stops the program (SIGTERM, then SIGKILL after 1 s), builds it
again, with the objects of the unchanged files from the build cache, and
runs it with the terminal's stdin, stdout and stderr and the arguments
after the file. A build error is printed and the next change builds again;
a program that ends with a failing status is told of (`[ore] exited with
status 1`). Ctrl-C stops the watcher and the program. `ore test --watch`
watches the files of the test programs and runs them all again.

Every diagnostic has a code (`error[ORE2033]`), found by its message in
`syntax/codes.ore`, and a page in [`docs/errors`](../docs/errors); the
command line prints the page's address under the diagnostic and the
language server sends it as the code's description. The address comes from
`docsPattern` in `syntax/codes.ore` (on GitHub for now; `ORE_DOCS` overrides
it). A new message needs a code there and a page: the tests check both.

Programs are loaded, checked and emitted from the sources every time; LLVM's
object files come from the build cache when it has them (see below).

| File | Contents |
|---|---|
| `syntax/tokens.ore` | Token kinds (named as `ts.SyntaxKind`) and keywords |
| `syntax/lexer.ore` | Tokens of a file, with byte offsets |
| `syntax/ast.ore` | The syntax tree: a node kind, a span and children |
| `syntax/parser.ore` | The parser, with its syntax errors and their spans |
| `syntax/source.ore` | A parsed file: path, text, tree; line and column of an offset |
| `syntax/diagnostic.ore` | Diagnostics and their `path:line:col: error: message` format |
| `syntax/imports.ore` | Module specifiers, string literal values, text imports |
| `syntax/parse.ore` | A file parsed into a `Source`, syntax errors as diagnostics |
| `syntax/nodes.ore` | Typed accessors of the tree for the checker (`expression(node)`, `parameters(fn)`, ...), and what TypeScript keeps in flags and token kinds: `declarationKind`, `prefixOperator`, `leadingCommentRanges` |
| `project/resolve.ore` | The `ore:` modules embedded in the compiler, the runtime's load order, import resolution |
| `project/load.ore` | `loadProgram`: the entry file and every module it imports |
| `ir/types.ore` | The type model (`compiler/ir/src/types.ts`): `Type`, `types`, `sameType`, `typeToString`, `typeKey`, `unionRepr`, `jsonProblem` |
| `ir/nodes.ore` | The IR nodes (`compiler/ir/src/nodes.ts`): `Module`, `Func`, `Local`, statements and expressions |
| `ir/dump.ore` | `dump(module)`: the canonical text of a module, the same as `dump` of `compiler/ir/src/dump.ts` |
| `checker/bigint.ore` | Untyped integer constants, `bigint` in TypeScript: sign and magnitude in 32-bit limbs |
| `checker/operand.ore`, `fold.ore` | Operands (`untyped-int`, `untyped-float`, `typed`, `error`) and folding of constants |
| `checker/symbols.ore` | Value and type symbols, generics, scopes |
| `checker/context.ore` | The types shared by the layers: `CheckResult`, `FuncContext`, `ClassInfo`, facts... |
| `checker/helpers.ore` | Tables and pure functions: operators, string and array methods, `terminates`, `visitLocals` |
| `checker/builtins.ore` | The root scope, from `runtime/std/builtin.d.ore`, and the runtime modules that implement namespaces (`fs`, `process`), also nested ones (`process.command`, a member of `process` with a module of its own) |
| `checker/assigned.ore` | Definite assignment |
| `checker/base.ore` | `Checker`: the state of a check, type resolution, unions and shapes, `coerce`, diagnostics |
| `checker/declarations.ore` | Modules, imports and exports, directives, functions, generics and their instances, parameters |
| `checker/classes.ore` | Classes, accessors, interfaces, conformance, itabs |
| `checker/slots.ore` | Generic methods of interfaces: the instances the program calls through them, made for every class and object literal converted, to a fixed point |
| `checker/statements.ore` | Statements, destructuring, closures, narrowing |
| `checker/expressions.ore` | Expressions: names, operators, assignments, literals, members |
| `checker/calls.ore` | Calls of functions, methods, values, constructors and built-ins (`unsafe`, `JSON`), array, map, channel and string methods |
| `checker/checker.ore` | `check(program)`: the passes over the modules of a program, into one IR module |
| `fmt/doc.ore` | Documents (groups, indents, lines, ifBreak, fill...) and their printer, which fits groups in the width |
| `fmt/estree.ore` | The syntax tree converted to the shape of typescript-estree's, and the comments of a file |
| `fmt/comments.ore` | Comments attached to nodes (leading, trailing, dangling), with prettier's rules, and printed |
| `fmt/print.ore` | The formatter: the tree printed as a document in the Ore style, as prettier prints it |
| `ir/read.ore` | `readModule(text)`: the module of a dump, so that `dump(readModule(dump(m)))` is `dump(m)` |
| `opt/inline.ore` | `inlineCalls(module)`: calls of small functions replaced by their bodies (`compiler/opt/src/inline.ts`) |
| `opt/escape.ore` | `planStack(module)`: escape analysis, the allocations placed on the stack (`compiler/opt/src/escape.ts`) |
| `opt/values.ore` | `valueClasses(module)`: the small immutable classes whose instances are LLVM structs passed by value, since nothing observes their identity |
| `llvm/*.ore` | The LLVM backend: `emitModule(module, options)` of `llvm/emit.ore`, the LLVM IR text of a module, ported file by file from `compiler/codegen/src` (`ll`, `context`, `helpers`, `base`, `functions`, `expressions`, `calls`, `collections`, `json`, `emit`) |
| `llvm/bindings.ore` | The LLVM C API the compiler calls (contexts, the IR parser, the verifier, target machines, the new pass manager), and the registration of the host's target by `target.arch` |
| `llvm/names.ore` | Names in the IR that do not depend on the checker's numbering: types after what they are, strings after their bytes, closures after their file, globals after their names, class ids from a hash of the class's name |
| `llvm/split.ore` | `splitModule(ir)`: a debug build's IR in parts, one per source file (several for a large one), each with only the types, declarations and constants it uses |
| `llvm/object.ore` | `emitObject(ir, options)`: LLVM IR text to an object file, as `clang -c -O0\|-O2` does: parsed in memory, verified, `default<O0>` or `default<O2>`, code generation for the host's CPU at -O0 or -O2; errors keep LLVM's `name:line:col`; `objectTarget`, what else decides the object |
| `driver/native.ore` | `nativeCode(paths)`: the libraries, C sources and library directories (`libDirs`) of a program's packages |
| `driver/link.ore` | Linking with lld: `ld64.lld` with the macOS SDK, `ld.lld` with glibc's start files and dynamic linker; C sources compiled with `$CC` (cc); the target triple |
| `driver/build.ore` | `compileToIr(entry, debug)` and `build(entry, options)` of `compiler/driver/src/build.ts`: load, check, emit, object, link; `buildIr` for IR already emitted |
| `driver/cache.ore` | The build cache: its directory, the keys of objects, `ore cache`'s size and cleaning |
| `lsp/jsonrpc.ore` | JSON-RPC over the LSP base protocol: `Content-Length` framing, a reader task, cancellation, error codes |
| `lsp/text.ore` | LSP positions (UTF-16) to byte offsets and back, file URIs |
| `lsp/analysis.ore` | What the server knows of a document, from the checker: diagnostics, hover (signature or type, and the JSDoc comment), definition, completion after `.`, references and rename |
| `lsp/server.ore` | The language server of `compiler/lsp`: lifecycle, documents with incremental changes, diagnostics and the language features |
| `cli/main.ore` | The `ore` command: the usage, and the dispatch to the commands |
| `cli/commands.ore` | `ore build`, `run`, `check`, `init`: the entry of a program (a file or package.json's `main`), errors and statuses |
| `cli/test.ore`, `cli/fmt.ore`, `cli/files.ore` | `ore test`, `ore fmt`, and the `.ore` files below the paths they are given |
| `cli/watch.ore`, `cli/background.ore` | `--watch`: the files of a program, polled for changes; the program run in the background and stopped |
| `cli/doc.ore` | `ore doc`: the exports of a module and their JSDoc, as a listing, Markdown or JSON |
| `cli/cache.ore` | `ore cache [clean]` |
| `cli/self.ore` | The path of the running executable (`/proc/self/exe`, `_NSGetExecutablePath`) |
| `main.ore` | `process.exit(main(process.args))` |

The tests of the compiler are `test/*.test.ore`, run with the rest of the
suite by [`ci/test.sh`](../ci/test.sh) (see [tests](../tests/README.md)).

## Building

`ore build` calls LLVM through its C API (`llvm/object.ore`) instead of
running clang on the IR, and links with lld (`driver/link.ore`). A C compiler
is needed only for the C sources of packages (`"ore": { "sources": [...] }`).
It needs LLVM 19 or newer (`libLLVM`, found through `llvm-config --libdir`,
Homebrew's `opt/llvm/lib` or `"libDirs"` in package.json) and lld
(`ld64.lld` or `ld.lld`, in PATH, beside `llvm-config`, in Homebrew's or
Debian's `/usr/lib/llvm-N/bin`, or `$ORE_LD`). On macOS the SDK comes from
`$SDKROOT` or `xcrun --show-sdk-path`, and the minimum version is the running
system's or `$MACOSX_DEPLOYMENT_TARGET`; on Linux, executables are PIE with
glibc's start files and dynamic linker.

Code is generated for the baseline CPU of the architecture (`generic`), so
that programs, `ore` itself included, run on any machine of it;
`ORE_CPU=native` generates it for the machine that builds.

Debug builds split the module into parts by source file (`llvm/split.ore`)
and compile the parts in parallel; release builds keep one module, so that
the runtime inlines into the program.

## The build cache

LLVM's object files are kept in `<cache>/objects/<sha256>.o`, where
`<cache>` is `$ORE_CACHE`, else `$XDG_CACHE_HOME/ore`, else
`~/.cache/ore` (`ORE_CACHE=off` turns the cache off). The key is the SHA-256
of the IR and of what else decides the object: the `ore` executable (its
path, size and modification time, so that a rebuilt compiler never reuses
the objects of another), LLVM's version, the target triple, the CPU
(`ORE_CPU`) and the optimization level. A debug build looks up each of its
parts, a release build its one module; on a hit, LLVM does not run, and the
object is linked from the cache.

The parts of a debug build are those of its source files, and the emitter
names what they contain after what it is rather than after the order of the
whole program (`llvm/names.ore`), so that a part's text, and its key, change
only when its file does: editing a file recompiles that file's parts (and
part 0, with the globals, when they change), and the runtime's parts are
the same in every program, compiled once per compiler and target. Linking
and the steps before LLVM (loading, checking, emitting) run every time: on
a 16-core Linux machine, a debug build of the compiler takes 3.7 s, then
3.2 s (LLVM 0.5 s, then 0.02 s), hello world 0.28 s, then 0.21 s, and a
release build of the compiler 53 s, then 3.7 s.

Builds running at the same time share the cache: an object is written to a
temporary file of its own, then renamed. Nothing is removed but by `ore
cache clean`: each debug build of a changed program adds the objects of
its changed parts (the objects of a debug build of the compiler take about
6 MB, those of the runtime 0.4 MB), and a release build one object of the
whole program (3 MB for the compiler). `ore cache` prints the size.
