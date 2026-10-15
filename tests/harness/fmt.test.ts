/**
 * The formatter written in Ore (`ore-next fmt --stdout`, compiler/next/src/fmt/)
 * checked against prettier with the options of `ore fmt` (formatOre in
 * compiler/cli/src/fmt.ts): on every .ore file of the repository its output
 * must equal prettier's.
 *
 * The files are formatted already, so each is also fed in deliberately
 * unformatted variants, made with the TypeScript scanner and parser so that
 * they still parse: indentation removed, lines joined or broken
 * after every bracket and comma, single quotes, semicolons, redundant
 * parentheses, identifiers made longer (lines too long, which must break) or
 * shorter (broken lines that must join), and comments inserted between
 * tokens and at the ends of lines.
 *
 * A file (or variant) that prettier does not format, because TypeScript does
 * not accept it (tests of compile errors, the lexer cases), is skipped.
 */
import { formatOre } from "@ore/cli/src/fmt"
import { build } from "@ore/driver"
import { beforeAll, describe, expect, test } from "bun:test"
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import ts from "typescript"
import { oreNext } from "./ore-next"

const root = join(import.meta.dir, "../..")
const work = mkdtempSync(join(tmpdir(), "ore-fmt-"))
/** The compiler in Ore, shared by the test files (./ore-next.ts). */
let binary = ""

function oreFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name.startsWith(".") || name === "node_modules") return []
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return oreFiles(path)
    return name.endsWith(".ore") ? [path] : []
  })
}

const files = ["tests", "runtime", "compiler/next"].flatMap((d) => oreFiles(join(root, d))).sort()

// -----------------------------------------------------------------------------
// Variants

const K = ts.SyntaxKind

type Token = { kind: ts.SyntaxKind; start: number; end: number }

/** The tokens of a text, with `}` rescanned as a template continuation where it is one. */
function tokens(text: string): Token[] {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, text)
  const templates: number[] = []
  const out: Token[] = []
  for (;;) {
    let kind = scanner.scan()
    if (kind === K.OpenBraceToken && templates.length > 0) templates[templates.length - 1]!++
    else if (kind === K.CloseBraceToken && templates.length > 0) {
      if (templates.at(-1) === 0) {
        templates.pop()
        kind = scanner.reScanTemplateToken(false)
      } else templates[templates.length - 1]!--
    }
    if (kind === K.TemplateHead || kind === K.TemplateMiddle) templates.push(0)
    out.push({ kind, start: scanner.getTokenStart(), end: scanner.getTokenEnd() })
    if (kind === K.EndOfFileToken) return out
  }
}

/** Inserts texts at positions; at one position, in the order given. */
function insert(text: string, edits: [number, string][]): string {
  const sorted = edits.map((e, i) => [...e, i] as const).sort((a, b) => b[0] - a[0] || b[2] - a[2])
  let out = text
  for (const [pos, s] of sorted) out = out.slice(0, pos) + s + out.slice(pos)
  return out
}

/** Tokens after which a line break cannot end a statement. */
const joinAfter = new Set([
  K.OpenParenToken,
  K.OpenBracketToken,
  K.OpenBraceToken,
  K.CommaToken,
  K.EqualsToken,
  K.EqualsGreaterThanToken,
  K.AmpersandAmpersandToken,
  K.BarBarToken,
  K.QuestionQuestionToken,
  K.QuestionToken,
  K.ColonToken,
  K.PlusToken,
  K.DotToken,
  K.BarToken,
  K.EqualsEqualsEqualsToken,
  K.ExclamationEqualsEqualsToken,
  K.LessThanToken,
])
const joinBefore = new Set([K.CloseParenToken, K.CloseBracketToken, K.CloseBraceToken, K.DotToken, K.QuestionDotToken])

/** Lines joined where the line break between two tokens is not significant and holds no comment. */
function joinLines(text: string): string {
  const toks = tokens(text)
  let out = ""
  let pos = 0
  for (let i = 1; i < toks.length; i++) {
    const prev = toks[i - 1]!
    const next = toks[i]!
    const trivia = text.slice(prev.end, next.start)
    if (!trivia.includes("\n") || trivia.includes("/")) continue
    if (!joinAfter.has(prev.kind) && !joinBefore.has(next.kind)) continue
    out += text.slice(pos, prev.end) + " "
    pos = next.start
  }
  return out + text.slice(pos)
}

/** A line break after every `(`, `[`, `{` and `,`. */
function explode(text: string): string {
  const breaks = [K.OpenParenToken, K.OpenBracketToken, K.OpenBraceToken, K.CommaToken]
  return insert(
    text,
    tokens(text)
      .filter((t) => breaks.includes(t.kind))
      .map((t) => [t.end, "\n"]),
  )
}

/** Double-quoted strings without quotes inside, single-quoted. */
function singleQuotes(text: string): string {
  let out = ""
  let pos = 0
  for (const t of tokens(text)) {
    if (t.kind !== K.StringLiteral) continue
    const content = text.slice(t.start + 1, t.end - 1)
    if (text[t.start] !== '"' || content.includes("'") || content.includes('"')) continue
    out += text.slice(pos, t.start) + "'" + content + "'"
    pos = t.end
  }
  return out + text.slice(pos)
}

/** Edits computed on the syntax tree of a text. */
function treeEdits(text: string, visit: (node: ts.Node, file: ts.SourceFile, edits: [number, string][]) => void): string {
  const file = ts.createSourceFile("variant.ts", text, ts.ScriptTarget.Latest, true)
  const edits: [number, string][] = []
  const walk = (node: ts.Node) => {
    visit(node, file, edits)
    ts.forEachChild(node, walk)
  }
  walk(file)
  return insert(text, edits)
}

/** A `;` after every statement and class field that has none. */
function semicolons(text: string): string {
  return treeEdits(text, (node, _, edits) => {
    const statement =
      ts.isExpressionStatement(node) ||
      ts.isVariableStatement(node) ||
      ts.isReturnStatement(node) ||
      ts.isThrowStatement(node) ||
      ts.isBreakStatement(node) ||
      ts.isContinueStatement(node) ||
      ts.isImportDeclaration(node) ||
      ts.isExportDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isPropertyDeclaration(node) ||
      ts.isDoStatement(node)
    if (statement && !text.slice(node.pos, node.end).trimEnd().endsWith(";")) edits.push([node.end, ";"])
  })
}

/** Redundant parentheses around binary, conditional, prefix and await expressions. */
function parentheses(text: string): string {
  return treeEdits(text, (node, file, edits) => {
    const binary =
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind !== K.CommaToken &&
      !(node.operatorToken.kind >= K.FirstAssignment && node.operatorToken.kind <= K.LastAssignment)
    const wrap = binary || ts.isConditionalExpression(node) || ts.isPrefixUnaryExpression(node) || ts.isAwaitExpression(node)
    if (wrap && !ts.isParenthesizedExpression(node.parent) && !ts.isExpressionStatement(node.parent)) {
      edits.push([node.getStart(file), "("])
      edits.push([node.end, ")"])
    }
  })
}

/** Every identifier renamed. */
function rename(text: string, f: (name: string) => string): string {
  let out = ""
  let pos = 0
  for (const t of tokens(text)) {
    if (t.kind !== K.Identifier) continue
    out += text.slice(pos, t.start) + f(text.slice(t.start, t.end))
    pos = t.end
  }
  return out + text.slice(pos)
}

/** A block comment before every `stride`-th token. */
function blockComments(text: string, stride: number): string {
  const toks = tokens(text)
  const edits: [number, string][] = []
  for (let i = 3; i < toks.length - 1; i += stride) edits.push([toks[i]!.start, `/* c${i} */ `])
  return insert(text, edits)
}

/** A line comment at the end of every `stride`-th line that ends between two tokens. */
function lineComments(text: string, stride: number): string {
  const toks = tokens(text)
  const edits: [number, string][] = []
  let count = 0
  for (let i = 1; i < toks.length; i++) {
    const trivia = text.slice(toks[i - 1]!.end, toks[i]!.start)
    const newline = trivia.indexOf("\n")
    if (newline < 0 || trivia.slice(0, newline).includes("/")) continue
    if (count++ % stride === 0) edits.push([toks[i - 1]!.end, ` // l${i}`])
  }
  return insert(text, edits)
}

const longer = (name: string) => name + "Xxxxxxxxxxx"
const shorter = (name: string) => name.slice(0, 1) + "q"

const variants: Record<string, (text: string) => string> = {
  "as written": (s) => s,
  "without indentation": (s) => s.replace(/^[ \t]+/gm, ""),
  "with lines joined": joinLines,
  "with lines broken": explode,
  "with single quotes": singleQuotes,
  "with semicolons": (s) => joinLines(semicolons(s)),
  "with parentheses": parentheses,
  "with long names, lines joined": (s) => joinLines(rename(s, longer)),
  "with long names, lines broken": (s) => explode(rename(s, longer)),
  "with short names, lines joined": (s) => joinLines(rename(s, shorter)),
  "with block comments": (s) => blockComments(s, 7),
  "with line comments": (s) => lineComments(s, 2),
}

// -----------------------------------------------------------------------------
// Tests

async function oreFormat(input: string): Promise<{ code: number; stdout: string; stderr: string }> {
  const path = join(work, `input-${Math.random().toString(36).slice(2)}.ore`)
  writeFileSync(path, input)
  const proc = Bun.spawn([binary, "fmt", "--stdout", path], { stdout: "pipe", stderr: "pipe" })
  const [code, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  return { code, stdout, stderr }
}

async function prettierFormat(input: string): Promise<string | undefined> {
  try {
    return await formatOre(input)
  } catch {
    return undefined
  }
}

beforeAll(async () => {
  binary = await oreNext()
}, 900_000)

for (const [name, variant] of Object.entries(variants)) {
  describe(`fmt, ${name}`, () => {
    for (const file of files) {
      test.concurrent(relative(root, file), async () => {
        const input = variant(readFileSync(file, "utf8"))
        const expected = await prettierFormat(input)
        if (expected === undefined) return
        const { code, stdout, stderr } = await oreFormat(input)
        expect(stderr).toBe("")
        expect(code).toBe(0)
        expect(stdout).toBe(expected)
      })
    }
  })
}
