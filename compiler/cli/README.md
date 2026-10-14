# @ore/cli

The `ore` command (`main.ts`): `run`, `build`, `check`, `test`, `fmt`,
`init`, `lsp`, `version`. `bun run build` compiles it with the prebuilt GC
into the standalone binary `dist/ore`.

- `fmt.ts`: `ore fmt`, with prettier's TypeScript printer, 4 spaces.

Tests run the commands end to end: projects and package.json, `ore test`,
`ore fmt`, and the language server.
