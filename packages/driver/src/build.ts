import { check } from "@ore/checker"
import { emitModule, type EmitOptions } from "@ore/codegen-c"
import { findPackageRoot, loadProgram, readPackageJson } from "@ore/project"
import { type Diagnostic } from "@ore/syntax"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { clang } from "./clang"
import { prepareRuntime } from "./runtime"

export interface CompileResult {
  /** Generated C, present only when there are no errors. */
  c?: string
  diagnostics: Diagnostic[]
  native?: NativeCode
}

/** Loads, checks and translates a program, given by its entry file, to C. */
export function compileToC(entry: string, options: EmitOptions = { debug: false }): CompileResult {
  const program = loadProgram(entry)
  if (program.syntaxErrors) return { diagnostics: program.diagnostics }
  const checked = check(program)
  const diagnostics = [...program.diagnostics, ...checked.diagnostics]
  if (!checked.module || program.diagnostics.length > 0) return { diagnostics }
  return { c: emitModule(checked.module, options), diagnostics, native: nativeCode(program.modules.map((m) => m.path)) }
}

export interface NativeCode {
  /** Libraries to link, as for `-l`. */
  link: string[]
  /** C source files to compile into the program. */
  sources: string[]
}

/** The native code that the packages of a program's modules ask for in their package.json. */
function nativeCode(paths: string[]): NativeCode {
  const native: NativeCode = { link: [], sources: [] }
  const roots = new Set(paths.map((p) => findPackageRoot(dirname(resolve(p)))).filter((r) => r !== undefined))
  for (const root of roots) {
    const ore = readPackageJson(root)?.ore
    for (const lib of ore?.link ?? []) if (!native.link.includes(lib)) native.link.push(lib)
    for (const src of ore?.sources ?? []) native.sources.push(join(root, src))
  }
  return native
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
  const { c, diagnostics, native } = compileToC(path, { debug: !options.release })
  if (c === undefined) return { ok: false, diagnostics }
  if (options.emitC) writeFileSync(options.emitC, c)

  const flags = [...commonFlags, ...(options.release ? ["-O2"] : ["-O0", "-g"])]
  const runtime = await prepareRuntime(flags)
  const dir = mkdtempSync(join(tmpdir(), "ore-build-"))
  try {
    const cPath = join(dir, "main.c")
    writeFileSync(cPath, c)
    const libs = (native?.link ?? []).map((l) => `-l${l}`)
    await clang([...flags, "-I", runtime.includeDir, cPath, ...(native?.sources ?? []), ...runtime.objects, "-lm", ...libs, "-o", options.output])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  return { ok: true, diagnostics }
}
