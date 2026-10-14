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
 * Header comments, as in golden.test.ts:
 *   // reference: none, <why>   no Bun reference (tasks and channels, or where
 *                               Ore differs on purpose): the .out is written by hand
 *   // threads: 8               OS threads for tasks (default 1)
 *   // exit: 13                 expected exit status (default 0)
 *   // stderr: <text>           a substring of stderr (repeatable)
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

const dir = join(import.meta.dir, "../async")
const shim = join(dir, "bun-shim.ts")
const cases = readdirSync(dir).filter((f) => f.endsWith(".ore")).sort()
const work = mkdtempSync(join(tmpdir(), "ore-async-"))
const bless = process.env.ORE_BLESS === "1"

function header(text: string, key: string): string[] {
  return [...text.matchAll(new RegExp(`^// ${key}: (.*)$`, "gm"))].map((m) => m[1]!.trim())
}

async function run(cmd: string[], env: Record<string, string> = {}): Promise<{ code: number; out: string; err: string }> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", env: { ...process.env, ...env } })
  const [code, out, err] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  return { code, out, err }
}

describe("reference", () => {
  for (const file of cases) {
    const text = readFileSync(join(dir, file), "utf8")
    if (header(text, "reference")[0]?.startsWith("none")) continue
    test(file, async () => {
      // Bun reads TypeScript only from .ts files.
      const copy = join(work, file.replace(/\.ore$/, ".ts"))
      copyFileSync(join(dir, file), copy)
      const { code, out, err } = await run([process.execPath, "--preload", shim, copy])
      expect(err).toBe("")
      expect(code).toBe(0)
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
      const text = readFileSync(join(dir, file), "utf8")
      const { code, out, err } = await run([binary], { ORE_THREADS: header(text, "threads")[0] ?? "1" })
      expect(out).toBe(readFileSync(join(dir, file.replace(/\.ore$/, ".out")), "utf8"))
      expect(code).toBe(Number(header(text, "exit")[0] ?? 0))
      for (const part of header(text, "stderr")) expect(err).toContain(part)
    }, 30_000)
  }
})
