// Expressions: names, operators, assignments, literals, members and conversions between them.
import * as ir from "@ore/ir"
import {
  arrayOf,
  findField,
  findMethod,
  isSubclass,
  isNumeric,
  isStringLike,
  membersOf,
  sameType,
  types,
  typeToString,
  type InterfaceType,
  type StructType,
  type Type,
  type UnionType,
} from "@ore/ir"
import ts from "typescript"
import { foldBinary, foldUnary } from "./fold"
import { errorOperand, type Operand } from "./operand"
import { Scope, type ValueSymbol } from "./symbols"
import type { AssignTarget } from "./context"
import {
  arithOps,
  compoundOps,
  compareOps,
  nullOperand,
  unknownName,
  fieldType,
  memberField,
  canBeNull,
  isNull,
  isString,
  typed,
  typeOf,
  numericLiteral,
} from "./helpers"
import { StatementChecker } from "./statements"

export abstract class ExpressionChecker extends StatementChecker {
  /**
   * Checks an expression. `expected` is the type required by the context; it
   * only guides literals whose type cannot be inferred alone, like `[]`.
   */
  protected checkExpr(node: ts.Expression, scope: Scope, expected?: Type): Operand {
    const result = this.checkExprInner(node, scope, expected)
    if (result.k === "typed") this.info.types.set(node, typeOf(result.expr))
    else if (result.k !== "error") this.info.types.set(node, this.defaultType(result))
    return result
  }

  protected checkExprInner(node: ts.Expression, scope: Scope, expected: Type | undefined): Operand {
    if (ts.isParenthesizedExpression(node)) return this.checkExpr(node.expression, scope, expected)
    if (ts.isArrayLiteralExpression(node)) return this.checkArrayLiteral(node, scope, expected)
    if (ts.isObjectLiteralExpression(node)) return this.checkObjectLiteral(node, scope, expected)
    // node.text is normalized ("5.0" becomes "5"); the source spelling decides int vs float.
    if (ts.isNumericLiteral(node)) return numericLiteral(node.getText())
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      return typed({ k: "string", type: types.string, value: node.text })
    }
    if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) {
      return typed({ k: "bool", type: types.bool, value: node.kind === ts.SyntaxKind.TrueKeyword })
    }
    if (ts.isIdentifier(node)) return this.checkIdentifier(node, scope)
    if (node.kind === ts.SyntaxKind.ThisKeyword) {
      const self = this.fn?.this
      if (!self) return this.fail(node, this.fn?.fieldInit ? "Field initializers cannot use 'this'." : "'this' can only be used inside a class.")
      this.capture(self, this.fn?.thisCaptures ?? [])
      return typed({ k: "local", type: self.type, local: self })
    }
    if (node.kind === ts.SyntaxKind.SuperKeyword) return this.fail(node, "'super' can only call the constructor or a method of the base class: 'super(...)' or 'super.m(...)'.")
    if (ts.isNewExpression(node)) return this.checkNew(node, scope, expected)
    if (ts.isBinaryExpression(node) && (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken || node.operatorToken.kind === ts.SyntaxKind.BarBarToken)) {
      return typed(this.condition(node, scope).expr)
    }
    if (ts.isBinaryExpression(node)) return this.checkBinary(node, scope)
    if (ts.isPrefixUnaryExpression(node)) return this.checkPrefixUnary(node, scope)
    if (ts.isPostfixUnaryExpression(node)) return this.checkIncDec(node.operand, node.operator, false, scope)
    if (ts.isCallExpression(node)) return this.checkCall(node, scope)
    if (ts.isConditionalExpression(node)) return this.checkConditional(node, scope, expected)
    if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
      return this.fail(node, "Type assertions are not supported in Ore. Use a conversion such as 'i32(x)'.")
    }
    if (ts.isTemplateExpression(node)) return this.checkTemplate(node, scope)
    if (ts.isPropertyAccessExpression(node)) return this.checkProperty(node, scope)
    if (ts.isElementAccessExpression(node)) return this.checkElement(node, scope)
    if (node.kind === ts.SyntaxKind.NullKeyword) return typed(nullOperand)
    if (ts.isNonNullExpression(node)) return this.checkNonNull(node, scope)
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return this.checkClosure(node, scope, expected)
    if (ts.isTypeOfExpression(node)) {
      const value = this.checkExpr(node.expression, scope)
      if (value.k === "error") return value
      return typed({ k: "typeof", type: types.string, value: this.toDefault(value, node.expression) })
    }
    if (ts.isAwaitExpression(node)) return this.fail(node, "'await' is not supported in Ore.")
    if (ts.isDeleteExpression(node)) return this.fail(node, "'delete' is not supported in Ore.")
    return this.fail(node, "This expression is not supported yet.")
  }

  protected checkIdentifier(node: ts.Identifier, scope: Scope): Operand {
    const found = scope.lookupCapturing(node.text)
    const symbol = found?.symbol
    if (symbol?.k === "local") this.capture(symbol.local, found!.closures)
    if (!symbol && node.text === "undefined") return this.fail(node, "'undefined' is not supported in Ore. Use 'null'.")
    if (!symbol) return this.fail(node, unknownName(node.text))
    this.info.definitions.set(node, symbol.decl)
    return this.symbolValue(symbol, node)
  }

  /** The value of a symbol named by `node`, or an error for names that are not values. */
  protected symbolValue(symbol: ValueSymbol, node: ts.Identifier | ts.MemberName): Operand {
    switch (symbol.k) {
      case "local": {
        const local = symbol.local
        if (this.poisoned.has(local)) return errorOperand
        if (this.untyped.has(local)) {
          // Its type comes from its first assignment, which has not been seen yet.
          this.readEarly.add(local)
          return this.fail(node, `Variable '${local.name}' is used before being assigned.`)
        }
        const ref: ir.Expr = { k: "local", type: local.type, local }
        if (this.unassigned.has(local)) this.refNodes.set(ref, node)
        return typed(this.narrowed(`L${local.id}`, ref))
      }
      case "const":
        return symbol.value
      case "class":
        return this.fail(node, `'${node.text}' is a class. Create an instance with 'new ${node.text}(...)'.`)
      case "generic-func":
        return this.fail(node, `'${node.text}' is a generic function and cannot be used as a value.`)
      case "namespace":
        return this.fail(node, `'${node.text}' is a namespace; call its functions, e.g. '${node.text}.${[...symbol.members.keys()][0]}(...)'.`)
      case "module":
        return this.fail(node, `'${node.text}' is a module; use its exports, e.g. '${node.text}.name'.`)
      case "func":
        if (symbol.func.extern) return this.fail(node, `External function '${symbol.func.name}' cannot be used as a value.`)
        return typed({ k: "func-ref", type: symbol.func.type, func: symbol.func })
      default:
        return this.fail(node, `'${node.text}' is a function and cannot be used as a value yet.`)
    }
  }

  protected checkBinary(node: ts.BinaryExpression, scope: Scope): Operand {
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
    if (compare) return this.compare(compare, this.checkExpr(node.left, scope), this.checkExpr(node.right, scope), node.operatorToken, node.left, node.right)
    if (op === K.CommaToken) return this.fail(node.operatorToken, "The comma operator is not supported in Ore.")
    if (op === K.QuestionQuestionToken) return this.checkCoalesce(node, scope)
    if (op === K.AsteriskAsteriskToken) return this.fail(node.operatorToken, "'**' is not supported yet.")
    if (op === K.InstanceOfKeyword) return this.checkInstanceOf(node, scope)
    if (op === K.InKeyword) return this.fail(node.operatorToken, "'in' is not supported in Ore.")
    return this.fail(node.operatorToken, `Operator '${node.operatorToken.getText()}' is not supported.`)
  }

  protected arith(op: ir.ArithOp, left: Operand, right: Operand, node: ts.BinaryExpression): Operand {
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

    if (op === "+" && (isString(left) || isString(right))) {
      if (!isString(left) || !isString(right)) {
        return this.fail(opNode, "Only strings can be concatenated with '+'. Use a template literal: `${a}${b}`.")
      }
      return typed({ k: "concat", type: types.string, parts: [left.expr, right.expr] })
    }
    const [l, r] = this.unify(left, right, node.left, node.right)
    if (!l || !r) return errorOperand
    const type = typeOf(l)
    if (!sameType(type, typeOf(r))) {
      return this.fail(opNode, `Operator '${op}' cannot be applied to types '${typeToString(type)}' and '${typeToString(typeOf(r))}'. Convert one side explicitly, e.g. '${typeToString(type)}(x)'.`)
    }
    if (type.kind === "string" && op === "+") return typed({ k: "concat", type: types.string, parts: [l, r] })
    if (!isNumeric(type)) return this.fail(opNode, `Operator '${op}' cannot be applied to type '${typeToString(type)}'.`)
    if (type.kind === "float" && (op === "&" || op === "|" || op === "^")) {
      return this.fail(opNode, `Operator '${op}' requires integer operands, got '${type.name}'.`)
    }
    return typed({ k: "arith", type, op, left: l, right: r })
  }

  protected compare(op: ir.CompareOp, left: Operand, right: Operand, opNode: ts.Node, leftNode: ts.Node, rightNode: ts.Node): Operand {
    if (left.k === "error" || right.k === "error") return errorOperand
    if (left.k !== "typed" && right.k !== "typed") {
      const folded = foldBinary(op, left, right)
      if (typeof folded === "string") return this.fail(opNode, folded)
      return folded
    }
    // Comparing with null tests a nullable value.
    if ((op === "===" || op === "!==") && (isNull(left) || isNull(right))) {
      const other = isNull(left) ? right : left
      if (other.k !== "typed") return this.fail(opNode, "A constant cannot be null.")
      // A narrowed reference is tested through its declared type.
      const value = other.expr.k === "recast" && canBeNull(other.expr.value.type) ? other.expr.value : other.expr
      if (!canBeNull(value.type)) {
        return this.fail(opNode, `Type '${typeToString(value.type)}' cannot be null, so this comparison is always ${op === "!=="}.`)
      }
      const test: ir.Expr = { k: "is-null", type: types.bool, value }
      return typed(op === "===" ? test : { k: "not", type: types.bool, operand: test })
    }
    let [l, r] = this.unify(left, right, leftNode, rightNode)
    if (!l || !r) return errorOperand
    // Two string constants, such as `target.os === "darwin"`, compare at compile time.
    if ((op === "===" || op === "!==") && l.k === "string" && r.k === "string") {
      return typed({ k: "bool", type: types.bool, value: (l.value === r.value) === (op === "===") })
    }
    // A member compares with a union containing it.
    if (!sameType(l.type, r.type) && r.type.kind === "union") l = this.coerce(typed(l), r.type, leftNode)
    else if (!sameType(l.type, r.type) && l.type.kind === "union") r = this.coerce(typed(r), l.type, rightNode)
    const type = typeOf(l)
    // Instances of a class and of a subclass compare by identity.
    const related = l.type.kind === "struct" && r.type.kind === "struct" && (isSubclass(l.type, r.type) || isSubclass(r.type, l.type))
    if (!sameType(type, typeOf(r)) && !related) {
      return this.fail(opNode, `Cannot compare '${typeToString(type)}' with '${typeToString(typeOf(r))}'.`)
    }
    const ordered = op !== "===" && op !== "!=="
    const equatable = isNumeric(type) || ["bool", "string", "array", "struct", "interface", "union", "map", "set", "literal", "func", "ptr", "chan"].includes(type.kind)
    if (ordered ? !(isNumeric(type) || type.kind === "string") : !equatable) {
      return this.fail(opNode, `Operator '${op}' cannot be applied to type '${typeToString(type)}'.`)
    }
    return typed({ k: "compare", type: types.bool, op, left: l, right: r })
  }

  protected checkAssign(node: ts.BinaryExpression, op: ir.ArithOp | undefined, scope: Scope): Operand {
    const result = this.checkAssignInner(node, op, scope)
    const key = this.refKey(node.left, scope)
    if (key) {
      this.invalidate(key)
      // After `x = value`, x has the type of the value until it changes again.
      const assigned = this.info.types.get(node.right)
      if (!op && result.k === "typed" && assigned) this.narrowTo(key, result.expr.type, assigned)
    }
    return result
  }

  /**
   * Writes an accessor property: evaluates the object once, computes the new
   * value from the old one (read by the getter, when `next` uses it), calls
   * the setter, and evaluates to the new value, or the old one for `x++`.
   */
  protected writeAccessor(target: AssignTarget, node: ts.Node, next: (old: () => ir.Expr) => ir.Expr | undefined, yieldOld: boolean): Operand {
    const { object, property, name } = target.accessor!
    const type = property.type
    const locals: ir.Bind["locals"] = []
    const hold = (value: ir.Expr): ir.Expr => {
      const local = this.newLocal("tmp", value.type, false)
      locals.push({ local, init: value })
      return { k: "local", type: value.type, local }
    }
    const self = hold(object)
    let old: ir.Expr | undefined
    const getOld = (): ir.Expr => (old ??= hold({ k: "method-call", type, func: property.get!, receiver: self, args: [] }))
    if ((yieldOld || next.length > 0) && !property.get) return this.fail(node, `Property '${name}' has a setter but no getter.`)
    if (yieldOld) getOld()
    const value = next(getOld)
    if (!value) return errorOperand
    const result = hold(value)
    const set: ir.Expr = { k: "method-call", type: types.void, func: property.set!, receiver: self, args: [result] }
    return typed({ k: "bind", type, locals, body: { k: "seq", type, exprs: [set, yieldOld ? old! : result] } })
  }

  /** Gives a variable declared without a type the type of its first assigned value. */
  protected settle(local: ir.Local, value: Operand, node: ts.Node): boolean {
    if (value.k === "error") return false
    const type = typeOf(this.toDefault(value, node))
    if (type.kind === "void" || type.kind === "never" || type.kind === "null") {
      this.error(node, `Cannot infer the type of '${local.name}' from this value. Add a type annotation, e.g. 'let ${local.name}: T'.`)
      this.readEarly.add(local)
      return false
    }
    local.type = type
    this.untyped.delete(local)
    this.info.types.set(this.declNodes.get(local)!, type)
    return true
  }

  /** Adds a fact that a reference of a union type holds a value of a narrower type. */
  protected narrowTo(key: string, declared: Type, actual: Type) {
    if (declared.kind !== "union" || sameType(declared, actual) || actual.kind === "null") return
    if (membersOf(actual).every((a) => declared.members.some((m) => sameType(m, a)))) this.addFacts([{ key, type: actual }])
  }

  protected checkAssignInner(node: ts.BinaryExpression, op: ir.ArithOp | undefined, scope: Scope): Operand {
    if (!op && (ts.isArrayLiteralExpression(node.left) || ts.isObjectLiteralExpression(node.left))) return this.checkDestructuringAssign(node, scope)
    const target = this.assignTarget(node.left, scope)
    // The first assignment of a variable declared without a type gives its type.
    const untyped = target?.lvalue?.k === "local" && this.untyped.has(target.lvalue.local) ? target.lvalue.local : undefined
    if (untyped && op) {
      this.readEarly.add(untyped)
      return this.fail(node.left, `Variable '${untyped.name}' is used before being assigned.`)
    }
    const value = this.checkExpr(node.right, scope, op || untyped ? undefined : target?.type)
    if (!target) return errorOperand
    if (untyped) {
      if (!this.settle(untyped, value, node.right)) return errorOperand
      target.type = untyped.type
    }
    if (target.accessor) {
      if (value.k === "error") return value
      if (!op) return this.writeAccessor(target, node, () => this.coerce(value, target.type, node.right), false)
      return this.writeAccessor(target, node, (old) => {
        const combined = this.arith(op, typed(old()), value, node)
        return combined.k === "typed" ? this.coerce(combined, target.type, node) : undefined
      }, false)
    }
    const { lvalue, type } = target
    if (!op) return typed({ k: "assign", type, target: lvalue, value: this.coerce(value, type, node.right) })

    if (lvalue.k === "local") {
      // Reading a local has no side effects: expand `x op= v` to `x = x op v`.
      const combined = this.arith(op, typed({ k: "local", type, local: lvalue.local }), value, node)
      if (combined.k !== "typed") return errorOperand
      return typed({ k: "assign", type, target: lvalue, value: combined.expr })
    }
    // Type-check `element op v` with a placeholder for the element, which must be evaluated once.
    const placeholder: ir.Expr = { k: "local", type, local: { id: -1, name: "element", type, mutable: true } }
    const combined = this.arith(op, typed(placeholder), value, node)
    if (combined.k !== "typed") return errorOperand
    const right = combined.expr.k === "arith" ? combined.expr.right : combined.expr.k === "concat" ? combined.expr.parts[1]! : undefined
    if (!right) return errorOperand
    return typed({ k: "assign", type, target: lvalue, op, value: right })
  }

  protected checkIncDec(node: ts.Expression, operator: ts.SyntaxKind, prefix: boolean, scope: Scope): Operand {
    const target = this.assignTarget(node, scope)
    if (!target) return errorOperand
    if (target.lvalue?.k === "local" && this.untyped.has(target.lvalue.local)) {
      this.readEarly.add(target.lvalue.local)
      return this.fail(node, `Variable '${target.lvalue.local.name}' is used before being assigned.`)
    }
    const op = operator === ts.SyntaxKind.PlusPlusToken ? "++" : "--"
    const type = target.type
    if (!isNumeric(type)) return this.fail(node, `Operator '${op}' cannot be applied to type '${typeToString(type)}'.`)
    if (target.accessor) {
      const one: ir.Expr = type.kind === "int" ? { k: "int", type, value: 1n } : { k: "float", type: type as ir.FloatLit["type"], value: 1 }
      return this.writeAccessor(target, node, (old) => ({ k: "arith", type: type as ir.Arith["type"], op: op === "++" ? "+" : "-", left: old(), right: one }), !prefix)
    }
    return typed({ k: "incdec", type, target: target.lvalue, op, prefix })
  }

  protected assignTarget(node: ts.Expression, scope: Scope): AssignTarget | undefined {
    if (ts.isParenthesizedExpression(node)) return this.assignTarget(node.expression, scope)
    if (ts.isElementAccessExpression(node)) {
      const target = this.checkExpr(node.expression, scope)
      if (target.k !== "typed") return undefined
      const array = target.expr
      if (array.type.kind === "string") return this.error(node, "Strings are immutable."), undefined
      if (array.type.kind !== "array") return this.error(node.expression, `Type '${typeToString(array.type)}' cannot be indexed.`), undefined
      const index = this.checkIndex(node.argumentExpression, scope)
      if (!index) return undefined
      this.info.types.set(node, array.type.elem)
      return { lvalue: { k: "element", array, index }, type: array.type.elem }
    }
    if (ts.isPropertyAccessExpression(node)) {
      const target = this.checkExpr(node.expression, scope)
      if (target.k !== "typed") return undefined
      const object = target.expr
      const name = node.name.text
      if (object.type.kind === "interface") {
        const index = object.type.members.findIndex((m) => m.name === name)
        const member = object.type.members[index]
        if (member?.k !== "field") return this.error(node.name, `Property '${name}' does not exist on type '${object.type.name}'.`), undefined
        this.defineMember(node.name, object.type, name)
        if (member.readonly) return this.error(node.name, `Cannot assign to '${name}' because it is a read-only property.`), undefined
        this.info.types.set(node, member.type)
        return { lvalue: { k: "iface-field", value: object, index }, type: member.type }
      }
      const property = this.accessor(object.type, name)
      if (property) {
        this.defineMember(node.name, object.type as StructType, name)
        if (!this.checkAccess(object.type as StructType, property, name, node.name)) return undefined
        if (!property.set) return this.error(node.name, `Cannot assign to '${name}' because it has a getter but no setter.`), undefined
        this.info.types.set(node, property.type)
        return { accessor: { object, property, name }, type: property.type }
      }
      if (object.type.kind === "union") return this.unionFieldTarget(node, object, name)
      const struct = object.type.kind === "struct" ? object.type : undefined
      const field = struct && findField(struct, name)
      if (!struct || !field) return this.error(node.name, `Property '${name}' does not exist on type '${typeToString(object.type)}'.`), undefined
      this.defineMember(node.name, struct, name)
      if (!this.checkAccess(struct, field, name, node.name)) return undefined
      // A constructor may initialize the read-only fields of its own instance.
      const initializing = this.fn?.ctor && this.fn.cls === struct && this.declaringClass(struct, name) === struct && object.k === "local" && object.local === this.fn.this
      if (field.readonly && !initializing) return this.error(node.name, `Cannot assign to '${name}' because it is a read-only property.`), undefined
      this.info.types.set(node, field.type)
      return { lvalue: { k: "field", object, name }, type: field.type }
    }
    if (!ts.isIdentifier(node)) return this.error(node, "Only variables, fields and array elements can be assigned to."), undefined
    const found = scope.lookupCapturing(node.text)
    const symbol = found?.symbol
    if (!symbol) return this.error(node, `Cannot find name '${node.text}'.`), undefined
    this.info.definitions.set(node, symbol.decl)
    if (symbol.k === "const") return this.error(node, `Cannot assign to '${node.text}' because it is a constant.`), undefined
    if (symbol.k !== "local") return this.error(node, `Cannot assign to '${node.text}' because it is not a variable.`), undefined
    if (!symbol.local.mutable) return this.error(node, `Cannot assign to '${node.text}' because it is a constant.`), undefined
    this.capture(symbol.local, found!.closures)
    symbol.local.assigned = true
    this.info.types.set(node, symbol.local.type)
    return { lvalue: { k: "local", local: symbol.local }, type: symbol.local.type }
  }

  /** A field that every member of a union has, writable and of the same type in each: `stmt.line = 3`. */
  protected unionFieldTarget(node: ts.PropertyAccessExpression, object: ir.Expr, name: string): AssignTarget | undefined {
    const union = object.type as ir.UnionType
    const fields = canBeNull(union) ? [] : union.members.map((m) => memberField(m, name))
    if (fields.length === 0 || fields.some((f) => f === undefined)) return this.error(node.name, this.noProperty(union, name)), undefined
    if (fields.some((f) => f!.readonly)) return this.error(node.name, `Cannot assign to '${name}' because it is a read-only property.`), undefined
    const type = fields[0]!.type
    if (fields.some((f) => !sameType(f!.type, type))) {
      return this.error(node.name, `Cannot assign to '${name}': its type differs between the members of '${typeToString(union)}'.`), undefined
    }
    this.info.types.set(node, type)
    return { lvalue: { k: "union-field", value: object, name }, type }
  }

  protected checkPrefixUnary(node: ts.PrefixUnaryExpression, scope: Scope): Operand {
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

  protected checkConditional(node: ts.ConditionalExpression, scope: Scope, expected?: Type): Operand {
    const condition = this.condition(node.condition, scope)
    const cond = condition.expr
    // Both branches are checked against the expected type, so that `c ? "a" : "b"` can be a literal type.
    const whenTrue = this.withFacts(condition.whenTrue, () => this.checkExpr(node.whenTrue, scope, expected))
    const whenFalse = this.withFacts(condition.whenFalse, () => this.checkExpr(node.whenFalse, scope, expected))
    // Branches that both fit the expected type take it, such as literals of a literal union.
    if (expected && whenTrue.k !== "error" && whenFalse.k !== "error") {
      const before = this.diagnostics.length
      const then = this.coerce(whenTrue, expected, node.whenTrue)
      const otherwise = this.coerce(whenFalse, expected, node.whenFalse)
      if (this.diagnostics.length === before) return typed({ k: "cond", type: expected, cond, then, else: otherwise })
      this.diagnostics.length = before
    }
    let [then, otherwise] = this.unify(whenTrue, whenFalse, node.whenTrue, node.whenFalse)
    if (!then || !otherwise) return errorOperand
    let type = typeOf(then)
    if (!sameType(type, typeOf(otherwise))) {
      // Branches of different types give their union, as in TypeScript.
      if (type.kind === "void" || otherwise.type.kind === "void") return this.fail(node, "Branches of '?:' cannot be 'void'.")
      type = this.unionOf([type, otherwise.type])
      then = this.coerce(typed(then), type, node.whenTrue)
      otherwise = this.coerce(typed(otherwise), type, node.whenFalse)
    }
    return typed({ k: "cond", type, cond, then, else: otherwise })
  }

  protected checkArrayLiteral(node: ts.ArrayLiteralExpression, scope: Scope, expected: Type | undefined): Operand {
    for (const e of node.elements) {
      if (ts.isSpreadElement(e)) return this.fail(e, "Spread elements are not supported yet.")
      if (ts.isOmittedExpression(e)) return this.fail(node, "Array holes are not supported.")
    }
    // The context gives the element type: an array type, or a union with exactly one array type (`T[] | null`).
    const arrays = expected ? membersOf(expected).filter((m) => m.kind === "array") : []
    if (arrays.length === 1) {
      const type = arrays[0] as ir.ArrayType
      const elems = node.elements.map((e) => this.coerce(this.checkExpr(e, scope, type.elem), type.elem, e))
      return typed({ k: "array", type, elems })
    }
    const values = node.elements.map((e) => this.checkExpr(e, scope))
    if (values.some((v) => v.k === "error")) return errorOperand
    // The element type is the type of the first typed element, else the default type of the constants.
    const first = values.find((v) => v.k === "typed")
    let elem: Type
    if (first?.k === "typed") elem = first.expr.type
    else if (values.length > 0) elem = values.some((v) => v.k === "untyped-float") ? types.f64 : types.i64
    else return this.fail(node, "Cannot infer the type of an empty array. Add a type annotation, e.g. 'let a: int[] = []'.")
    if (elem.kind === "void" || elem.kind === "never") return this.fail(node, `An array cannot contain values of type '${elem.kind}'.`)
    const elems = values.map((v, i) => this.coerce(v, elem, node.elements[i]!))
    return typed({ k: "array", type: arrayOf(elem), elems })
  }

  protected checkObjectLiteral(node: ts.ObjectLiteralExpression, scope: Scope, expected: Type | undefined): Operand {
    const props: { name: string; node: ts.Node; value: ts.Expression }[] = []
    for (const prop of node.properties) {
      if (ts.isPropertyAssignment(prop)) {
        const name = this.memberName(prop.name)
        if (name !== undefined) props.push({ name, node: prop.name, value: prop.initializer })
      } else if (ts.isShorthandPropertyAssignment(prop)) {
        props.push({ name: prop.name.text, node: prop.name, value: prop.name })
      } else if (ts.isSpreadAssignment(prop)) {
        return this.fail(prop, "Object spread is not supported yet.")
      } else {
        return this.fail(prop, "Methods and accessors in object literals are not supported yet.")
      }
    }
    for (let i = 0; i < props.length; i++) {
      if (props.findIndex((p) => p.name === props[i]!.name) !== i) return this.fail(props[i]!.node, `Duplicate property '${props[i]!.name}'.`)
    }

    if (expected?.kind === "union") {
      // Pick the object member whose literal-typed fields match the literal, as in a tagged union.
      const candidates = expected.members.filter((m) => m.kind === "struct" || m.kind === "interface")
      const matching = candidates.filter((m) =>
        props.every((p) => {
          const type = fieldType(m, p.name)
          if (!type) return false
          const literal = ts.isStringLiteral(p.value) || ts.isNoSubstitutionTemplateLiteral(p.value) ? p.value.text : undefined
          return literal === undefined || membersOf(type).some((t) => t.kind === "string" || (t.kind === "literal" && t.value === literal))
        }),
      )
      if (matching.length === 1) return this.checkObjectLiteral(node, scope, matching[0])
      // Otherwise the member with these property names, to report what does not match.
      const byNames = candidates.filter((m) => props.every((p) => fieldType(m, p.name)))
      if (byNames.length === 1 && matching.length === 0) return this.checkObjectLiteral(node, scope, byNames[0])
      if (candidates.length === 1) return this.checkObjectLiteral(node, scope, candidates[0])
      if (candidates.length > 1) {
        return this.fail(node, matching.length > 1
          ? `Cannot tell which member of '${typeToString(expected)}' this object literal is. Give its discriminant field a literal value.`
          : `No member of '${typeToString(expected)}' matches this object literal.`)
      }
    }
    if (expected?.kind === "struct") {
      // A literal for a known object type must have exactly its fields.
      let ok = true
      for (const p of props) {
        if (!findField(expected, p.name)) {
          this.error(p.node, `Property '${p.name}' does not exist in type '${typeToString(expected)}'.`)
          ok = false
        }
      }
      const missing = expected.fields.filter((f) => !props.some((p) => p.name === f.name)).map((f) => `'${f.name}'`)
      if (missing.length > 0) {
        this.error(node, `Missing ${missing.length === 1 ? "property" : "properties"} ${missing.join(", ")} of type '${typeToString(expected)}'.`)
        ok = false
      }
      const fields = props.map((p) => {
        const type = findField(expected, p.name)?.type ?? types.i64
        return { name: p.name, value: this.coerce(this.checkExpr(p.value, scope, type), type, p.value) }
      })
      return ok ? typed({ k: "object", type: expected, fields }) : errorOperand
    }

    // For an interface, its field types guide the literal, which is then converted by the caller.
    const hints = expected?.kind === "interface" ? expected : undefined
    if (hints) {
      for (const p of props) {
        if (!hints.members.some((m) => m.k === "field" && m.name === p.name)) {
          return this.fail(p.node, `Object literal may only specify known properties, and '${p.name}' does not exist in type '${hints.name}'.`)
        }
      }
    }
    const fields: { name: string; value: ir.Expr }[] = []
    for (const p of props) {
      const hint = hints?.members.find((m) => m.k === "field" && m.name === p.name)?.type
      const value = this.checkExpr(p.value, scope, hint)
      if (value.k === "error") return errorOperand
      const expr = hint ? this.coerce(value, hint, p.value) : this.toDefault(value, p.value)
      if (expr.type.kind === "void" || expr.type.kind === "never") return this.fail(p.value, `A property cannot have type '${expr.type.kind}'.`)
      fields.push({ name: p.name, value: expr })
    }
    const type = this.shape(fields.map((f) => ({ name: f.name, type: f.value.type, readonly: false })))
    return typed({ k: "object", type, fields })
  }

  protected checkTemplate(node: ts.TemplateExpression, scope: Scope): Operand {
    const parts: ir.Expr[] = []
    const text = (value: string) => {
      if (value !== "") parts.push({ k: "string", type: types.string, value })
    }
    text(node.head.text)
    for (const span of node.templateSpans) {
      const value = this.checkExpr(span.expression, scope)
      if (value.k !== "error") {
        const expr = this.toDefault(value, span.expression)
        if (this.printable(expr, span.expression)) parts.push(expr)
      }
      text(span.literal.text)
    }
    return typed({ k: "concat", type: types.string, parts })
  }

  /** Whether a value can be printed or interpolated; reports an error if not. */
  protected printable(expr: ir.Expr, node: ts.Node): boolean {
    const type = expr.type
    const simple = (t: Type) => isNumeric(t) || t.kind === "bool" || isStringLike(t) || t.kind === "null"
    if (membersOf(type).every(simple)) return true
    this.error(node, `Cannot format a value of type '${typeToString(type)}'.`)
    return false
  }

  /**
   * The exported value `m.name` of a module imported as `* as m`, or
   * undefined if the expression is not such an access. Reports missing exports.
   */
  protected moduleMember(node: ts.Expression, scope: Scope): ValueSymbol | undefined {
    if (!ts.isPropertyAccessExpression(node) || !ts.isIdentifier(node.expression)) return undefined
    const module = scope.lookupValue(node.expression.text)
    if (module?.k === "namespace") {
      // An export of the module implementing the namespace in Ore, such as `fs.stat`.
      const exported = module.module?.(node.name.text)?.value
      if (exported) {
        this.info.definitions.set(node.expression, module.decl)
        if (ts.isIdentifier(node.name)) this.info.definitions.set(node.name, exported.decl)
        return exported
      }
      // A constant of a built-in namespace, such as `Math.PI`.
      const member = module.members.get(node.name.text)
      if (member?.k !== "const") return undefined
      this.info.definitions.set(node.expression, module.decl)
      if (ts.isIdentifier(node.name)) this.info.definitions.set(node.name, member.decl)
      return member
    }
    if (module?.k !== "module") return undefined
    this.info.definitions.set(node.expression, module.decl)
    const value = module.exports(node.name.text)?.value
    if (!value) {
      this.error(node.name, `Module '${module.name}' has no exported value '${node.name.text}'.`)
      return { k: "const", value: errorOperand, type: undefined, decl: node }
    }
    if (ts.isIdentifier(node.name)) this.info.definitions.set(node.name, value.decl)
    return value
  }

  protected checkProperty(node: ts.PropertyAccessExpression, scope: Scope): Operand {
    const member = this.moduleMember(node, scope)
    if (member) return this.symbolValue(member, node.name)
    const target = this.checkExpr(node.expression, scope)
    if (target.k === "error") return target
    const value = this.toDefault(target, node.expression)
    if (node.questionDotToken) return this.optional(value, node, (v) => this.member(v, node.name, node.name.text))
    const result = this.member(value, node.name, node.name.text)
    const key = this.refKey(node, scope)
    return result.k === "typed" && key ? typed(this.narrowed(key, result.expr)) : result
  }

  /** Reads the field or length named by a property access from a value. */
  protected member(value: ir.Expr, nameNode: ts.Node, name: string): Operand {
    if (name === "length" && (value.type.kind === "string" || value.type.kind === "array")) return typed({ k: "len", type: types.i64, value })
    if (name === "length" && membersOf(value.type).every(isStringLike)) {
      return typed({ k: "len", type: types.i64, value: { k: "recast", type: types.string, value } })
    }
    if (name === "size" && value.type.kind === "map") return typed({ k: "map", op: "size", type: types.i64, mapType: value.type, map: value })
    if (name === "size" && value.type.kind === "set") return typed({ k: "set", op: "size", type: types.i64, setType: value.type, set: value })
    const property = this.accessor(value.type, name)
    if (property) {
      this.defineMember(nameNode, value.type as StructType, name)
      if (!this.checkAccess(value.type as StructType, property, name, nameNode)) return errorOperand
      if (!property.get) return this.fail(nameNode, `Property '${name}' has a setter but no getter.`)
      return typed({ k: "method-call", type: property.type, func: property.get, receiver: value, args: [] })
    }
    if (value.type.kind === "struct") {
      const struct = value.type
      const field = findField(struct, name)
      this.defineMember(nameNode, struct, name)
      if (field) {
        if (!this.checkAccess(struct, field, name, nameNode)) return errorOperand
        return typed({ k: "field", type: field.type, object: value, name })
      }
      const method = findMethod(struct, name)
      if (method) {
        if (!this.checkAccess(struct, method, name, nameNode)) return errorOperand
        const bound: ir.Expr = { k: "bound-method", type: method.func.type, receiver: value, func: method.func }
        this.dispatch(bound, name)
        return typed(bound)
      }
      if (this.genericMethod(struct, name)) return this.fail(nameNode, `'${name}' is a generic method and cannot be used as a value; call it.`)
    }
    if (value.type.kind === "interface") {
      const index = value.type.members.findIndex((m) => m.name === name)
      const member = value.type.members[index]
      this.defineMember(nameNode, value.type, name)
      if (member?.k === "field") return typed({ k: "iface-field", type: member.type, value, index })
      if (member) return typed({ k: "bound-method", type: member.type, receiver: value, index })
    }
    if (value.type.kind === "union" && !canBeNull(value.type)) {
      // A field that every member has, such as the discriminant of a tagged union.
      const fieldTypes = value.type.members.map((m) => fieldType(m, name))
      if (fieldTypes.every((t) => t !== undefined)) {
        return typed({ k: "union-field", type: this.unionOf(fieldTypes as Type[]), value, name })
      }
    }
    return this.fail(nameNode, this.noProperty(value.type, name))
  }

  protected noProperty(type: Type, name: string): string {
    const message = `Property '${name}' does not exist on type '${typeToString(type)}'.`
    if (type.kind === "union" && type.members.some((m) => m.kind === "null")) {
      return `${message} The value may be null: check it with '!== null' first, or use '?.'.`
    }
    return message
  }

  /**
   * Optional chaining: `access` applied to the non-null value, or `null`.
   * Values that cannot be null are accessed directly.
   */
  protected optional(value: ir.Expr, node: ts.Node, access: (value: ir.Expr) => Operand): Operand {
    if (!membersOf(value.type).some((m) => m.kind === "null")) return access(value)
    const binding = this.newLocal("opt", this.without(value.type, (m) => m.kind === "null"), false)
    const body = access({ k: "local", type: binding.type, local: binding })
    if (body.k !== "typed") return body
    const resultType = body.expr.type
    if (resultType.kind === "void") return typed({ k: "optional", type: types.void as unknown as UnionType, value, binding, body: body.expr })
    const type = this.unionOf([resultType, types.null]) as UnionType
    return typed({ k: "optional", type, value, binding, body: this.coerce(body, type, node) })
  }

  protected checkInstanceOf(node: ts.BinaryExpression, scope: Scope): Operand {
    const operand = this.checkExpr(node.left, scope)
    if (operand.k !== "typed") return operand.k === "error" ? operand : this.fail(node.left, "A constant is not an object.")
    const value = operand.expr
    const target = this.instanceOfTarget(node.right, scope)
    if (!target) return errorOperand
    const test = this.instanceTest(value, target)
    if (test) return typed(test)
    return this.fail(node, `A value of type '${typeToString(value.type)}' is never an instance of '${typeToString(target)}'.`)
  }

  /** The `is` test of `value instanceof target`, or undefined if it can never be true. */
  protected instanceTest(value: ir.Expr, target: StructType | InterfaceType): ir.Expr | undefined {
    const type = value.type
    if (sameType(type, target)) return { k: "bool", type: types.bool, value: true }
    // An instance of a class is an instance of its base classes; one of a base class may be of a subclass.
    const related = (m: Type) => m.kind === "struct" && target.kind === "struct" && (isSubclass(m, target) || isSubclass(target, m))
    if (type.kind === "struct" && target.kind === "struct" && isSubclass(type, target)) return { k: "bool", type: types.bool, value: true }
    if (type.kind === "struct" && related(type)) return { k: "is", type: types.bool, value, member: target }
    if (type.kind === "union" && type.members.some((m) => sameType(m, target) || related(m))) return { k: "is", type: types.bool, value, member: target }
    if (target.kind !== "struct") return undefined
    if (type.kind === "interface" && !this.conformance(target, type).reason) return { k: "is", type: types.bool, value, member: target }
    const via = this.interfaceFor(type, target)
    return via && { k: "is", type: types.bool, value, member: target, via }
  }

  /** The interface member of a union that a class implements, if exactly one. */
  protected interfaceFor(type: Type, cls: StructType): InterfaceType | undefined {
    if (type.kind !== "union") return undefined
    const ifaces = type.members.filter((m): m is InterfaceType => m.kind === "interface" && !this.conformance(cls, m).reason)
    return ifaces.length === 1 ? ifaces[0] : undefined
  }

  protected instanceOfTarget(node: ts.Expression, scope: Scope): StructType | InterfaceType | undefined {
    const symbol = ts.isIdentifier(node) ? scope.lookupType(node.text) : undefined
    if (ts.isIdentifier(node) && symbol) this.info.definitions.set(node, symbol.decl)
    const type = symbol?.type
    if ((type?.kind === "struct" && type.nominal) || type?.kind === "interface") return type
    this.error(node, "The right side of 'instanceof' must be a class or an interface.")
    return undefined
  }

  protected checkNonNull(node: ts.NonNullExpression, scope: Scope): Operand {
    const operand = this.checkExpr(node.expression, scope)
    if (operand.k !== "typed") return operand
    const value = operand.expr
    if (!membersOf(value.type).some((m) => m.kind === "null")) return this.fail(node, `Type '${typeToString(value.type)}' cannot be null; '!' is not needed.`)
    return typed({ k: "recast", type: this.without(value.type, (m) => m.kind === "null"), value })
  }

  protected checkCoalesce(node: ts.BinaryExpression, scope: Scope): Operand {
    const operand = this.checkExpr(node.left, scope)
    if (operand.k !== "typed") return operand.k === "error" ? operand : this.fail(node.left, "The left side of '??' cannot be null.")
    const value = operand.expr
    if (!membersOf(value.type).some((m) => m.kind === "null")) return this.fail(node.left, `Type '${typeToString(value.type)}' cannot be null; '??' is not needed.`)
    const type = this.without(value.type, (m) => m.kind === "null")
    const fallback = this.coerce(this.checkExpr(node.right, scope, type), type, node.right)
    return typed({ k: "coalesce", type, value, fallback })
  }

  protected checkElement(node: ts.ElementAccessExpression, scope: Scope): Operand {
    const target = this.checkExpr(node.expression, scope)
    if (target.k === "error") return target
    const value = this.toDefault(target, node.expression)
    const element = (v: ir.Expr): Operand => {
      const index = this.checkIndex(node.argumentExpression, scope)
      if (!index) return errorOperand
      if (v.type.kind === "string") return typed({ k: "index", type: types.u8, target: v, index })
      if (v.type.kind === "array") return typed({ k: "index", type: v.type.elem, target: v, index })
      return this.fail(node.expression, `Type '${typeToString(v.type)}' cannot be indexed.`)
    }
    return node.questionDotToken ? this.optional(value, node, element) : element(value)
  }

  /** Checks an index or offset: any integer type, and untyped constants must not be negative. */
  protected checkIndex(node: ts.Expression, scope: Scope, allowNegative = false): ir.Expr | undefined {
    const value = this.checkExpr(node, scope)
    if (value.k === "error") return undefined
    if (value.k === "untyped-int" && value.value < 0n && !allowNegative) return this.error(node, `Index ${value.value} must not be negative.`), undefined
    const expr = value.k === "typed" ? value.expr : this.coerce(value, types.i64, node)
    if (expr.type.kind !== "int") return this.error(node, `An index must be an integer, got '${typeToString(expr.type)}'.`), undefined
    return expr
  }

  /** Records the declaration of a field or method for go to definition. */
  protected defineMember(node: ts.Node, struct: StructType | InterfaceType, name: string) {
    const decl = this.memberDecls.get(struct)?.get(name)
    if (decl && ts.isIdentifier(node)) this.info.definitions.set(node, decl)
  }
}
