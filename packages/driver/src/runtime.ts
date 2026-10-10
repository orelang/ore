import { createHash } from "node:crypto"
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import header from "../../../runtime/include/ore.h" with { type: "text" }
import runtimeSource from "../../../runtime/src/runtime.c" with { type: "text" }
import taskSource from "../../../runtime/src/task.c" with { type: "text" }
import { clang } from "./clang"
import { prepareGc } from "./gc"

export interface RuntimeFiles {
  includeDir: string
  /** Object files to link: the runtime and the garbage collector. */
  objects: string[]
}

export function cacheDir(): string {
  return process.env.ORE_CACHE ?? join(homedir(), ".cache", "ore")
}

/** The C sources of the runtime, embedded in the compiler. */
const sources: Record<string, string> = { "runtime.c": runtimeSource, "task.c": taskSource }

/**
 * Materializes the embedded runtime into the cache and compiles it once per
 * runtime version and flag set.
 */
export async function prepareRuntime(flags: string[]): Promise<RuntimeFiles> {
  const hash = createHash("sha256").update(header)
  for (const [name, text] of Object.entries(sources)) hash.update(name).update(text)
  const dir = join(cacheDir(), `runtime-${hash.update(flags.join(" ")).digest("hex").slice(0, 16)}`)
  const includeDir = join(dir, "include")
  const objects = Object.keys(sources).map((name) => join(dir, name.replace(/\.c$/, ".o")))
  const gc = await prepareGc(cacheDir())
  if (objects.every((o) => existsSync(o))) return { includeDir, objects: [...objects, gc] }

  mkdirSync(includeDir, { recursive: true })
  writeFileSync(join(includeDir, "ore.h"), header)
  for (const [name, text] of Object.entries(sources)) {
    const object = join(dir, name.replace(/\.c$/, ".o"))
    writeFileSync(join(dir, name), text)
    // Compile to a temporary name so concurrent builds never see a partial object.
    const temp = `${object}.${process.pid}.tmp`
    await clang([...flags, "-I", includeDir, "-c", join(dir, name), "-o", temp])
    renameSync(temp, object)
  }
  return { includeDir, objects: [...objects, gc] }
}
