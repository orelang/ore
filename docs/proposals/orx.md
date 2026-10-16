# Proposal: `.orx` — JSX-like files rendering into a configurable factory

> Status: proposal, not implemented.

## Recommended approach: desugar in the parser (minimal blast radius)

An `.orx` file is parsed into **ordinary Ore AST**: `<div class="a">text{expr}</div>` is turned
directly by the parser into `CallExpression` / `ObjectLiteralExpression` / `ArrayLiteralExpression`
nodes — the same tree the text `x("div", { class: "a" }, ["text", expr])` would produce.
The factory `x` is imported from `ore:x` by default; the import is injected as a synthetic
`ImportDeclaration` at the top of the AST, which **the existing loader resolves on its own**
(it already scans statements for specifiers — `compiler/src/project/load.ore:142`).

Why this is the fastest path:

- **Checker, optimizer, LLVM backend, IR — zero changes.** They see an ordinary function call.
- **Spans stay natural**: the parser reads the original text, so diagnostics and the LSP
  point into the real `.orx` text (except for the synthetic nodes — see risks).
- No offset-remapping machinery like `project/json.ore`'s `place()` is needed — there the
  generated text differs in length from the source, here that problem does not exist at all.

Rejected alternative: real `JsxElement` AST kinds + lowering in the checker.
Semantically cleaner (fmt and the LSP would see JSX as-is), but it touches the parser, AST,
checker, fmt and LSP — many times more code. Contradicts the "minimal blood" requirement.

## Desugaring semantics (v1)

- `<div class="a" id={x} {...rest}>text{expr}<b/></div>`
  → `x("div", { class: "a", id: x, ...rest }, ["text", expr, x("b", {}, [])])`
- Always exactly 3 arguments: `tag: string`, `props`, `children` (empty ones: `{}` and `[]`).
  An empty object literal and `[]` are legal: the signature of `x` provides the context types
  (verified at `tests/run/collections/dictionaries.ore:30` and in the spec — `[]` requires a
  context type, and it is there).
- A tag is always a string. V1: plain identifiers only (no `foo.bar`), no calling
  function components by capitalization — document this.
- Attributes: `name="string"`, `name={expr}`, `{...expr}`. Attribute names are any
  identifiers, including keywords (`class`, `for` — as in TSX).
- Children: text (→ StringLiteral; trimmed at the edges, whitespace-only runs between tags
  are dropped), `{expr}` (the real expression node, checked as-is), nested elements, `<tag />`.
- Fragments `<></>` are **not supported in v1**, with a clear parser error.
- In `.orx`, a `<` in operand position starts JSX (as in TSX). Generic calls `f<T>(...)`
  do not break: they are parsed above `primary()` (`parser.ore:1331-1338`, the `speculate`
  backtracking already exists). The TSX limitation for generic arrows `<T>(x: T) => x`
  remains — document it.
- Config in package.json (extending the existing `ore` key, modeled on
  `jsxFactory`/`jsxImportSource`):
  ```json
  { "ore": { "link": [], "sources": [], "libDirs": [], "x": "h", "xImportSource": "preact" } }
  ```
  `ore.x` — the factory name (default `"x"`), `ore.xImportSource` — the module specifier
  (default `"ore:x"`). An empty string for `xImportSource` means the factory is resolved
  locally and no import is injected.

## Changes by file

### Core (~350 lines)

1. **`compiler/src/syntax/parser.ore`** — the whole feature:
   - A `jsx: bool` field and a factory-name field; a "saw JSX" flag (for the lazy import).
   - `primary()` (`parser.ore:1395`): `case "LessThanToken": if (this.jsx) return this.jsxElement(); break`.
     When `<` is not in operand position (comparisons), control never reaches here — no conflicts.
   - Methods `jsxElement()`, `jsxAttributes()`, `jsxChildren()` (~200 lines): build nodes
     following the existing code — `CallExpression` with `expression`/`arguments` roles
     (as in `parser.ore:1324`), `ObjectLiteralExpression` with `PropertyAssignment`
     (`name`/`initializer`) and `SpreadAssignment`, `ArrayLiteralExpression`.
   - Synthetic nodes: the factory `Identifier` (text = name, span at the `<`);
     `StringLiteral`s for the tag and text children — **set text with quotes and escaping**,
     because `stringValue()` expects raw quoted text (`compiler/src/syntax/imports.ore:51-62`);
     the span is still the real range of the tag/text.
   - Errors: `Unterminated JSX element`, `Expected corresponding JSX closing tag`, etc.
     Every message needs a code in `compiler/src/syntax/codes.ore` (the runner requires a
     code on every diagnostic, `tests/runner/golden.ore:180`).

2. **`compiler/src/syntax/parse.ore`** — `parse(path, text, options?)`:
   pass the options to the parser; after `parseSourceFile()`, if the file is `.orx`, contained
   JSX, and an `xImportSource` is set — prepend a synthetic `ImportDeclaration`:
   `import { x } from "<xImportSource>"`, with the child structure mirroring a parsed import
   (`ImportClause` → `NamedImports` → `ImportSpecifier`, `moduleSpecifier`).
   Span 0..0, inserted **after** any leading directives. If the module already explicitly
   imports `{x}` from that source — do not duplicate it.

3. **`compiler/src/project/load.ore`** — config reading:
   a `Map<package root, XConfig>` cache in `Loader`; in `parse()` when `path.endsWith(".orx")`:
   `findPackageRoot(dirname(path))` + `readPackageJson` → `{ name: ore.x ?? "x",
   source: ore.xImportSource ?? "ore:x" }`. package.json is already part of `programFiles`
   (`load.ore:47-48`), so the build cache is invalidated automatically when the config changes.

4. **`compiler/src/project/resolve.ore`**:
   - `PackageJson`/`NativeConfig`: add fields `x: string | null` and `xImportSource: string | null`.
     Safe for existing package.json files: the JSON decoder yields `null` for a missing field
     when the type includes `null` (`compiler/src/llvm/json.ore:1077-1084`); without `null`
     in the type it errors with `missing field` (same function, branch `:1083`).
   - `resolveFile()` (`:209-215`): after `x.ore` try `x.orx`, and `index.orx` for directories.
     This also enables importing `.orx` modules from ordinary `.ore` files.
   - Register the new stdlib module: `import xModule from "../../../runtime/std/x.ore"
     with { type: "text" }` + `stdModules.set("ore:x", xModule)` (following `:49-61`).

5. **`runtime/std/x.ore`** (new, ~15 lines) — the default factory:
   ```ts
   // ore:x — the default factory of .orx files.
   export interface XNode {
       tag: string
       props: Record<string, unknown> | null
       children: unknown[]
   }
   export function x(tag: string, props: Record<string, unknown> | null, children: unknown[]): XNode {
       return { tag, props, children }
   }
   ```
   (`unknown` exists in the language, `docs/spec/02-types.md:579`; dictionaries — `Record<string, V>`.)

### Extension touch points (mostly one-liners)

6. **`compiler/src/cli/commands.ore:31,33,46,140`** — the entry accepts `.orx`
   (`endsWith(".ore")` does not match `foo.orx`!), basename for the binary name.
7. **`compiler/src/driver/build.ore:114`** — the `.ll` file name: `basename(entry, ".ore")` → handle both suffixes.
8. **`compiler/src/cli/files.ore:26`** — discovery for `check`/`test`: add `.orx`.
   **Do not add fmt**: fmt reprints the AST, and the AST of `.orx` is calls — it would "destroy" the JSX.
9. **LSP**: `compiler/src/lsp/server.ore:927` (discovery) and `compiler/src/lsp/analysis.ore:903-907`
   (module name from basename) — handle `.orx`.
10. **Editors**: `editors/vscode/package.json` (`contributes.languages[0].extensions` += `.orx`),
    `editors/zed/languages/ore/config.toml` (`path_suffixes` += `"orx"`). V1 limitation:
    JSX highlighting will not appear (the grammar wraps TS, not TSX) — document this.

### Tests and documentation

11. **Tests**:
    - `tests/run/functions/jsx/` — `main.ore` (ordinary one, which also exercises importing `.orx`
      from `.ore`), `view.orx` (JSX: attributes, spreads, nesting, `{expr}`, self-closing),
      `main.out`. No runner changes needed: a case directory with `main.ore` is already supported
      (`tests/runner/cases.ore:36`), the `.out` is looked up next to it (`golden.ore:83`).
    - Unit tests for the desugaring and parser errors in `compiler/test/parse.test.ore`
      (or a new `compiler/test/jsx.test.ore`) — the `ore:test` format.
    - A custom-config test: a small program in `tests/run/` with its own package.json
      (`ore.xImportSource` → a local factory module).
    - Run: `ci/bootstrap.sh` (self-build, 3 stages) → `ci/test.sh`.
      Note: the fmt runner checks the formatting of every `.ore` file — `runtime/std/x.ore`
      and any new `.ore` files must be formatted.

12. **Documentation**:
    - `docs/spec/01-programs.md:5` (the `.ore` extension → add `.orx`) + a new spec section:
      syntax, desugaring rules, the `ore.x`/`ore.xImportSource` config, v1 limitations.
    - `docs/spec/11-standard-modules.md` — the `ore:x` row.
    - `CHANGELOG.md`.

## Estimate

- ~500–700 lines of new/changed code, of which ~250 are the JSX parser; the rest is option
  plumbing, config, extension touch points, tests.
- Layers with no changes: lexer (JSX reads fine with existing tokens), checker, IR, opt, LLVM, fmt.
- Risks and v1 limitations:
  - The synthetic import (span 0..0) and the synthetic callee: go-to-definition/hover on `<`
    in the LSP will point at the import/factory "at zero width" — cosmetic.
  - A user-defined local `x` with the default config → duplicate declaration error; mitigation:
    skip the injection when the same name is explicitly imported (item 2).
  - `children: unknown[]` in the default `x` — no strict typing of children; it can be tightened
    later (a generic `XChild`) without breaking the desugaring ABI.
  - fmt does not process `.orx` (in v1 this is a safeguard, not a defect).
