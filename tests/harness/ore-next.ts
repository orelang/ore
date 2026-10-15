/**
 * The compiler in Ore, built once for all the test files that run it: in
 * release (its oracles then run several times faster), cached by a hash of
 * the sources it is built from, under $ORE_TEST_CACHE (~/.cache/ore/test by
 * default). Test files run in parallel processes, so a lock directory keeps
 * them from building it more than once at a time.
 */
import { build } from "@ore/driver"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const root = join(import.meta.dir, "../..")

/** The files the binary depends on: the compiler that builds it, its own sources, the runtime. */
function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir).sort()) {
    if (entry === "node_modules" || entry.startsWith(".") || entry === "test") continue
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) sources(path, out)
    else if (/\.(ts|ore|json)$/.test(entry)) out.push(path)
  }
  return out
}

function sourceHash(): string {
  const hash = createHash("sha256")
  for (const file of [...sources(join(root, "compiler")), ...sources(join(root, "runtime"))]) {
    hash.update(file.slice(root.length))
    hash.update(readFileSync(file))
  }
  return hash.digest("hex").slice(0, 16)
}

let cached: Promise<string> | undefined

/** The path of an `ore-next` built from the current sources. */
export function oreNext(): Promise<string> {
  cached ??= buildOnce()
  return cached
}

async function buildOnce(): Promise<string> {
  const dir = process.env.ORE_TEST_CACHE ?? join(homedir(), ".cache/ore/test")
  mkdirSync(dir, { recursive: true })
  const binary = join(dir, `ore-next-${sourceHash()}`)
  const lock = `${binary}.lock`
  for (;;) {
    if (existsSync(binary)) return binary
    try {
      mkdirSync(lock)
      break
    } catch {
      // Another process builds it; a lock older than 20 minutes is left over from a killed one.
      try {
        if (Date.now() - statSync(lock).mtimeMs > 20 * 60_000) rmSync(lock, { recursive: true, force: true })
      } catch {}
      await Bun.sleep(500)
    }
  }
  try {
    if (existsSync(binary)) return binary
    const partial = `${binary}.partial-${process.pid}`
    const result = await build(join(root, "compiler/next/src/main.ore"), { output: partial, release: true })
    if (!result.ok) throw new Error(`ore-next does not build:\n${result.diagnostics.map((d) => d.message).join("\n")}`)
    renameSync(partial, binary)
    // Older builds of other sources are of no more use.
    for (const entry of readdirSync(dir)) {
      if (entry.startsWith("ore-next-") && join(dir, entry) !== binary && !entry.endsWith(".lock")) rmSync(join(dir, entry), { force: true })
    }
    return binary
  } finally {
    rmSync(lock, { recursive: true, force: true })
  }
}
