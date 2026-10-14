/**
 * The compiler written in Ore, in compiler/next/, checked against the TypeScript
 * compiler on every .ore file of the repository.
 *
 * Lexer: the tokens of each file (kind and byte span) must equal those of the
 * TypeScript scanner, with `}` rescanned as a template continuation where the
 * parser would.
 *
 * Parser: for each file without syntax errors, the tree in pre-order (kind and
 * byte span of each node, children as ts.forEachChild visits them) must equal
 * the TypeScript parser's.
 */
import { build } from "@ore/driver"
import { beforeAll, describe, expect, test } from "bun:test"
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import ts from "typescript"

const root = join(import.meta.dir, "../..")
const binary = join(mkdtempSync(join(tmpdir(), "ore-next-")), "ore-next")

function oreFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name.startsWith(".") || name === "node_modules") return []
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return oreFiles(path)
    return name.endsWith(".ore") ? [path] : []
  })
}

const files = ["tests", "runtime", "compiler/next"].flatMap((d) => oreFiles(join(root, d))).sort()

/** The first name of each SyntaxKind value: the real kinds come before markers such as FirstToken. */
const kindNames = new Map<number, string>()
for (const [name, value] of Object.entries(ts.SyntaxKind)) if (typeof value === "number" && !kindNames.has(value)) kindNames.set(value, name)

/** The byte offset of each UTF-16 offset of a text. */
function byteOffsets(text: string): number[] {
  const bytes: number[] = []
  let offset = 0
  for (let i = 0; i < text.length; i++) {
    bytes.push(offset)
    const code = text.charCodeAt(i)
    offset += code < 0x80 ? 1 : code < 0x800 ? 2 : code >= 0xd800 && code < 0xdc00 ? 4 : code >= 0xdc00 && code < 0xe000 ? 0 : 3
  }
  bytes.push(offset)
  return bytes
}

/** Tokens as the TypeScript scanner reads them, with byte offsets: "Kind start end". */
function typescriptTokens(text: string): string[] {
  const bytes = byteOffsets(text)
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

/** The TypeScript parser's tree in pre-order, or undefined if the text has syntax errors. */
function typescriptTree(path: string, text: string): string[] | undefined {
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  if ((file as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length > 0) return undefined
  const bytes = byteOffsets(text)
  const lines: string[] = []
  const visit = (node: ts.Node) => {
    lines.push(`${kindNames.get(node.kind)} ${bytes[node.getStart(file)]} ${bytes[node.end]}`)
    ts.forEachChild(node, visit)
  }
  visit(file)
  return lines
}

async function run(...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([binary, ...args], { stdout: "pipe", stderr: "pipe" })
  const [code, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  return { code, stdout, stderr }
}

beforeAll(async () => {
  const result = await build(join(root, "compiler/next/src/main.ore"), { output: binary, release: true })
  expect(result.diagnostics.map((d) => d.message)).toEqual([])
}, 120_000)

describe("selfhost lexer", () => {
  for (const file of files) {
    test(relative(root, file), async () => {
      const { code, stdout } = await run("tokens", file)
      expect(code).toBe(0)
      expect(stdout.trimEnd().split("\n")).toEqual(typescriptTokens(readFileSync(file, "utf8")))
    })
  }
})

describe("selfhost parser", () => {
  for (const file of files) {
    const text = readFileSync(file, "utf8")
    const expected = typescriptTree(file, text)
    if (!expected) continue
    test(relative(root, file), async () => {
      const { stdout, stderr } = await run("tree", file)
      expect(stderr).toBe("")
      expect(stdout.trimEnd().split("\n")).toEqual(expected)
    })
  }
})
