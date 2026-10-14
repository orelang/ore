/**
 * The self-hosted compiler in selfhost/, checked against the TypeScript
 * compiler on every .ore file of the repository.
 *
 * Lexer: the tokens of each file (kind and byte span) must equal those of the
 * TypeScript scanner, with `}` rescanned as a template continuation where the
 * parser would.
 */
import { build } from "@ore/driver"
import { beforeAll, describe, expect, test } from "bun:test"
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import ts from "typescript"

const root = join(import.meta.dir, "..")
const binary = join(mkdtempSync(join(tmpdir(), "ore-selfhost-")), "ore-selfhost")

function oreFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name.startsWith(".") || name === "node_modules") return []
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return oreFiles(path)
    return name.endsWith(".ore") ? [path] : []
  })
}

const files = ["tests", "std", "selfhost", "bench"].flatMap((d) => oreFiles(join(root, d))).sort()

/** The first name of each SyntaxKind value: the real kinds come before markers such as FirstToken. */
const kindNames = new Map<number, string>()
for (const [name, value] of Object.entries(ts.SyntaxKind)) if (typeof value === "number" && !kindNames.has(value)) kindNames.set(value, name)

/** Tokens as the TypeScript scanner reads them, with byte offsets: "Kind start end". */
function typescriptTokens(text: string): string[] {
  // Byte offset of each UTF-16 offset.
  const bytes: number[] = []
  let offset = 0
  for (let i = 0; i < text.length; i++) {
    bytes.push(offset)
    const code = text.charCodeAt(i)
    offset += code < 0x80 ? 1 : code < 0x800 ? 2 : code >= 0xd800 && code < 0xdc00 ? 4 : code >= 0xdc00 && code < 0xe000 ? 0 : 3
  }
  bytes.push(offset)

  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, text)
  const templates: number[] = []
  const tokens: string[] = []
  for (;;) {
    let kind = scanner.scan()
    if (kind === ts.SyntaxKind.OpenBraceToken && templates.length > 0) templates[templates.length - 1]!++
    else if (kind === ts.SyntaxKind.CloseBraceToken && templates.length > 0) {
      if (templates.at(-1) === 0) {
        templates.pop()
        kind = scanner.reScanTemplateToken(false)
      } else templates[templates.length - 1]!--
    }
    if (kind === ts.SyntaxKind.TemplateHead || kind === ts.SyntaxKind.TemplateMiddle) templates.push(0)
    tokens.push(`${kindNames.get(kind)} ${bytes[scanner.getTokenStart()]} ${bytes[scanner.getTokenEnd()]}`)
    if (kind === ts.SyntaxKind.EndOfFileToken) return tokens
  }
}

beforeAll(async () => {
  const result = await build(join(root, "selfhost/src/main.ore"), { output: binary, release: true })
  expect(result.diagnostics.map((d) => d.message)).toEqual([])
}, 120_000)

describe("selfhost lexer", () => {
  for (const file of files) {
    test(relative(root, file), async () => {
      const proc = Bun.spawn([binary, file], { stdout: "pipe", stderr: "pipe" })
      const [code, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()])
      expect(code).toBe(0)
      expect(stdout.trimEnd().split("\n")).toEqual(typescriptTokens(readFileSync(file, "utf8")))
    })
  }
})
