import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const main = join(import.meta.dir, "../src/main.ts")

test("ore test runs test files, isolates failures and reports them", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ore-test-cmd-"))
  mkdirSync(join(dir, "src"))
  writeFileSync(join(dir, "src/math.ore"), "export function div(a: int, b: int): int {\n  return a / b\n}\n")
  writeFileSync(
    join(dir, "src/math.test.ore"),
    [
      'import { test, expect } from "ore:test"',
      'import { div } from "./math"',
      'test("divides", () => {\n  expect(div(6, 3)).toBe(2)\n})',
      'test("wrong", () => {\n  expect(div(6, 3)).toBe(3)\n})',
      'test("panics", () => {\n  div(1, 0)\n})',
      'test("still runs", () => {\n  expect(true).toBe(true)\n})',
    ].join("\n"),
  )
  const proc = Bun.spawn(["bun", main, "test"], { cwd: dir, stdout: "pipe", stderr: "pipe" })
  const [code, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()])
  expect(code).toBe(1)
  expect(stdout).toContain("✓ divides")
  expect(stdout).toContain("✗ wrong\n      expected 3, got 2")
  expect(stdout).toContain("✗ panics\n      integer divide by zero")
  expect(stdout).toContain("✓ still runs")
  expect(stdout).toContain("2 passed, 2 failed")
}, 20_000)
