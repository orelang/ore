import { check, type CheckInfo } from "@ore/checker"
import { typeToString, type Type } from "@ore/ir"
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

export interface Completion {
  label: string
  kind: "field" | "method"
  /** The member's type. */
  detail: string
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
    if (decl && ts.isClassDeclaration(decl)) return { contents: code(`class ${decl.name?.text}`), range }
    if (decl && ts.isInterfaceDeclaration(decl)) return { contents: code(interfaceText(decl)), range }
    if (decl && (ts.isMethodDeclaration(decl) || ts.isMethodSignature(decl))) {
      return { contents: code(`(method) ${ownerName(decl)}.${signatureText(decl)}`), range }
    }
    if (decl && ts.isConstructorDeclaration(decl)) return { contents: code(`constructor${signatureText(decl)}`), range }

    const type = this.info.types.get(node) ?? (decl && declarationType(decl, this.info))
    if (!type) return undefined
    if (decl && (ts.isPropertyDeclaration(decl) || ts.isPropertySignature(decl) || (ts.isParameter(decl) && ts.getModifiers(decl)?.length))) {
      return { contents: code(`(property) ${ownerName(decl)}.${node.text}: ${typeToString(type)}`), range }
    }
    const kind = decl && isConstDeclaration(decl) ? "const" : decl && ts.isParameter(decl) ? "(parameter)" : "let"
    return { contents: code(`${kind} ${node.text}: ${typeToString(type)}`), range }
  }

  /** Members of the value before a `.` at a position. */
  completions(position: Position): Completion[] {
    if (!this.info) return []
    const offset = this.offset(position)
    if (offset === undefined) return []
    let access: ts.PropertyAccessExpression | undefined
    const visit = (node: ts.Node) => {
      if (ts.isPropertyAccessExpression(node) && offset >= node.name.pos && offset <= Math.max(node.name.end, node.name.pos)) access = node
      if (node.pos <= offset && offset <= node.end) ts.forEachChild(node, visit)
    }
    visit(this.source.ast)
    if (!access) return []
    // A built-in namespace such as `console` lists its functions.
    const target = ts.isIdentifier(access.expression) ? this.info.definitions.get(access.expression) : undefined
    if (target && ts.isModuleDeclaration(target) && target.body && ts.isModuleBlock(target.body)) {
      return target.body.statements.flatMap((s): Completion[] =>
        ts.isFunctionDeclaration(s) && s.name ? [{ label: s.name.text, kind: "method", detail: signatureText(s) }] : [],
      )
    }
    const type = this.info.types.get(access.expression)
    return type ? members(type, enclosingClass(access)) : []
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

  private offset(position: Position): number | undefined {
    try {
      return this.source.ast.getPositionOfLineAndCharacter(position.line, position.character)
    } catch {
      return undefined
    }
  }

  private identifierAt(position: Position): ts.Identifier | undefined {
    const ast = this.source.ast
    const offset = this.offset(position)
    if (offset === undefined) return undefined
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
  if (parsed.diagnostics.length === 0) {
    const checked = check(parsed.source)
    return new Analysis(parsed.source, checked.diagnostics, checked.info)
  }
  // With syntax errors, such as while typing `obj.`, only syntax errors are
  // reported, but types are still collected for completion where possible.
  let info: CheckInfo | undefined
  try {
    info = check(parsed.source).info
  } catch {
    info = undefined
  }
  return new Analysis(parsed.source, parsed.diagnostics, info)
}

function members(type: Type, inside: string | undefined): Completion[] {
  switch (type.kind) {
    case "struct":
      return [
        ...type.fields.filter((f) => !f.private || inside === type.name).map((f): Completion => ({ label: f.name, kind: "field", detail: typeToString(f.type) })),
        ...type.methods.filter((m) => !m.private || inside === type.name).map((m): Completion => ({ label: m.name, kind: "method", detail: typeToString(m.func.type) })),
      ]
    case "interface":
      return type.members.map((m): Completion => ({ label: m.name, kind: m.k, detail: typeToString(m.type) }))
    case "array":
      return [
        { label: "length", kind: "field", detail: "i64" },
        { label: "push", kind: "method", detail: `(...values: ${typeToString(type.elem)}[]) => i64` },
        { label: "pop", kind: "method", detail: `() => ${typeToString(type.elem)}` },
        { label: "slice", kind: "method", detail: `(start?: int, end?: int) => ${typeToString(type)}` },
      ]
    case "string":
      return [
        { label: "length", kind: "field", detail: "i64" },
        { label: "slice", kind: "method", detail: "(start?: int, end?: int) => string" },
      ]
    default:
      return []
  }
}

/** Name of the class around a node, which may see its private members. */
function enclosingClass(node: ts.Node): string | undefined {
  for (let n: ts.Node | undefined = node; n; n = n.parent) if (ts.isClassDeclaration(n)) return n.name?.text
  return undefined
}

function ownerName(member: ts.Node): string {
  const owner = ts.isParameter(member) ? member.parent.parent : member.parent
  return (owner as ts.ClassDeclaration | ts.InterfaceDeclaration).name?.text ?? "{}"
}

/** `name(params): result` of a method, or `(params)` of a constructor. */
function signatureText(decl: ts.SignatureDeclaration): string {
  const file = decl.getSourceFile()
  const name = decl.name ? decl.name.getText(file) : ""
  const params = decl.parameters.map((p) => p.getText(file)).join(", ")
  return `${name}(${params})${decl.type ? `: ${decl.type.getText(file)}` : ""}`
}

function interfaceText(decl: ts.InterfaceDeclaration): string {
  const file = decl.getSourceFile()
  const members = decl.members.map((m) => `  ${m.getText(file).replace(/[;,]$/, "")}`)
  return `interface ${decl.name.text} {\n${members.join("\n")}\n}`
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
  return (
    (ts.isFunctionDeclaration(parent) ||
      ts.isTypeAliasDeclaration(parent) ||
      ts.isVariableDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isInterfaceDeclaration(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isMethodSignature(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isPropertySignature(parent)) &&
    parent.name === node
  )
}

function isConstDeclaration(decl: ts.Node): boolean {
  return ts.isVariableDeclaration(decl) && (decl.parent.flags & ts.NodeFlags.Const) !== 0
}

function declarationType(decl: ts.Node, info: CheckInfo) {
  const name = (decl as ts.NamedDeclaration).name
  return name ? info.types.get(name) : undefined
}
