import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadProgram, resolveImport } from "../src"

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "ore-project-"))
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  return root
}

test("resolves relative paths, index files and packages", () => {
  const root = project({
    "src/main.ore": "",
    "src/util.ore": "",
    "src/lib/index.ore": "",
    "node_modules/geo/package.json": JSON.stringify({ name: "geo", main: "src/geo.ore" }),
    "node_modules/geo/src/geo.ore": "",
    "node_modules/geo/src/extra.ore": "",
    "node_modules/@acme/tools/index.ore": "",
  })
  const from = join(root, "src/main.ore")
  expect(resolveImport("./util", from)).toBe(join(root, "src/util.ore"))
  expect(resolveImport("./util.ore", from)).toBe(join(root, "src/util.ore"))
  expect(resolveImport("./lib", from)).toBe(join(root, "src/lib/index.ore"))
  expect(resolveImport("geo", from)).toBe(join(root, "node_modules/geo/src/geo.ore"))
  expect(resolveImport("geo/src/extra", from)).toBe(join(root, "node_modules/geo/src/extra.ore"))
  expect(resolveImport("@acme/tools", from)).toBe(join(root, "node_modules/@acme/tools/index.ore"))
  expect(resolveImport("./missing", from)).toBeUndefined()
})

test("loads modules dependencies first and reports missing modules", () => {
  const root = project({
    "main.ore": 'import { a } from "./a"\nimport { b } from "./b"\nimport { c } from "./nope"\n',
    "a.ore": 'import { b } from "./b"\n',
    "b.ore": 'import { a } from "./a"\n',
  })
  const program = loadProgram(join(root, "main.ore"))
  expect(program.modules.map((m) => m.path.split("/").pop())).toEqual(["frames", "string", "array", "map", "format", "float-tables", "float", "json", "number", "b.ore", "a.ore", "main.ore"])
  expect(program.diagnostics.map((d) => d.message)).toEqual(["Cannot find module './nope'."])
})

test("uses overridden texts", () => {
  const root = project({ "main.ore": "" })
  const program = loadProgram(join(root, "main.ore"), { overrides: new Map([[join(root, "main.ore"), "export function main() {}"]]) })
  expect(program.entry.ast.statements.length).toBe(1)
})
