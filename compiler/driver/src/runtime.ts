import { homedir } from "node:os"
import { join } from "node:path"

/** Where compiled objects are kept between builds: the GC. */
export function cacheDir(): string {
  return process.env.ORE_CACHE ?? join(homedir(), ".cache", "ore")
}
