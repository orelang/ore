/**
 * Programs built by the compiler in Ore, which calls LLVM's C API and links
 * with lld instead of running clang: every program of tests/run with an
 * expected output (as golden.test.ts finds them) is built in debug mode by
 * `ore-next build` and run, and its output, exit status and stderr must match
 * the expectations. The time ore-next takes is printed at the end.
 *
 * `ore-next object` builds an executable from LLVM IR, here from
 * @ore/codegen's, with the C sources and libraries given on its command line.
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

/** Runs a program built from a test, and checks its output, status and stderr against the test's expectations. */
async function expectRun(path: string, executable: string): Promise<void> {
  const text = await Bun.file(path).text()
  const run = await spawn([executable], { ORE_THREADS: header(text, "threads") ?? "1" })
  expect(run.stdout).toBe(await Bun.file(path.replace(/\.ore$/, ".out")).text())
  expect(run.code).toBe(Number(header(text, "exit") ?? 0))
  for (const [, line] of text.matchAll(/^\/\/ stderr: (.*)$/gm)) expect(run.stderr).toContain(line!.trim())
}

beforeAll(async () => {
  const result = await build(join(root, "compiler/next/src/main.ore"), { output: binary })
  expect(result.diagnostics.map((d) => d.message)).toEqual([])
}, 120_000)

let buildTime = 0
let built = 0
afterAll(() => {
  if (built > 0) console.log(`ore-next built ${built} programs in ${(buildTime / 1000).toFixed(1)} s (${Math.round(buildTime / built)} ms each, a debug build of ore-next)`)
})

describe("ore-next build", () => {
  for (const path of entries(join(root, "tests/run"))) {
    const name = relative(join(root, "tests/run"), path)
    test(name, async () => {
      const output = join(work, name.replace(/\.ore$/, "").replaceAll("/", "_"))
      const started = performance.now()
      const result = await spawn([binary, "build", relative(process.cwd(), path), "-o", output])
      buildTime += performance.now() - started
      built++
      expect(result.stderr).toBe("")
      expect(result.code).toBe(0)
      await expectRun(path, output)
    }, 60_000)
  }
})

test("ore-next object", async () => {
  const path = join(root, "tests/run/modules/ffi/main.ore")
  const compiled = compileToIr(path, { debug: true })
  expect(compiled.diagnostics.map((d) => d.message)).toEqual([])
  const output = join(work, "object-ffi")
  writeFileSync(`${output}.ll`, compiled.ir!)
  const result = await spawn([binary, "object", `${output}.ll`, ...compiled.native!.sources, "-o", output, "-l", "m", "-L", "/usr/lib", "--release"])
  expect(result).toEqual({ code: 0, stdout: "", stderr: "" })
  await expectRun(path, output)

  writeFileSync(`${output}-bad.ll`, "define i32 @main() {\n  ret i64 0\n}\n")
  const bad = await spawn([binary, "object", `${output}-bad.ll`, "-o", output])
  expect(bad.code).toBe(1)
  expect(bad.stderr).toContain(`invalid LLVM IR: ${output}-bad.ll:2:7: error:`)
}, 60_000)
