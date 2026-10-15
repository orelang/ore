# Ore for Zed

Ore files use Zed's TypeScript tree-sitter grammar, since the syntax is the
same. The queries in `languages/ore` (highlights, brackets, indents,
outline, injections, text objects, overrides) are Zed's own TypeScript
queries, copied unchanged from
[`crates/grammars/src/typescript`](https://github.com/zed-industries/zed/tree/7fa2adbe088c8feb3173aec4fc5f8ac0fc153f31/crates/grammars/src/typescript)
of zed-industries/zed at `7fa2adbe`, so that Ore looks exactly like
TypeScript; to update them, copy them again from a newer commit.
`src/lib.rs` starts `ore lsp` for diagnostics, hover, definitions,
references, rename and completion.

Install: in Zed, `zed: install dev extension` and pick this directory.

## License

Since its queries come from Zed, which licenses them under the GNU GPL,
version 3 or later, this extension (the `editors/zed` directory) is
licensed under the [GPL-3.0-or-later](LICENSE-GPL). The rest of Ore is
licensed under MIT OR Apache-2.0 (see the [README](../../README.md#license)).
