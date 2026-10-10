/**
 * Golden tests.
 *
 * tests/run/NAME.ore   is built and run; stdout must equal NAME.out.
 *                      A directory tests/run/NAME/ is a program of several
 *                      modules with entry main.ore and output main.out.
 *                      Header comments set other expectations:
 *                        // exit: 2
 *                        // stderr: panic: integer divide by zero   (substring, repeatable)
 * tests/diag/NAME.ore  must fail to check; every diagnostic must sit on a line
 *                      annotated with `// error: <substring of the message>`,
 *                      and every annotation must be matched. A directory
 *                      tests/diag/NAME/ is checked from main.ore, with
 *                      annotations in any of its modules.
 *
 * ORE_BLESS=1 bun test tests   rewrites the .out files from actual output.
 */
import { build } from "@ore/driver"
import { check } from "@ore/checker"
import { loadProgram } from "@ore/project"
import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const bless = process.env.ORE_BLESS === "1"

/** Test entry files: NAME.ore, or NAME/main.ore for a program of several modules. */
function cases(dir: string): string[] {
  const root = join(import.meta.dir, dir)
  return readdirSync(root)
    .flatMap((f) => (f.endsWith(".ore") ? [f] : existsSync(join(root, f, "main.ore")) ? [join(f, "main.ore")] : []))
    .sort()
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
      const output = join(work, file.replace(/\.ore$/, "").replaceAll("/", "_"))
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
      for (const [, line] of text.matchAll(/^\/\/ stderr: (.*)$/gm)) expect(stderr).toContain(line!.trim())
    })
  }
})

describe("diag", () => {
  for (const file of cases("diag")) {
    test(file, async () => {
      const path = join(import.meta.dir, "diag", file)
      const program = loadProgram(path)
      const diagnostics = program.syntaxErrors ? program.diagnostics : [...program.diagnostics, ...check(program).diagnostics]

      // Annotations by module and line, in every module of the program.
      const expected = new Map<string, string[]>()
      for (const source of program.modules) {
        source.text.split("\n").forEach((line, i) => {
          const m = line.match(/\/\/ error: (.*)$/)
          const key = `${source.path}:${i}`
          if (m) expected.set(key, [...(expected.get(key) ?? []), m[1]!.trim()])
        })
      }
      expect(expected.size).toBeGreaterThan(0)

      const unexpected: string[] = []
      for (const d of diagnostics) {
        const { line } = d.source.position(d.start)
        const key = `${d.source.path}:${line}`
        const annotations = expected.get(key) ?? []
        const index = annotations.findIndex((a) => d.message.includes(a))
        if (index === -1) unexpected.push(`${d.source.path.split("/").pop()}:${line + 1}: ${d.message}`)
        else annotations.splice(index, 1)
      }
      const missing = [...expected].flatMap(([key, rest]) => rest.map((a) => `${key.split("/").pop()}: ${a}`))
      expect({ unexpected, missing }).toEqual({ unexpected: [], missing: [] })
    })
  }
})
