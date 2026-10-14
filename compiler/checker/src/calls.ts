// Calls: functions, methods, closures, constructors, built-ins (including `unsafe` and `JSON`), array and string methods.
import * as ir from "@ore/ir"
import {
  arrayOf,
  findField,
  findMethod,
  isNumeric,
  isStringLike,
  membersOf,
  sameType,
  types,
  typeToString,
  type FuncType,
  type MapType,
  type ChanType,
  type StructType,
  type Type,
  type UnionType,
  type ArrayType,
} from "@ore/ir"
import ts from "typescript"
import { errorOperand, type Operand } from "./operand"
import { Scope, type ValueSymbol } from "./symbols"
import { stringMethods, arrayMethods, isSymbolDispose, unknownName, isStringLiteralNode, typed, typeOf, jsonProblem } from "./helpers"
import { ExpressionChecker } from "./expressions"

export abstract class CallChecker extends ExpressionChecker {
  protected checkCall(node: ts.CallExpression, scope: Scope): Operand {
    const callee = node.expression
    const symbolOfCallee = ts.isIdentifier(callee) ? scope.lookupValue(callee.text) : this.moduleMember(callee, scope)
    if (symbolOfCallee?.k === "generic-func") {
      if (ts.isIdentifier(callee)) this.info.definitions.set(callee, symbolOfCallee.decl)
      const generic = symbolOfCallee.generic
      const decl = generic.decl as ts.FunctionDeclaration
      const call = this.genericCall(generic, decl.parameters, node.typeArguments, node.arguments, node, scope)
      if (!call) return errorOperand
      const func = call.instance as ir.Func
      return this.callFunc(func, node.arguments, node, scope, `Function '${generic.name}'`, undefined, call.operands.length > 0 ? call.operands : undefined)
    }
    // Type arguments of a method call are checked with the method.
    if (node.typeArguments && !ts.isPropertyAccessExpression(callee)) return this.fail(node.typeArguments[0]!, "Type arguments are only allowed for generic functions.")
    if (node.questionDotToken && !ts.isPropertyAccessExpression(callee)) {
      // `f?.(...)` calls a function value unless it is null.
      const value = this.checkExpr(callee, scope)
      if (value.k !== "typed") return value
      return this.optional(value.expr, node, (f) => this.callValue(typed(f), node, scope))
    }
    let symbol: ValueSymbol | undefined
    let name: string
    let nameNode: ts.Node
    if (ts.isElementAccessExpression(callee) && isSymbolDispose(callee.argumentExpression)) {
      if (node.arguments.length > 0) return this.fail(node, "'[Symbol.dispose]' takes no arguments.")
      const target = this.checkExpr(callee.expression, scope)
      if (target.k !== "typed") return target.k === "error" ? target : this.fail(callee.expression, "A constant is not disposable.")
      const call = this.disposeCall(target.expr)
      return call ? typed(call) : this.fail(callee, `Type '${typeToString(target.expr.type)}' has no '[Symbol.dispose]' method.`)
    }
    if (ts.isPropertyAccessExpression(callee) && symbolOfCallee) {
      // `m.f(...)`: an export of a module imported as `* as m`.
      name = callee.getText()
      nameNode = callee.name
      symbol = symbolOfCallee
      if (symbol.k === "local" || symbol.k === "const") return this.callValue(this.checkExpr(callee, scope), node, scope)
    } else if (ts.isPropertyAccessExpression(callee)) {
      // `console.log(...)`: a member of a namespace, or else a method call.
      const ns = ts.isIdentifier(callee.expression) ? scope.lookupValue(callee.expression.text) : undefined
      if (ns?.k !== "namespace") return this.checkMethodCall(node, callee, scope)
      if (ns.name === "internal" && !this.isInternal(this.sourceOf(node))) {
        return this.fail(callee.expression, "'internal' is only for the standard library. Add '//ore:internal' at the top of the file to use it here.")
      }
      this.info.definitions.set(callee.expression as ts.Identifier, ns.decl)
      name = `${ns.name}.${callee.name.text}`
      nameNode = callee.name
      symbol = ns.members.get(callee.name.text)
      if (!symbol) return this.fail(callee.name, `'${ns.name}' has no member '${callee.name.text}'.`)
      if (ts.isIdentifier(callee.name)) this.info.definitions.set(callee.name, symbol.decl)
    } else {
      // Anything but a name is a function value, such as `make()(1)` or `handlers[i](e)`.
      if (!ts.isIdentifier(callee)) return this.callValue(this.checkExpr(callee, scope), node, scope)
      name = callee.text
      nameNode = callee
      symbol = scope.lookupValue(callee.text)
      if (!symbol) return this.fail(callee, unknownName(callee.text))
      if (symbol.k === "local") return this.callValue(this.checkExpr(callee, scope), node, scope)
      this.info.definitions.set(callee, symbol.decl)
    }
    const args = node.arguments
    // Functions check spread arguments themselves, for rest parameters.
    if (symbol.k !== "func") for (const arg of args) if (ts.isSpreadElement(arg)) return this.fail(arg, "Spread arguments are not supported yet.")

    switch (symbol.k) {
      case "conversion": {
        if (args.length !== 1) return this.fail(node, `Conversion '${name}' expects exactly 1 argument, got ${args.length}.`)
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
        if (!symbol.name.startsWith("console.")) return this.builtinCall(symbol.name, symbol.decl as ts.FunctionDeclaration, node, scope)
        if (symbol.name === "process.panic" || symbol.name === "process.exit") {
          if (args.length !== 1) return this.fail(node, `'${name}' expects exactly 1 argument, got ${args.length}.`)
          const type = symbol.name === "process.panic" ? types.string : types.i32
          const value = this.coerce(this.checkExpr(args[0]!, scope, type), type, args[0]!)
          return typed({ k: "builtin", type: types.never, name: symbol.name, args: [value] })
        }
        const values: ir.Expr[] = []
        for (const arg of args) {
          const value = this.checkExpr(arg, scope)
          if (value.k === "error") continue
          const expr = this.toDefault(value, arg)
          if (this.printable(expr, arg)) values.push(expr)
        }
        return typed({ k: "builtin", type: types.void, name: symbol.name, args: values })
      }
      case "func":
        return this.callFunc(symbol.func, args, node, scope, `Function '${symbol.func.sourceName}'`)
      case "class":
        return this.fail(nameNode, `Class '${name}' must be instantiated with 'new ${name}(...)'.`)
      default:
        return this.fail(nameNode, `'${name}' is not a function.`)
    }
  }

  /** Checks a call of an array method that takes a callback or a value. */
  protected arrayMethod(array: ir.Expr, type: ir.ArrayType, name: string, node: ts.CallExpression, callee: ts.PropertyAccessExpression, scope: Scope): Operand {
    const T = type.elem
    const args = node.arguments
    const [min, max] = arrayMethods.get(name)!
    if (args.length < min || args.length > max) {
      return this.fail(node, `'${name}' expects ${min === max ? min : `${min} to ${max}`} argument(s), got ${args.length}.`)
    }
    const method = (resultType: Type, values: ir.Expr[], arity?: number): Operand => typed({ k: "array-method", method: name, type: resultType, array, args: values, arity })
    const predicate = () => this.callback(args[0]!, scope, [T, types.i64], types.bool)
    switch (name) {
      case "forEach": {
        const cb = this.callback(args[0]!, scope, [T, types.i64], types.void, true)
        return cb ? method(types.void, [cb.expr], cb.arity) : errorOperand
      }
      case "map": {
        const cb = this.callback(args[0]!, scope, [T, types.i64], undefined)
        if (!cb) return errorOperand
        if (cb.result.kind === "void" || cb.result.kind === "never") return this.fail(args[0]!, "The callback of 'map' must return a value.")
        return method(arrayOf(cb.result), [cb.expr], cb.arity)
      }
      case "filter":
      case "find":
      case "findIndex":
      case "some":
      case "every": {
        const cb = predicate()
        if (!cb) return errorOperand
        const result: Type = name === "filter" ? type : name === "find" ? this.unionOf([T, types.null]) : name === "findIndex" ? types.i64 : types.bool
        return method(result, [cb.expr], cb.arity)
      }
      case "reduce": {
        // The accumulator has the type of the initial value.
        const initial = this.checkExpr(args[1]!, scope)
        if (initial.k === "error") return errorOperand
        const init = this.toDefault(initial, args[1]!)
        const cb = this.callback(args[0]!, scope, [init.type, T, types.i64], init.type)
        return cb ? method(init.type, [cb.expr, init], cb.arity) : errorOperand
      }
      case "includes":
      case "indexOf": {
        const x = this.coerce(this.checkExpr(args[0]!, scope, T), T, args[0]!)
        return method(name === "includes" ? types.bool : types.i64, [x])
      }
      case "join": {
        if (!membersOf(T).every((m) => isNumeric(m) || m.kind === "bool" || isStringLike(m) || m.kind === "null")) {
          return this.fail(callee.name, `Cannot join elements of type '${typeToString(T)}'.`)
        }
        const sep = args[0] ? this.coerce(this.checkExpr(args[0], scope, types.string), types.string, args[0]) : undefined
        return method(types.string, sep ? [sep] : [])
      }
      case "reverse":
        return method(type, [])
      default: {
        // sort: by a comparator returning a number, or in natural order for numbers and strings.
        if (args.length === 0) {
          if (!(isNumeric(T) || isStringLike(T))) return this.fail(callee.name, `Sorting '${typeToString(T)}' needs a comparator: 'sort((a, b) => ...)'.`)
          return method(type, [])
        }
        const cb = this.callback(args[0]!, scope, [T, T], undefined)
        if (!cb) return errorOperand
        if (!isNumeric(cb.result)) return this.fail(args[0]!, "The comparator of 'sort' must return a number.")
        return method(type, [cb.expr], cb.arity)
      }
    }
  }

  /**
   * Checks a callback: a function literal gets the parameter types, and its
   * result is inferred when `result` is undefined; a function value may take
   * fewer parameters than given. With `ignoreResult`, any result is accepted.
   */
  protected callback(node: ts.Expression, scope: Scope, params: Type[], result: Type | undefined, ignoreResult = false): { expr: ir.Expr; arity: number; result: Type } | undefined {
    const expected: FuncType = { kind: "func", params, result: result ?? types.void }
    const literal = ts.isArrowFunction(node) || ts.isFunctionExpression(node)
    const value = literal ? this.checkClosure(node, scope, expected, result === undefined) : this.checkExpr(node, scope)
    const describe = `(${params.map(typeToString).join(", ")}) => ${result ? typeToString(result) : "..."}`
    if (value.k === "error") return undefined
    if (value.k !== "typed") return this.error(node, `Expected a function of type '${describe}', got '${typeToString(this.defaultType(value))}'.`), undefined
    const type = value.expr.type
    if (type.kind !== "func" || type.params.length > params.length || type.params.some((p, i) => !sameType(p, params[i]!))) {
      return this.error(node, `Expected a function of type '${describe}', got '${typeToString(type)}'.`), undefined
    }
    if (!ignoreResult && result && !sameType(type.result, result)) {
      return this.error(node, `Expected a function of type '${describe}', got '${typeToString(type)}'.`), undefined
    }
    return { expr: value.expr, arity: type.params.length, result: type.result }
  }

  /**
   * Checks a call of a built-in function by its declaration in builtin.d.ore;
   * `Math.abs`, `min` and `max` take and return any one numeric type.
   */
  protected builtinCall(name: string, decl: ts.FunctionDeclaration, node: ts.CallExpression, scope: Scope): Operand {
    if (name === "JSON.stringify" || name === "JSON.parse") return this.jsonCall(name, node, scope)
    if (name.startsWith("unsafe.") && decl.typeParameters) return this.unsafeCall(name, node, scope)
    const args = node.arguments
    const required = decl.parameters.filter((p) => !p.questionToken).length
    if (args.length < required || args.length > decl.parameters.length) {
      const count = required === decl.parameters.length ? `${required}` : `${required} to ${decl.parameters.length}`
      return this.fail(node, `'${name}' expects ${count} argument(s), got ${args.length}.`)
    }
    if (decl.typeParameters) {
      const operands = args.map((a) => this.checkExpr(a, scope))
      if (operands.some((o) => o.k === "error")) return errorOperand
      // The type of the first typed argument, or the default type of the constants.
      const first = operands.find((o) => o.k === "typed")
      const type = first?.k === "typed" ? first.expr.type : this.defaultType(operands.find((o) => o.k === "untyped-float") ?? operands[0]!)
      if (!isNumeric(type)) return this.fail(args[0]!, `'${name}' needs numbers, got '${typeToString(type)}'.`)
      return typed({ k: "builtin", type, name, args: operands.map((o, i) => this.coerce(o, type, args[i]!)) })
    }
    const types_ = decl.parameters.map((p) => this.resolveType(p.type!, this.builtins!)!)
    const values = args.map((a, i) => this.coerce(this.checkExpr(a, scope, types_[i]), types_[i]!, a))
    const result = this.resolveType(decl.type!, this.builtins!)!
    // A built-in that fails with an Error creates the basic one.
    const error = membersOf(result).some((m) => m === this.errorType)
      ? { ctor: this.basicErrorClass().ctor!, itab: this.itab(this.basicErrorClass(), this.errorType!) }
      : undefined
    return typed({ k: "builtin", type: result, name, args: values, error })
  }

  /** `JSON.stringify(value, indent?)` and `JSON.parse<T>(text)`, whose code is generated per type. */
  protected jsonCall(name: string, node: ts.CallExpression, scope: Scope): Operand {
    const args = node.arguments
    if (name === "JSON.stringify") {
      if (args.length < 1 || args.length > 2) return this.fail(node, `'${name}' expects 1 to 2 argument(s), got ${args.length}.`)
      const operand = this.checkExpr(args[0]!, scope)
      if (operand.k === "error") return operand
      const value = this.toDefault(operand, args[0]!)
      const problem = jsonProblem(value.type)
      if (problem) return this.fail(args[0]!, problem)
      const values = [value]
      if (args[1]) values.push(this.coerce(this.checkExpr(args[1], scope, types.i64), types.i64, args[1]))
      return typed({ k: "builtin", type: types.string, name, args: values })
    }
    const typeArg = node.typeArguments?.length === 1 ? node.typeArguments[0] : undefined
    if (!typeArg) return this.fail(node, "'JSON.parse' needs the type to read, e.g. 'JSON.parse<Config>(text)'.")
    const target = this.resolveValueType(typeArg, scope)
    if (!target) return errorOperand
    const problem = jsonProblem(target)
    if (problem) return this.fail(typeArg, problem)
    if (args.length !== 1) return this.fail(node, `'${name}' expects 1 argument(s), got ${args.length}.`)
    const text = this.coerce(this.checkExpr(args[0]!, scope, types.string), types.string, args[0]!)
    const result = this.unionOf([target, this.errorType!])
    const error = { ctor: this.basicErrorClass().ctor!, itab: this.itab(this.basicErrorClass(), this.errorType!) }
    return typed({ k: "builtin", type: result, name, args: [text], error, typeArgs: [target] })
  }

  /** The generic functions of `unsafe`, whose type argument is given or comes from a value. */
  protected unsafeCall(name: string, node: ts.CallExpression, scope: Scope): Operand {
    const args = node.arguments
    const short = name.slice("unsafe.".length)
    const expect = (count: number): boolean => {
      if (args.length === count) return true
      this.fail(node, `'${name}' expects ${count} argument(s), got ${args.length}.`)
      return false
    }
    const typeArg = node.typeArguments?.length === 1 ? node.typeArguments[0] : undefined
    if (node.typeArguments && !typeArg) return this.fail(node, `'${name}' takes one type argument.`)
    const explicit = typeArg ? this.resolveValueType(typeArg, scope) : undefined
    if (typeArg && !explicit) return errorOperand
    const pointer = (arg: ts.Expression) => this.coerce(this.checkExpr(arg, scope, types.ptr), types.ptr, arg)
    const call = (type: Type, values: ir.Expr[], typeArgs: Type[] = []): Operand => typed({ k: "builtin", type, name, args: values, typeArgs })
    const isReference = (t: Type) => t.kind === "struct" || t.kind === "array" || t.kind === "map" || t.kind === "chan"
    const isAtomic = (t: Type) => t.kind === "int" || t.kind === "ptr"

    // `T` from the type argument, or else from the value argument at `index`.
    const typeFrom = (index: number): { type: Type; value: ir.Expr } | undefined => {
      const operand = this.checkExpr(args[index]!, scope, explicit)
      if (operand.k === "error") return undefined
      const value = explicit ? this.coerce(operand, explicit, args[index]!) : this.toDefault(operand, args[index]!)
      return { type: explicit ?? value.type, value }
    }
    const needType = (example: string): Type | undefined => {
      if (!explicit) this.fail(node, `'${name}' needs a type argument, e.g. '${example}'.`)
      return explicit
    }
    const storable = (t: Type, at: ts.Node): boolean => {
      if (t.kind === "void" || t.kind === "never" || t.kind === "null") return this.error(at, `'${name}' cannot work on '${typeToString(t)}'.`), false
      return true
    }

    switch (short) {
      case "sizeOf":
      case "alignOf": {
        const t = needType(`unsafe.${short}<i64>()`)
        if (!t || !expect(0) || !storable(t, node)) return errorOperand
        return call(types.i64, [], [t])
      }
      case "load":
      case "atomicLoad":
      case "fromAddress": {
        const t = needType(`unsafe.${short}<i64>(p)`)
        if (!t || !expect(1)) return errorOperand
        if (short === "fromAddress" && !isReference(t)) return this.fail(typeArg!, `'${name}' needs an object, array or map type, got '${typeToString(t)}'.`)
        if (short === "atomicLoad" && !isAtomic(t)) return this.fail(typeArg!, `Atomic operations need an integer or 'ptr', got '${typeToString(t)}'.`)
        if (!storable(t, typeArg!)) return errorOperand
        return call(t, [pointer(args[0]!)], [t])
      }
      case "bitcast": {
        const t = needType("unsafe.bitcast<u64>(x)")
        if (!t || !expect(1)) return errorOperand
        const operand = this.checkExpr(args[0]!, scope)
        if (operand.k === "error") return errorOperand
        const value = this.toDefault(operand, args[0]!)
        const bits = (x: Type) => (x.kind === "int" || x.kind === "float" ? x.bits : 0)
        if (!bits(t) || !bits(value.type)) return this.fail(node, `'${name}' converts between numeric types, not '${typeToString(value.type)}' and '${typeToString(t)}'.`)
        if (bits(t) !== bits(value.type)) return this.fail(node, `'${name}' needs types of the same size: '${typeToString(value.type)}' has ${bits(value.type)} bits, '${typeToString(t)}' ${bits(t)}.`)
        return call(t, [value], [t])
      }
      case "functionAddress": {
        if (!expect(1)) return errorOperand
        // A declared C function, which is not a value otherwise.
        const named = ts.isIdentifier(args[0]!) ? scope.lookupValue(args[0]!.text) : undefined
        if (named?.k === "func" && named.func.extern) return call(types.ptr, [{ k: "func-ref", type: named.func.type, func: named.func }])
        const operand = this.checkExpr(args[0]!, scope)
        if (operand.k === "error") return errorOperand
        if (operand.k !== "typed" || operand.expr.k !== "func-ref") return this.fail(args[0]!, `'${name}' needs the name of a top-level function.`)
        return call(types.ptr, [operand.expr])
      }
      case "addressOf": {
        if (!expect(1)) return errorOperand
        const v = typeFrom(0)
        if (!v) return errorOperand
        if (!isReference(v.type)) return this.fail(args[0]!, `'${name}' needs an object, array or map, got '${typeToString(v.type)}'.`)
        return call(types.ptr, [v.value], [v.type])
      }
      case "store":
      case "atomicStore":
      case "atomicAdd":
      case "atomicSub":
      case "atomicAnd":
      case "atomicOr":
      case "atomicXor":
      case "atomicExchange": {
        if (!expect(2)) return errorOperand
        const p = pointer(args[0]!)
        const v = typeFrom(1)
        if (!v || !storable(v.type, args[1]!)) return errorOperand
        if (short !== "store" && !isAtomic(v.type)) return this.fail(args[1]!, `Atomic operations need an integer or 'ptr', got '${typeToString(v.type)}'.`)
        const arithmetic = short !== "store" && short !== "atomicStore" && short !== "atomicExchange"
        if (arithmetic && v.type.kind !== "int") return this.fail(args[1]!, `'${name}' needs an integer, got '${typeToString(v.type)}'.`)
        const result = short === "store" || short === "atomicStore" ? types.void : v.type
        return call(result, [p, v.value], [v.type])
      }
      case "atomicCompareExchange": {
        if (!expect(3)) return errorOperand
        const p = pointer(args[0]!)
        const expected = typeFrom(1)
        if (!expected) return errorOperand
        if (!isAtomic(expected.type)) return this.fail(args[1]!, `Atomic operations need an integer or 'ptr', got '${typeToString(expected.type)}'.`)
        const desired = this.coerce(this.checkExpr(args[2]!, scope, expected.type), expected.type, args[2]!)
        return call(types.bool, [p, expected.value, desired], [expected.type])
      }
      case "asm": {
        const result = explicit ?? types.void
        if (args.length < 2) return this.fail(node, `'${name}' expects a template and constraints, got ${args.length} argument(s).`)
        const texts: ir.Expr[] = []
        for (const arg of args.slice(0, 2)) {
          if (!isStringLiteralNode(arg)) return this.fail(arg, "The template and the constraints of 'unsafe.asm' must be string literals.")
          texts.push({ k: "string", type: types.string, value: arg.text })
        }
        const operands: ir.Expr[] = []
        for (const arg of args.slice(2)) {
          const operand = this.checkExpr(arg, scope)
          if (operand.k === "error") return errorOperand
          const value = this.toDefault(operand, arg)
          if (!isNumeric(value.type) && value.type.kind !== "ptr") return this.fail(arg, `An operand of 'unsafe.asm' must be a number or 'ptr', got '${typeToString(value.type)}'.`)
          operands.push(value)
        }
        if (result.kind !== "void" && !isNumeric(result) && result.kind !== "ptr") return this.fail(typeArg!, `'unsafe.asm' can return a number or 'ptr', got '${typeToString(result)}'.`)
        return call(result, [...texts, ...operands], [result])
      }
    }
    return this.fail(node, `Unknown function '${name}'.`)
  }

  /** Calls a function value with arguments converted to its parameters. */
  protected callValue(callee: Operand, node: ts.CallExpression, scope: Scope): Operand {
    if (callee.k !== "typed") return callee.k === "error" ? callee : this.fail(node.expression, "A constant is not a function.")
    const type = callee.expr.type
    if (type.kind !== "func") return this.fail(node.expression, `A value of type '${typeToString(type)}' is not a function.`)
    const args = node.arguments
    for (const arg of args) if (ts.isSpreadElement(arg)) return this.fail(arg, "Spread arguments are not supported yet.")
    if (args.length !== type.params.length) return this.fail(node, `This function expects ${type.params.length} argument(s), got ${args.length}.`)
    const values = args.map((arg, i) => this.coerce(this.checkExpr(arg, scope, type.params[i]), type.params[i]!, arg))
    return typed({ k: "call-value", type: type.result, callee: callee.expr, args: values })
  }

  protected checkNew(node: ts.NewExpression, scope: Scope, expected?: Type): Operand {
    const qualified = ts.isPropertyAccessExpression(node.expression)
    if (!ts.isIdentifier(node.expression) && !qualified) return this.fail(node.expression, "Only named classes can be instantiated.")
    const name = node.expression.getText()
    const symbol = qualified ? this.typeSymbol(node.expression, scope) : scope.lookupType(name)
    if (qualified && !symbol) return errorOperand
    if (name === "Chan" && !symbol) {
      let type: ChanType | undefined
      if (node.typeArguments) type = this.resolveType(ts.factory.createTypeReferenceNode("Chan", node.typeArguments), scope) as ChanType | undefined
      else if (expected?.kind === "chan") type = expected
      else return this.fail(node, "Cannot infer the type of the channel. Write 'new Chan<T>()' or annotate the variable.")
      const args = node.arguments ?? []
      if (args.length > 1) return this.fail(args[1]!, "'new Chan' takes at most a capacity.")
      const capacity = args[0] ? this.coerce(this.checkExpr(args[0], scope, types.i64), types.i64, args[0]) : ({ k: "int", type: types.i64, value: 0n } as const)
      return type ? typed({ k: "chan", op: "new", type, chanType: type, value: capacity }) : errorOperand
    }
    if (name === "Map" && !symbol) {
      if (node.arguments && node.arguments.length > 0) return this.fail(node.arguments[0]!, "'new Map' takes no arguments; add entries with 'set'.")
      let type: MapType | undefined
      if (node.typeArguments) type = this.resolveType(ts.factory.createTypeReferenceNode("Map", node.typeArguments), scope) as MapType | undefined
      else if (expected?.kind === "map") type = expected
      else return this.fail(node, "Cannot infer the types of the Map. Write 'new Map<K, V>()' or annotate the variable.")
      return type ? typed({ k: "map", op: "new", type, mapType: type }) : errorOperand
    }
    if (symbol && symbol.type === this.errorType) {
      if (ts.isIdentifier(node.expression)) this.info.definitions.set(node.expression, symbol.decl)
      const created = this.callFunc(this.basicErrorClass().ctor!, node.arguments ?? [], node, scope, "'new Error'")
      return created.k === "typed" ? typed(this.coerce(created, this.errorType, node)) : created
    }
    if (symbol?.generic && ts.isClassDeclaration(symbol.generic.decl)) {
      if (ts.isIdentifier(node.expression)) this.info.definitions.set(node.expression, symbol.decl)
      const ctorDecl = symbol.generic.decl.members.find(ts.isConstructorDeclaration)
      const call = this.genericCall(symbol.generic, ctorDecl?.parameters ?? [], node.typeArguments, node.arguments ?? [], node, scope)
      if (!call) return errorOperand
      const instance = call.instance as StructType
      return this.callFunc(instance.ctor!, node.arguments ?? [], node, scope, `Constructor of '${instance.name}'`, undefined, call.operands.length > 0 ? call.operands : undefined)
    }
    const type = symbol?.type
    if (!type || type.kind !== "struct" || !type.nominal) return this.fail(node.expression, `'${name}' is not a class.`)
    if (node.typeArguments) return this.fail(node.typeArguments[0]!, `Class '${name}' is not generic.`)
    if (ts.isIdentifier(node.expression)) this.info.definitions.set(node.expression, symbol.decl)
    return this.callFunc(type.ctor!, node.arguments ?? [], node, scope, `Constructor of '${name}'`)
  }

  /** A checked call of a function or method with arguments converted to its parameters. */
  /** The class created by `new Error(message)`. */
  protected basicErrorClass(): StructType {
    if (this.basicError) return this.basicError
    const type: StructType = { kind: "struct", id: this.nextStructId++, name: "BasicError", nominal: true, fields: [{ name: "message", type: types.string, readonly: true }], methods: [] }
    const message = this.newLocal("message", types.string, false)
    const self = this.newLocal("this", type, false)
    const thisRef: ir.Expr = { k: "local", type, local: self }
    type.ctor = {
      name: "ore_new_BasicError",
      sourceName: "Error.constructor",
      line: 1,
      type: { kind: "func", params: [types.string], result: type },
      params: [message],
      body: {
        k: "block",
        body: [
          { k: "let", local: self, init: { k: "alloc", type } },
          { k: "expr", expr: { k: "assign", type: types.string, target: { k: "field", object: thisRef, name: "message" }, value: { k: "local", type: types.string, local: message } } },
          { k: "return", value: thisRef },
        ],
      },
      exported: false,
    }
    this.module.structs.push(type)
    this.module.functions.push(type.ctor)
    this.basicError = type
    return type
  }

  protected callFunc(func: ir.Func, args: readonly ts.Expression[], node: ts.Node, scope: Scope, what: string, receiver?: ir.Expr, operands?: Operand[]): Operand {
    const params = func.type.params
    const variadic = func.variadic
    if (variadic) {
      // A variadic C function: the fixed arguments, then any number of the promoted type.
      if (args.length < params.length) return this.fail(node, `${what} expects at least ${params.length} argument(s), got ${args.length}.`)
      const values = args.map((arg, i) => {
        const type = i < params.length ? params[i]! : variadic
        return this.coerce(this.checkExpr(arg, scope, type), type, arg)
      })
      return typed({ k: "call", type: func.type.result, func, args: values })
    }
    const signature = this.signatures.get(func.params)
    const fixed = signature?.rest ? params.length - 1 : params.length
    const required = signature?.required ?? params.length
    const given = args.slice(0, fixed)
    for (const arg of given) if (ts.isSpreadElement(arg)) return this.fail(arg, "Spread arguments are only supported for a rest parameter.")
    if (args.length < required || (!signature?.rest && args.length > fixed)) {
      const count = signature?.rest ? `at least ${required}` : required === fixed ? `${fixed}` : `${required} to ${fixed}`
      return this.fail(node, `${what} expects ${count} argument(s), got ${args.length}.`)
    }
    const values = given.map((arg, i) => this.coerce(operands?.[i] ?? this.checkExpr(arg, scope, params[i]), params[i]!, arg))

    // Extra arguments form the rest array, unless a single `...array` is passed on.
    if (signature?.rest) {
      const array = params[fixed] as ArrayType
      const extra = args.slice(fixed)
      if (extra.length === 1 && ts.isSpreadElement(extra[0]!)) {
        const spread = extra[0]
        values.push(this.coerce(this.checkExpr(spread.expression, scope, array), array, spread.expression))
      } else {
        const elems: ir.Expr[] = []
        for (const arg of extra) {
          if (ts.isSpreadElement(arg)) return this.fail(arg, "Pass a single '...array' as all the rest arguments.")
          elems.push(this.coerce(this.checkExpr(arg, scope, array.elem), array.elem, arg))
        }
        // Before default values, which come only when there are no extra arguments.
        if (values.length === fixed) values.push({ k: "array", type: array, elems })
      }
    }

    if (values.length >= params.length) {
      if (receiver) return typed({ k: "method-call", type: func.type.result, func, receiver, args: values })
      return typed({ k: "call", type: func.type.result, func, args: values })
    }
    // Missing arguments take their default values, computed after the given
    // ones, which their expressions can use by the parameter names.
    const locals: ir.Bind["locals"] = []
    const hold = (value: ir.Expr): ir.Expr & { k: "local" } => {
      const local = this.newLocal("arg", value.type, false)
      locals.push({ local, init: value })
      return { k: "local", type: value.type, local }
    }
    const self = receiver && hold(receiver)
    const held: ir.Expr[] = values.map(hold)
    const inner = new Scope(signature!.scope)
    held.forEach((v, i) => {
      const p = signature!.parameters[i]!
      if (ts.isIdentifier(p.name) && v.k === "local") inner.declareValue(p.name.text, { k: "local", local: v.local, decl: p })
    })
    // Errors in default values were reported at the declaration.
    const errors = this.diagnostics.length
    for (let i = held.length; i < fixed; i++) {
      const p = signature!.parameters[i]!
      const type = params[i]!
      held.push(p.initializer ? this.coerce(this.checkExpr(p.initializer, inner, type), type, p.initializer) : { k: "null", type: type as UnionType })
    }
    this.diagnostics.length = errors
    if (signature!.rest) held.push({ k: "array", type: params[fixed] as ArrayType, elems: [] })
    const call: ir.Expr = self
      ? { k: "method-call", type: func.type.result, func, receiver: self, args: held }
      : { k: "call", type: func.type.result, func, args: held }
    return typed({ k: "bind", type: func.type.result, locals, body: call })
  }

  protected checkMethodCall(node: ts.CallExpression, callee: ts.PropertyAccessExpression, scope: Scope): Operand {
    const target = this.checkExpr(callee.expression, scope)
    if (target.k === "error") return target
    const value = this.toDefault(target, callee.expression)
    if (callee.questionDotToken) return this.optional(value, node, (v) => this.methodCall(v, node, callee, scope))
    return this.methodCall(value, node, callee, scope)
  }

  protected methodCall(value: ir.Expr, node: ts.CallExpression, callee: ts.PropertyAccessExpression, scope: Scope): Operand {
    const name = callee.name.text
    const args = node.arguments
    const type = value.type

    const generic = type.kind === "struct" ? this.genericMethods.get(type)?.get(name) : undefined
    if (node.typeArguments && !generic) return this.fail(node.typeArguments[0]!, "Type arguments are only allowed for generic functions and methods.")
    if (type.kind === "struct" && generic) {
      this.defineMember(callee.name, type, name)
      if (!this.checkAccess(type, generic, name, callee.name)) return errorOperand
      const decl = generic.generic.decl as ts.MethodDeclaration
      const call = this.genericCall(generic.generic, decl.parameters, node.typeArguments, args, node, scope)
      if (!call) return errorOperand
      const what = `Method '${type.name}.${name}'`
      return this.callFunc(call.instance as ir.Func, args, node, scope, what, value, call.operands.length > 0 ? call.operands : undefined)
    }
    if (type.kind === "struct") {
      const method = findMethod(type, name)
      if (method) {
        this.defineMember(callee.name, type, name)
        if (!this.checkAccess(type, method, name, callee.name)) return errorOperand
        return this.callFunc(method.func, args, node, scope, `Method '${type.name}.${name}'`, value)
      }
      const field = findField(type, name)
      if (field?.type.kind === "func") return this.callValue(this.member(value, callee.name, callee.name.text), node, scope)
      if (field) return this.fail(callee.name, `Field '${name}' is not a method.`)
    }
    if (type.kind === "interface") {
      const index = type.members.findIndex((m) => m.name === name)
      const member = type.members[index]
      if (member?.k === "method") {
        this.defineMember(callee.name, type, name)
        for (const arg of args) if (ts.isSpreadElement(arg)) return this.fail(arg, "Spread arguments are not supported yet.")
        const params = member.type.params
        if (args.length !== params.length) return this.fail(node, `Method '${type.name}.${name}' expects ${params.length} argument(s), got ${args.length}.`)
        const values = args.map((arg, i) => this.coerce(this.checkExpr(arg, scope, params[i]), params[i]!, arg))
        return typed({ k: "iface-call", type: member.type.result, value, index, method: member.type, args: values })
      }
      if (member?.type.kind === "func") return this.callValue(this.member(value, callee.name, callee.name.text), node, scope)
      if (member) return this.fail(callee.name, `Field '${name}' is not a method.`)
    }
    if (type.kind === "chan") {
      const arity: Record<string, number> = { send: 1, receive: 0, close: 0, onReceive: 1, onSend: 2 }
      const count = arity[name]
      if (count === undefined) return this.fail(callee.name, `Method '${name}' does not exist on type '${typeToString(type)}'.`)
      if (args.length !== count) return this.fail(node, `'${name}' expects ${count} argument(s), got ${args.length}.`)
      if (name === "onReceive") {
        const cb = this.callback(args[0]!, scope, [this.unionOf([type.elem, types.null])], types.void, true)
        if (!cb) return errorOperand
        return typed({ k: "chan", op: "on-receive", type: types.SelectCase, chanType: type, chan: value, handler: cb.expr, arity: cb.arity })
      }
      if (name === "onSend") {
        const sent = this.coerce(this.checkExpr(args[0]!, scope, type.elem), type.elem, args[0]!)
        const cb = this.callback(args[1]!, scope, [], types.void, true)
        if (!cb) return errorOperand
        return typed({ k: "chan", op: "on-send", type: types.SelectCase, chanType: type, chan: value, value: sent, handler: cb.expr, arity: 0 })
      }
      const op = name as ir.ChanOp["op"]
      const sent = op === "send" ? this.coerce(this.checkExpr(args[0]!, scope, type.elem), type.elem, args[0]!) : undefined
      const result = op === "receive" ? this.unionOf([type.elem, types.null]) : types.void
      return typed({ k: "chan", op, type: result, chanType: type, chan: value, value: sent })
    }
    if (type.kind === "map") {
      const arity: Record<string, number> = { get: 1, set: 2, has: 1, delete: 1, clear: 0, keys: 0, values: 0 }
      const count = arity[name]
      if (count === undefined) return this.fail(callee.name, `Method '${name}' does not exist on type '${typeToString(type)}'.`)
      if (args.length !== count) return this.fail(node, `'${name}' expects ${count} argument(s), got ${args.length}.`)
      const key = count > 0 ? this.coerce(this.checkExpr(args[0]!, scope, type.key), type.key, args[0]!) : undefined
      const val = count > 1 ? this.coerce(this.checkExpr(args[1]!, scope, type.value), type.value, args[1]!) : undefined
      const op = name as ir.MapOp["op"]
      const result: Type =
        op === "get" ? this.unionOf([type.value, types.null])
        : op === "set" ? type
        : op === "has" || op === "delete" ? types.bool
        : op === "keys" ? arrayOf(type.key)
        : op === "values" ? arrayOf(type.value)
        : types.void
      return typed({ k: "map", op, type: result, mapType: type, map: value, key, value: val })
    }
    if (type.kind === "array" && arrayMethods.has(name)) return this.arrayMethod(value, type, name, node, callee, scope)
    if ((isNumeric(type) || type.kind === "bool") && name === "toString" && args.length === 0) {
      return typed({ k: "concat", type: types.string, parts: [value] })
    }
    if (isNumeric(type) && name === "toFixed") {
      if (args.length !== 1) return this.fail(node, `'toFixed' expects 1 argument(s), got ${args.length}.`)
      const digits = this.coerce(this.checkExpr(args[0]!, scope, types.i64), types.i64, args[0]!)
      const number: ir.Expr = type.kind === "float" && type.bits === 64 ? value : { k: "convert", type: types.f64, value }
      return typed({ k: "builtin", type: types.string, name: "Number.toFixed", args: [number, digits] })
    }
    const stringMethod = isStringLike(type) || (type.kind === "union" && type.members.every(isStringLike)) ? stringMethods[name] : undefined
    if (stringMethod) {
      const [params, optional, result] = stringMethod
      if (args.length < params.length - optional || args.length > params.length) {
        return this.fail(node, `'${name}' expects ${optional ? `${params.length - optional} to ${params.length}` : params.length} argument(s), got ${args.length}.`)
      }
      const values = args.map((a, i) => this.coerce(this.checkExpr(a, scope, params[i]), params[i]!, a))
      const str = sameType(type, types.string) ? value : ({ k: "recast", type: types.string, value } as ir.Expr)
      return typed({ k: "string-method", method: name, type: result, value: str, args: values })
    }
    if (type.kind === "array" && name === "push") {
      const values: ir.Expr[] = []
      for (const arg of args) {
        if (ts.isSpreadElement(arg)) return this.fail(arg, "Spread arguments are not supported yet.")
        values.push(this.coerce(this.checkExpr(arg, scope, type.elem), type.elem, arg))
      }
      return typed({ k: "push", type: types.i64, array: value, values })
    }
    if (type.kind === "array" && name === "pop") {
      if (args.length > 0) return this.fail(node, `'pop' expects no arguments, got ${args.length}.`)
      return typed({ k: "pop", type: type.elem, array: value })
    }
    if (name === "slice" && (type.kind === "string" || type.kind === "array")) {
      if (args.length > 2) return this.fail(node, `'slice' expects at most 2 arguments, got ${args.length}.`)
      const offsets = args.map((a) => this.checkIndex(a, scope, true))
      if (offsets.some((o) => !o)) return errorOperand
      return typed({ k: "slice", type, value, start: offsets[0], end: offsets[1] })
    }
    return this.fail(callee.name, this.noProperty(type, name).replace("Property", "Method"))
  }
}
