import { createHash } from "node:crypto"
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { clang, ToolError } from "./clang"

/** Boehm GC version in runtime/third_party/bdwgc; part of cache keys. */
export const gcVersion = "8.2.12"

/** Name of the prebuilt GC object for this platform, as embedded in a compiled `ore`. */
export const gcObjectName = `gc-${process.platform}-${process.arch}.o`

const sourceDir = join(import.meta.dir, "../../../runtime/third_party/bdwgc")

/**
 * Build options of the GC. GC_THREADS: tasks run on several OS threads.
 * ALWAYS_SMALL_CLEAR_STACK: by default the GC clears stack memory down to the
 * lowest stack pointer it has seen, which with task stacks lies on another
 * stack and reaches guard pages.
 */
const gcDefines = ["-DNO_EXECUTE_PERMISSION", "-DALWAYS_SMALL_CLEAR_STACK", "-DGC_THREADS", "-DGC_BUILTIN_ATOMIC", "-DPARALLEL_MARK"]

/** Compiles the Boehm GC amalgamation into one object file. */
export async function compileGc(output: string): Promise<void> {
  if (!existsSync(join(sourceDir, "extra/gc.c"))) {
    throw new ToolError(`Boehm GC sources not found in ${sourceDir}. Run 'git submodule update --init'.`)
  }
  await clang(["-std=c11", "-O2", "-w", "-I", join(sourceDir, "include"), ...gcDefines, "-c", join(sourceDir, "extra/gc.c"), "-o", output])
}

/**
 * Returns the GC object in the cache, taking it from the files embedded in a
 * compiled `ore`, or compiling it from the repository sources once.
 */
export async function prepareGc(cache: string): Promise<string> {
  const dir = join(cache, `gc-${gcVersion}-${createHash("sha256").update(gcDefines.join(" ")).digest("hex").slice(0, 8)}`)
  const object = join(dir, gcObjectName)
  if (existsSync(object)) return object
  mkdirSync(dir, { recursive: true })
  const temp = `${object}.${process.pid}.tmp`
  const embedded = Bun.embeddedFiles.find((f) => (f as Blob & { name: string }).name === gcObjectName)
  if (embedded) writeFileSync(temp, new Uint8Array(await embedded.arrayBuffer()))
  else await compileGc(temp)
  renameSync(temp, object)
  return object
}
