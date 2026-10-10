/**
 * Golden tests.
 *
 * tests/run/NAME.ore   is built and run; stdout must equal NAME.out.
 *                      Header comments set other expectations:
 *                        // exit: 2
 *                        // stderr: panic: integer divide by zero   (substring)
 * tests/diag/NAME.ore  must fail to check; every diagnostic must sit on a line
 *                      annotated with `// error: <substring of the message>`,
 *                      and every annotation must be matched.
 *
 * ORE_BLESS=1 bun test tests   rewrites the .out files from actual output.
 */
import { build } from "@ore/driver"
import { check } from "@ore/checker"
import { parse } from "@ore/syntax"
import { describe, expect, test } from "bun:test"
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const bless = process.env.ORE_BLESS === "1"

function cases(dir: string): string[] {
  return readdirSync(join(import.meta.dir, dir)).filter((f) => f.endsWith(".ore")).sort()
}

function header(text: string, key: string): string | undefined {
  return text.match(new RegExp(`^// ${key}: (.*)$`, "m"))?.[1]?.trim()
}

describe("run", () => {
  const work = mkdtempSync(join(tmpdir(), "ore-golden-"))
  process.on("exit", () => rmSync(work, { recursive: true, force: true }))

  for (const file of cases("run")) {
    test(file, async () => {
      const path = join(import.meta.dir, "run", file)
      const text = await Bun.file(path).text()
      const output = join(work, file.replace(/\.ore$/, ""))
      const result = await build(path, { output })
      expect(result.diagnostics.map((d) => d.message)).toEqual([])

      const proc = Bun.spawn([output], { stdout: "pipe", stderr: "pipe" })
      const [code, stdout, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ])
      const outPath = path.replace(/\.ore$/, ".out")
      if (bless) writeFileSync(outPath, stdout)
      expect(stdout).toBe(await Bun.file(outPath).text())
      expect(code).toBe(Number(header(text, "exit") ?? 0))
      const expectedStderr = header(text, "stderr")
      if (expectedStderr) expect(stderr).toContain(expectedStderr)
    })
  }
})

describe("diag", () => {
  for (const file of cases("diag")) {
    test(file, async () => {
      const path = join(import.meta.dir, "diag", file)
      const text = await Bun.file(path).text()
      const parsed = parse(file, text)
      const diagnostics = parsed.diagnostics.length > 0 ? parsed.diagnostics : check(parsed.source).diagnostics

      const expected = new Map<number, string[]>()
      text.split("\n").forEach((line, i) => {
        const m = line.match(/\/\/ error: (.*)$/)
        if (m) expected.set(i, [...(expected.get(i) ?? []), m[1]!.trim()])
      })
      expect(expected.size).toBeGreaterThan(0)

      const unexpected: string[] = []
      for (const d of diagnostics) {
        const { line } = parsed.source.position(d.start)
        const annotations = expected.get(line) ?? []
        const index = annotations.findIndex((a) => d.message.includes(a))
        if (index === -1) unexpected.push(`${line + 1}: ${d.message}`)
        else annotations.splice(index, 1)
      }
      const missing = [...expected].flatMap(([line, rest]) => rest.map((a) => `${line + 1}: ${a}`))
      expect({ unexpected, missing }).toEqual({ unexpected: [], missing: [] })
    })
  }
})
