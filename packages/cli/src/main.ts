#!/usr/bin/env bun
import { check } from "@ore/checker"
import { build, ToolError } from "@ore/driver"
import { serve } from "@ore/lsp"
import { formatDiagnostic, parse, type Diagnostic } from "@ore/syntax"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { parseArgs } from "node:util"
import { createConnection } from "vscode-languageserver/node"
import pkg from "../package.json" with { type: "json" }

const usage = `Ore ${pkg.version}

Usage:
  ore run <file.ore> [args...]   Build and run a program
  ore build <file.ore>           Build a native binary
      -o, --output <path>        Output path (default: file name without .ore)
      --release                  Optimize instead of building with debug info
      --emit-c <path>            Also write the generated C
  ore check <file.ore>           Report errors without building
  ore lsp                        Start the language server on stdio
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
  const file = entryFile(positionals)
  if (!file) return 2
  const result = await build(file, {
    output: values.output ?? basename(file, ".ore"),
    release: values.release,
    emitC: values["emit-c"],
  })
  report(result.diagnostics)
  return result.ok ? 0 : 1
}

async function run(args: string[]): Promise<number> {
  const file = entryFile(args.slice(0, 1))
  if (!file) return 2
  const dir = mkdtempSync(join(tmpdir(), "ore-run-"))
  try {
    const output = join(dir, basename(file, ".ore"))
    const result = await build(file, { output })
    report(result.diagnostics)
    if (!result.ok) return 1
    const proc = Bun.spawn([output, ...args.slice(1)], { stdio: ["inherit", "inherit", "inherit"] })
    return await proc.exited
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function checkCommand(args: string[]): Promise<number> {
  const file = entryFile(args)
  if (!file) return 2
  const parsed = parse(file, await Bun.file(file).text())
  const diagnostics = parsed.diagnostics.length > 0 ? parsed.diagnostics : check(parsed.source).diagnostics
  report(diagnostics)
  return diagnostics.some((d) => d.severity === "error") ? 1 : 0
}

function entryFile(positionals: string[]): string | undefined {
  const [file, ...extra] = positionals
  if (!file || extra.length > 0) {
    process.stderr.write("ore: expected exactly one .ore file\n")
    return undefined
  }
  return file
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
