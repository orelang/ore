import { arrayOf, types, type Expr, type Type } from "@ore/ir"
import { parse, type Source } from "@ore/syntax"
import ts from "typescript"
import builtinText from "../../../std/builtin.d.ore" with { type: "text" }
import { Scope, type ValueSymbol } from "./symbols"

/** Values of built-in constants, declared without values in builtin.d.ore. */
const constants: Record<string, number> = { "Math.PI": Math.PI, "Math.E": Math.E }

/**
 * Builds the root scope from the type aliases and functions of
 * `std/builtin.d.ore`. Its interfaces are declared by the checker.
 */
export function builtinScope(): { scope: Scope; source: Source } {
  const { source, diagnostics } = parse("std/builtin.d.ore", builtinText)
  if (diagnostics.length > 0) throw new Error(`invalid builtin.d.ore: ${diagnostics[0]!.message}`)
  const scope = new Scope()

  for (const stmt of source.ast.statements) {
    if (ts.isTypeAliasDeclaration(stmt)) {
      const name = stmt.name.text
      const type = resolveBuiltinType(stmt.type, scope, name)
      if (type) scope.declareType(name, { type, decl: stmt })
    } else if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      const name = stmt.name.text
      const target = scope.lookupType(name)
      if (!target) throw new Error(`unknown builtin function ${name}`)
      scope.declareValue(name, { k: "conversion", type: target.type, decl: stmt })
    } else if (ts.isModuleDeclaration(stmt) && ts.isIdentifier(stmt.name) && stmt.body && ts.isModuleBlock(stmt.body)) {
      const ns = stmt.name.text
      const members = new Map<string, ValueSymbol>()
      for (const member of stmt.body.statements) {
        if (ts.isFunctionDeclaration(member) && member.name) {
          members.set(member.name.text, { k: "builtin", name: `${ns}.${member.name.text}`, decl: member })
        } else if (ts.isVariableStatement(member)) {
          for (const d of member.declarationList.declarations) {
            const name = `${ns}.${(d.name as ts.Identifier).text}`
            const value = constants[name]
            // A value known only at run time, such as `process.args`, is a call of a built-in.
            const expr: Expr =
              value !== undefined ? { k: "float", type: types.f64, value } : { k: "builtin", type: arrayOf(types.string), name, args: [] }
            if (value === undefined && name !== "process.args") throw new Error(`unknown builtin constant ${name}`)
            members.set((d.name as ts.Identifier).text, { k: "const", value: { k: "typed", expr }, type: expr.type, decl: d })
          }
        }
      }
      scope.declareValue(ns, { k: "namespace", name: ns, members, decl: stmt })
    }
  }
  return { scope, source }
}

function resolveBuiltinType(node: ts.TypeNode, scope: Scope, name: string): Type | undefined {
  // `type X = intrinsic` is parsed into a dedicated keyword node.
  if (node.kind === ts.SyntaxKind.IntrinsicKeyword) {
    const type = (types as Record<string, Type>)[name]
    if (!type) throw new Error(`unknown intrinsic type ${name}`)
    return type
  }
  if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) return scope.lookupType(node.typeName.text)?.type
  // Pseudo types such as `numeric` exist only to document built-in signatures.
  return undefined
}
