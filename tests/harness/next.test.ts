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
 *
 * Roles: for the same files, the role of each node (the name of the property
 * of its parent that holds it, "-" for the root) must equal the TypeScript AST's.
 *
 * Modules: for each program of tests/ (the entries of golden.test.ts) and the
 * Ore compiler itself, the modules loaded in order, their imports and text
 * imports must equal those of @ore/project, and so must the formatted
 * diagnostics when there is no syntax error.
 *
 * IR: for the same programs, `ore-next ir` must print the dump of the IR
 * module that @ore/checker builds (`dump` of compiler/ir/src/dump.ts), or,
 * for a program that does not check, the same formatted diagnostics.
 *
 * Read: for each valid program of tests/run and the Ore compiler itself, the
 * dump of the IR module built by @ore/checker, read by
 * compiler/next/src/ir/read.ore (`ore-next read`) and dumped again, must be
 * the same text.
 *
 * LLVM: for the same programs, `ore-next llvm` on that dump (the optimizer
 * and the backend in Ore) must print the LLVM IR that @ore/codegen emits for
 * the module, byte for byte, in release and in debug builds.
 */
import { check } from "@ore/checker"
import { emitModule } from "@ore/codegen"
import { build } from "@ore/driver"
import { loadProgram } from "@ore/project"
import { formatDiagnostic } from "@ore/syntax"
import { beforeAll, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import ts from "typescript"
import { dump } from "../../compiler/ir/src/dump"

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

/** The name of the property of `parent` that holds `child`, directly or in a NodeArray. */
function roleOf(parent: ts.Node, child: ts.Node): string {
  for (const [key, value] of Object.entries(parent)) {
    // `assertClause` is a deprecated alias of `attributes`, holding the same node.
    if (key === "parent" || key === "original" || key === "assertClause") continue
    if (value === child || (Array.isArray(value) && value.includes(child))) return key
  }
  return "?"
}

/** The TypeScript parser's tree in pre-order with roles: "role Kind start end", or undefined on syntax errors. */
function typescriptRoles(path: string, text: string): string[] | undefined {
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  if ((file as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length > 0) return undefined
  const bytes = byteOffsets(text)
  const lines: string[] = []
  const visit = (node: ts.Node, role: string) => {
    lines.push(`${role} ${kindNames.get(node.kind)} ${bytes[node.getStart(file)]} ${bytes[node.end]}`)
    ts.forEachChild(node, (child) => visit(child, roleOf(node, child)))
  }
  visit(file, "-")
  return lines
}

/** Program entries below a directory: NAME.ore, or NAME/main.ore for a program of several modules. */
function entries(dir: string): string[] {
  return readdirSync(dir)
    .flatMap((name) => {
      const path = join(dir, name)
      if (name.endsWith(".ore")) return [path]
      if (!statSync(path).isDirectory()) return []
      return existsSync(join(path, "main.ore")) ? [join(path, "main.ore")] : entries(path)
    })
    .sort()
}

/** What `ore-next modules` prints for a program, from @ore/project; null diagnostics when there are syntax errors. */
function typescriptModules(entry: string): { modules: string[]; diagnostics: string[] | null } {
  const program = loadProgram(entry)
  const modules: string[] = []
  for (const source of program.modules) {
    modules.push(source.path)
    for (const [specifier, target] of program.imports.get(source) ?? []) modules.push(`  import ${specifier} ${target.path}`)
    for (const [specifier, text] of program.texts.get(source) ?? []) modules.push(`  text ${specifier} ${Buffer.byteLength(text)}`)
  }
  const diagnostics = program.syntaxErrors ? null : program.diagnostics.flatMap((d) => formatDiagnostic(d).split("\n"))
  return { modules, diagnostics }
}

async function run(...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([binary, ...args], { stdout: "pipe", stderr: "pipe" })
  const [code, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  return { code, stdout, stderr }
}

beforeAll(async () => {
  // A debug build: with the checker, a release build of the compiler takes minutes, and runs no faster here.
  const result = await build(join(root, "compiler/next/src/main.ore"), { output: binary })
  expect(result.diagnostics.map((d) => d.message)).toEqual([])
}, 600_000)

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

describe("next roles", () => {
  for (const file of files) {
    const text = readFileSync(file, "utf8")
    const expected = typescriptRoles(file, text)
    if (!expected) continue
    test(relative(root, file), async () => {
      const { stdout, stderr } = await run("roles", file)
      expect(stderr).toBe("")
      expect(stdout.trimEnd().split("\n")).toEqual(expected)
    })
  }
})

describe("next modules", () => {
  const programs = [...entries(join(root, "tests/run")), ...entries(join(root, "tests/diag")), join(root, "compiler/next/src/main.ore")]
  for (const file of programs) {
    // Relative to the working directory, as the command line gives it.
    const entry = relative(process.cwd(), file)
    test(relative(root, file), async () => {
      const expected = typescriptModules(entry)
      const { code, stdout, stderr } = await run("modules", entry)
      expect(stderr).toBe("")
      expect(code).toBe(0)
      // The modules, then the diagnostics.
      const lines = stdout.trimEnd().split("\n")
      const count = expected.modules.length
      expect(lines.slice(0, count)).toEqual(expected.modules)
      if (expected.diagnostics !== null) expect(lines.slice(count)).toEqual(expected.diagnostics)
    })
  }
})

/** What `ore-next ir` prints for a program, from @ore/checker: the dump on stdout, or the diagnostics on stderr. */
function typescriptIr(entry: string): { code: number; stdout: string; stderr: string } {
  const program = loadProgram(entry)
  const checked = program.syntaxErrors ? undefined : check(program)
  const diagnostics = [...program.diagnostics, ...(checked?.diagnostics ?? [])]
  if (!checked?.module || program.diagnostics.length > 0) {
    return { code: 1, stdout: "", stderr: diagnostics.map((d) => `${formatDiagnostic(d)}\n`).join("") }
  }
  return { code: 0, stdout: dump(checked.module), stderr: "" }
}

describe("next ir", () => {
  const programs = [...entries(join(root, "tests/run")), ...entries(join(root, "tests/diag")), join(root, "compiler/next/src/main.ore")]
  // Programs whose IR or diagnostics still differ, with the reason.
  const skipped = new Set<string>([
    // Members of `fs` and `process` implemented by Ore modules (namespaceModules of the TS checker): not ported yet.
    "tests/run/concurrency/spawn-many.ore",
    "tests/run/library/dirs.ore",
    "tests/run/library/spawn.ore",
    "tests/diag/library/namespaces.ore",
  ])
  for (const file of programs) {
    const entry = relative(process.cwd(), file)
    const name = relative(root, file)
    if (skipped.has(name)) {
      test.skip(name, () => {})
      continue
    }
    test(name, async () => {
      const expected = typescriptIr(entry)
      const actual = await run("ir", entry)
      expect(actual.stderr).toBe(expected.stderr)
      expect(actual.code).toBe(expected.code)
      expect(actual.stdout).toBe(expected.stdout)
    }, 60_000)
  }
})

/** The valid programs whose IR the TypeScript checker builds: every one of tests/run, and the Ore compiler. */
const checkedPrograms = [...entries(join(root, "tests/run")), join(root, "compiler/next/src/main.ore")]

/** What the TypeScript compiler makes of a program: the dump of its IR, a file holding it, and its LLVM IR. */
type Compiled = { dump: string; path: string; debug: string; release: string }

const compiledWork = mkdtempSync(join(tmpdir(), "ore-next-ir-"))
const compiled = new Map<string, Compiled>()

/**
 * The IR module of a program from @ore/checker, which every program of
 * tests/run has, its dump, and its LLVM IR from @ore/codegen; computed once
 * for the read and LLVM blocks.
 */
function compile(file: string): Compiled {
  const known = compiled.get(file)
  if (known) return known
  // Relative to the working directory, as the command line gives it.
  const program = loadProgram(relative(process.cwd(), file))
  expect(program.diagnostics.map((d) => d.message)).toEqual([])
  const checked = check(program)
  expect(checked.diagnostics.map((d) => d.message)).toEqual([])
  const module = checked.module!
  const text = dump(module)
  const path = join(compiledWork, `${relative(root, file).replaceAll("/", "_")}.txt`)
  writeFileSync(path, text)
  // Debug first: a release build inlines calls in the module itself.
  const debug = emitModule(module, { debug: true })
  const release = emitModule(module, { debug: false })
  const result = { dump: text, path, debug, release }
  compiled.set(file, result)
  return result
}

describe("next read", () => {
  for (const file of checkedPrograms) {
    test(relative(root, file), async () => {
      const { dump: text, path } = compile(file)
      const { code, stdout, stderr } = await run("read", path)
      expect(stderr).toBe("")
      expect(code).toBe(0)
      expect(stdout).toBe(text)
    }, 120_000)
  }
})

/**
 * Programs whose LLVM IR from `ore-next llvm` still differs from that of
 * @ore/codegen, by path, with the reason; they are skipped. There are none:
 * every program matches byte for byte.
 */
const llvmDifferences = new Map<string, string>()

describe("next llvm", () => {
  for (const file of checkedPrograms) {
    const name = relative(root, file)
    const reason = llvmDifferences.get(name)
    for (const mode of ["release", "debug"] as const) {
      const testOrSkip = reason === undefined ? test : test.skip
      testOrSkip(`${name} (${mode})${reason === undefined ? "" : `: ${reason}`}`, async () => {
        const result = compile(file)
        const { code, stdout, stderr } = await run("llvm", result.path, ...(mode === "debug" ? ["--debug"] : []))
        expect(stderr).toBe("")
        expect(code).toBe(0)
        // Line by line first, so that a failure shows where the texts differ.
        if (stdout !== result[mode]) expect(stdout.split("\n")).toEqual(result[mode].split("\n"))
        expect(stdout === result[mode]).toBe(true)
      }, 120_000)
    }
  }
})

/** The *.test.ore files of compiler/next/test, as `ore test` runs them. */
describe("next tests", () => {
  const dir = join(root, "compiler/next/test")
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".test.ore")).sort()) {
    test(name, async () => {
      const output = join(mkdtempSync(join(tmpdir(), "ore-next-test-")), "test")
      const result = await build(join(dir, name), { output })
      expect(result.diagnostics.map((d) => d.message)).toEqual([])
      const proc = Bun.spawn([output], { stdout: "pipe", stderr: "pipe" })
      const [code, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()])
      expect({ code, stderr }).toEqual({ code: 0, stderr: "" })
      expect(stdout).toContain(" 0 failed")
    }, 120_000)
  }
})
