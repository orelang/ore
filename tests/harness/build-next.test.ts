/**
 * Programs built by the compiler in Ore, which calls LLVM's C API and links
 * with lld instead of running clang: every program of tests/run with an
 * expected output (as golden.test.ts finds them) is built in debug mode and
 * run, and its output, exit status and stderr must match the expectations.
 *
 * The LLVM IR comes from @ore/codegen (`compileToIr`), and `ore-next object`
 * turns it, with the C sources and libraries of the program's packages, into
 * an executable. The time ore-next takes is printed at the end.
 */
import { build, compileToIr } from "@ore/driver"
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"

const root = join(import.meta.dir, "../..")
const work = mkdtempSync(join(tmpdir(), "ore-build-next-"))
const binary = join(work, "ore-next")
process.on("exit", () => rmSync(work, { recursive: true, force: true }))

/** Entry files of programs: NAME.ore, or NAME/main.ore for a program of several modules. */
function entries(dir: string): string[] {
  return readdirSync(dir)
    .flatMap((name) => {
      const path = join(dir, name)
      if (name.endsWith(".ore")) return [path]
      if (!statSync(path).isDirectory()) return []
      return existsSync(join(path, "main.ore")) ? [join(path, "main.ore")] : entries(path)
    })
    .sort()
}

function header(text: string, key: string): string | undefined {
  return text.match(new RegExp(`^// ${key}: (.*)$`, "m"))?.[1]?.trim()
}

async function spawn(args: string[], env: Record<string, string> = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe", env: { ...process.env, ...env } })
  const [code, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  return { code, stdout, stderr }
}

beforeAll(async () => {
  const result = await build(join(root, "compiler/next/src/main.ore"), { output: binary })
  expect(result.diagnostics.map((d) => d.message)).toEqual([])
}, 120_000)

let buildTime = 0
let built = 0
afterAll(() => {
  if (built > 0) console.log(`ore-next built ${built} programs in ${(buildTime / 1000).toFixed(1)} s (${Math.round(buildTime / built)} ms each)`)
})

describe("ore-next object", () => {
  for (const path of entries(join(root, "tests/run"))) {
    const name = relative(join(root, "tests/run"), path)
    test(name, async () => {
      const text = await Bun.file(path).text()
      const compiled = compileToIr(path, { debug: true })
      expect(compiled.diagnostics.map((d) => d.message)).toEqual([])
      const base = join(work, name.replace(/\.ore$/, "").replaceAll("/", "_"))
      writeFileSync(`${base}.ll`, compiled.ir!)
      const native = compiled.native!
      const args = [binary, "object", `${base}.ll`, ...native.sources, "-o", base]
      for (const dir of native.libDirs) args.push("-L", dir)
      for (const lib of native.link) args.push("-l", lib)
      const started = performance.now()
      const result = await spawn(args)
      buildTime += performance.now() - started
      built++
      expect(result.stderr).toBe("")
      expect(result.code).toBe(0)

      const run = await spawn([base], { ORE_THREADS: header(text, "threads") ?? "1" })
      expect(run.stdout).toBe(await Bun.file(path.replace(/\.ore$/, ".out")).text())
      expect(run.code).toBe(Number(header(text, "exit") ?? 0))
      for (const [, line] of text.matchAll(/^\/\/ stderr: (.*)$/gm)) expect(run.stderr).toContain(line!.trim())
    }, 60_000)
  }
})
