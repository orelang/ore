/** Compiles the GC object for embedding into the standalone `ore` binary: `bun build-gc.ts <out-dir>`. */
import { join } from "node:path"
import { compileGc, gcObjectName } from "./gc"

const outDir = process.argv[2] ?? "dist"
await compileGc(join(outDir, gcObjectName))
console.log(join(outDir, gcObjectName))
