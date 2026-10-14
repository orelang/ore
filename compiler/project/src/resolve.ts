import { existsSync, readFileSync, statSync } from "node:fs"
import { dirname, isAbsolute, join, resolve } from "node:path"
import runtimeArray from "../../../runtime/core/array.ore" with { type: "text" }
import runtimeChan from "../../../runtime/core/chan.ore" with { type: "text" }
import runtimeFloat from "../../../runtime/core/float.ore" with { type: "text" }
import runtimeFloatTables from "../../../runtime/core/float-tables.ore" with { type: "text" }
import runtimeFormat from "../../../runtime/core/format.ore" with { type: "text" }
import runtimeFrames from "../../../runtime/core/frames.ore" with { type: "text" }
import runtimeIo from "../../../runtime/core/io.ore" with { type: "text" }
import runtimeJson from "../../../runtime/core/json.ore" with { type: "text" }
import runtimeNumber from "../../../runtime/core/number.ore" with { type: "text" }
import runtimeOs from "../../../runtime/core/os.ore" with { type: "text" }
import runtimePoll from "../../../runtime/core/poll.ore" with { type: "text" }
import runtimeNet from "../../../runtime/core/net.ore" with { type: "text" }
import runtimeProgram from "../../../runtime/core/program.ore" with { type: "text" }
import runtimeMap from "../../../runtime/core/map.ore" with { type: "text" }
import runtimeString from "../../../runtime/core/string.ore" with { type: "text" }
import runtimeTask from "../../../runtime/core/task.ore" with { type: "text" }
import cryptoModule from "../../../runtime/std/crypto.ore" with { type: "text" }
import netModule from "../../../runtime/std/net.ore" with { type: "text" }
import syncModule from "../../../runtime/std/sync.ore" with { type: "text" }
import testModule from "../../../runtime/std/test.ore" with { type: "text" }

/** Standard library modules, imported as "ore:name" and embedded in the compiler. */
export const stdModules: Record<string, string> = {
  "ore:crypto": cryptoModule,
  "ore:net": netModule,
  "ore:sync": syncModule,
  "ore:test": testModule,
  "ore:runtime/string": runtimeString,
  "ore:runtime/array": runtimeArray,
  "ore:runtime/map": runtimeMap,
  "ore:runtime/format": runtimeFormat,
  "ore:runtime/float": runtimeFloat,
  "ore:runtime/float-tables": runtimeFloatTables,
  "ore:runtime/json": runtimeJson,
  "ore:runtime/number": runtimeNumber,
  "ore:runtime/frames": runtimeFrames,
  "ore:runtime/os": runtimeOs,
  "ore:runtime/task": runtimeTask,
  "ore:runtime/chan": runtimeChan,
  "ore:runtime/poll": runtimePoll,
  "ore:runtime/io": runtimeIo,
  "ore:runtime/program": runtimeProgram,
  "ore:runtime/net": runtimeNet,
}

/** The modules of the runtime written in Ore (runtime/core), part of every program, in load order. */
export const runtimeModules = ["ore:runtime/frames", "ore:runtime/string", "ore:runtime/array", "ore:runtime/map", "ore:runtime/format", "ore:runtime/float-tables", "ore:runtime/float", "ore:runtime/json", "ore:runtime/number", "ore:runtime/os", "ore:runtime/io", "ore:runtime/task", "ore:runtime/chan", "ore:runtime/poll", "ore:runtime/net", "ore:runtime/program"]

export interface PackageJson {
  name?: string
  version?: string
  /** The entry file of a program, or the module imported by a package's name. */
  main?: string
  dependencies?: Record<string, string>
  /** Native code: libraries to link (`-l`), and C sources relative to the package. */
  ore?: { link?: string[]; sources?: string[] }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

export function readPackageJson(dir: string): PackageJson | undefined {
  const path = join(dir, "package.json")
  if (!existsSync(path)) return undefined
  return JSON.parse(readFileSync(path, "utf8")) as PackageJson
}

/** The nearest directory at or above `dir` that has a package.json. */
export function findPackageRoot(dir: string): string | undefined {
  for (let d = resolve(dir); ; d = dirname(d)) {
    if (existsSync(join(d, "package.json"))) return d
    if (dirname(d) === d) return undefined
  }
}

/** A file path for a module path: `x.ore`, `x` itself if it ends in `.ore`, or `x/index.ore`. */
function resolveFile(base: string): string | undefined {
  const candidates = base.endsWith(".ore") ? [base] : [`${base}.ore`, join(base, "index.ore")]
  return candidates.find(isFile)
}

/** The entry module of a package directory: its package.json `main`, or `index.ore`. */
export function packageEntry(dir: string): string | undefined {
  const main = readPackageJson(dir)?.main
  return main ? resolveFile(join(dir, main)) : resolveFile(join(dir, "index"))
}

/**
 * Resolves an import specifier like Node does: relative paths against the
 * importing file, and package names in `node_modules` directories above it.
 */
export function resolveImport(specifier: string, fromFile: string): string | undefined {
  if (specifier.startsWith("ore:")) return stdModules[specifier] === undefined ? undefined : specifier
  if (specifier.startsWith("./") || specifier.startsWith("../") || isAbsolute(specifier)) {
    return resolveFile(resolve(dirname(fromFile), specifier))
  }
  const parts = specifier.split("/")
  const nameLength = specifier.startsWith("@") ? 2 : 1
  const name = parts.slice(0, nameLength).join("/")
  const subpath = parts.slice(nameLength).join("/")
  for (let d = dirname(resolve(fromFile)); ; d = dirname(d)) {
    const dir = join(d, "node_modules", name)
    if (existsSync(dir)) return subpath ? resolveFile(join(dir, subpath)) : packageEntry(dir)
    if (dirname(d) === d) return undefined
  }
}
