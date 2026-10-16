# Documentation

| Document | Contents |
|---|---|
| [spec](spec/README.md) | The language specification, by chapter |
| [errors](errors/README.md) | A page for each diagnostic code (`ORE1001`...), linked from the compiler and the language server |
| [architecture.md](architecture.md) | Principles, the compiler pipeline, the runtime, testing |
| [environment.md](environment.md) | The environment variables of programs and of `ore` |
| [roadmap.md](roadmap.md) | What comes next, in order |
| [assets](assets) | The banner and the brand's colors (`banner.html`), rendered to `banner.png` by `render.sh` |

Elsewhere in the repository: the [README](../README.md) is the overview and
the tour of the language, the [changelog](../CHANGELOG.md) lists changes by
release, and the READMEs of [`compiler`](../compiler/README.md),
[`runtime`](../runtime/README.md) and [`bench`](../bench/README.md)
describe their parts.

## Writing the documentation

- The project is "Ore", its organization and packages "orelang".
- Headings are in sentence case: `## Modules from GitHub`.
- File names are lowercase-kebab-case (`architecture.md`,
  `07-modules.md`), except `README.md`, `CHANGELOG.md` and the pages of
  diagnostics, `errors/OREnnnn.md`, which the compiler links to by their
  code and which must not be renamed.
- Chapters of the specification are numbered (`NN-name.md`); a new chapter
  takes the next number.
- Code blocks name their language: `ts` for Ore, `sh` for commands,
  `console` for a terminal session with its output, `json` for JSON and
  `text` for other output and diagrams.
- Links between documents are relative and must resolve, anchors included.
- The prose is plain English: what a feature does and how it differs from
  TypeScript or JavaScript, without marketing.
- In the names of the standard library, only a class or a type is
  capitalized, at most one part of a path (`process.Child`,
  `time.FormatOptions`); namespaces, functions, methods and fields are
  lowercase (`process.command.run`). JavaScript's own globals keep their
  names (`Map.groupBy`, `Number.MAX_SAFE_INTEGER`, `JSON.parse`).
