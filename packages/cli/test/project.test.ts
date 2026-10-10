import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const main = join(import.meta.dir, "../src/main.ts")

async function ore(args: string[], cwd: string) {
  const proc = Bun.spawn(["bun", main, ...args], { cwd, stdout: "pipe", stderr: "pipe" })
  const [code, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  return { code, stdout, stderr }
}

test("ore init creates a project that ore run builds from package.json", async () => {
  const dir = join(mkdtempSync(join(tmpdir(), "ore-cli-")), "My App")
  expect((await ore(["init", dir], tmpdir())).code).toBe(0)

  // A dependency installed by npm: a package with .ore files and a main.
  mkdirSync(join(dir, "node_modules/greet"), { recursive: true })
  writeFileSync(join(dir, "node_modules/greet/package.json"), JSON.stringify({ name: "greet", main: "lib.ore" }))
  writeFileSync(join(dir, "node_modules/greet/lib.ore"), 'export function hello(name: string): string {\n  return `hi ${name}`\n}\n')
  writeFileSync(join(dir, "src/main.ore"), 'import { hello } from "greet"\n\nexport function main() {\n  console.log(hello("ore"))\n}\n')

  const run = await ore(["run"], join(dir, "src"))
  expect(run.stderr).toBe("")
  expect(run.stdout).toBe("hi ore\n")
  expect((await ore(["init", dir], tmpdir())).code).toBe(2)
}, 20_000)

test("without a file or package.json, commands explain what to do", async () => {
  const result = await ore(["run"], mkdtempSync(join(tmpdir(), "ore-empty-")))
  expect(result.code).toBe(2)
  expect(result.stderr).toContain("give a .ore file, or run in a project")
}, 10_000)
