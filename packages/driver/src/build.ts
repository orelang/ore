import { check } from "@ore/checker"
import { emitModule, type EmitOptions } from "@ore/codegen-c"
import { emitModule as emitLlvm } from "@ore/codegen-llvm"
import { findPackageRoot, loadProgram, readPackageJson } from "@ore/project"
import { type Diagnostic } from "@ore/syntax"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { clang } from "./clang"
import { header, prepareRuntime } from "./runtime"

/** The code generator: C (the default for now) or LLVM IR; ORE_BACKEND=llvm selects LLVM. */
export type Backend = "c" | "llvm"

function defaultBackend(): Backend {
  return process.env.ORE_BACKEND === "llvm" ? "llvm" : "c"
}

export interface CompileResult {
  /** Generated C or LLVM IR, present only when there are no errors. */
  c?: string
  diagnostics: Diagnostic[]
  native?: NativeCode
}

/** Loads, checks and translates a program, given by its entry file, to C or LLVM IR. */
export function compileToC(entry: string, options: EmitOptions = { debug: false }, backend: Backend = defaultBackend()): CompileResult {
  const program = loadProgram(entry)
  if (program.syntaxErrors) return { diagnostics: program.diagnostics }
  const checked = check(program)
  const diagnostics = [...program.diagnostics, ...checked.diagnostics]
  if (!checked.module || program.diagnostics.length > 0) return { diagnostics }
  const code = backend === "llvm" ? emitLlvm(checked.module, header, options) : emitModule(checked.module, options)
  return { c: code, diagnostics, native: nativeCode(program.modules.map((m) => m.path)) }
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
  /** Also write the generated C (or LLVM IR) to this path. */
  emitC?: string
  backend?: Backend
}

export interface BuildResult {
  ok: boolean
  diagnostics: Diagnostic[]
}

const commonFlags = ["-std=c11", "-fwrapv", "-fno-strict-aliasing", "-w"]

export async function build(path: string, options: BuildOptions): Promise<BuildResult> {
  const backend = options.backend ?? defaultBackend()
  const { c, diagnostics, native } = compileToC(path, { debug: !options.release }, backend)
  if (c === undefined) return { ok: false, diagnostics }
  if (options.emitC) writeFileSync(options.emitC, c)

  const flags = [...commonFlags, ...(options.release ? ["-O2"] : ["-O0", "-g"])]
  const runtime = await prepareRuntime(flags)
  const dir = mkdtempSync(join(tmpdir(), "ore-build-"))
  try {
    const cPath = join(dir, backend === "llvm" ? "main.ll" : "main.c")
    writeFileSync(cPath, c)
    const libs = (native?.link ?? []).map((l) => `-l${l}`)
    await clang([...flags, "-I", runtime.includeDir, cPath, ...(native?.sources ?? []), ...runtime.objects, "-lm", "-pthread", ...libs, "-o", options.output])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  return { ok: true, diagnostics }
}
