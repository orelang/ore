# @ore/cli

The `ore` command (`main.ts`): `run`, `build`, `check`, `test`, `fmt`,
`init`, `lsp`, `version`, of the bootstrap compiler in TypeScript, run as
`bun run ore`. `dist/ore` is the same command written in Ore
(`compiler/next/src/cli/`), which `bun run build` builds with this one.

- `fmt.ts`: `ore fmt`, with prettier's TypeScript printer, 4 spaces.

Tests run the commands end to end: projects and package.json, `ore test`,
`ore fmt`, and the language server.
