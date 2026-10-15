// Statements, destructuring, closures and narrowing.
import * as ir from "@ore/ir"
import { findMethod, isNumeric, isStringLike, membersOf, sameType, typeofName, types, typeToString, type FuncType, type Type } from "@ore/ir"
import ts from "typescript"
import { errorOperand, type Operand } from "./operand"
import { Scope, type ValueSymbol } from "./symbols"
import type { Fact, Condition, LoopContext } from "./context"
import {
  disposeName,
  fieldType,
  isStringLiteralNode,
  typed,
  typeOf,
  hasZeroValue,
  zeroValue,
  poison,
  isTrue,
  terminates,
  exits,
  paramName,
} from "./helpers"
import { ClassChecker } from "./classes"

export abstract class StatementChecker extends ClassChecker {
  protected checkBlock(block: ts.Block, scope: Scope): ir.Block {
    const inner = new Scope(scope)
    const body: ir.Stmt[] = []
    this.withFacts([], () => {
      // Function declarations are hoisted, as in JavaScript: they exist from the
      // start of the block, can call each other, and see every variable of the
      // block. Their signatures are declared first and their bodies checked last.
      const nested = block.statements.filter(ts.isFunctionDeclaration)
      const locals = nested.map((decl) => this.declareNestedFunction(decl, inner))
      const statements: ir.Stmt[] = []
      this.checkStatements(block.statements.filter((s) => !ts.isFunctionDeclaration(s)), inner, statements)

      const creations: ir.Stmt[] = []
      const captured = new Set<ir.Local>()
      nested.forEach((decl, i) => {
        const local = locals[i]
        if (!local) return
        const closure = this.checkClosure(decl, inner, local.type)
        if (closure.k !== "typed") return
        for (const c of (closure.expr as ir.Closure).func.captures ?? []) captured.add(c)
        const assign: ir.Expr = { k: "assign", type: local.type, target: { k: "local", local }, value: closure.expr }
        creations.push({ k: "expr", expr: assign, line: this.line(decl) })
      })
      // Variables of this block used by hoisted functions get their boxes at the
      // start of the block; their declarations become assignments.
      const boxes: ir.Stmt[] = []
      statements.forEach((s, i) => {
        if (s.k !== "let" || !captured.has(s.local)) return
        s.local.assigned = true
        boxes.push({ k: "let", local: s.local, line: s.line })
        const init = s.init
        statements[i] = init ? { k: "expr", expr: { k: "assign", type: s.local.type, target: { k: "local", local: s.local }, value: init }, line: s.line } : { k: "block", body: [] }
      })
      for (const [i, local] of locals.entries()) if (local) body.push({ k: "let", local, line: this.line(nested[i]!) })
      body.push(...boxes, ...creations, ...statements)
    })
    return { k: "block", body }
  }

  /**
   * Checks statements of a block. A `using` declaration takes the statements
   * after it as its body, so that its resource is disposed when they end.
   */
  protected checkStatements(stmts: readonly ts.Statement[], scope: Scope, out: ir.Stmt[]) {
    for (const [i, stmt] of stmts.entries()) {
      if (ts.isVariableStatement(stmt) && stmt.declarationList.flags & ts.NodeFlags.Using) {
        this.checkUsing(stmt, stmts.slice(i + 1), scope, out)
        return
      }
      this.checkStmt(stmt, scope, out)
    }
  }

  protected checkUsing(stmt: ts.VariableStatement, rest: readonly ts.Statement[], scope: Scope, out: ir.Stmt[]) {
    // After an error, the rest of the block is still checked.
    const fail = (node: ts.Node, message: string) => {
      this.error(node, message)
      this.checkStatements(rest, scope, out)
    }
    const decls = stmt.declarationList.declarations
    if ((stmt.declarationList.flags & ts.NodeFlags.AwaitUsing) === ts.NodeFlags.AwaitUsing) return fail(stmt, "'await using' is not supported in Ore.")
    if (decls.length !== 1) return fail(stmt, "Declare one resource per 'using'.")
    const decl = decls[0]!
    if (!ts.isIdentifier(decl.name) || !decl.initializer) return fail(decl, "'using' needs a name and an initializer.")
    const declared = decl.type ? this.resolveValueType(decl.type, scope) : undefined
    const value = this.checkExpr(decl.initializer, scope, declared)
    if (value.k === "error") return this.checkStatements(rest, scope, out)
    const init = declared ? this.coerce(value, declared, decl.initializer) : this.toDefault(value, decl.initializer)
    const local = this.newLocal(decl.name.text, init.type, false)
    if (scope === this.globals) local.global = true
    if (!scope.declareValue(local.name, { k: "local", local, decl })) this.error(decl.name, `Cannot redeclare '${local.name}' in the same scope.`)
    this.info.types.set(decl.name, local.type)

    // The resource, or null, must have `[Symbol.dispose](): void`.
    const resource = this.without(local.type, (m) => m.kind === "null")
    const ref: ir.Expr = { k: "local", type: local.type, local }
    const target: ir.Expr = sameType(resource, local.type) ? ref : { k: "recast", type: resource, value: ref }
    const call = this.disposeCall(target)
    if (!call) return fail(decl.initializer, `Type '${typeToString(resource)}' is not disposable: it needs a '[Symbol.dispose](): void' method.`)
    const callStmt: ir.Stmt = { k: "expr", expr: call }
    const dispose: ir.Stmt = sameType(resource, local.type)
      ? callStmt
      : { k: "if", cond: { k: "not", type: types.bool, operand: { k: "is-null", type: types.bool, value: ref } }, then: callStmt }
    const body: ir.Stmt[] = []
    this.checkStatements(rest, scope, body)
    out.push({ k: "using", local, init, dispose, body, line: this.line(stmt) })
  }

  /** A call of `[Symbol.dispose]()` on a value, if its type has that method. */
  protected disposeCall(value: ir.Expr): ir.Expr | undefined {
    const type = value.type
    if (type.kind === "struct") {
      const method = findMethod(type, disposeName)
      if (method && method.func.params.length === 0) return { k: "method-call", type: method.func.type.result, func: method.func, receiver: value, args: [] }
    }
    if (type.kind === "interface") {
      const index = type.members.findIndex((m) => m.name === disposeName)
      const member = type.members[index]
      if (member?.k === "method" && member.type.params.length === 0) return { k: "iface-call", type: member.type.result, value, index, method: member.type, args: [] }
    }
    return undefined
  }

  /** Declares a local for a nested function declaration, typed by its annotations. */
  protected declareNestedFunction(decl: ts.FunctionDeclaration, scope: Scope): ir.Local | undefined {
    if (!decl.name || !decl.body) return this.error(decl, "A nested function needs a name and a body."), undefined
    if (decl.typeParameters) return this.error(decl.typeParameters[0]!, "Nested generic functions are not supported."), undefined
    const params: Type[] = []
    for (const p of decl.parameters) {
      if (!p.type) return this.error(p, `Parameter '${p.name.getText()}' must have a type annotation.`), undefined
      const t = this.resolveValueType(p.type, scope)
      if (!t) return undefined
      params.push(t)
    }
    const result = decl.type ? this.resolveType(decl.type, scope) : types.void
    if (!result) return undefined
    const local = this.newLocal(decl.name.text, { kind: "func", params, result }, false)
    // Assigned once its closure exists; a recursive function captures itself through a box.
    local.assigned = true
    if (!scope.declareValue(decl.name.text, { k: "local", local, decl })) this.error(decl.name, `Cannot redeclare '${decl.name.text}' in the same scope.`)
    this.info.types.set(decl.name, local.type)
    return local
  }

  /** Checks a statement whose own scope ends with it (a branch or loop body). */
  protected checkNested(stmt: ts.Statement, scope: Scope): ir.Stmt {
    if (ts.isBlock(stmt)) return this.checkBlock(stmt, scope)
    const body: ir.Stmt[] = []
    this.withFacts([], () => this.checkStmt(stmt, new Scope(scope), body))
    return body.length === 1 ? body[0]! : { k: "block", body }
  }

  protected checkStmt(stmt: ts.Statement, scope: Scope, out: ir.Stmt[]) {
    const before = out.length
    this.checkStmtInner(stmt, scope, out)
    const line = this.line(stmt)
    for (let i = before; i < out.length; i++) out[i]!.line ??= line
  }

  protected checkStmtInner(stmt: ts.Statement, scope: Scope, out: ir.Stmt[]) {
    const fn = this.fn!
    if (ts.isBlock(stmt)) out.push(this.checkBlock(stmt, scope))
    else if (ts.isVariableStatement(stmt)) this.checkVariables(stmt.declarationList, scope, out)
    else if (ts.isExpressionStatement(stmt)) {
      const value = this.checkExpr(stmt.expression, scope)
      if (value.k === "typed") out.push({ k: "expr", expr: value.expr })
    } else if (ts.isIfStatement(stmt)) {
      const condition = this.condition(stmt.expression, scope)
      const then = this.withFacts(condition.whenTrue, () => this.checkNested(stmt.thenStatement, scope))
      const elseStmt = stmt.elseStatement ? this.withFacts(condition.whenFalse, () => this.checkNested(stmt.elseStatement!, scope)) : undefined
      out.push({ k: "if", cond: condition.expr, then, else: elseStmt })
      // After `if (x === null) return` (or continue, break), x is not null for the rest of the block.
      const thenExits = exits(then)
      const elseExits = elseStmt !== undefined && exits(elseStmt)
      if (thenExits && !elseExits) this.addFacts(condition.whenFalse)
      else if (elseExits && !thenExits) this.addFacts(condition.whenTrue)
    } else if (ts.isWhileStatement(stmt)) {
      this.invalidateAssigned(stmt, scope)
      const condition = this.condition(stmt.expression, scope)
      const cond = condition.expr
      const loop = this.withFacts(condition.whenTrue, () => this.checkLoopBody(stmt.statement, scope))
      out.push(Object.assign(loop.ir, { k: "loop" as const, id: loop.id, cond: isTrue(cond) ? undefined : cond, condAfter: false, body: loop.body }))
    } else if (ts.isDoStatement(stmt)) {
      this.invalidateAssigned(stmt, scope)
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
        else if (word === "continue" && loop.isSwitch) this.error(stmt.label, `Cannot continue '${loop.label}': it labels a switch.`)
        else {
          loop.ir.labeled = true
          out.push({ k: word, target: loop.id })
        }
      } else if (word === "break") {
        if (fn.loops.length === 0) this.error(stmt, "'break' must be inside a loop or switch.")
        out.push({ k: "break" })
      } else {
        const loop = fn.loops.findLast((l) => !l.isSwitch)
        if (!loop) this.error(stmt, "'continue' must be inside a loop.")
        // Inside a switch, a plain C `continue` still targets the enclosing loop.
        out.push({ k: "continue" })
      }
    } else if (ts.isReturnStatement(stmt)) {
      out.push(this.checkReturn(stmt, scope))
    } else if (ts.isEmptyStatement(stmt)) {
      // nothing
    } else if (ts.isFunctionDeclaration(stmt)) {
      // A function declaration outside a block body, such as `if (x) function f() {}`.
      this.error(stmt, "A function declaration must be at the top level or directly in a block.")
    } else if (ts.isThrowStatement(stmt) || ts.isTryStatement(stmt)) {
      this.error(stmt, "Exceptions are not supported in Ore. Return an error value, or call panic() for unrecoverable failures.")
    } else if (ts.isSwitchStatement(stmt)) {
      const sw = this.checkSwitch(stmt, scope)
      if (sw) out.push(sw)
    } else if (ts.isForOfStatement(stmt)) {
      const loop = this.checkForOf(stmt, scope)
      if (loop) out.push(loop)
    } else if (ts.isForInStatement(stmt)) {
      this.error(stmt, "'for...in' is not supported in Ore. Use 'for...of'.")
    } else if (ts.isLabeledStatement(stmt)) {
      const label = stmt.label.text
      const inner = stmt.statement
      if (!(ts.isWhileStatement(inner) || ts.isDoStatement(inner) || ts.isForStatement(inner) || ts.isForOfStatement(inner) || ts.isSwitchStatement(inner))) {
        this.error(stmt.label, "Labels are only supported on loops and switches.")
      } else if (fn.loops.some((l) => l.label === label)) {
        this.error(stmt.label, `Duplicate label '${label}'.`)
      } else {
        fn.pendingLabel = label
      }
      this.checkStmt(inner, scope, out)
    } else if (ts.isEnumDeclaration(stmt)) {
      this.error(stmt, this.unsupportedTopLevel(stmt))
    } else {
      this.error(stmt, "This statement is not supported yet.")
    }
  }

  protected checkVariables(list: ts.VariableDeclarationList, scope: Scope, out: ir.Stmt[]) {
    const isConst = (list.flags & ts.NodeFlags.Const) !== 0
    if (!isConst && !(list.flags & ts.NodeFlags.Let)) {
      if (list.flags & (ts.NodeFlags.Using | ts.NodeFlags.AwaitUsing)) return this.error(list, "'using' must be a statement directly in a block.")
      return this.error(list, "'var' is not supported in Ore. Use 'let' or 'const'.")
    }
    for (const decl of list.declarations) {
      if (!ts.isIdentifier(decl.name)) {
        if (!decl.initializer) {
          this.error(decl.name, "A destructuring declaration must be initialized.")
          continue
        }
        const declared = decl.type ? this.resolveValueType(decl.type, scope) : undefined
        const value = this.checkExpr(decl.initializer, scope, declared)
        if (value.k === "error") continue
        const init = declared ? this.coerce(value, declared, decl.initializer) : this.toDefault(value, decl.initializer)
        this.bindPattern(decl.name, init, !isConst, scope, out)
        continue
      }
      const name = decl.name.text
      const declared = decl.type ? this.resolveValueType(decl.type, scope) : undefined
      if (isConst && !decl.initializer) this.error(decl.name, "A 'const' declaration must be initialized.")

      const value = decl.initializer ? this.checkExpr(decl.initializer, scope, declared) : undefined
      let symbol: ValueSymbol
      let init: ir.Expr
      if (isConst && !declared && value && (value.k === "untyped-int" || value.k === "untyped-float")) {
        // An untyped constant stays untyped, like in Go: `const n = 10` is usable as any numeric type.
        symbol = { k: "const", value, type: undefined, decl }
        this.info.types.set(decl.name, this.defaultType(value))
      } else {
        let type: Type
        // Without a value, a variable of a type without a zero value, or without a
        // type, must be assigned before it is read.
        let unassigned = false
        if (declared) {
          type = declared
          unassigned = !value && !hasZeroValue(declared)
          init = value ? this.coerce(value, declared, decl.initializer!) : zeroValue(declared)
        } else if (value) {
          init = this.toDefault(value, decl.initializer!)
          type = typeOf(init)
          if (type.kind === "void" || type.kind === "never") this.error(decl.initializer!, `Cannot assign an expression of type '${type.kind}' to a variable.`)
          if (type.kind === "null") this.error(decl.initializer!, `Cannot infer a type from 'null'. Add a type annotation, e.g. 'let ${name}: T | null = null'.`)
        } else {
          // Typed by its first assignment.
          type = types.never
          init = zeroValue(types.i64)
          unassigned = true
        }
        const local = this.newLocal(name, type, !isConst)
        // Its type is unknown: uses of it report nothing more.
        if (!declared && value?.k === "error") this.poisoned.add(local)
        if (scope === this.globals) local.global = true
        if (scope === this.globals && ts.isVariableStatement(decl.parent.parent)) {
          const directives = this.directives(decl.parent.parent)
          if (directives.some((d) => d.name === "threadlocal")) this.threadLocal(decl, local)
          const exported = directives.find((d) => d.name === "export" && d.arg !== "")
          if (exported) this.exportVariable(decl, local, exported.arg)
        }
        symbol = { k: "local", local, decl }
        if (!declared && !value) this.untyped.add(local)
        else this.info.types.set(decl.name, type)
        if (unassigned) {
          this.unassigned.add(local)
          this.declNodes.set(local, decl.name)
          out.push({ k: "let", local })
        } else if (local.global && !value && (isNumeric(type) || type.kind === "bool" || type.kind === "ptr")) {
          // Such a global is zero bits before any code runs, so the declaration does not store it again.
          out.push({ k: "let", local })
        } else {
          out.push({ k: "let", local, init })
        }
        const initType = decl.initializer && this.info.types.get(decl.initializer)
        if (initType) this.narrowTo(`L${local.id}`, type, initType)
      }
      if (!scope.declareValue(name, symbol)) this.error(decl.name, `Cannot redeclare '${name}' in the same scope.`)
    }
  }

  /**
   * Declares the names of a binding pattern, or a single name, with the parts
   * of `value` they select, adding the declarations to `out`.
   */
  protected bindPattern(name: ts.BindingName, value: ir.Expr, mutable: boolean, scope: Scope, out: ir.Stmt[]) {
    if (ts.isIdentifier(name)) return this.declareBinding(name, value, mutable, scope, out)
    // The value is read once per name, so it is held in a local first.
    let whole = value
    if (whole.k !== "local") {
      const local = this.newLocal("tmp", value.type, false)
      out.push({ k: "let", local, init: value })
      whole = { k: "local", type: value.type, local }
    }
    if (ts.isObjectBindingPattern(name)) {
      for (const e of name.elements) {
        if (e.dotDotDotToken) {
          this.error(e, "Rest elements are not supported in object destructuring.")
          continue
        }
        if (e.initializer) this.error(e.initializer, "Default values in destructuring are not supported.")
        const key = e.propertyName ?? e.name
        if (!ts.isIdentifier(key) && !ts.isStringLiteral(key)) {
          this.error(key, "Destructure a property by its name.")
          continue
        }
        const part = this.member(whole, key, key.text)
        if (part.k === "typed") this.bindPattern(e.name, part.expr, mutable, scope, out)
      }
      return
    }
    const array = whole.type
    if (array.kind !== "array") return this.error(name, `Type '${typeToString(array)}' cannot be destructured as an array.`)
    name.elements.forEach((e, i) => {
      if (ts.isOmittedExpression(e)) return
      if (e.initializer) this.error(e.initializer, "Default values in destructuring are not supported.")
      const index: ir.Expr = { k: "int", type: types.i64, value: BigInt(i) }
      const part: ir.Expr = e.dotDotDotToken ? { k: "slice", type: array, value: whole, start: index } : { k: "index", type: array.elem, target: whole, index }
      this.bindPattern(e.name, part, mutable, scope, out)
    })
  }

  protected declareBinding(name: ts.Identifier, init: ir.Expr, mutable: boolean, scope: Scope, out: ir.Stmt[]) {
    const local = this.newLocal(name.text, init.type, mutable)
    if (scope === this.globals) local.global = true
    if (!scope.declareValue(local.name, { k: "local", local, decl: name.parent })) this.error(name, `Cannot redeclare '${local.name}' in the same scope.`)
    this.info.types.set(name, init.type)
    out.push({ k: "let", local, init })
  }

  /** `[a, b] = value` or `({ a, b } = value)`: assigns the parts of the value; evaluates to the value. */
  protected checkDestructuringAssign(node: ts.BinaryExpression, scope: Scope): Operand {
    const operand = this.checkExpr(node.right, scope)
    if (operand.k === "error") return operand
    const value = this.toDefault(operand, node.right)
    const locals: ir.Bind["locals"] = []
    const assigns: ir.Expr[] = []
    const hold = (v: ir.Expr): ir.Expr => {
      const local = this.newLocal("tmp", v.type, false)
      locals.push({ local, init: v })
      return { k: "local", type: v.type, local }
    }
    const assign = (target: ts.Expression, part: ir.Expr) => {
      if (ts.isArrayLiteralExpression(target)) {
        const whole = hold(part)
        const array = whole.type
        if (array.kind !== "array") return this.error(target, `Type '${typeToString(array)}' cannot be destructured as an array.`)
        target.elements.forEach((e, i) => {
          if (ts.isOmittedExpression(e)) return
          const index: ir.Expr = { k: "int", type: types.i64, value: BigInt(i) }
          if (ts.isSpreadElement(e)) assign(e.expression, { k: "slice", type: array, value: whole, start: index })
          else assign(e, { k: "index", type: array.elem, target: whole, index })
        })
        return
      }
      if (ts.isObjectLiteralExpression(target)) {
        const whole = hold(part)
        for (const p of target.properties) {
          if (ts.isShorthandPropertyAssignment(p)) {
            const field = this.member(whole, p.name, p.name.text)
            if (field.k === "typed") assign(p.name, field.expr)
          } else if (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) {
            const field = this.member(whole, p.name, p.name.text)
            if (field.k === "typed") assign(p.initializer, field.expr)
          } else {
            this.error(p, "Destructure a property by its name.")
          }
        }
        return
      }
      const lvalue = this.assignTarget(target, scope)
      if (!lvalue) return
      if (lvalue.lvalue?.k === "local" && this.untyped.has(lvalue.lvalue.local)) {
        if (!this.settle(lvalue.lvalue.local, typed(part), target)) return
        lvalue.type = lvalue.lvalue.local.type
      }
      const key = this.refKey(target, scope)
      if (key) this.invalidate(key)
      if (lvalue.accessor) {
        const write = this.writeAccessor(lvalue, target, () => this.coerce(typed(part), lvalue.type, target), false)
        if (write.k === "typed") assigns.push(write.expr)
        return
      }
      assigns.push({ k: "assign", type: lvalue.type, target: lvalue.lvalue, value: this.coerce(typed(part), lvalue.type, target) })
    }
    assign(node.left, value)
    const result = locals[0]!
    const ref: ir.Expr = { k: "local", type: value.type, local: result.local }
    return typed({ k: "bind", type: value.type, locals, body: { k: "seq", type: value.type, exprs: [...assigns, ref] } })
  }

  protected checkFor(stmt: ts.ForStatement, outer: Scope): ir.Stmt {
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
    this.invalidateAssigned(stmt, scope)
    const condition = stmt.condition ? this.condition(stmt.condition, scope) : undefined
    const cond = condition?.expr
    let update: ir.Expr | undefined
    if (stmt.incrementor) {
      const value = this.checkExpr(stmt.incrementor, scope)
      if (value.k === "typed") update = value.expr
    }
    const { id, ir: shared, body } = this.withFacts(condition?.whenTrue ?? [], () => this.checkLoopBody(stmt.statement, scope))
    const loop: ir.LoopStmt = Object.assign(shared, {
      k: "loop" as const,
      id,
      perIteration: prelude.flatMap((s) => (s.k === "let" && s.local.mutable ? [s.local] : [])),
      cond: cond && !isTrue(cond) ? cond : undefined,
      condAfter: false,
      update,
      body,
    })
    return prelude.length === 0 ? loop : { k: "block", body: [...prelude, loop] }
  }

  protected checkForOf(stmt: ts.ForOfStatement, outer: Scope): ir.ForOfStmt | undefined {
    if (stmt.awaitModifier) return this.error(stmt.awaitModifier, "'for await' is not supported in Ore."), undefined
    const list = stmt.initializer
    if (!ts.isVariableDeclarationList(list) || !(list.flags & (ts.NodeFlags.Const | ts.NodeFlags.Let))) {
      return this.error(list, "The loop variable must be declared with 'const' or 'let'."), undefined
    }
    const decl = list.declarations[0]!
    if (decl.type) this.error(decl.type, "The loop variable cannot have a type annotation; its type comes from the iterable.")

    const value = this.checkExpr(stmt.expression, outer)
    if (value.k === "error") return undefined
    const iterable = this.toDefault(value, stmt.expression)
    const type = iterable.type
    const mutable = (list.flags & ts.NodeFlags.Let) !== 0
    // Names and types of the loop variables: one, or `[key, value]` for a map.
    let bindings: [ts.BindingName, Type][]
    if (type.kind === "map") {
      const pattern = decl.name
      const names = ts.isArrayBindingPattern(pattern) ? pattern.elements.map((e) => (ts.isBindingElement(e) && ts.isIdentifier(e.name) && !e.dotDotDotToken && !e.initializer ? e.name : undefined)) : []
      if (names.length !== 2 || !names[0] || !names[1]) return this.error(decl.name, "Iterate a Map with 'for (const [key, value] of map)'."), undefined
      bindings = [[names[0], type.key], [names[1], type.value]]
    } else {
      let elem: Type
      if (type.kind === "array" || type.kind === "chan" || type.kind === "set") elem = type.elem
      else if (type.kind === "string") elem = types.i32
      else return this.error(stmt.expression, `Type '${typeToString(type)}' is not iterable.`), undefined
      bindings = [[decl.name, elem]]
    }

    this.invalidateAssigned(stmt.statement, outer)
    const scope = new Scope(outer)
    // A destructured element is held by a hidden loop variable, unpacked at the start of each iteration.
    const prologue: ir.Stmt[] = []
    const locals = bindings.map(([name, t]) => {
      if (!ts.isIdentifier(name)) {
        const local = this.newLocal("item", t, false)
        this.bindPattern(name, { k: "local", type: t, local }, mutable, scope, prologue)
        return local
      }
      const local = this.newLocal(name.text, t, mutable)
      if (!scope.declareValue(local.name, { k: "local", local, decl: name.parent })) this.error(name, `Duplicate name '${name.text}'.`)
      this.info.types.set(name, t)
      return local
    })
    const loop = this.checkLoopBody(stmt.statement, scope)
    const body: ir.Stmt = prologue.length === 0 ? loop.body : { k: "block", body: [...prologue, ...(loop.body.k === "block" ? loop.body.body : [loop.body])] }
    return Object.assign(loop.ir, { k: "for-of" as const, id: loop.id, local: locals[0]!, value: locals[1], iterable, body })
  }

  protected checkSwitch(stmt: ts.SwitchStatement, outer: Scope): ir.SwitchStmt | undefined {
    const operand = this.checkExpr(stmt.expression, outer)
    if (operand.k === "error") return undefined
    const value = this.toDefault(operand, stmt.expression)
    const type = value.type
    if (!(isNumeric(type) || type.kind === "bool" || membersOf(type).every(isStringLike))) {
      return this.error(stmt.expression, `Cannot switch on a value of type '${typeToString(type)}'.`), undefined
    }
    const fn = this.fn!
    const local = this.newLocal("switch", type, false)
    const ref: ir.Expr = { k: "local", type, local }
    const loop: LoopContext = { id: fn.nextLoopId++, label: fn.pendingLabel, isSwitch: true, ir: { labeled: false } }
    fn.pendingLabel = undefined

    // All clauses share one block scope, as in TypeScript.
    const scope = new Scope(outer)
    const clauses: ir.SwitchStmt["clauses"] = []
    let hasDefault = false
    // String literal cases narrow the subject: within a clause, the values of
    // the cases that lead to it without falling through code; in default, the rest.
    const allCases = new Set<string>()
    for (const clause of stmt.caseBlock.clauses) {
      if (ts.isCaseClause(clause) && isStringLiteralNode(clause.expression)) allCases.add(clause.expression.text)
    }
    let entering = new Set<string>()
    let narrowable = true
    for (const clause of stmt.caseBlock.clauses) {
      let facts: Fact[] = []
      if (ts.isCaseClause(clause)) {
        if (isStringLiteralNode(clause.expression)) entering.add(clause.expression.text)
        else narrowable = false
        if (narrowable) facts = this.literalFacts(stmt.expression, entering, scope)[0]
      } else if (narrowable && entering.size === 0) {
        facts = this.literalFacts(stmt.expression, allCases, scope)[1]
      }
      this.facts.push(new Map(facts.map((f) => [f.key, f.type])))
      let test: ir.Expr | undefined
      if (ts.isCaseClause(clause)) {
        const compared = this.compare("===", typed(ref), this.checkExpr(clause.expression, scope), clause.expression, stmt.expression, clause.expression)
        test = compared.k === "typed" ? compared.expr : poison(types.bool)
      } else if (hasDefault) {
        this.error(clause, "A switch can have only one 'default' clause.")
      } else {
        hasDefault = true
      }
      fn.loops.push(loop)
      const body: ir.Stmt[] = []
      for (const s of clause.statements) this.checkStmt(s, scope, body)
      fn.loops.pop()
      this.facts.pop()
      clauses.push({ test, body })
      // The next clause is narrowed only if this one cannot fall through into it.
      if (clause.statements.length > 0) {
        const last = body.at(-1)
        const exits = last !== undefined && (last.k === "break" || last.k === "continue" || terminates(last))
        entering = new Set()
        narrowable = exits
      }
    }
    // A switch over a union of string literals that has a case for each is exhaustive.
    const exhaustive = membersOf(type).every((m) => m.kind === "literal" && allCases.has(m.value))
    return Object.assign(loop.ir, { k: "switch" as const, id: loop.id, local, value, clauses, exhaustive })
  }

  protected checkLoopBody(stmt: ts.Statement, scope: Scope): LoopContext & { body: ir.Stmt } {
    const fn = this.fn!
    const loop: LoopContext = { id: fn.nextLoopId++, label: fn.pendingLabel, ir: { labeled: false } }
    fn.pendingLabel = undefined
    fn.loops.push(loop)
    const body = this.checkNested(stmt, scope)
    fn.loops.pop()
    return { ...loop, body }
  }

  protected checkReturn(stmt: ts.ReturnStatement, scope: Scope): ir.ReturnStmt {
    const fn = this.fn!
    if (fn.topLevel) {
      this.error(stmt, "'return' is only allowed in a function. Use 'process.exit()' to end the program.")
      return { k: "return" }
    }
    if (fn.ctor) {
      if (stmt.expression) this.error(stmt.expression, "A constructor cannot return a value.")
      return { k: "return", value: { k: "local", type: fn.this!.type, local: fn.this! } }
    }
    if (fn.result === undefined) {
      // A closure without a return type takes the type of its first return.
      if (!stmt.expression) {
        fn.result = types.void
        return { k: "return" }
      }
      const value = this.checkExpr(stmt.expression, scope)
      if (value.k === "error") return { k: "return" }
      const expr = this.toDefault(value, stmt.expression)
      fn.result = expr.type
      return { k: "return", value: expr }
    }
    const result = fn.result
    if (!stmt.expression) {
      if (result.kind !== "void") this.error(stmt, `A return value of type '${typeToString(result)}' is required.`)
      return { k: "return" }
    }
    const value = this.checkExpr(stmt.expression, scope, result)
    if (result.kind === "void") {
      // `return f()` of a void `f` calls it and returns.
      if (value.k === "typed" && value.expr.type.kind === "void") return { k: "return", value: value.expr }
      if (value.k !== "error") this.error(stmt.expression, "A function without a return type annotation cannot return a value.")
      return { k: "return" }
    }
    return { k: "return", value: this.coerce(value, result, stmt.expression) }
  }

  protected checkCondition(node: ts.Expression, scope: Scope): ir.Expr {
    return this.coerce(this.checkExpr(node, scope), types.bool, node)
  }

  /** Records that closures, innermost first, capture a local of an enclosing function. */
  protected capture(local: ir.Local, closures: ir.Func[]) {
    if (closures.length === 0 || local.global) return
    local.captured = true
    for (const f of closures) if (!f.captures!.includes(local)) f.captures!.push(local)
  }

  /**
   * Checks an arrow function, function expression or nested function into a
   * closure. Parameter and return types come from annotations or from the
   * expected function type; otherwise the return type is inferred.
   */
  protected checkClosure(node: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration, outer: Scope, expected?: Type, inferResult = false): Operand {
    if (node.typeParameters) return this.fail(node.typeParameters[0]!, "Generic closures are not supported.")
    if (node.asteriskToken) return this.fail(node.asteriskToken, "Generators are not supported in Ore.")
    if (node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) return this.fail(node, "'async' is not supported in Ore. Use spawn() and channels.")
    // The expected function type, also from a union such as `(() => void) | null`.
    const funcs = expected ? membersOf(expected).filter((m): m is FuncType => m.kind === "func") : []
    const want = funcs.length === 1 ? funcs[0] : undefined
    if (want && node.parameters.length > want.params.length) {
      return this.fail(node, `This function takes ${node.parameters.length} parameter(s), but ${want.params.length} are expected.`)
    }
    const params: ir.Local[] = []
    for (const [i, p] of node.parameters.entries()) {
      if (p.dotDotDotToken || p.questionToken || p.initializer) return this.fail(p, "Optional, default and rest parameters are not supported in closures, which are called as values.")
      const type = p.type ? this.resolveValueType(p.type, outer) : want?.params[i]
      if (!type) return this.fail(p.name, `Parameter '${p.name.getText()}' needs a type annotation here.`)
      if (p.type && want && !sameType(type, want.params[i]!)) {
        return this.fail(p.type, `Parameter type '${typeToString(type)}' does not match the expected '${typeToString(want.params[i]!)}'.`)
      }
      this.info.types.set(p.name, type)
      params.push(this.newLocal(paramName(p, i), type, true))
    }
    // An unused trailing parameter of the expected type is still passed.
    for (let i = params.length; i < (want?.params.length ?? 0); i++) params.push(this.newLocal(`_${i}`, want!.params[i]!, false))

    const annotated = node.type ? this.resolveType(node.type, outer) : undefined
    const outerFn = this.fn
    const name = ts.isFunctionDeclaration(node) ? node.name!.text : "<lambda>"
    const func: ir.Func = {
      name: `ore_lambda_${this.nextLambda++}`,
      sourceName: outerFn?.closure ? `${outerFn.closure.sourceName}.${name}` : name,
      line: this.line(node),
      file: this.sourceOf(node).path,
      type: { kind: "func", params: params.map((p) => p.type), result: types.void },
      params,
      body: { k: "block", body: [] },
      exported: false,
      captures: [],
    }
    this.module.functions.push(func)
    const prologue: ir.Stmt[] = []
    const scope = this.paramScope(node.parameters, params, new Scope(outer, func), prologue)

    // Arrow functions keep the `this` of the enclosing method; function expressions have none.
    const isArrow = ts.isArrowFunction(node)
    const savedFn = this.fn
    const savedFacts = this.facts
    // What is known about constants where a function literal is created stays
    // true inside it. A hoisted declaration may run earlier, so it knows nothing.
    const inherited = new Map<string, Type>()
    if (!ts.isFunctionDeclaration(node)) {
      for (const frame of savedFacts) {
        for (const [key, type] of frame) {
          const id = /^L(\d+)$/.exec(key)?.[1]
          const local = id === undefined ? undefined : this.localsById.get(Number(id))
          if (local && !local.mutable && !local.assigned) inherited.set(key, type)
        }
      }
    }
    this.facts = [inherited]
    this.fn = {
      result: annotated ?? (inferResult ? undefined : want && want.result.kind !== "void" ? want.result : want ? types.void : undefined),
      closure: func,
      this: isArrow ? outerFn?.this : undefined,
      thisCaptures: isArrow ? [func, ...(outerFn?.thisCaptures ?? [])] : [],
      cls: isArrow ? outerFn?.cls : undefined,
      loops: [],
      nextLoopId: 0,
    }
    try {
      const body = node.body!
      if (ts.isBlock(body)) {
        func.body = this.checkBlock(body, scope)
      } else {
        // An expression body returns its value, or is evaluated for a void result.
        const value = this.checkExpr(body, scope, this.fn.result)
        if (value.k === "error") return errorOperand
        if (this.fn.result?.kind === "void") {
          func.body = { k: "block", body: value.k === "typed" ? [{ k: "expr", expr: value.expr }] : [] }
        } else {
          const expr = this.fn.result ? this.coerce(value, this.fn.result, body) : this.toDefault(value, body)
          this.fn.result ??= expr.type
          func.body = { k: "block", body: [{ k: "return", value: expr }] }
        }
      }
      func.body.body.unshift(...prologue)
      const result = this.fn.result ?? types.void
      func.type = { kind: "func", params: func.type.params, result }
      this.checkReturns(func, node.type ?? node)
    } finally {
      this.fn = savedFn
      this.facts = savedFacts
    }
    const closure: ir.Expr = { k: "closure", type: func.type, func }
    this.refNodes.set(closure, node)
    return typed(closure)
  }

  /** Checks a condition and the facts it establishes when true and when false. */
  protected condition(node: ts.Expression, scope: Scope): Condition {
    if (ts.isParenthesizedExpression(node)) return this.condition(node.expression, scope)
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
      const inner = this.condition(node.operand, scope)
      return { expr: { k: "not", type: types.bool, operand: inner.expr }, whenTrue: inner.whenFalse, whenFalse: inner.whenTrue }
    }
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind
      if (op === ts.SyntaxKind.AmpersandAmpersandToken || op === ts.SyntaxKind.BarBarToken) {
        const and = op === ts.SyntaxKind.AmpersandAmpersandToken
        const left = this.condition(node.left, scope)
        // The right side runs only when the left side did not decide the result.
        const right = this.withFacts(and ? left.whenTrue : left.whenFalse, () => this.condition(node.right, scope))
        const expr: ir.Expr = { k: "logical", type: types.bool, op: and ? "&&" : "||", left: left.expr, right: right.expr }
        return and
          ? { expr, whenTrue: [...left.whenTrue, ...right.whenTrue], whenFalse: [] }
          : { expr, whenTrue: [], whenFalse: [...left.whenFalse, ...right.whenFalse] }
      }
      if (op === ts.SyntaxKind.EqualsEqualsEqualsToken || op === ts.SyntaxKind.ExclamationEqualsEqualsToken) {
        const nullSide = node.right.kind === ts.SyntaxKind.NullKeyword ? node.left : node.left.kind === ts.SyntaxKind.NullKeyword ? node.right : undefined
        if (nullSide) {
          const expr = this.checkCondition(node, scope)
          const key = this.refKey(nullSide, scope)
          const type = this.info.types.get(nullSide)
          const notNull = key && type ? [{ key, type: this.without(type, (m) => m.kind === "null") }] : []
          return op === ts.SyntaxKind.EqualsEqualsEqualsToken ? { expr, whenTrue: [], whenFalse: notNull } : { expr, whenTrue: notNull, whenFalse: [] }
        }
        const literalSide = isStringLiteralNode(node.right) ? node.right : isStringLiteralNode(node.left) ? node.left : undefined
        if (literalSide) {
          const subject = literalSide === node.right ? node.left : node.right
          const expr = this.checkCondition(node, scope)
          const [yes, no] = this.literalFacts(subject, new Set([literalSide.text]), scope)
          return op === ts.SyntaxKind.EqualsEqualsEqualsToken ? { expr, whenTrue: yes, whenFalse: no } : { expr, whenTrue: no, whenFalse: yes }
        }
      }
      if (op === ts.SyntaxKind.InstanceOfKeyword) {
        const expr = this.checkCondition(node, scope)
        const key = this.refKey(node.left, scope)
        const type = this.info.types.get(node.left)
        const target = ts.isIdentifier(node.right) ? scope.lookupType(node.right.text)?.type : undefined
        if (!key || !type || !target) return { expr, whenTrue: [], whenFalse: [] }
        // Only a member of a union can be excluded when the test is false.
        const isMember = membersOf(type).some((m) => sameType(m, target))
        return { expr, whenTrue: [{ key, type: target }], whenFalse: isMember ? [{ key, type: this.without(type, (m) => sameType(m, target)) }] : [] }
      }
    }
    return { expr: this.checkCondition(node, scope), whenTrue: [], whenFalse: [] }
  }

  /**
   * Facts when `subject` equals one of `values`, and when it does not:
   * `subject` is a variable of a literal union (`mode === "a"`), a field of a
   * union of objects (`shape.kind === "circle"`), or `typeof x`.
   */
  protected literalFacts(subject: ts.Expression, values: Set<string>, scope: Scope): [Fact[], Fact[]] {
    if (ts.isParenthesizedExpression(subject)) return this.literalFacts(subject.expression, values, scope)
    const narrow = (target: ts.Expression, matches: (member: Type) => boolean | "both"): [Fact[], Fact[]] => {
      const key = this.refKey(target, scope)
      const type = this.info.types.get(target)
      if (!key || !type || type.kind !== "union") return [[], []]
      const yes = this.unionOf(type.members.filter((m) => matches(m) !== false))
      const no = this.unionOf(type.members.filter((m) => matches(m) !== true))
      return [[{ key, type: yes }], [{ key, type: no }]]
    }
    // Whether a type's values are all in `values` (true), none (false), or some (both).
    const covers = (type: Type): boolean | "both" => {
      const members = membersOf(type)
      if (members.every((m) => m.kind === "literal" && values.has(m.value))) return true
      if (members.every((m) => m.kind === "literal" && !values.has(m.value))) return false
      return "both"
    }
    if (ts.isTypeOfExpression(subject)) return narrow(subject.expression, (m) => values.has(typeofName(m)))
    if (ts.isPropertyAccessExpression(subject) && !subject.questionDotToken) {
      const base = this.info.types.get(subject.expression)
      if (base?.kind === "union") {
        return narrow(subject.expression, (m) => {
          const type = fieldType(m, subject.name.text)
          return type ? covers(type) : "both"
        })
      }
    }
    return narrow(subject, covers)
  }

  /**
   * The key of a variable or a field path for narrowing facts: `L<id>` for a
   * local or `this`, followed by `.field` for each field access.
   */
  protected refKey(node: ts.Expression, scope: Scope): string | undefined {
    if (ts.isParenthesizedExpression(node)) return this.refKey(node.expression, scope)
    if (ts.isIdentifier(node)) {
      const symbol = scope.lookupValue(node.text)
      return symbol?.k === "local" ? `L${symbol.local.id}` : undefined
    }
    if (node.kind === ts.SyntaxKind.ThisKeyword) return this.fn?.this ? `L${this.fn.this.id}` : undefined
    if (ts.isPropertyAccessExpression(node) && !node.questionDotToken) {
      const base = this.refKey(node.expression, scope)
      return base && `${base}.${node.name.text}`
    }
    return undefined
  }

  /** A reference narrowed by the facts in effect, with a run-time checked conversion. */
  protected narrowed(key: string, expr: ir.Expr): ir.Expr {
    for (let i = this.facts.length - 1; i >= 0; i--) {
      const type = this.facts[i]!.get(key)
      if (type) return this.narrowConvert(expr, type)
    }
    return expr
  }

  /**
   * Converts a value to a narrower type established by a check: a member of
   * its union, or the class behind an interface (directly or in a union).
   */
  protected narrowConvert(expr: ir.Expr, type: Type): ir.Expr {
    if (sameType(type, expr.type)) return expr
    if (type.kind === "struct" && expr.type.kind === "interface") return { k: "downcast", type, value: expr }
    if (type.kind === "struct" && expr.type.kind === "union" && !expr.type.members.some((m) => sameType(m, type))) {
      const via = this.interfaceFor(expr.type, type)
      if (via) return { k: "downcast", type, value: { k: "recast", type: via, value: expr } }
    }
    return { k: "recast", type, value: expr }
  }

  protected withFacts<T>(facts: Fact[], check: () => T): T {
    this.facts.push(new Map(facts.map((f) => [f.key, f.type])))
    try {
      return check()
    } finally {
      this.facts.pop()
    }
  }

  /** Adds facts that hold for the rest of the current flow scope. */
  protected addFacts(facts: Fact[]) {
    for (const f of facts) this.facts.at(-1)!.set(f.key, f.type)
  }

  /** Forgets facts about a variable or field path and paths through it, after it may have changed. */
  protected invalidate(key: string) {
    for (const frame of this.facts) {
      for (const k of frame.keys()) if (k === key || k.startsWith(`${key}.`)) frame.delete(k)
    }
  }

  /** Forgets facts about variables assigned anywhere in a loop, which may change between iterations. */
  protected invalidateAssigned(node: ts.Node, scope: Scope) {
    const visit = (n: ts.Node) => {
      let target: ts.Expression | undefined
      if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment) target = n.left
      if (target) {
        const key = this.refKey(target, scope)
        if (key) this.invalidate(key)
      }
      ts.forEachChild(n, visit)
    }
    visit(node)
  }
}
