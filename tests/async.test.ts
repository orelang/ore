/**
 * Asynchronous code: promises, async/await, timers and microtasks.
 *
 * tests/async/NAME.ore is a program whose expected output NAME.out is the
 * output of the same file run by Bun, with tests/async/bun-shim.ts providing
 * Ore's `time` and `task.microtask` on top of Web APIs: the order of
 * microtasks and timers must be JavaScript's.
 *
 * "reference" checks each .out against Bun; "ore" runs the program built by
 * Ore against it.
 *
 * ORE_BLESS=1 bun test tests/async.test.ts   rewrites the .out files from Bun.
 */
import { build } from "@ore/driver"
import { describe, expect, test } from "bun:test"
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/** Whether Ore implements async yet; until then only the references are checked. */
const implemented = false

const dir = join(import.meta.dir, "async")
const shim = join(dir, "bun-shim.ts")
const cases = readdirSync(dir).filter((f) => f.endsWith(".ore")).sort()
const work = mkdtempSync(join(tmpdir(), "ore-async-"))
const bless = process.env.ORE_BLESS === "1"

async function stdout(cmd: string[]): Promise<string> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" })
  const [code, out, err] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  if (code !== 0) throw new Error(`${cmd.join(" ")} exited with ${code}: ${err}`)
  return out
}

describe("reference", () => {
  for (const file of cases) {
    test(file, async () => {
      // Bun reads TypeScript only from .ts files.
      const copy = join(work, file.replace(/\.ore$/, ".ts"))
      copyFileSync(join(dir, file), copy)
      const out = await stdout([process.execPath, "--preload", shim, copy])
      const expected = join(dir, file.replace(/\.ore$/, ".out"))
      if (bless) writeFileSync(expected, out)
      expect(out).toBe(readFileSync(expected, "utf8"))
    })
  }
})

describe("ore", () => {
  for (const file of cases) {
    ;(implemented ? test : test.skip)(file, async () => {
      const binary = join(work, file.replace(/\.ore$/, ""))
      const result = await build(join(dir, file), { output: binary })
      expect(result.diagnostics.map((d) => d.message)).toEqual([])
      const out = await stdout([binary])
      expect(out).toBe(readFileSync(join(dir, file.replace(/\.ore$/, ".out")), "utf8"))
    }, 30_000)
  }
})
