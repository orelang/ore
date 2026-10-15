import { check } from "@ore/checker"
import { emitModule, type EmitOptions } from "@ore/codegen"
import { findPackageRoot, loadProgram, readPackageJson } from "@ore/project"
import { type Diagnostic } from "@ore/syntax"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { clang } from "./clang"


export interface CompileResult {
  /** Generated LLVM IR, present only when there are no errors. */
  ir?: string
  diagnostics: Diagnostic[]
  native?: NativeCode
}

/** Loads, checks and translates a program, given by its entry file, to LLVM IR. */
export function compileToIr(entry: string, options: EmitOptions = { debug: false }): CompileResult {
  const program = loadProgram(entry)
  if (program.syntaxErrors) return { diagnostics: program.diagnostics }
  const checked = check(program)
  const diagnostics = [...program.diagnostics, ...checked.diagnostics]
  if (!checked.module || program.diagnostics.length > 0) return { diagnostics }
  return { ir: emitModule(checked.module, options), diagnostics, native: nativeCode(program.modules.map((m) => m.path)) }
}

export interface NativeCode {
  /** Libraries to link, as for `-l`. */
  link: string[]
  /** C source files to compile into the program. */
  sources: string[]
  /** Directories to search for the libraries, as for `-L`. */
  libDirs: string[]
}

/** The native code that the packages of a program's modules ask for in their package.json. */
export function nativeCode(paths: string[]): NativeCode {
  const native: NativeCode = { link: [], sources: [], libDirs: [] }
  const roots = new Set(paths.map((p) => findPackageRoot(dirname(resolve(p)))).filter((r) => r !== undefined))
  for (const root of roots) {
    const ore = readPackageJson(root)?.ore
    for (const lib of ore?.link ?? []) if (!native.link.includes(lib)) native.link.push(lib)
    for (const src of ore?.sources ?? []) native.sources.push(join(root, src))
    for (const entry of ore?.libDirs ?? []) {
      const dir = libDir(root, entry)
      if (dir !== undefined && !native.libDirs.includes(dir)) native.libDirs.push(dir)
    }
  }
  return native
}

/**
 * A directory of `"ore": { "libDirs": [...] }`: a path relative to the
 * package, or `$(command args...)`, the output of a command run without a
 * shell, such as `$(llvm-config --libdir)`. Undefined when the directory does
 * not exist or the command fails, so that a package can list the places a
 * library may be on several systems.
 */
export function libDir(root: string, entry: string): string | undefined {
  let dir = entry
  const command = entry.match(/^\$\((.*)\)$/)
  if (command) {
    const args = command[1]!.trim().split(/\s+/)
    try {
      const proc = Bun.spawnSync(args, { stdout: "pipe", stderr: "ignore" })
      if (!proc.success) return undefined
      dir = proc.stdout.toString().trim()
      if (dir === "") return undefined
    } catch {
      return undefined
    }
  }
  dir = resolve(root, dir)
  return existsSync(dir) ? dir : undefined
}

export interface BuildOptions {
  output: string
  /** Optimize (-O2) instead of building with stack traces (-O0). */
  release?: boolean
  /** Also write the generated LLVM IR to this path. */
  emitLlvm?: string
}

export interface BuildResult {
  ok: boolean
  diagnostics: Diagnostic[]
}

const commonFlags = ["-std=c11", "-fwrapv", "-fno-strict-aliasing", "-w"]

export async function build(path: string, options: BuildOptions): Promise<BuildResult> {
  const { ir, diagnostics, native } = compileToIr(path, { debug: !options.release })
  if (ir === undefined) return { ok: false, diagnostics }
  if (options.emitLlvm) writeFileSync(options.emitLlvm, ir)

  const flags = [...commonFlags, ...(options.release ? ["-O2"] : ["-O0", "-g"])]
  // The runtime, the collector included, is Ore: part of the program's LLVM IR.
  const dir = mkdtempSync(join(tmpdir(), "ore-build-"))
  try {
    const irPath = join(dir, "main.ll")
    writeFileSync(irPath, ir)
    const libs = [...(native?.libDirs ?? []).map((d) => `-L${d}`), ...(native?.link ?? []).map((l) => `-l${l}`)]
    await clang([...flags, irPath, ...(native?.sources ?? []), "-lm", "-pthread", ...libs, "-o", options.output])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  return { ok: true, diagnostics }
}
