import { createHash } from "node:crypto"
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import header from "../../../runtime/include/ore.h" with { type: "text" }
import source from "../../../runtime/src/runtime.c" with { type: "text" }
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

/**
 * Materializes the embedded runtime into the cache and compiles it once per
 * runtime version and flag set.
 */
export async function prepareRuntime(flags: string[]): Promise<RuntimeFiles> {
  const hash = createHash("sha256").update(header).update(source).update(flags.join(" ")).digest("hex").slice(0, 16)
  const dir = join(cacheDir(), `runtime-${hash}`)
  const includeDir = join(dir, "include")
  const object = join(dir, "runtime.o")
  const gc = await prepareGc(cacheDir())
  if (existsSync(object)) return { includeDir, objects: [object, gc] }

  mkdirSync(includeDir, { recursive: true })
  writeFileSync(join(includeDir, "ore.h"), header)
  writeFileSync(join(dir, "runtime.c"), source)
  // Compile to a temporary name so concurrent builds never see a partial object.
  const temp = `${object}.${process.pid}.tmp`
  await clang([...flags, "-I", includeDir, "-c", join(dir, "runtime.c"), "-o", temp])
  renameSync(temp, object)
  return { includeDir, objects: [object, gc] }
}
