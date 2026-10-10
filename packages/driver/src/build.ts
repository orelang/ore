import { check } from "@ore/checker"
import { emitModule, type EmitOptions } from "@ore/codegen-c"
import { loadProgram } from "@ore/project"
import { type Diagnostic } from "@ore/syntax"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { clang } from "./clang"
import { prepareRuntime } from "./runtime"

export interface CompileResult {
  /** Generated C, present only when there are no errors. */
  c?: string
  diagnostics: Diagnostic[]
}

/** Loads, checks and translates a program, given by its entry file, to C. */
export function compileToC(entry: string, options: EmitOptions = { debug: false }): CompileResult {
  const program = loadProgram(entry)
  if (program.syntaxErrors) return { diagnostics: program.diagnostics }
  const checked = check(program)
  const diagnostics = [...program.diagnostics, ...checked.diagnostics]
  if (!checked.module || program.diagnostics.length > 0) return { diagnostics }
  return { c: emitModule(checked.module, options), diagnostics }
}

export interface BuildOptions {
  output: string
  /** Optimize (-O2) instead of building with debug info (-O0 -g). */
  release?: boolean
  /** Also write the generated C to this path. */
  emitC?: string
}

export interface BuildResult {
  ok: boolean
  diagnostics: Diagnostic[]
}

const commonFlags = ["-std=c11", "-fwrapv", "-fno-strict-aliasing", "-w"]

export async function build(path: string, options: BuildOptions): Promise<BuildResult> {
  const { c, diagnostics } = compileToC(path, { debug: !options.release })
  if (c === undefined) return { ok: false, diagnostics }
  if (options.emitC) writeFileSync(options.emitC, c)

  const flags = [...commonFlags, ...(options.release ? ["-O2"] : ["-O0", "-g"])]
  const runtime = await prepareRuntime(flags)
  const dir = mkdtempSync(join(tmpdir(), "ore-build-"))
  try {
    const cPath = join(dir, "main.c")
    writeFileSync(cPath, c)
    await clang([...flags, "-I", runtime.includeDir, cPath, ...runtime.objects, "-lm", "-o", options.output])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  return { ok: true, diagnostics }
}
