#!/usr/bin/env bun
import { check } from "@ore/checker"
import { build, ToolError } from "@ore/driver"
import { serve } from "@ore/lsp"
import { fmtCommand } from "./fmt"
import { findPackageRoot, loadProgram, readPackageJson } from "@ore/project"
import { formatDiagnostic, type Diagnostic } from "@ore/syntax"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join, resolve } from "node:path"
import { parseArgs } from "node:util"
import { createConnection } from "vscode-languageserver/node"
import pkg from "../package.json" with { type: "json" }

const usage = `Ore ${pkg.version}

Usage:
  ore run [file.ore] [args...]   Build and run a program
  ore build [file.ore]           Build a native binary
      -o, --output <path>        Output path (default: package name or file name)
      --release                  Optimize instead of building with debug info
      --emit-c <path>            Also write the generated C
  ore check [file.ore]           Report errors without building
  ore test [paths...]            Run the tests in *.test.ore files (default: all below .)
  ore fmt [--check] [paths...]   Format .ore files in place, or list unformatted ones
  ore init [directory]           Create a project: package.json and src/main.ore
  ore lsp                        Start the language server on stdio

Without a file, the program is the 'main' of the nearest package.json.
  ore version                    Print the version
  ore help                       Print this help
`

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv
  switch (command) {
    case "run":
      return run(rest)
    case "build":
      return buildCommand(rest)
    case "check":
      return checkCommand(rest)
    case "init":
      return init(rest)
    case "test":
      return testCommand(rest)
    case "fmt":
      return fmtCommand(rest)
    case "lsp":
      serve(createConnection(process.stdin, process.stdout), pkg.version)
      return new Promise(() => {})
    case "version":
    case "--version":
      console.log(pkg.version)
      return 0
    case undefined:
    case "help":
    case "--help":
    case "-h":
      process.stdout.write(usage)
      return 0
    default:
      process.stderr.write(`ore: unknown command '${command}'\n\n${usage}`)
      return 2
  }
}

async function buildCommand(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      output: { type: "string", short: "o" },
      release: { type: "boolean" },
      "emit-c": { type: "string" },
    },
  })
  const target = entry(positionals)
  if (!target) return 2
  if (target.args.length > 0) return usageError(`unexpected arguments: ${target.args.join(" ")}`)
  const result = await build(target.file, {
    output: values.output ?? target.name,
    release: values.release,
    emitC: values["emit-c"],
  })
  report(result.diagnostics)
  return result.ok ? 0 : 1
}

async function run(args: string[]): Promise<number> {
  const target = entry(args)
  if (!target) return 2
  const dir = mkdtempSync(join(tmpdir(), "ore-run-"))
  try {
    const output = join(dir, target.name)
    const result = await build(target.file, { output })
    report(result.diagnostics)
    if (!result.ok) return 1
    const proc = Bun.spawn([output, ...target.args], { stdio: ["inherit", "inherit", "inherit"] })
    return await proc.exited
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function checkCommand(args: string[]): Promise<number> {
  const target = entry(args)
  if (!target) return 2
  if (target.args.length > 0) return usageError(`unexpected arguments: ${target.args.join(" ")}`)
  const file = target.file
  const program = loadProgram(file)
  const diagnostics = program.syntaxErrors ? program.diagnostics : [...program.diagnostics, ...check(program).diagnostics]
  report(diagnostics)
  return diagnostics.some((d) => d.severity === "error") ? 1 : 0
}

/**
 * The program to build: a `.ore` file given first, or else the `main` of
 * the nearest package.json. The other arguments are for the program.
 */
function entry(positionals: string[]): { file: string; name: string; args: string[] } | undefined {
  const [first, ...rest] = positionals
  if (first?.endsWith(".ore")) return { file: first, name: basename(first, ".ore"), args: rest }
  const root = findPackageRoot(process.cwd())
  const pkg = root ? readPackageJson(root) : undefined
  if (!root || !pkg?.main) {
    process.stderr.write("ore: give a .ore file, or run in a project whose package.json has a 'main' (see 'ore init')\n")
    return undefined
  }
  const name = (pkg.name ?? basename(pkg.main, ".ore")).replace(/^@.*\//, "")
  return { file: join(root, pkg.main), name, args: positionals }
}

/** *.test.ore files in the given files and directories, outside node_modules and hidden directories. */
function testFiles(paths: string[]): string[] {
  const files: string[] = []
  const walk = (path: string) => {
    if (statSync(path).isFile()) {
      if (path.endsWith(".ore")) files.push(path)
      return
    }
    for (const entry of readdirSync(path).sort()) {
      if (entry === "node_modules" || entry.startsWith(".")) continue
      const child = join(path, entry)
      if (statSync(child).isDirectory()) walk(child)
      else if (entry.endsWith(".test.ore")) files.push(child)
    }
  }
  for (const p of paths.length > 0 ? paths : ["."]) walk(p)
  return files
}

async function testCommand(args: string[]): Promise<number> {
  const files = testFiles(args)
  if (files.length === 0) {
    process.stderr.write("ore: no *.test.ore files found\n")
    return 1
  }
  const dir = mkdtempSync(join(tmpdir(), "ore-test-"))
  let failed = 0
  try {
    for (const [i, file] of files.entries()) {
      console.log(file)
      const output = join(dir, `test${i}`)
      const result = await build(file, { output, test: true })
      report(result.diagnostics)
      const code = result.ok ? await Bun.spawn([output], { stdio: ["inherit", "inherit", "inherit"] }).exited : 1
      if (code !== 0) failed++
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  console.log(failed === 0 ? `\nAll ${files.length} test file(s) passed.` : `\n${failed} of ${files.length} test file(s) failed.`)
  return failed === 0 ? 0 : 1
}

function usageError(message: string): number {
  process.stderr.write(`ore: ${message}\n`)
  return 2
}

function init(args: string[]): number {
  const dir = resolve(args[0] ?? ".")
  if (existsSync(join(dir, "package.json"))) return usageError(`${join(dir, "package.json")} already exists`)
  const name = basename(dir).toLowerCase().replace(/[^a-z0-9._-]/g, "-")
  mkdirSync(join(dir, "src"), { recursive: true })
  const manifest = { name, version: "0.1.0", private: true, main: "src/main.ore" }
  writeFileSync(join(dir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`)
  if (!existsSync(join(dir, "src/main.ore"))) {
    writeFileSync(join(dir, "src/main.ore"), `export function main() {\n    console.log("hello, ${name}")\n}\n`)
  }
  console.log(`Created ${name} in ${dir}. Run it with 'ore run'.`)
  return 0
}

function report(diagnostics: Diagnostic[]) {
  for (const d of diagnostics) process.stderr.write(`${formatDiagnostic(d)}\n`)
}

try {
  process.exitCode = await main(process.argv.slice(2))
} catch (error) {
  if (error instanceof ToolError || (error as NodeJS.ErrnoException).code === "ENOENT") {
    process.stderr.write(`ore: ${(error as Error).message}\n`)
    process.exitCode = 1
  } else {
    throw error
  }
}
