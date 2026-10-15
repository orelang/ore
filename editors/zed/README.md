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

## Install

Each release of Ore has this extension as `ore-zed-vX.Y.Z.zip` (from
[the releases](https://github.com/orelang/ore/releases)):

1. Unzip it; it unpacks into a directory `ore-zed-vX.Y.Z`. Keep that
   directory: Zed loads the extension from it.
2. In Zed, run `zed: install dev extension` (from the command palette, or the
   Extensions page) and pick that directory.

Zed builds `src/` to WebAssembly itself, so Rust must be installed with
[rustup](https://rustup.rs) (Zed adds the `wasm32-wasip2` target it
needs). From a clone of the repository, pick `editors/zed` instead. The
language server is `ore lsp`, so `ore` must be on `PATH`, or set
`lsp.ore.binary.path` in Zed's settings.

## License

Since its queries come from Zed, which licenses them under the GNU GPL,
version 3 or later, this extension (the `editors/zed` directory) is
licensed under the [GPL-3.0-or-later](LICENSE-GPL). The rest of Ore is
licensed under MIT OR Apache-2.0 (see the [README](../../README.md#license)).
