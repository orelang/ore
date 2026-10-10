import { check, type CheckInfo } from "@ore/checker"
import { typeToString } from "@ore/ir"
import { parse, type Diagnostic, type Source } from "@ore/syntax"
import ts from "typescript"

export interface Position {
  line: number
  character: number
}

export interface Range {
  start: Position
  end: Position
}

/** A location in the analyzed file, or in a file such as `std/builtin.d.ore`. */
export interface Location {
  path: string
  /** Text of the target file, for files that are not on disk. */
  text?: string
  range: Range
}

/** The result of analyzing one document. Positions are zero-based UTF-16 offsets, as in LSP. */
export class Analysis {
  readonly diagnostics: Diagnostic[]
  private readonly info: CheckInfo | undefined

  constructor(readonly source: Source, diagnostics: Diagnostic[], info: CheckInfo | undefined) {
    this.diagnostics = diagnostics
    this.info = info
  }

  range(source: Source, start: number, end: number): Range {
    const a = source.position(start)
    const b = source.position(end)
    return { start: { line: a.line, character: a.column }, end: { line: b.line, character: b.column } }
  }

  /** Markdown hover text for the identifier at a position. */
  hover(position: Position): { contents: string; range: Range } | undefined {
    const node = this.identifierAt(position)
    if (!node || !this.info) return undefined
    const range = this.range(this.source, node.getStart(this.source.ast), node.getEnd())
    const decl = this.info.definitions.get(node) ?? (isDeclarationName(node) ? node.parent : undefined)
    if (decl && ts.isFunctionDeclaration(decl)) return { contents: code(functionSignature(decl)), range }
    if (decl && ts.isTypeAliasDeclaration(decl)) return { contents: code(typeAliasText(decl)), range }

    const type = this.info.types.get(node) ?? (decl && declarationType(decl, this.info))
    if (!type) return undefined
    const kind = decl && isConstDeclaration(decl) ? "const" : decl && ts.isParameter(decl) ? "(parameter)" : "let"
    return { contents: code(`${kind} ${node.text}: ${typeToString(type)}`), range }
  }

  definition(position: Position): Location | undefined {
    const node = this.identifierAt(position)
    const decl = node && this.info?.definitions.get(node)
    if (!decl) return undefined
    const file = decl.getSourceFile()
    const name = (decl as ts.NamedDeclaration).name ?? decl
    const target = { path: file.fileName, text: file.fileName === this.source.path ? undefined : file.text }
    const start = name.getStart(file)
    const a = file.getLineAndCharacterOfPosition(start)
    const b = file.getLineAndCharacterOfPosition(name.getEnd())
    return { ...target, range: { start: { line: a.line, character: a.character }, end: { line: b.line, character: b.character } } }
  }

  private identifierAt(position: Position): ts.Identifier | undefined {
    const ast = this.source.ast
    let offset: number
    try {
      offset = ast.getPositionOfLineAndCharacter(position.line, position.character)
    } catch {
      return undefined
    }
    let found: ts.Identifier | undefined
    const visit = (node: ts.Node) => {
      if (offset < node.getStart(ast) || offset > node.getEnd()) return
      if (ts.isIdentifier(node)) found = node
      ts.forEachChild(node, visit)
    }
    visit(ast)
    return found
  }
}

export function analyze(path: string, text: string): Analysis {
  const parsed = parse(path, text)
  if (parsed.diagnostics.length > 0) return new Analysis(parsed.source, parsed.diagnostics, undefined)
  const checked = check(parsed.source)
  return new Analysis(parsed.source, checked.diagnostics, checked.info)
}

function code(text: string): string {
  return `\`\`\`ore\n${text}\n\`\`\``
}

function functionSignature(decl: ts.FunctionDeclaration): string {
  const file = decl.getSourceFile()
  const end = decl.body ? decl.body.getStart(file) : decl.getEnd()
  const text = file.text.slice(decl.getStart(file), end).trim().replace(/\s+/g, " ")
  return text.replace(/^export\s+/, "").replace(/^declare\s+/, "")
}

function typeAliasText(decl: ts.TypeAliasDeclaration): string {
  const file = decl.getSourceFile()
  const type = decl.type.kind === ts.SyntaxKind.IntrinsicKeyword ? "intrinsic" : decl.type.getText(file)
  return `type ${decl.name.text} = ${type}`
}

function isDeclarationName(node: ts.Identifier): boolean {
  const parent = node.parent
  return (ts.isFunctionDeclaration(parent) || ts.isTypeAliasDeclaration(parent) || ts.isVariableDeclaration(parent) || ts.isParameter(parent))
    && parent.name === node
}

function isConstDeclaration(decl: ts.Node): boolean {
  return ts.isVariableDeclaration(decl) && (decl.parent.flags & ts.NodeFlags.Const) !== 0
}

function declarationType(decl: ts.Node, info: CheckInfo) {
  const name = (decl as ts.NamedDeclaration).name
  return name ? info.types.get(name) : undefined
}
