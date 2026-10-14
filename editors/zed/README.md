# Ore for Zed

Ore files use Zed's TypeScript tree-sitter grammar, since the syntax is the
same; the queries in `languages/ore` add highlighting, brackets, indentation
and the outline. `src/lib.rs` starts `ore lsp` for diagnostics, hover,
definitions, references, rename and completion.

[`tests/harness/zed-queries.test.ts`](../../tests/harness/zed-queries.test.ts)
checks that the queries compile against the grammar.

Install: in Zed, `zed: install dev extension` and pick this directory.
