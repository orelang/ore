// Tables and pure functions of the checker.
import * as ir from "@ore/ir"
import { arrayOf, findField, findMethod, isStringLike, membersOf, sameType, types, typeToString, type FuncType, type Type } from "@ore/ir"
import ts from "typescript"
import type { Operand } from "./operand"

export const K = ts.SyntaxKind

export const arithOps = new Map<ts.SyntaxKind, ir.ArithOp>([
  [K.PlusToken, "+"],
  [K.MinusToken, "-"],
  [K.AsteriskToken, "*"],
  [K.SlashToken, "/"],
  [K.PercentToken, "%"],
  [K.AmpersandToken, "&"],
  [K.BarToken, "|"],
  [K.CaretToken, "^"],
  [K.LessThanLessThanToken, "<<"],
  [K.GreaterThanGreaterThanToken, ">>"],
])

export const compoundOps = new Map<ts.SyntaxKind, ir.ArithOp>([
  [K.PlusEqualsToken, "+"],
  [K.MinusEqualsToken, "-"],
  [K.AsteriskEqualsToken, "*"],
  [K.SlashEqualsToken, "/"],
  [K.PercentEqualsToken, "%"],
  [K.AmpersandEqualsToken, "&"],
  [K.BarEqualsToken, "|"],
  [K.CaretEqualsToken, "^"],
  [K.LessThanLessThanEqualsToken, "<<"],
  [K.GreaterThanGreaterThanEqualsToken, ">>"],
])

/** String methods: parameter types, how many trailing ones are optional, and the result. */
export const stringMethods: Record<string, [Type[], number, Type]> = {
  indexOf: [[types.string, types.i64], 1, types.i64],
  lastIndexOf: [[types.string], 0, types.i64],
  includes: [[types.string], 0, types.bool],
  startsWith: [[types.string], 0, types.bool],
  endsWith: [[types.string], 0, types.bool],
  split: [[types.string], 0, arrayOf(types.string)],
  trim: [[], 0, types.string],
  trimStart: [[], 0, types.string],
  trimEnd: [[], 0, types.string],
  toUpperCase: [[], 0, types.string],
  toLowerCase: [[], 0, types.string],
  replace: [[types.string, types.string], 0, types.string],
  replaceAll: [[types.string, types.string], 0, types.string],
  repeat: [[types.i64], 0, types.string],
  padStart: [[types.i64, types.string], 1, types.string],
  padEnd: [[types.i64, types.string], 1, types.string],
  substring: [[types.i64, types.i64], 1, types.string],
}

/** Array methods handled by `arrayMethod`, with their minimum and maximum argument counts. */
export const arrayMethods = new Map<string, [number, number]>([
  ["forEach", [1, 1]],
  ["map", [1, 1]],
  ["filter", [1, 1]],
  ["find", [1, 1]],
  ["findIndex", [1, 1]],
  ["some", [1, 1]],
  ["every", [1, 1]],
  ["reduce", [2, 2]],
  ["includes", [1, 1]],
  ["indexOf", [1, 1]],
  ["join", [0, 1]],
  ["reverse", [0, 0]],
  ["sort", [0, 1]],
])

export const compareOps = new Map<ts.SyntaxKind, ir.CompareOp>([
  [K.EqualsEqualsEqualsToken, "==="],
  [K.ExclamationEqualsEqualsToken, "!=="],
  [K.LessThanToken, "<"],
  [K.LessThanEqualsToken, "<="],
  [K.GreaterThanToken, ">"],
  [K.GreaterThanEqualsToken, ">="],
])

/** `null` before it gets a union type from the context. */
export const nullOperand = { k: "null", type: types.null } as unknown as ir.Expr

/** The member name of `[Symbol.dispose]`. */
export const disposeName = "[Symbol.dispose]"

export function isSymbolDispose(node: ts.Expression): boolean {
  return ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "Symbol" && node.name.text === "dispose"
}

/** Built-in functions that moved into namespaces. */
export const renamed: Record<string, string> = { println: "console.log", print: "console.write", panic: "process.panic" }

export function unknownName(name: string): string {
  const hint = renamed[name]
  return hint ? `Cannot find name '${name}'. Use '${hint}'.` : `Cannot find name '${name}'.`
}

/** A C identifier for a source name: other characters become `_x<hex>_`. */
export function cIdent(name: string): string {
  return name.replace(/[^A-Za-z0-9_]/g, (c) => `_x${c.codePointAt(0)!.toString(16)}_`)
}

/** Whether a type annotation refers to any of the type parameter names. */
export function mentions(node: ts.Node, names: string[]): boolean {
  if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName) && names.includes(node.typeName.text)) return true
  return ts.forEachChild(node, (child) => mentions(child, names) || undefined) ?? false
}

/** Whether a value of type `from` can be a member `m` of a union: the same type, or a string literal for `string`. */
export function memberOf(from: Type, m: Type): boolean {
  return sameType(from, m) || (from.kind === "literal" && m.kind === "string")
}

/** The type of a public field of a struct or interface, if it has one. */
export function fieldType(type: Type, name: string): Type | undefined {
  if (type.kind === "struct") {
    const field = findField(type, name)
    return field && !field.private ? field.type : undefined
  }
  if (type.kind === "interface") {
    const member = type.members.find((m) => m.name === name)
    return member?.k === "field" ? member.type : undefined
  }
  return undefined
}

/** The type of a public method of a class or interface, if it has one. */
export function methodType(type: Type, name: string): FuncType | undefined {
  if (type.kind === "struct") {
    const method = findMethod(type, name)
    return method && !method.private ? method.func.type : undefined
  }
  if (type.kind === "interface") {
    const member = type.members.find((m) => m.name === name)
    return member?.k === "method" ? member.type : undefined
  }
  return undefined
}

/** What `typeof` gives for values of a type. */
/** Statements handled by the declaration passes. */
export function isDeclaration(stmt: ts.Statement): boolean {
  return (
    ts.isTypeAliasDeclaration(stmt) ||
    ts.isFunctionDeclaration(stmt) ||
    ts.isClassDeclaration(stmt) ||
    ts.isInterfaceDeclaration(stmt) ||
    ts.isImportDeclaration(stmt) ||
    ts.isExportDeclaration(stmt) ||
    ts.isExportAssignment(stmt) ||
    ts.isEmptyStatement(stmt)
  )
}

/** The known directives and what they apply to. */
export const directiveKinds = new Map<string, "function" | "variable" | "module">([
  ["internal", "module"],
  ["noinline", "function"],
  ["inline", "function"],
  ["cold", "function"],
  ["naked", "function"],
  ["export", "function"],
  ["runtime", "function"],
  ["threadlocal", "variable"],
])

export function isStringLiteralNode(node: ts.Node): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
}

export function canBeNull(type: Type): boolean {
  return membersOf(type).some((m) => m.kind === "null")
}

export function isNull(value: Operand): boolean {
  return value.k === "typed" && value.expr.type.kind === "null"
}

export function isString(value: Operand): value is Extract<Operand, { k: "typed" }> {
  return value.k === "typed" && value.expr.type.kind === "string"
}

export function typed(expr: ir.Expr): Operand {
  return { k: "typed", expr }
}

export function typeOf(expr: ir.Expr): Type {
  return expr.type
}

export function numericLiteral(text: string): Operand {
  const clean = text.replace(/_/g, "")
  if (/^0[xob]/i.test(clean) || !/[.eE]/.test(clean)) return { k: "untyped-int", value: BigInt(clean) }
  return { k: "untyped-float", value: Number(clean) }
}

export function floatLit(type: ir.FloatType, value: number): ir.FloatLit {
  return { k: "float", type, value: type.bits === 32 ? Math.fround(value) : value }
}

/** Whether a type has a zero value for variables without an initializer; references do not. */
export function hasZeroValue(type: Type): boolean {
  if (type.kind === "union") return type.members.some((m) => m.kind === "null")
  return type.kind !== "struct" && type.kind !== "interface" && type.kind !== "chan" && type.kind !== "func" && type.kind !== "ptr"
}

export function zeroValue(type: Type): ir.Expr {
  switch (type.kind) {
    case "int":
      return { k: "int", type, value: 0n }
    case "float":
      return { k: "float", type, value: 0 }
    case "bool":
      return { k: "bool", type, value: false }
    case "string":
      return { k: "string", type, value: "" }
    case "array":
      return { k: "array", type, elems: [] }
    case "map":
      return { k: "map", op: "new", type, mapType: type }
    case "union":
      return { k: "null", type }
    default:
      return poison(type)
  }
}

/**
 * Placeholder for an expression with a reported error. It has the expected
 * type to avoid cascading errors and never reaches codegen.
 */
export function poison(type: Type): ir.Expr {
  return { k: "int", type, value: 0n } as unknown as ir.Expr
}

export function isLiteral(expr: ir.Expr): boolean {
  return expr.k === "int" || expr.k === "float" || expr.k === "bool" || expr.k === "string"
}

export function isTrue(expr: ir.Expr): boolean {
  return expr.k === "bool" && expr.value
}

/** Whether control can never fall through the end of a statement. */
export function terminates(stmt: ir.Stmt): boolean {
  switch (stmt.k) {
    case "return":
      return true
    case "block":
      return stmt.body.some(terminates)
    case "if":
      return stmt.else !== undefined && terminates(stmt.then) && terminates(stmt.else)
    case "loop":
      return stmt.cond === undefined && !breaks(stmt.body, stmt.id, false)
    case "expr":
      return stmt.expr.type.kind === "never"
    case "using":
      return stmt.body.some(terminates)
    case "switch": {
      // Without a default, no clause may run. Otherwise execution ends at the
      // end of the last clause, unless a break exits the switch.
      const last = stmt.clauses.at(-1)
      return (
        (stmt.exhaustive || stmt.clauses.some((c) => !c.test)) &&
        last !== undefined &&
        last.body.some(terminates) &&
        !stmt.clauses.some((c) => c.body.some((s) => breaks(s, stmt.id, false)))
      )
    }
    default:
      return false
  }
}

/** Whether control never reaches the statement after this one: it returns, panics, breaks or continues. */
export function exits(stmt: ir.Stmt): boolean {
  switch (stmt.k) {
    case "break":
    case "continue":
      return true
    case "block":
      return stmt.body.some(exits)
    case "if":
      return stmt.else !== undefined && exits(stmt.then) && exits(stmt.else)
    default:
      return terminates(stmt)
  }
}

/** Whether a statement contains a `break` that exits the loop `loopId`. */
export function breaks(stmt: ir.Stmt, loopId: number, nested: boolean): boolean {
  switch (stmt.k) {
    case "break":
      return stmt.target === undefined ? !nested : stmt.target === loopId
    case "block":
      return stmt.body.some((s) => breaks(s, loopId, nested))
    case "if":
      return breaks(stmt.then, loopId, nested) || (stmt.else !== undefined && breaks(stmt.else, loopId, nested))
    case "loop":
    case "for-of":
      return breaks(stmt.body, loopId, true)
    case "switch":
      return stmt.clauses.some((c) => c.body.some((s) => breaks(s, loopId, true)))
    case "using":
      return stmt.body.some((s) => breaks(s, loopId, nested))
    default:
      return false
  }
}

/** Calls `visit` for every local used or declared in a subtree of IR, without entering other functions. */
export function visitLocals(node: unknown, visit: (local: ir.Local) => void, seen = new Set<object>()) {
  if (!node || typeof node !== "object" || seen.has(node)) return
  seen.add(node)
  if (Array.isArray(node)) {
    for (const n of node) visitLocals(n, visit, seen)
    return
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === "local" || key === "binding") visit(value as ir.Local)
    else if (key !== "type" && key !== "func" && key !== "captures") visitLocals(value, visit, seen)
  }
}

/** The name of a parameter's local: its own, or a made-up one for a destructured parameter. */
export function paramName(p: ts.ParameterDeclaration, index: number): string {
  return ts.isIdentifier(p.name) ? p.name.text : `param${index}`
}

/** Why values of a type cannot be converted to or from JSON, if they cannot. */
export function jsonProblem(type: Type, seen = new Set<Type>()): string | undefined {
  switch (type.kind) {
    case "int":
    case "float":
    case "bool":
    case "string":
    case "literal":
    case "null":
      return undefined
    case "array":
      return jsonProblem(type.elem, seen)
    case "map":
      if (!isStringLike(type.key)) return `Type '${typeToString(type)}' cannot be converted to or from JSON: the keys of a Map must be strings.`
      return jsonProblem(type.value, seen)
    case "struct":
      if (seen.has(type)) return undefined
      seen.add(type)
      for (const f of type.fields) {
        const problem = jsonProblem(f.type, seen)
        if (problem) return problem
      }
      return undefined
    case "union":
      for (const m of type.members) {
        const problem = jsonProblem(m, seen)
        if (problem) return problem
      }
      return undefined
    default:
      return `Type '${typeToString(type)}' cannot be converted to or from JSON.`
  }
}
