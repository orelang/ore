import * as ir from "@ore/ir"
import { intRange, isNumeric, sameType, types, typeToString, type FuncType, type Type } from "@ore/ir"
import { diagnosticAt, type Diagnostic, type Source } from "@ore/syntax"
import ts from "typescript"
import { builtinScope } from "./builtins"
import { foldBinary, foldUnary } from "./fold"
import { errorOperand, type Operand } from "./operand"
import { Scope, type ValueSymbol } from "./symbols"

export interface CheckResult {
  /** Present only when there are no errors. */
  module?: ir.Module
  diagnostics: Diagnostic[]
  info: CheckInfo
}

/** Facts about the source collected for tooling (hover, go to definition). */
export interface CheckInfo {
  /** Type of each checked expression; untyped constants get their default type. */
  types: Map<ts.Node, Type>
  /** Declaration node of each resolved identifier. */
  definitions: Map<ts.Identifier, ts.Node>
}

export interface CheckOptions {
  /** Require `export function main()`. */
  entry: boolean
}

export function check(source: Source, options: CheckOptions = { entry: true }): CheckResult {
  return new Checker(source).run(options)
}

interface FuncContext {
  result: Type
  /** Enclosing loops, innermost last. */
  loops: LoopContext[]
  nextLoopId: number
  /** Label of a labeled statement whose loop has not been entered yet. */
  pendingLabel?: string
}

interface LoopContext {
  id: number
  label?: string
  /** Shared with the IR loop so a labeled jump can mark it. */
  ir: { labeled: boolean }
}

class Checker {
  private readonly diagnostics: Diagnostic[] = []
  private readonly info: CheckInfo = { types: new Map(), definitions: new Map() }
  private readonly module: ir.Module = { functions: [] }
  private nextLocalId = 0
  private fn: FuncContext | undefined

  constructor(private readonly source: Source) {}

  run(options: CheckOptions): CheckResult {
    const scope = new Scope(builtinScope())
    const bodies: [ts.FunctionDeclaration, ir.Func][] = []

    // Pass 1: type aliases and function signatures, so that functions can be
    // called before their declaration and recursively.
    for (const stmt of this.source.ast.statements) {
      if (ts.isTypeAliasDeclaration(stmt)) this.declareTypeAlias(stmt, scope)
      else if (ts.isFunctionDeclaration(stmt)) {
        const func = this.declareFunction(stmt, scope)
        if (func) bodies.push([stmt, func])
      }
    }

    // Pass 2: top-level constants in source order, then function bodies.
    for (const stmt of this.source.ast.statements) {
      if (ts.isTypeAliasDeclaration(stmt) || ts.isFunctionDeclaration(stmt)) continue
      if (ts.isVariableStatement(stmt)) this.checkTopLevelVariables(stmt, scope)
      else if (ts.isEmptyStatement(stmt)) continue
      else this.error(stmt, this.unsupportedTopLevel(stmt))
    }
    for (const [decl, func] of bodies) this.checkFunctionBody(decl, func, scope)

    if (options.entry) this.checkEntry(scope)

    const hasErrors = this.diagnostics.some((d) => d.severity === "error")
    return { module: hasErrors ? undefined : this.module, diagnostics: this.diagnostics, info: this.info }
  }

  // ---------------------------------------------------------------------------
  // Declarations

  private declareTypeAlias(decl: ts.TypeAliasDeclaration, scope: Scope) {
    if (decl.typeParameters) return this.error(decl.typeParameters[0]!, "Generic type aliases are not supported yet.")
    const type = this.resolveType(decl.type, scope)
    if (!type) return
    if (!scope.declareType(decl.name.text, { type, decl })) this.error(decl.name, `Duplicate type '${decl.name.text}'.`)
  }

  private declareFunction(decl: ts.FunctionDeclaration, scope: Scope): ir.Func | undefined {
    if (!decl.name) return this.error(decl, "A function declaration must have a name."), undefined
    if (!decl.body) return this.error(decl.name, "A function declaration must have a body."), undefined
    if (decl.typeParameters) this.error(decl.typeParameters[0]!, "Generic functions are not supported yet.")
    if (decl.asteriskToken) this.error(decl.asteriskToken, "Generators are not supported in Ore.")
    for (const mod of decl.modifiers ?? []) {
      if (mod.kind === ts.SyntaxKind.AsyncKeyword) this.error(mod, "'async' is not supported in Ore. Use spawn() and channels.")
      else if (mod.kind === ts.SyntaxKind.DefaultKeyword) this.error(mod, "Default exports are not supported in Ore.")
      else if (mod.kind !== ts.SyntaxKind.ExportKeyword) this.error(mod, `Modifier '${mod.getText()}' is not allowed here.`)
    }

    const params: ir.Local[] = []
    for (const p of decl.parameters) {
      if (!ts.isIdentifier(p.name)) {
        this.error(p.name, "Destructuring parameters are not supported yet.")
        continue
      }
      if (p.dotDotDotToken) this.error(p, "Rest parameters are not supported yet.")
      if (p.questionToken) this.error(p, "Optional parameters are not supported yet.")
      if (p.initializer) this.error(p.initializer, "Default parameter values are not supported yet.")
      let type: Type | undefined
      if (!p.type) this.error(p.name, `Parameter '${p.name.text}' must have a type annotation.`)
      else type = this.resolveValueType(p.type, scope)
      if (type) this.info.types.set(p.name, type)
      params.push(this.newLocal(p.name.text, type ?? types.i64, true))
    }

    const result = decl.type ? this.resolveType(decl.type, scope) ?? types.void : types.void
    const type: FuncType = { kind: "func", params: params.map((p) => p.type), result }
    const exported = decl.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false
    const func: ir.Func = {
      name: `ore_fn_${decl.name.text}`,
      sourceName: decl.name.text,
      type,
      params,
      body: { k: "block", body: [] },
      exported,
    }
    if (!scope.declareValue(decl.name.text, { k: "func", func, decl })) {
      this.error(decl.name, `Duplicate declaration '${decl.name.text}'.`)
      return undefined
    }
    this.module.functions.push(func)
    return func
  }

  private checkFunctionBody(decl: ts.FunctionDeclaration, func: ir.Func, outer: Scope) {
    const scope = new Scope(outer)
    decl.parameters.forEach((p, i) => {
      const local = func.params[i]
      if (local && ts.isIdentifier(p.name)) {
        if (!scope.declareValue(local.name, { k: "local", local, decl: p })) this.error(p.name, `Duplicate parameter '${local.name}'.`)
      }
    })
    this.fn = { result: func.type.result, loops: [], nextLoopId: 0 }
    func.body = this.checkBlock(decl.body!, scope)
    this.fn = undefined

    const result = func.type.result
    if (result.kind !== "void" && !terminates(func.body)) {
      this.error(decl.type ?? decl.name!, `Function '${func.sourceName}' must return a value of type '${typeToString(result)}' on every path.`)
    }
  }

  private checkTopLevelVariables(stmt: ts.VariableStatement, scope: Scope) {
    const list = stmt.declarationList
    if (!(list.flags & ts.NodeFlags.Const)) {
      return this.error(stmt, "Only 'const' declarations are allowed at the top level. Mutable globals are not supported.")
    }
    for (const decl of list.declarations) {
      if (!ts.isIdentifier(decl.name)) {
        this.error(decl.name, "Destructuring is not supported yet.")
        continue
      }
      if (!decl.initializer) {
        this.error(decl.name, "A 'const' declaration must be initialized.")
        continue
      }
      const declared = decl.type ? this.resolveValueType(decl.type, scope) : undefined
      let value = this.checkExpr(decl.initializer, scope)
      if (declared) value = { k: "typed", expr: this.coerce(value, declared, decl.initializer) }
      if (value.k === "typed" && !isLiteral(value.expr)) {
        this.error(decl.initializer, "A top-level constant must be initialized with a constant expression.")
        continue
      }
      const name = decl.name.text
      if (!scope.declareValue(name, { k: "const", value, type: declared, decl })) this.error(decl.name, `Duplicate declaration '${name}'.`)
    }
  }

  private checkEntry(scope: Scope) {
    const main = scope.lookupValue("main")
    if (!main || main.k !== "func") {
      return this.diagnostics.push({
        source: this.source,
        start: 0,
        length: 0,
        severity: "error",
        message: "The entry file must declare 'export function main()'.",
      })
    }
    const decl = main.decl as ts.FunctionDeclaration
    if (!main.func.exported) this.error(decl.name!, "'main' must be exported.")
    if (main.func.params.length > 0) this.error(decl.parameters[0]!, "'main' must not take parameters.")
    if (main.func.type.result.kind !== "void") this.error(decl.type!, "'main' must not return a value.")
  }

  private unsupportedTopLevel(stmt: ts.Statement): string {
    if (ts.isImportDeclaration(stmt) || ts.isExportDeclaration(stmt)) return "Imports and re-exports are not supported yet."
    if (ts.isClassDeclaration(stmt)) return "Classes are not supported yet."
    if (ts.isInterfaceDeclaration(stmt)) return "Interfaces are not supported yet."
    if (ts.isEnumDeclaration(stmt)) return "Enums are not supported in Ore. Use a union of literal types."
    if (ts.isModuleDeclaration(stmt)) return "Namespaces are not supported in Ore. Use modules."
    return "Only declarations are allowed at the top level. Put statements in 'main'."
  }

  // ---------------------------------------------------------------------------
  // Types

  private resolveType(node: ts.TypeNode, scope: Scope): Type | undefined {
    switch (node.kind) {
      case ts.SyntaxKind.NumberKeyword:
        return types.f64
      case ts.SyntaxKind.BooleanKeyword:
        return types.bool
      case ts.SyntaxKind.StringKeyword:
        return types.string
      case ts.SyntaxKind.VoidKeyword:
        return types.void
      case ts.SyntaxKind.NeverKeyword:
        return types.never
      case ts.SyntaxKind.AnyKeyword:
        return this.error(node, "'any' is not supported in Ore."), undefined
      case ts.SyntaxKind.UnknownKeyword:
        return this.error(node, "'unknown' is not supported yet."), undefined
    }
    if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
      if (node.typeArguments) return this.error(node, "Generic types are not supported yet."), undefined
      const symbol = scope.lookupType(node.typeName.text)
      if (!symbol) return this.error(node.typeName, `Cannot find type '${node.typeName.text}'.`), undefined
      this.info.definitions.set(node.typeName, symbol.decl)
      return symbol.type
    }
    if (ts.isParenthesizedTypeNode(node)) return this.resolveType(node.type, scope)
    this.error(node, "This kind of type is not supported yet.")
    return undefined
  }

  /** Resolves the type of a variable or parameter, which cannot be `void` or `never`. */
  private resolveValueType(node: ts.TypeNode, scope: Scope): Type | undefined {
    const type = this.resolveType(node, scope)
    if (type && (type.kind === "void" || type.kind === "never")) {
      this.error(node, `A value cannot have type '${type.kind}'.`)
      return undefined
    }
    return type
  }

  // ---------------------------------------------------------------------------
  // Statements

  private checkBlock(block: ts.Block, scope: Scope): ir.Block {
    const inner = new Scope(scope)
    const body: ir.Stmt[] = []
    for (const stmt of block.statements) this.checkStmt(stmt, inner, body)
    return { k: "block", body }
  }

  /** Checks a statement whose own scope ends with it (a branch or loop body). */
  private checkNested(stmt: ts.Statement, scope: Scope): ir.Stmt {
    if (ts.isBlock(stmt)) return this.checkBlock(stmt, scope)
    const body: ir.Stmt[] = []
    this.checkStmt(stmt, new Scope(scope), body)
    return body.length === 1 ? body[0]! : { k: "block", body }
  }

  private checkStmt(stmt: ts.Statement, scope: Scope, out: ir.Stmt[]) {
    const fn = this.fn!
    if (ts.isBlock(stmt)) out.push(this.checkBlock(stmt, scope))
    else if (ts.isVariableStatement(stmt)) this.checkVariables(stmt.declarationList, scope, out)
    else if (ts.isExpressionStatement(stmt)) {
      const value = this.checkExpr(stmt.expression, scope)
      if (value.k === "typed") out.push({ k: "expr", expr: value.expr })
    } else if (ts.isIfStatement(stmt)) {
      const cond = this.checkCondition(stmt.expression, scope)
      const then = this.checkNested(stmt.thenStatement, scope)
      const elseStmt = stmt.elseStatement ? this.checkNested(stmt.elseStatement, scope) : undefined
      out.push({ k: "if", cond, then, else: elseStmt })
    } else if (ts.isWhileStatement(stmt)) {
      const cond = this.checkCondition(stmt.expression, scope)
      const loop = this.checkLoopBody(stmt.statement, scope)
      out.push(Object.assign(loop.ir, { k: "loop" as const, id: loop.id, cond: isTrue(cond) ? undefined : cond, condAfter: false, body: loop.body }))
    } else if (ts.isDoStatement(stmt)) {
      const loop = this.checkLoopBody(stmt.statement, scope)
      const cond = this.checkCondition(stmt.expression, scope)
      out.push(Object.assign(loop.ir, { k: "loop" as const, id: loop.id, cond, condAfter: true, body: loop.body }))
    } else if (ts.isForStatement(stmt)) {
      out.push(this.checkFor(stmt, scope))
    } else if (ts.isBreakStatement(stmt) || ts.isContinueStatement(stmt)) {
      const word = ts.isBreakStatement(stmt) ? "break" : "continue"
      if (stmt.label) {
        const loop = fn.loops.findLast((l) => l.label === stmt.label!.text)
        if (!loop) this.error(stmt.label, `Cannot find loop label '${stmt.label.text}'.`)
        else {
          loop.ir.labeled = true
          out.push({ k: word, target: loop.id })
        }
      } else {
        if (fn.loops.length === 0) this.error(stmt, `'${word}' must be inside a loop.`)
        out.push({ k: word })
      }
    } else if (ts.isReturnStatement(stmt)) {
      out.push(this.checkReturn(stmt, scope))
    } else if (ts.isEmptyStatement(stmt)) {
      // nothing
    } else if (ts.isFunctionDeclaration(stmt)) {
      this.error(stmt, "Nested functions are not supported yet.")
    } else if (ts.isThrowStatement(stmt) || ts.isTryStatement(stmt)) {
      this.error(stmt, "Exceptions are not supported in Ore. Return an error value, or call panic() for unrecoverable failures.")
    } else if (ts.isSwitchStatement(stmt)) {
      this.error(stmt, "'switch' is not supported yet.")
    } else if (ts.isForOfStatement(stmt) || ts.isForInStatement(stmt)) {
      this.error(stmt, `'${ts.isForOfStatement(stmt) ? "for...of" : "for...in"}' is not supported yet.`)
    } else if (ts.isLabeledStatement(stmt)) {
      const label = stmt.label.text
      const inner = stmt.statement
      if (!(ts.isWhileStatement(inner) || ts.isDoStatement(inner) || ts.isForStatement(inner))) {
        this.error(stmt.label, "Labels are only supported on loops.")
      } else if (fn.loops.some((l) => l.label === label)) {
        this.error(stmt.label, `Duplicate label '${label}'.`)
      } else {
        fn.pendingLabel = label
      }
      this.checkStmt(inner, scope, out)
    } else {
      this.error(stmt, "This statement is not supported yet.")
    }
  }

  private checkVariables(list: ts.VariableDeclarationList, scope: Scope, out: ir.Stmt[]) {
    const isConst = (list.flags & ts.NodeFlags.Const) !== 0
    if (!isConst && !(list.flags & ts.NodeFlags.Let)) {
      if (list.flags & (ts.NodeFlags.Using | ts.NodeFlags.AwaitUsing)) return this.error(list, "'using' is not supported yet.")
      return this.error(list, "'var' is not supported in Ore. Use 'let' or 'const'.")
    }
    for (const decl of list.declarations) {
      if (!ts.isIdentifier(decl.name)) {
        this.error(decl.name, "Destructuring is not supported yet.")
        continue
      }
      const name = decl.name.text
      const declared = decl.type ? this.resolveValueType(decl.type, scope) : undefined
      if (isConst && !decl.initializer) this.error(decl.name, "A 'const' declaration must be initialized.")
      if (!decl.type && !decl.initializer) this.error(decl.name, `Variable '${name}' needs a type annotation or an initializer.`)

      const value = decl.initializer ? this.checkExpr(decl.initializer, scope) : undefined
      let symbol: ValueSymbol
      let init: ir.Expr
      if (isConst && !declared && value && (value.k === "untyped-int" || value.k === "untyped-float")) {
        // An untyped constant stays untyped, like in Go: `const n = 10` is usable as any numeric type.
        symbol = { k: "const", value, type: undefined, decl }
        this.info.types.set(decl.name, this.defaultType(value))
      } else {
        let type: Type
        if (declared) {
          type = declared
          init = value ? this.coerce(value, declared, decl.initializer!) : zeroValue(declared)
        } else if (value) {
          init = this.toDefault(value, decl.initializer!)
          type = typeOf(init)
          if (type.kind === "void" || type.kind === "never") this.error(decl.initializer!, `Cannot assign an expression of type '${type.kind}' to a variable.`)
        } else {
          type = types.i64
          init = zeroValue(type)
        }
        const local = this.newLocal(name, type, !isConst)
        symbol = { k: "local", local, decl }
        this.info.types.set(decl.name, type)
        out.push({ k: "let", local, init })
      }
      if (!scope.declareValue(name, symbol)) this.error(decl.name, `Cannot redeclare '${name}' in the same scope.`)
    }
  }

  private checkFor(stmt: ts.ForStatement, outer: Scope): ir.Stmt {
    const scope = new Scope(outer)
    const prelude: ir.Stmt[] = []
    const init = stmt.initializer
    if (init) {
      if (ts.isVariableDeclarationList(init)) this.checkVariables(init, scope, prelude)
      else {
        const value = this.checkExpr(init, scope)
        if (value.k === "typed") prelude.push({ k: "expr", expr: value.expr })
      }
    }
    const cond = stmt.condition ? this.checkCondition(stmt.condition, scope) : undefined
    let update: ir.Expr | undefined
    if (stmt.incrementor) {
      const value = this.checkExpr(stmt.incrementor, scope)
      if (value.k === "typed") update = value.expr
    }
    const { id, ir: shared, body } = this.checkLoopBody(stmt.statement, scope)
    const loop: ir.LoopStmt = Object.assign(shared, {
      k: "loop" as const,
      id,
      cond: cond && !isTrue(cond) ? cond : undefined,
      condAfter: false,
      update,
      body,
    })
    return prelude.length === 0 ? loop : { k: "block", body: [...prelude, loop] }
  }

  private checkLoopBody(stmt: ts.Statement, scope: Scope): LoopContext & { body: ir.Stmt } {
    const fn = this.fn!
    const loop: LoopContext = { id: fn.nextLoopId++, label: fn.pendingLabel, ir: { labeled: false } }
    fn.pendingLabel = undefined
    fn.loops.push(loop)
    const body = this.checkNested(stmt, scope)
    fn.loops.pop()
    return { ...loop, body }
  }

  private checkReturn(stmt: ts.ReturnStatement, scope: Scope): ir.ReturnStmt {
    const result = this.fn!.result
    if (!stmt.expression) {
      if (result.kind !== "void") this.error(stmt, `A return value of type '${typeToString(result)}' is required.`)
      return { k: "return" }
    }
    const value = this.checkExpr(stmt.expression, scope)
    if (result.kind === "void") {
      this.error(stmt.expression, "A function without a return type annotation cannot return a value.")
      return { k: "return" }
    }
    return { k: "return", value: this.coerce(value, result, stmt.expression) }
  }

  private checkCondition(node: ts.Expression, scope: Scope): ir.Expr {
    return this.coerce(this.checkExpr(node, scope), types.bool, node)
  }

  // ---------------------------------------------------------------------------
  // Expressions

  private checkExpr(node: ts.Expression, scope: Scope): Operand {
    const result = this.checkExprInner(node, scope)
    if (result.k === "typed") this.info.types.set(node, typeOf(result.expr))
    else if (result.k !== "error") this.info.types.set(node, this.defaultType(result))
    return result
  }

  private checkExprInner(node: ts.Expression, scope: Scope): Operand {
    if (ts.isParenthesizedExpression(node)) return this.checkExpr(node.expression, scope)
    // node.text is normalized ("5.0" becomes "5"); the source spelling decides int vs float.
    if (ts.isNumericLiteral(node)) return numericLiteral(node.getText(this.source.ast))
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      return typed({ k: "string", type: types.string, value: node.text })
    }
    if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) {
      return typed({ k: "bool", type: types.bool, value: node.kind === ts.SyntaxKind.TrueKeyword })
    }
    if (ts.isIdentifier(node)) return this.checkIdentifier(node, scope)
    if (ts.isBinaryExpression(node)) return this.checkBinary(node, scope)
    if (ts.isPrefixUnaryExpression(node)) return this.checkPrefixUnary(node, scope)
    if (ts.isPostfixUnaryExpression(node)) return this.checkIncDec(node.operand, node.operator, false, scope)
    if (ts.isCallExpression(node)) return this.checkCall(node, scope)
    if (ts.isConditionalExpression(node)) return this.checkConditional(node, scope)
    if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
      return this.fail(node, "Type assertions are not supported in Ore. Use a conversion such as 'i32(x)'.")
    }
    if (ts.isTemplateExpression(node)) return this.fail(node, "Template literals with substitutions are not supported yet.")
    if (node.kind === ts.SyntaxKind.NullKeyword) return this.fail(node, "'null' is not supported yet.")
    if (ts.isAwaitExpression(node)) return this.fail(node, "'await' is not supported in Ore.")
    if (ts.isDeleteExpression(node)) return this.fail(node, "'delete' is not supported in Ore.")
    return this.fail(node, "This expression is not supported yet.")
  }

  private checkIdentifier(node: ts.Identifier, scope: Scope): Operand {
    const symbol = scope.lookupValue(node.text)
    if (!symbol) return this.fail(node, `Cannot find name '${node.text}'.`)
    this.info.definitions.set(node, symbol.decl)
    switch (symbol.k) {
      case "local":
        return typed({ k: "local", type: symbol.local.type, local: symbol.local })
      case "const":
        return symbol.value
      default:
        return this.fail(node, `'${node.text}' is a function and cannot be used as a value yet.`)
    }
  }

  private checkBinary(node: ts.BinaryExpression, scope: Scope): Operand {
    const op = node.operatorToken.kind
    const K = ts.SyntaxKind
    if (op === K.EqualsToken) return this.checkAssign(node, undefined, scope)
    const compound = compoundOps.get(op)
    if (compound) return this.checkAssign(node, compound, scope)

    if (op === K.EqualsEqualsToken || op === K.ExclamationEqualsToken) {
      const strict = op === K.EqualsEqualsToken ? "===" : "!=="
      return this.fail(node.operatorToken, `'${node.operatorToken.getText()}' is not supported in Ore. Use '${strict}'.`)
    }
    if (op === K.GreaterThanGreaterThanGreaterThanToken) {
      return this.fail(node.operatorToken, "'>>>' is not supported in Ore. Use '>>' on an unsigned type.")
    }
    if (op === K.AmpersandAmpersandToken || op === K.BarBarToken) {
      const left = this.checkCondition(node.left, scope)
      const right = this.checkCondition(node.right, scope)
      return typed({ k: "logical", type: types.bool, op: op === K.AmpersandAmpersandToken ? "&&" : "||", left, right })
    }
    const arith = arithOps.get(op)
    if (arith) return this.arith(arith, this.checkExpr(node.left, scope), this.checkExpr(node.right, scope), node)
    const compare = compareOps.get(op)
    if (compare) return this.compare(compare, this.checkExpr(node.left, scope), this.checkExpr(node.right, scope), node)
    if (op === K.CommaToken) return this.fail(node.operatorToken, "The comma operator is not supported in Ore.")
    if (op === K.QuestionQuestionToken) return this.fail(node.operatorToken, "'??' is not supported yet.")
    if (op === K.AsteriskAsteriskToken) return this.fail(node.operatorToken, "'**' is not supported yet.")
    if (op === K.InstanceOfKeyword || op === K.InKeyword) return this.fail(node.operatorToken, `'${node.operatorToken.getText()}' is not supported yet.`)
    return this.fail(node.operatorToken, `Operator '${node.operatorToken.getText()}' is not supported.`)
  }

  private arith(op: ir.ArithOp, left: Operand, right: Operand, node: ts.BinaryExpression): Operand {
    if (left.k === "error" || right.k === "error") return errorOperand
    const opNode = node.operatorToken
    const shift = op === "<<" || op === ">>"

    if (left.k !== "typed" && right.k !== "typed") {
      const folded = foldBinary(op, left, right)
      if (typeof folded === "string") return this.fail(opNode, folded)
      return folded
    }

    if (shift) {
      const l = left.k === "typed" ? left.expr : this.toDefault(left, node.left)
      const r = right.k === "typed" ? right.expr : this.coerce(right, types.u64, node.right)
      const lt = typeOf(l)
      const rt = typeOf(r)
      if (lt.kind !== "int" || rt.kind !== "int") {
        return this.fail(opNode, `Operator '${op}' requires integer operands, got '${typeToString(lt)}' and '${typeToString(rt)}'.`)
      }
      return typed({ k: "arith", type: lt, op, left: l, right: r })
    }

    const [l, r] = this.unify(left, right, node.left, node.right)
    if (!l || !r) return errorOperand
    const type = typeOf(l)
    if (!sameType(type, typeOf(r))) {
      return this.fail(opNode, `Operator '${op}' cannot be applied to types '${typeToString(type)}' and '${typeToString(typeOf(r))}'. Convert one side explicitly, e.g. '${typeToString(type)}(x)'.`)
    }
    if (type.kind === "string" && op === "+") return this.fail(opNode, "String concatenation is not supported yet.")
    if (!isNumeric(type)) return this.fail(opNode, `Operator '${op}' cannot be applied to type '${typeToString(type)}'.`)
    if (type.kind === "float" && (op === "&" || op === "|" || op === "^")) {
      return this.fail(opNode, `Operator '${op}' requires integer operands, got '${type.name}'.`)
    }
    return typed({ k: "arith", type, op, left: l, right: r })
  }

  private compare(op: ir.CompareOp, left: Operand, right: Operand, node: ts.BinaryExpression): Operand {
    if (left.k === "error" || right.k === "error") return errorOperand
    if (left.k !== "typed" && right.k !== "typed") {
      const folded = foldBinary(op, left, right)
      if (typeof folded === "string") return this.fail(node.operatorToken, folded)
      return folded
    }
    const [l, r] = this.unify(left, right, node.left, node.right)
    if (!l || !r) return errorOperand
    const type = typeOf(l)
    if (!sameType(type, typeOf(r))) {
      return this.fail(node.operatorToken, `Cannot compare '${typeToString(type)}' with '${typeToString(typeOf(r))}'.`)
    }
    const ordered = op !== "===" && op !== "!=="
    if (ordered ? !isNumeric(type) : !(isNumeric(type) || type.kind === "bool" || type.kind === "string")) {
      return this.fail(node.operatorToken, `Operator '${op}' cannot be applied to type '${typeToString(type)}'.`)
    }
    return typed({ k: "compare", type: types.bool, op, left: l, right: r })
  }

  private checkAssign(node: ts.BinaryExpression, op: ir.ArithOp | undefined, scope: Scope): Operand {
    const local = this.assignTarget(node.left, scope)
    const value = this.checkExpr(node.right, scope)
    if (!local) return errorOperand
    let expr: ir.Expr
    if (op) {
      const current: Operand = typed({ k: "local", type: local.type, local })
      const combined = this.arith(op, current, value, node)
      if (combined.k !== "typed") return errorOperand
      expr = combined.expr
    } else {
      expr = this.coerce(value, local.type, node.right)
    }
    return typed({ k: "assign", type: local.type, target: local, value: expr })
  }

  private checkIncDec(target: ts.Expression, operator: ts.SyntaxKind, prefix: boolean, scope: Scope): Operand {
    const local = this.assignTarget(target, scope)
    if (!local) return errorOperand
    const op = operator === ts.SyntaxKind.PlusPlusToken ? "++" : "--"
    if (!isNumeric(local.type)) return this.fail(target, `Operator '${op}' cannot be applied to type '${typeToString(local.type)}'.`)
    return typed({ k: "incdec", type: local.type, target: local, op, prefix })
  }

  private assignTarget(node: ts.Expression, scope: Scope): ir.Local | undefined {
    if (ts.isParenthesizedExpression(node)) return this.assignTarget(node.expression, scope)
    if (!ts.isIdentifier(node)) return this.error(node, "Only variables can be assigned to yet."), undefined
    const symbol = scope.lookupValue(node.text)
    if (!symbol) return this.error(node, `Cannot find name '${node.text}'.`), undefined
    this.info.definitions.set(node, symbol.decl)
    if (symbol.k !== "local") return this.error(node, `Cannot assign to '${node.text}' because it is not a variable.`), undefined
    if (!symbol.local.mutable) return this.error(node, `Cannot assign to '${node.text}' because it is a constant.`), undefined
    this.info.types.set(node, symbol.local.type)
    return symbol.local
  }

  private checkPrefixUnary(node: ts.PrefixUnaryExpression, scope: Scope): Operand {
    const K = ts.SyntaxKind
    if (node.operator === K.PlusPlusToken || node.operator === K.MinusMinusToken) {
      return this.checkIncDec(node.operand, node.operator, true, scope)
    }
    if (node.operator === K.ExclamationToken) {
      return typed({ k: "not", type: types.bool, operand: this.checkCondition(node.operand, scope) })
    }
    const operand = this.checkExpr(node.operand, scope)
    if (operand.k === "error") return operand
    const op = node.operator === K.MinusToken ? "-" : node.operator === K.TildeToken ? "~" : "+"
    if (operand.k !== "typed") {
      const folded = foldUnary(op, operand)
      if (typeof folded === "string") return this.fail(node, folded)
      return folded
    }
    const type = typeOf(operand.expr)
    if (!isNumeric(type) || (op === "~" && type.kind !== "int")) {
      return this.fail(node, `Operator '${op}' cannot be applied to type '${typeToString(type)}'.`)
    }
    if (op === "+") return operand
    return typed({ k: "unary", type, op, operand: operand.expr })
  }

  private checkConditional(node: ts.ConditionalExpression, scope: Scope): Operand {
    const cond = this.checkCondition(node.condition, scope)
    const [then, otherwise] = this.unify(this.checkExpr(node.whenTrue, scope), this.checkExpr(node.whenFalse, scope), node.whenTrue, node.whenFalse)
    if (!then || !otherwise) return errorOperand
    const type = typeOf(then)
    if (!sameType(type, typeOf(otherwise))) {
      return this.fail(node, `Branches have different types '${typeToString(type)}' and '${typeToString(typeOf(otherwise))}'.`)
    }
    return typed({ k: "cond", type, cond, then, else: otherwise })
  }

  private checkCall(node: ts.CallExpression, scope: Scope): Operand {
    if (node.typeArguments) return this.fail(node.typeArguments[0]!, "Type arguments are not supported yet.")
    if (node.questionDotToken) return this.fail(node, "Optional calls are not supported yet.")
    const callee = node.expression
    if (!ts.isIdentifier(callee)) return this.fail(callee, "Only calls of named functions are supported yet.")
    const symbol = scope.lookupValue(callee.text)
    if (!symbol) return this.fail(callee, `Cannot find name '${callee.text}'.`)
    this.info.definitions.set(callee, symbol.decl)
    const args = node.arguments
    for (const arg of args) if (ts.isSpreadElement(arg)) return this.fail(arg, "Spread arguments are not supported yet.")

    switch (symbol.k) {
      case "conversion": {
        if (args.length !== 1) return this.fail(node, `Conversion '${callee.text}' expects exactly 1 argument, got ${args.length}.`)
        const target = symbol.type
        let value = this.checkExpr(args[0]!, scope)
        if (value.k === "untyped-float" && target.kind === "int") {
          // Converting a float constant to an integer truncates toward zero, then range-checks.
          if (!Number.isFinite(value.value)) return this.fail(args[0]!, `Cannot convert ${value.value} to '${target.name}'.`)
          value = { k: "untyped-int", value: BigInt(Math.trunc(value.value)) }
        }
        if (value.k !== "typed") return typed(this.coerce(value, target, args[0]!))
        const from = typeOf(value.expr)
        if (!isNumeric(from) || !isNumeric(target)) {
          return this.fail(args[0]!, `Cannot convert '${typeToString(from)}' to '${typeToString(target)}'.`)
        }
        if (sameType(from, target)) return value
        return typed({ k: "convert", type: target, value: value.expr })
      }
      case "builtin": {
        if (symbol.name === "panic") {
          if (args.length !== 1) return this.fail(node, `'panic' expects exactly 1 argument, got ${args.length}.`)
          const message = this.coerce(this.checkExpr(args[0]!, scope), types.string, args[0]!)
          return typed({ k: "builtin", type: types.never, name: "panic", args: [message] })
        }
        const values: ir.Expr[] = []
        for (const arg of args) {
          const value = this.checkExpr(arg, scope)
          if (value.k === "error") continue
          const expr = this.toDefault(value, arg)
          const type = typeOf(expr)
          if (!isNumeric(type) && type.kind !== "bool" && type.kind !== "string") {
            this.error(arg, `Cannot print a value of type '${typeToString(type)}'.`)
          }
          values.push(expr)
        }
        return typed({ k: "builtin", type: types.void, name: symbol.name, args: values })
      }
      case "func": {
        const func = symbol.func
        if (args.length !== func.params.length) {
          return this.fail(node, `Function '${func.sourceName}' expects ${func.params.length} argument(s), got ${args.length}.`)
        }
        const values = args.map((arg, i) => this.coerce(this.checkExpr(arg, scope), func.type.params[i]!, arg))
        return typed({ k: "call", type: func.type.result, func, args: values })
      }
      default:
        return this.fail(callee, `'${callee.text}' is not a function.`)
    }
  }

  // ---------------------------------------------------------------------------
  // Operand conversions

  /** Converts an operand to `target`, reporting an error if it is not assignable. */
  private coerce(value: Operand, target: Type, node: ts.Node): ir.Expr {
    switch (value.k) {
      case "error":
        return poison(target)
      case "typed": {
        const from = typeOf(value.expr)
        if (sameType(from, target) || from.kind === "never") return value.expr
        let message = `Type '${typeToString(from)}' is not assignable to type '${typeToString(target)}'.`
        if (isNumeric(from) && isNumeric(target)) message += ` Use an explicit conversion: '${typeToString(target)}(...)'.`
        this.error(node, message)
        return poison(target)
      }
      case "untyped-int": {
        if (target.kind === "int") {
          const [min, max] = intRange(target)
          if (value.value < min || value.value > max) {
            this.error(node, `Constant ${value.value} overflows '${target.name}' (range ${min}..${max}).`)
            return poison(target)
          }
          return { k: "int", type: target, value: value.value }
        }
        if (target.kind === "float") return floatLit(target, Number(value.value))
        this.error(node, `An integer constant is not assignable to type '${typeToString(target)}'.`)
        return poison(target)
      }
      case "untyped-float": {
        if (target.kind === "float") return floatLit(target, value.value)
        if (target.kind === "int") this.error(node, `A floating-point constant is not assignable to integer type '${target.name}'. Use '${target.name}(...)' to truncate.`)
        else this.error(node, `A floating-point constant is not assignable to type '${typeToString(target)}'.`)
        return poison(target)
      }
    }
  }

  /** Gives an untyped constant its default type: `int` for integers, `f64` for floats. */
  private toDefault(value: Operand, node: ts.Node): ir.Expr {
    if (value.k === "typed") return value.expr
    if (value.k === "error") return poison(types.i64)
    return this.coerce(value, this.defaultType(value), node)
  }

  private defaultType(value: Operand): Type {
    return value.k === "untyped-float" ? types.f64 : types.i64
  }

  /**
   * Brings two operands to a common type: an untyped side takes the type of
   * the typed side. Returns undefined operands if that fails, so that the
   * enclosing expression reports nothing more.
   */
  private unify(a: Operand, b: Operand, aNode: ts.Node, bNode: ts.Node): [ir.Expr | undefined, ir.Expr | undefined] {
    if (a.k === "error" || b.k === "error") return [undefined, undefined]
    if (a.k === "typed" && b.k === "typed") return [a.expr, b.expr]
    const before = this.diagnostics.length
    let result: [ir.Expr, ir.Expr]
    if (a.k === "typed") result = [a.expr, this.coerce(b, typeOf(a.expr), bNode)]
    else if (b.k === "typed") result = [this.coerce(a, typeOf(b.expr), aNode), b.expr]
    else {
      const type = a.k === "untyped-float" || b.k === "untyped-float" ? types.f64 : types.i64
      result = [this.coerce(a, type, aNode), this.coerce(b, type, bNode)]
    }
    return this.diagnostics.length === before ? result : [undefined, undefined]
  }

  // ---------------------------------------------------------------------------
  // Helpers

  private newLocal(name: string, type: Type, mutable: boolean): ir.Local {
    return { id: this.nextLocalId++, name, type, mutable }
  }

  private error(node: ts.Node, message: string) {
    this.diagnostics.push(diagnosticAt(this.source, node, message))
  }

  private fail(node: ts.Node, message: string): Operand {
    this.error(node, message)
    return errorOperand
  }
}

const K = ts.SyntaxKind

const arithOps = new Map<ts.SyntaxKind, ir.ArithOp>([
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

const compoundOps = new Map<ts.SyntaxKind, ir.ArithOp>([
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

const compareOps = new Map<ts.SyntaxKind, ir.CompareOp>([
  [K.EqualsEqualsEqualsToken, "==="],
  [K.ExclamationEqualsEqualsToken, "!=="],
  [K.LessThanToken, "<"],
  [K.LessThanEqualsToken, "<="],
  [K.GreaterThanToken, ">"],
  [K.GreaterThanEqualsToken, ">="],
])

function typed(expr: ir.Expr): Operand {
  return { k: "typed", expr }
}

export function typeOf(expr: ir.Expr): Type {
  return expr.type
}

function numericLiteral(text: string): Operand {
  const clean = text.replace(/_/g, "")
  if (/^0[xob]/i.test(clean) || !/[.eE]/.test(clean)) return { k: "untyped-int", value: BigInt(clean) }
  return { k: "untyped-float", value: Number(clean) }
}

function floatLit(type: ir.FloatType, value: number): ir.FloatLit {
  return { k: "float", type, value: type.bits === 32 ? Math.fround(value) : value }
}

function zeroValue(type: Type): ir.Expr {
  switch (type.kind) {
    case "int":
      return { k: "int", type, value: 0n }
    case "float":
      return { k: "float", type, value: 0 }
    case "bool":
      return { k: "bool", type, value: false }
    case "string":
      return { k: "string", type, value: "" }
    default:
      return poison(type)
  }
}

/**
 * Placeholder for an expression with a reported error. It has the expected
 * type to avoid cascading errors and never reaches codegen.
 */
function poison(type: Type): ir.Expr {
  return { k: "int", type, value: 0n } as unknown as ir.Expr
}

function isLiteral(expr: ir.Expr): boolean {
  return expr.k === "int" || expr.k === "float" || expr.k === "bool" || expr.k === "string"
}

function isTrue(expr: ir.Expr): boolean {
  return expr.k === "bool" && expr.value
}

/** Whether control can never fall through the end of a statement. */
function terminates(stmt: ir.Stmt): boolean {
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
    default:
      return false
  }
}

/** Whether a statement contains a `break` that exits the loop `loopId`. */
function breaks(stmt: ir.Stmt, loopId: number, nested: boolean): boolean {
  switch (stmt.k) {
    case "break":
      return stmt.target === undefined ? !nested : stmt.target === loopId
    case "block":
      return stmt.body.some((s) => breaks(s, loopId, nested))
    case "if":
      return breaks(stmt.then, loopId, nested) || (stmt.else !== undefined && breaks(stmt.else, loopId, nested))
    case "loop":
      return breaks(stmt.body, loopId, true)
    default:
      return false
  }
}
