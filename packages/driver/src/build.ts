import { check } from "@ore/checker"
import { emitModule, type EmitOptions } from "@ore/codegen-c"
import { parse, type Diagnostic } from "@ore/syntax"
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

/** Parses, checks and translates an entry file to C. */
export function compileToC(path: string, text: string, options: EmitOptions = { debug: false }): CompileResult {
  const parsed = parse(path, text)
  if (parsed.diagnostics.length > 0) return { diagnostics: parsed.diagnostics }
  const checked = check(parsed.source)
  if (!checked.module) return { diagnostics: checked.diagnostics }
  return { c: emitModule(checked.module, options), diagnostics: checked.diagnostics }
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
  const text = await Bun.file(path).text()
  const { c, diagnostics } = compileToC(path, text, { debug: !options.release })
  if (c === undefined) return { ok: false, diagnostics }
  if (options.emitC) writeFileSync(options.emitC, c)

  const flags = [...commonFlags, ...(options.release ? ["-O2"] : ["-O0", "-g"])]
  const runtime = await prepareRuntime(flags)
  const dir = mkdtempSync(join(tmpdir(), "ore-build-"))
  try {
    const cPath = join(dir, "main.c")
    writeFileSync(cPath, c)
    await clang([...flags, "-I", runtime.includeDir, cPath, runtime.object, "-lm", "-o", options.output])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  return { ok: true, diagnostics }
}
