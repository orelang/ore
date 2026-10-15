/**
 * The `ore` command of the compiler written in Ore (compiler/next/src/cli/),
 * driven as a user would: the behaviors of compiler/cli/test/*.test.ts
 * (init, run from package.json with an installed dependency, the message
 * without a program, test, fmt), and the flags, messages and exit statuses
 * of build, check, fmt and the unknown command. The language server has its
 * own test, lsp-next.test.ts.
 *
 * TODO: port to an Ore test file once `ore test` can drive programs this way
 * (the Ore test runner of tests/run and tests/diag).
 */
import { beforeAll, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { oreNext } from "./ore-next"

const root = join(import.meta.dir, "../..")
/** The compiler in Ore, shared by the test files (./ore-next.ts). */
let binary = ""

beforeAll(async () => {
  binary = await oreNext()
}, 900_000)

async function ore(args: string[], cwd: string) {
  const proc = Bun.spawn([binary, ...args], { cwd, stdout: "pipe", stderr: "pipe" })
  const [code, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  return { code, stdout, stderr }
}

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "ore-cli-next-"))
}

test("ore init creates a project that ore run builds from package.json", async () => {
  const dir = join(scratch(), "My App")
  const init = await ore(["init", dir], tmpdir())
  expect(init.code).toBe(0)
  expect(init.stdout).toBe(`Created my-app in ${dir}. Run it with 'ore run'.\n`)
  expect(JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))).toEqual({ name: "my-app", version: "0.1.0", private: true, main: "src/main.ore" })
  expect((await ore(["run"], dir)).stdout).toBe("hello, my-app\n")

  // A dependency installed by npm: a package with .ore files and a main.
  mkdirSync(join(dir, "node_modules/greet"), { recursive: true })
  writeFileSync(join(dir, "node_modules/greet/package.json"), JSON.stringify({ name: "greet", main: "lib.ore" }))
  writeFileSync(join(dir, "node_modules/greet/lib.ore"), "export function hello(name: string): string {\n  return `hi ${name}`\n}\n")
  writeFileSync(join(dir, "src/main.ore"), 'import { hello } from "greet"\n\nconsole.log(hello("ore"))\n')

  const run = await ore(["run"], join(dir, "src"))
  expect(run.stderr).toBe("")
  expect(run.stdout).toBe("hi ore\n")
  const again = await ore(["init", dir], tmpdir())
  expect(again.code).toBe(2)
  expect(again.stderr).toBe(`ore: ${join(dir, "package.json")} already exists\n`)
}, 30_000)

test("without a file or package.json, commands explain what to do", async () => {
  for (const command of ["run", "build", "check"]) {
    const result = await ore([command], scratch())
    expect(result.code).toBe(2)
    expect(result.stderr).toBe("ore: give a .ore file, or run in a project whose package.json has a 'main' (see 'ore init')\n")
  }
}, 10_000)

test("ore run forwards the arguments, the output and the exit status", async () => {
  const dir = scratch()
  writeFileSync(join(dir, "args.ore"), 'console.log(process.args.join("|"))\nconsole.error("to stderr")\nprocess.exit(7)\n')
  expect(await ore(["run", "args.ore", "a", "b c"], dir)).toEqual({ code: 7, stdout: "a|b c\n", stderr: "to stderr\n" })
}, 10_000)

test("ore build and ore check report errors with status 1, and command line errors with 2", async () => {
  const dir = scratch()
  writeFileSync(join(dir, "ok.ore"), 'console.log("ok")\n')
  writeFileSync(join(dir, "bad.ore"), "let x: u8 = 300\n")
  const diagnostic = "bad.ore:1:13: error: Constant 300 overflows 'u8' (range 0..255).\n  let x: u8 = 300\n              ^^^\n"
  expect(await ore(["check", "bad.ore"], dir)).toEqual({ code: 1, stdout: "", stderr: diagnostic })
  expect(await ore(["build", "bad.ore"], dir)).toEqual({ code: 1, stdout: "", stderr: diagnostic })
  expect(await ore(["run", "bad.ore"], dir)).toEqual({ code: 1, stdout: "", stderr: diagnostic })
  // A directory: each program in it, each diagnostic once.
  expect(await ore(["check", "."], dir)).toEqual({ code: 1, stdout: "", stderr: diagnostic })
  expect(await ore(["check", "ok.ore"], dir)).toEqual({ code: 0, stdout: "", stderr: "" })

  expect(await ore(["build", "ok.ore", "-o", "out", "--emit-llvm", "ok.ll"], dir)).toEqual({ code: 0, stdout: "", stderr: "" })
  expect(existsSync(join(dir, "ok.ll"))).toBe(true)
  expect((await Bun.$`${join(dir, "out")}`.text())).toBe("ok\n")
  expect((await ore(["build", "ok.ore"], dir)).code).toBe(0)
  expect(existsSync(join(dir, "ok"))).toBe(true)

  expect(await ore(["build", "ok.ore", "--fast"], dir)).toEqual({ code: 2, stdout: "", stderr: "ore: unknown option '--fast'\n" })
  expect(await ore(["build", "ok.ore", "-o"], dir)).toEqual({ code: 2, stdout: "", stderr: "ore: option -o needs a value\n" })
  expect(await ore(["build", "ok.ore", "extra"], dir)).toEqual({ code: 2, stdout: "", stderr: "ore: unexpected arguments: extra\n" })
  const missing = await ore(["build", "missing.ore"], dir)
  expect(missing.code).toBe(1)
  expect(missing.stderr).toStartWith("ore: ")
}, 30_000)

test("ore test runs test files, isolates failures and reports them", async () => {
  const dir = scratch()
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
  writeFileSync(join(dir, "src/ok.test.ore"), 'import { test, expect } from "ore:test"\ntest("passes", () => {\n  expect(1).toBe(1)\n})\n')
  // Skipped: dependencies and hidden directories.
  mkdirSync(join(dir, "node_modules/dep"), { recursive: true })
  writeFileSync(join(dir, "node_modules/dep/x.test.ore"), "process.exit(1)\n")
  mkdirSync(join(dir, ".hidden"))
  writeFileSync(join(dir, ".hidden/x.test.ore"), "process.exit(1)\n")

  const { code, stdout } = await ore(["test"], dir)
  expect(code).toBe(1)
  expect(stdout).toContain("src/math.test.ore\n  ✓ divides")
  expect(stdout).toContain("✗ wrong\n      expected 3, got 2")
  expect(stdout).toContain("✗ panics\n      integer divide by zero")
  expect(stdout).toContain("✓ still runs")
  expect(stdout).toContain("2 passed, 2 failed")
  expect(stdout).toContain("src/ok.test.ore\n  ✓ passes\n\n1 passed, 0 failed\n")
  expect(stdout).toEndWith("\n1 of 2 test file(s) failed.\n")
  expect(stdout.indexOf("src/math.test.ore")).toBeLessThan(stdout.indexOf("src/ok.test.ore"))

  expect(await ore(["test", "src/ok.test.ore"], dir)).toMatchObject({ code: 0, stdout: expect.stringContaining("All 1 test file(s) passed.") })
  mkdirSync(join(dir, "empty"))
  expect(await ore(["test", "empty"], dir)).toEqual({ code: 1, stdout: "", stderr: "ore: no *.test.ore files found\n" })
}, 30_000)

test("ore fmt formats in the one Ore style, in place or with --check", async () => {
  const dir = scratch()
  const unformatted = "export function main(){ const xs=[1,2];for(const x of xs){console.log( x*2 );} }\n"
  const formatted = ["export function main() {", "    const xs = [1, 2]", "    for (const x of xs) {", "        console.log(x * 2)", "    }", "}", ""].join("\n")
  writeFileSync(join(dir, "a.ore"), unformatted)
  // Ore-specific code such as using and declare stays.
  writeFileSync(join(dir, "b.ore"), "declare function strlen(s: string): u64\nusing r = open()\n")

  expect(await ore(["fmt", "--stdout", "a.ore"], dir)).toEqual({ code: 0, stdout: formatted, stderr: "" })
  expect(await ore(["fmt", "--check"], dir)).toEqual({ code: 1, stdout: "a.ore\n", stderr: "" })
  expect(await ore(["fmt"], dir)).toEqual({ code: 0, stdout: "", stderr: "" })
  expect(readFileSync(join(dir, "a.ore"), "utf8")).toBe(formatted)
  expect(readFileSync(join(dir, "b.ore"), "utf8")).toBe("declare function strlen(s: string): u64\nusing r = open()\n")
  expect(await ore(["fmt", "--check", "."], dir)).toEqual({ code: 0, stdout: "", stderr: "" })

  writeFileSync(join(dir, "broken.ore"), "function (\n")
  const broken = await ore(["fmt", "--check"], dir)
  expect(broken.code).toBe(1)
  expect(broken.stderr).toStartWith("broken.ore: ")
}, 10_000)

test("ore version, help and unknown commands", async () => {
  const version = await ore(["version"], root)
  expect(version.code).toBe(0)
  expect(version.stdout).toMatch(/^\d+\.\d+\.\d+/)
  expect((await ore(["--version"], root)).stdout).toBe(version.stdout)
  const help = await ore(["help"], root)
  expect(help.stdout).toStartWith(`Ore ${version.stdout.trim()}\n\nUsage:\n`)
  expect((await ore([], root)).stdout).toBe(help.stdout)
  expect(await ore(["frobnicate"], root)).toEqual({ code: 2, stdout: "", stderr: `ore: unknown command 'frobnicate'\n\n${help.stdout}` })
}, 10_000)

test("ore test runs the test files of the compiler in Ore", async () => {
  const result = await ore(["test", "compiler/next/test"], root)
  expect(result.stderr).toBe("")
  expect(result.stdout).toMatch(/\nAll \d+ test file\(s\) passed.\n$/)
  expect(result.code).toBe(0)
}, 60_000)
