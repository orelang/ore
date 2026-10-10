import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import * as estree from "prettier/plugins/estree"
import * as typescript from "prettier/plugins/typescript"
import type { Options } from "prettier"
import { format } from "prettier/standalone"

/** The one Ore style, as with gofmt: there is nothing to configure. */
const style: Options = {
  parser: "typescript",
  plugins: [typescript, estree],
  semi: false,
  printWidth: 120,
  tabWidth: 4,
  trailingComma: "all",
  arrowParens: "always",
}

export async function formatOre(text: string): Promise<string> {
  return format(text, style)
}

/** .ore files in the given files and directories, outside node_modules and hidden directories. */
function oreFiles(paths: string[]): string[] {
  const files: string[] = []
  const walk = (path: string) => {
    if (statSync(path).isFile()) return void (path.endsWith(".ore") && files.push(path))
    for (const entry of readdirSync(path).sort()) {
      if (entry === "node_modules" || entry.startsWith(".")) continue
      walk(join(path, entry))
    }
  }
  for (const p of paths.length > 0 ? paths : ["."]) walk(p)
  return files
}

/** `ore fmt [--check] [paths...]`: formats files in place, or lists those that are not formatted. */
export async function fmtCommand(args: string[]): Promise<number> {
  const check = args.includes("--check")
  const files = oreFiles(args.filter((a) => a !== "--check"))
  let unformatted = 0
  let failed = 0
  for (const file of files) {
    const text = readFileSync(file, "utf8")
    let formatted: string
    try {
      formatted = await formatOre(text)
    } catch (error) {
      process.stderr.write(`${file}: ${(error as Error).message.split("\n")[0]}\n`)
      failed++
      continue
    }
    if (formatted === text) continue
    unformatted++
    if (check) console.log(file)
    else writeFileSync(file, formatted)
  }
  if (failed > 0) return 1
  return check && unformatted > 0 ? 1 : 0
}
