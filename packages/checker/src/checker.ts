import * as ir from "@ore/ir"
import {
  arrayOf,
  findField,
  findMethod,
  intRange,
  isNumeric,
  sameType,
  types,
  typeToString,
  type Field,
  type FuncType,
  type InterfaceMember,
  type InterfaceType,
  type StructType,
  type Type,
} from "@ore/ir"
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
  /** `this` inside a method or constructor. */
  this?: ir.Local
  /** The class whose method or constructor is being checked. */
  cls?: StructType
  ctor?: boolean
  /** Checking field initializers, which cannot use `this`. */
  fieldInit?: boolean
  /** Enclosing loops, innermost last. */
  loops: LoopContext[]
  nextLoopId: number
  /** Label of a labeled statement whose loop has not been entered yet. */
  pendingLabel?: string
}

/** A class declaration between the passes of checking. */
interface ClassInfo {
  decl: ts.ClassDeclaration
  type: StructType
  /** Field initializers by field name, checked before constructor bodies. */
  inits: { name: string; node: ts.Expression; value?: ir.Expr }[]
  /** Constructor parameters that declare fields. */
  paramProps: ir.Local[]
  ctorDecl?: ts.ConstructorDeclaration
  ctorThis: ir.Local
  methods: [ts.MethodDeclaration, ir.Func][]
}

interface InterfaceInfo {
  decl: ts.InterfaceDeclaration
  type: InterfaceType
  state: "declared" | "filling" | "filled"
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
  private readonly module: ir.Module
  private nextLocalId = 0
  private fn: FuncContext | undefined
  /** Anonymous struct types by shape key. */
  private readonly shapes = new Map<string, StructType>()
  private nextStructId = 0
  private readonly classes: ClassInfo[] = []
  private readonly interfaces = new Map<InterfaceType, InterfaceInfo>()
  private readonly itabs = new Map<string, ir.Itab>()
  /** Declarations of fields and methods, for tooling. */
  private readonly memberDecls = new Map<StructType | InterfaceType, Map<string, ts.Node>>()

  constructor(private readonly source: Source) {
    this.module = { file: source.path, functions: [], structs: [], itabs: [] }
  }

  run(options: CheckOptions): CheckResult {
    const scope = new Scope(builtinScope())
    const bodies: [ts.FunctionDeclaration, ir.Func][] = []
    const statements = this.source.ast.statements

    // Pass 1: names of classes and interfaces, so that types can refer to them in any order.
    for (const stmt of statements) {
      if (ts.isClassDeclaration(stmt)) this.declareClass(stmt, scope)
      else if (ts.isInterfaceDeclaration(stmt)) this.declareInterface(stmt, scope)
    }

    // Pass 2: type aliases, then signatures of functions and class members,
    // so that they can be used before their declaration and recursively.
    for (const stmt of statements) if (ts.isTypeAliasDeclaration(stmt)) this.declareTypeAlias(stmt, scope)
    for (const info of this.interfaces.values()) this.fillInterface(info, scope)
    for (const stmt of statements) {
      if (ts.isFunctionDeclaration(stmt)) {
        const func = this.declareFunction(stmt, scope)
        if (func) bodies.push([stmt, func])
      }
    }
    for (const info of this.classes) this.declareClassMembers(info, scope)

    // Pass 3: top-level constants in source order, field initializers, then bodies.
    for (const stmt of statements) {
      if (ts.isTypeAliasDeclaration(stmt) || ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt) || ts.isInterfaceDeclaration(stmt)) continue
      if (ts.isVariableStatement(stmt)) this.checkTopLevelVariables(stmt, scope)
      else if (ts.isEmptyStatement(stmt)) continue
      else this.error(stmt, this.unsupportedTopLevel(stmt))
    }
    for (const info of this.classes) this.checkFieldInitializers(info, scope)
    for (const info of this.classes) this.checkImplements(info, scope)
    for (const [decl, func] of bodies) this.checkFunctionBody(decl, func, scope)
    for (const info of this.classes) this.checkClassBodies(info, scope)

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
    // An anonymous object type is displayed by the first alias that names it.
    if (type.kind === "struct" && type.name === undefined) type.name = decl.name.text
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

    const params = this.resolveParams(decl.parameters, scope)
    const result = decl.type ? this.resolveType(decl.type, scope) ?? types.void : types.void
    const type: FuncType = { kind: "func", params: params.map((p) => p.type), result }
    const exported = decl.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false
    const func: ir.Func = {
      name: `ore_fn_${decl.name.text}`,
      sourceName: decl.name.text,
      line: this.line(decl.name),
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

  /** Resolves parameters into locals; parameter properties are allowed only by the caller. */
  private resolveParams(parameters: readonly ts.ParameterDeclaration[], scope: Scope): ir.Local[] {
    const params: ir.Local[] = []
    for (const p of parameters) {
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
    return params
  }

  /** A scope with the parameters of a function declared. */
  private paramScope(parameters: readonly ts.ParameterDeclaration[], locals: ir.Local[], outer: Scope): Scope {
    const scope = new Scope(outer)
    parameters.forEach((p, i) => {
      const local = locals[i]
      if (local && ts.isIdentifier(p.name)) {
        if (!scope.declareValue(local.name, { k: "local", local, decl: p })) this.error(p.name, `Duplicate parameter '${local.name}'.`)
      }
    })
    return scope
  }

  private checkFunctionBody(decl: ts.FunctionDeclaration, func: ir.Func, outer: Scope) {
    const scope = this.paramScope(decl.parameters, func.params, outer)
    this.fn = { result: func.type.result, loops: [], nextLoopId: 0 }
    func.body = this.checkBlock(decl.body!, scope)
    this.fn = undefined
    this.checkReturns(func, decl.type ?? decl.name!)
  }

  private checkReturns(func: ir.Func, node: ts.Node) {
    const result = func.type.result
    if (result.kind !== "void" && !terminates(func.body)) {
      this.error(node, `Function '${func.sourceName}' must return a value of type '${typeToString(result)}' on every path.`)
    }
  }

  // ---------------------------------------------------------------------------
  // Classes

  private declareClass(decl: ts.ClassDeclaration, scope: Scope) {
    if (!decl.name) return this.error(decl, "A class declaration must have a name.")
    const name = decl.name.text
    if (decl.typeParameters) this.error(decl.typeParameters[0]!, "Generic classes are not supported yet.")
    for (const clause of decl.heritageClauses ?? []) {
      if (clause.token === ts.SyntaxKind.ExtendsKeyword) this.error(clause, "Class inheritance is not supported in Ore. Use composition and interfaces.")
    }
    for (const mod of decl.modifiers ?? []) {
      if (mod.kind !== ts.SyntaxKind.ExportKeyword) this.error(mod, `Modifier '${mod.getText()}' is not allowed on classes.`)
    }
    const type: StructType = { kind: "struct", id: this.nextStructId++, name, nominal: true, fields: [], methods: [] }
    if (!scope.declareType(name, { type, decl }) || !scope.declareValue(name, { k: "class", type, decl })) {
      return this.error(decl.name, `Duplicate declaration '${name}'.`)
    }
    this.module.structs.push(type)
    this.memberDecls.set(type, new Map())
    const ctorThis = this.newLocal("this", type, false)
    this.classes.push({ decl, type, inits: [], paramProps: [], ctorThis, methods: [] })
  }

  private declareClassMembers(info: ClassInfo, scope: Scope) {
    const { decl, type } = info
    const className = type.name!
    const decls = this.memberDecls.get(type)!
    const declare = (name: string, node: ts.Node, nameNode: ts.Node): boolean => {
      if (decls.has(name)) {
        this.error(nameNode, `Duplicate member '${name}'.`)
        return false
      }
      decls.set(name, node)
      return true
    }

    for (const member of decl.members) {
      if (ts.isSemicolonClassElement(member)) continue
      const flags = this.memberModifiers(member)
      if (ts.isPropertyDeclaration(member)) {
        const name = this.memberName(member.name)
        if (name === undefined || !declare(name, member, member.name)) continue
        if (member.questionToken || member.exclamationToken) this.error(member.questionToken ?? member.exclamationToken!, "Optional and definitely-assigned fields are not supported.")
        let fieldType: Type | undefined
        if (member.type) fieldType = this.resolveValueType(member.type, scope)
        else if (!member.initializer) this.error(member.name, `Field '${name}' needs a type annotation or an initializer.`)
        if (member.initializer) info.inits.push({ name, node: member.initializer })
        // A field without an annotation gets its type from the initializer later.
        type.fields.push({ name, type: fieldType ?? types.void, readonly: flags.readonly, private: flags.private })
        if (fieldType) this.info.types.set(member.name, fieldType)
      } else if (ts.isMethodDeclaration(member)) {
        const name = this.memberName(member.name)
        if (name === undefined || !declare(name, member, member.name)) continue
        if (flags.readonly) this.error(member, "Methods cannot be 'readonly'.")
        if (member.asteriskToken) this.error(member.asteriskToken, "Generators are not supported in Ore.")
        if (member.questionToken) this.error(member.questionToken, "Optional methods are not supported.")
        if (member.typeParameters) this.error(member.typeParameters[0]!, "Generic methods are not supported yet.")
        if (!member.body) {
          this.error(member.name, "A method must have a body.")
          continue
        }
        const params = this.resolveParams(member.parameters, scope)
        const result = member.type ? this.resolveType(member.type, scope) ?? types.void : types.void
        const func: ir.Func = {
          name: `ore_m_${className}_${name}`,
          sourceName: `${className}.${name}`,
          line: this.line(member.name),
          type: { kind: "func", params: params.map((p) => p.type), result },
          params,
          receiver: this.newLocal("this", type, false),
          body: { k: "block", body: [] },
          exported: false,
        }
        type.methods.push({ name, func, private: flags.private })
        info.methods.push([member, func])
        this.module.functions.push(func)
      } else if (ts.isConstructorDeclaration(member)) {
        if (info.ctorDecl) {
          this.error(member, "A class can have only one constructor.")
          continue
        }
        if (!member.body) {
          this.error(member, "A constructor must have a body.")
          continue
        }
        info.ctorDecl = member
        // Parameters with modifiers declare fields: `constructor(private x: f64)`.
        const params = this.resolveParams(member.parameters, scope)
        member.parameters.forEach((p, i) => {
          const pflags = this.memberModifiers(p)
          if (!pflags.any || !ts.isIdentifier(p.name) || !params[i]) return
          if (!declare(p.name.text, p, p.name)) return
          type.fields.push({ name: p.name.text, type: params[i]!.type, readonly: pflags.readonly, private: pflags.private })
          info.paramProps.push(params[i]!)
        })
        type.ctor = this.ctorFunc(info, params, member)
      } else if (ts.isGetAccessor(member) || ts.isSetAccessor(member)) {
        this.error(member, "Getters and setters are not supported yet.")
      } else {
        this.error(member, "This class member is not supported.")
      }
    }
    type.ctor ??= this.ctorFunc(info, [], decl.name!)
  }

  private ctorFunc(info: ClassInfo, params: ir.Local[], node: ts.Node): ir.Func {
    const func: ir.Func = {
      name: `ore_new_${info.type.name}`,
      sourceName: `${info.type.name}.constructor`,
      line: this.line(node),
      type: { kind: "func", params: params.map((p) => p.type), result: info.type },
      params,
      body: { k: "block", body: [] },
      exported: false,
    }
    this.module.functions.push(func)
    return func
  }

  private memberModifiers(node: ts.Node): { private: boolean; readonly: boolean; any: boolean } {
    const flags = { private: false, readonly: false, any: false }
    for (const mod of (ts.canHaveModifiers(node) && ts.getModifiers(node)) || []) {
      flags.any = true
      switch (mod.kind) {
        case ts.SyntaxKind.PrivateKeyword:
          flags.private = true
          break
        case ts.SyntaxKind.ReadonlyKeyword:
          flags.readonly = true
          break
        case ts.SyntaxKind.PublicKeyword:
          break
        case ts.SyntaxKind.ProtectedKeyword:
          this.error(mod, "'protected' is not supported in Ore, which has no inheritance. Use 'private'.")
          break
        case ts.SyntaxKind.StaticKeyword:
          this.error(mod, "Static members are not supported yet. Use top-level functions and constants.")
          break
        default:
          this.error(mod, `Modifier '${mod.getText()}' is not allowed here.`)
      }
    }
    return flags
  }

  /** Checks field initializers and infers the types of fields without annotations. */
  private checkFieldInitializers(info: ClassInfo, scope: Scope) {
    // Initializers run before the constructor body but cannot use `this`.
    this.fn = { result: types.void, loops: [], nextLoopId: 0, fieldInit: true }
    for (const init of info.inits) {
      const index = info.type.fields.findIndex((f) => f.name === init.name)
      const field = info.type.fields[index]!
      const declared = field.type.kind === "void" ? undefined : field.type
      const value = this.checkExpr(init.node, scope, declared)
      if (declared) init.value = this.coerce(value, declared, init.node)
      else if (value.k !== "error") {
        init.value = this.toDefault(value, init.node)
        info.type.fields[index] = { ...field, type: init.value.type }
        const decl = this.memberDecls.get(info.type)!.get(init.name) as ts.PropertyDeclaration
        this.info.types.set(decl.name, init.value.type)
      }
    }
    this.fn = undefined
  }

  private checkClassBodies(info: ClassInfo, outer: Scope) {
    const { type } = info
    const ctor = type.ctor!
    const self = info.ctorThis
    const thisRef: ir.Expr = { k: "local", type, local: self }
    const setField = (name: string, value: ir.Expr): ir.Stmt => ({
      k: "expr",
      expr: { k: "assign", type: value.type, target: { k: "field", object: thisRef, name }, value },
    })

    // Constructor: allocate, assign parameter properties, run field initializers, then the body.
    const body: ir.Stmt[] = [{ k: "let", local: self, init: { k: "alloc", type } }]
    for (const p of info.paramProps) body.push(setField(p.name, { k: "local", type: p.type, local: p }))
    for (const init of info.inits) if (init.value) body.push(setField(init.name, init.value))
    if (info.ctorDecl) {
      const scope = this.paramScope(info.ctorDecl.parameters, ctor.params, outer)
      this.fn = { result: types.void, loops: [], nextLoopId: 0, this: self, cls: type, ctor: true }
      body.push(...this.checkBlock(info.ctorDecl.body!, scope).body)
      this.fn = undefined
    }
    body.push({ k: "return", value: thisRef })
    ctor.body = { k: "block", body }

    // Fields of reference types have no zero value and must be set in the constructor.
    const assigned = new Set([...info.paramProps.map((p) => p.name), ...info.inits.map((i) => i.name)])
    for (const stmt of info.ctorDecl?.body?.statements ?? []) {
      if (!ts.isExpressionStatement(stmt) || !ts.isBinaryExpression(stmt.expression)) continue
      const { left, operatorToken } = stmt.expression
      if (operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(left) && left.expression.kind === ts.SyntaxKind.ThisKeyword) {
        assigned.add(left.name.text)
      }
    }
    for (const field of type.fields) {
      if (!hasZeroValue(field.type) && !assigned.has(field.name)) {
        const decl = this.memberDecls.get(type)!.get(field.name) as ts.PropertyDeclaration
        this.error(decl.name, `Field '${field.name}' of type '${typeToString(field.type)}' must be initialized in its declaration or at the top level of the constructor.`)
      }
    }

    for (const [decl, func] of info.methods) {
      const scope = this.paramScope(decl.parameters, func.params, outer)
      this.fn = { result: func.type.result, loops: [], nextLoopId: 0, this: func.receiver, cls: type }
      func.body = this.checkBlock(decl.body!, scope)
      this.fn = undefined
      this.checkReturns(func, decl.type ?? decl.name)
    }
  }

  /** Checks that a class has the members of the interfaces it `implements`. */
  private checkImplements(info: ClassInfo, scope: Scope) {
    for (const clause of info.decl.heritageClauses ?? []) {
      if (clause.token !== ts.SyntaxKind.ImplementsKeyword) continue
      for (const ref of clause.types) {
        const type = ts.isIdentifier(ref.expression) ? scope.lookupType(ref.expression.text) : undefined
        if (ts.isIdentifier(ref.expression) && type) this.info.definitions.set(ref.expression, type.decl)
        if (!type || type.type.kind !== "interface") {
          this.error(ref, `'${ref.expression.getText()}' is not an interface.`)
          continue
        }
        const result = this.conformance(info.type, type.type)
        if (result.reason) this.error(ref, `Class '${info.type.name}' does not implement '${type.type.name}': ${result.reason}.`)
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Interfaces

  private declareInterface(decl: ts.InterfaceDeclaration, scope: Scope) {
    const name = decl.name.text
    if (decl.typeParameters) this.error(decl.typeParameters[0]!, "Generic interfaces are not supported yet.")
    const type: InterfaceType = { kind: "interface", id: this.nextStructId++, name, members: [] }
    if (!scope.declareType(name, { type, decl })) return this.error(decl.name, `Duplicate type '${name}'.`)
    this.interfaces.set(type, { decl, type, state: "declared" })
    this.memberDecls.set(type, new Map())
  }

  private fillInterface(info: InterfaceInfo, scope: Scope) {
    if (info.state === "filled") return
    if (info.state === "filling") return this.error(info.decl.name, `Interface '${info.type.name}' extends itself.`)
    info.state = "filling"
    const members: InterfaceMember[] = []
    const decls = this.memberDecls.get(info.type)!
    const add = (member: InterfaceMember, node: ts.Node, decl: ts.Node) => {
      const existing = members.find((m) => m.name === member.name)
      if (!existing) {
        members.push(member)
        decls.set(member.name, decl)
      } else if (existing.k !== member.k || !sameType(existing.type, member.type)) {
        this.error(node, `Member '${member.name}' conflicts with an inherited member of a different type.`)
      }
    }

    for (const clause of info.decl.heritageClauses ?? []) {
      for (const ref of clause.types) {
        const base = ts.isIdentifier(ref.expression) ? scope.lookupType(ref.expression.text) : undefined
        if (!base || base.type.kind !== "interface") {
          this.error(ref, `An interface can only extend interfaces.`)
          continue
        }
        if (ts.isIdentifier(ref.expression)) this.info.definitions.set(ref.expression, base.decl)
        const baseInfo = this.interfaces.get(base.type)!
        this.fillInterface(baseInfo, scope)
        for (const m of base.type.members) add(m, ref, this.memberDecls.get(base.type)!.get(m.name)!)
      }
    }
    for (const member of info.decl.members) {
      if (!member.name) {
        this.error(member, "Call, construct and index signatures are not supported.")
        continue
      }
      const name = this.memberName(member.name)
      if (name === undefined) continue
      if (member.questionToken) this.error(member.questionToken, "Optional members are not supported yet.")
      if (ts.isPropertySignature(member)) {
        if (!member.type) {
          this.error(member.name, `Property '${name}' must have a type annotation.`)
          continue
        }
        const type = this.resolveValueType(member.type, scope)
        const readonly = member.modifiers?.some((m) => m.kind === ts.SyntaxKind.ReadonlyKeyword) ?? false
        if (type) {
          this.info.types.set(member.name, type)
          add({ k: "field", name, type, readonly }, member.name, member)
        }
      } else if (ts.isMethodSignature(member)) {
        if (member.typeParameters) this.error(member.typeParameters[0]!, "Generic methods are not supported yet.")
        const params = this.resolveParams(member.parameters, scope)
        const result = member.type ? this.resolveType(member.type, scope) ?? types.void : types.void
        add({ k: "method", name, type: { kind: "func", params: params.map((p) => p.type), result } }, member.name, member)
      } else {
        this.error(member, "This interface member is not supported.")
      }
    }
    members.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    info.type.members = members
    info.state = "filled"
  }

  /**
   * Whether a struct or interface has the members of an interface. For an
   * interface source, `indices` maps each target member to a source member.
   */
  private conformance(from: StructType | InterfaceType, iface: InterfaceType): { reason?: string; indices?: number[] } {
    const indices: number[] = []
    for (const member of iface.members) {
      const what = `${member.k === "field" ? "property" : "method"} '${member.name}'`
      if (from.kind === "interface") {
        const index = from.members.findIndex((m) => m.name === member.name)
        const source = from.members[index]
        if (!source || source.k !== member.k) return { reason: `${what} is missing` }
        if (!sameType(source.type, member.type)) return { reason: `${what} has type '${typeToString(source.type)}' instead of '${typeToString(member.type)}'` }
        if (source.k === "field" && member.k === "field" && source.readonly && !member.readonly) return { reason: `${what} is read-only` }
        indices.push(index)
      } else if (member.k === "field") {
        const field = findField(from, member.name)
        if (!field || field.private) return { reason: `${what} is missing` }
        if (!sameType(field.type, member.type)) return { reason: `${what} has type '${typeToString(field.type)}' instead of '${typeToString(member.type)}'` }
        if (field.readonly && !member.readonly) return { reason: `${what} is read-only` }
      } else {
        const method = findMethod(from, member.name)
        if (!method || method.private) return { reason: `${what} is missing` }
        if (!sameType(method.func.type, member.type)) return { reason: `${what} has type '${typeToString(method.func.type)}' instead of '${typeToString(member.type)}'` }
      }
    }
    return { indices }
  }

  /** The interface table of a struct, created once per struct and interface. */
  private itab(struct: StructType, iface: InterfaceType): ir.Itab {
    const key = `${struct.id}:${iface.id}`
    let itab = this.itabs.get(key)
    if (!itab) {
      itab = { id: this.itabs.size, struct, iface }
      this.itabs.set(key, itab)
      this.module.itabs.push(itab)
    }
    return itab
  }

  /** Reports access to a private member from outside its class. */
  private checkAccess(struct: StructType, member: { private?: boolean }, name: string, node: ts.Node): boolean {
    if (!member.private || this.fn?.cls === struct) return true
    this.error(node, `'${name}' is private and only accessible inside class '${struct.name}'.`)
    return false
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
    if (ts.isArrayTypeNode(node)) {
      const elem = this.resolveValueType(node.elementType, scope)
      return elem && arrayOf(elem)
    }
    if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName) && node.typeName.text === "Array" && !scope.lookupType("Array")) {
      if (node.typeArguments?.length !== 1) return this.error(node, "'Array' expects exactly 1 type argument."), undefined
      const elem = this.resolveValueType(node.typeArguments[0]!, scope)
      return elem && arrayOf(elem)
    }
    if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
      if (node.typeArguments) return this.error(node, "Generic types are not supported yet."), undefined
      const symbol = scope.lookupType(node.typeName.text)
      if (!symbol) return this.error(node.typeName, `Cannot find type '${node.typeName.text}'.`), undefined
      this.info.definitions.set(node.typeName, symbol.decl)
      return symbol.type
    }
    if (ts.isParenthesizedTypeNode(node)) return this.resolveType(node.type, scope)
    if (ts.isTypeLiteralNode(node)) return this.resolveTypeLiteral(node, scope)
    this.error(node, "This kind of type is not supported yet.")
    return undefined
  }

  private resolveTypeLiteral(node: ts.TypeLiteralNode, scope: Scope): Type | undefined {
    const fields: Field[] = []
    for (const member of node.members) {
      if (!ts.isPropertySignature(member)) {
        this.error(member, ts.isMethodSignature(member) ? "Methods in object types are not supported yet. Use an interface." : "Only properties are supported in object types.")
        continue
      }
      const name = this.memberName(member.name)
      if (name === undefined) continue
      if (member.questionToken) this.error(member.questionToken, "Optional properties are not supported yet.")
      if (!member.type) {
        this.error(member.name, `Property '${name}' must have a type annotation.`)
        continue
      }
      if (fields.some((f) => f.name === name)) this.error(member.name, `Duplicate property '${name}'.`)
      const type = this.resolveValueType(member.type, scope)
      const readonly = member.modifiers?.some((m) => m.kind === ts.SyntaxKind.ReadonlyKeyword) ?? false
      if (type) fields.push({ name, type, readonly })
      if (type) this.info.types.set(member.name, type)
    }
    const shape = this.shape(fields)
    // The first declaration of a shape is where its fields are defined.
    if (!this.memberDecls.has(shape)) {
      this.memberDecls.set(shape, new Map(node.members.flatMap((m) => (m.name && ts.isIdentifier(m.name) ? [[m.name.text, m] as const] : []))))
    }
    return shape
  }

  /** The interned anonymous struct type with these fields. */
  private shape(fields: Field[]): StructType {
    const sorted = [...fields].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    const key = sorted.map((f) => `${f.readonly ? "readonly " : ""}${f.name}:${typeKey(f.type)}`).join(";")
    let struct = this.shapes.get(key)
    if (!struct) {
      struct = { kind: "struct", id: this.nextStructId++, name: undefined, nominal: false, fields: sorted, methods: [] }
      this.shapes.set(key, struct)
      this.module.structs.push(struct)
    }
    return struct
  }

  /** The name of a property; computed and private names are rejected. */
  private memberName(name: ts.PropertyName): string | undefined {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text
    if (ts.isPrivateIdentifier(name)) this.error(name, "'#' private names are not supported. Use the 'private' modifier.")
    else this.error(name, "Computed property names are not supported.")
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
    const before = out.length
    this.checkStmtInner(stmt, scope, out)
    const line = this.line(stmt)
    for (let i = before; i < out.length; i++) out[i]!.line ??= line
  }

  private checkStmtInner(stmt: ts.Statement, scope: Scope, out: ir.Stmt[]) {
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
    } else if (ts.isForOfStatement(stmt)) {
      const loop = this.checkForOf(stmt, scope)
      if (loop) out.push(loop)
    } else if (ts.isForInStatement(stmt)) {
      this.error(stmt, "'for...in' is not supported in Ore. Use 'for...of'.")
    } else if (ts.isLabeledStatement(stmt)) {
      const label = stmt.label.text
      const inner = stmt.statement
      if (!(ts.isWhileStatement(inner) || ts.isDoStatement(inner) || ts.isForStatement(inner) || ts.isForOfStatement(inner))) {
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

      const value = decl.initializer ? this.checkExpr(decl.initializer, scope, declared) : undefined
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
          if (!value && !hasZeroValue(declared)) this.error(decl.name, `Variable '${name}' of type '${typeToString(declared)}' must be initialized.`)
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

  private checkForOf(stmt: ts.ForOfStatement, outer: Scope): ir.ForOfStmt | undefined {
    if (stmt.awaitModifier) return this.error(stmt.awaitModifier, "'for await' is not supported in Ore."), undefined
    const list = stmt.initializer
    if (!ts.isVariableDeclarationList(list) || !(list.flags & (ts.NodeFlags.Const | ts.NodeFlags.Let))) {
      return this.error(list, "The loop variable must be declared with 'const' or 'let'."), undefined
    }
    const decl = list.declarations[0]!
    if (!ts.isIdentifier(decl.name)) return this.error(decl.name, "Destructuring is not supported yet."), undefined
    if (decl.type) this.error(decl.type, "The loop variable cannot have a type annotation; its type comes from the iterable.")

    const value = this.checkExpr(stmt.expression, outer)
    if (value.k === "error") return undefined
    const iterable = this.toDefault(value, stmt.expression)
    const type = iterable.type
    let elem: Type
    if (type.kind === "array") elem = type.elem
    else if (type.kind === "string") elem = types.i32
    else return this.error(stmt.expression, `Type '${typeToString(type)}' is not iterable.`), undefined

    const scope = new Scope(outer)
    const local = this.newLocal(decl.name.text, elem, (list.flags & ts.NodeFlags.Let) !== 0)
    scope.declareValue(local.name, { k: "local", local, decl })
    this.info.types.set(decl.name, elem)
    const loop = this.checkLoopBody(stmt.statement, scope)
    return Object.assign(loop.ir, { k: "for-of" as const, id: loop.id, local, iterable, body: loop.body })
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
    const fn = this.fn!
    if (fn.ctor) {
      if (stmt.expression) this.error(stmt.expression, "A constructor cannot return a value.")
      return { k: "return", value: { k: "local", type: fn.this!.type, local: fn.this! } }
    }
    const result = fn.result
    if (!stmt.expression) {
      if (result.kind !== "void") this.error(stmt, `A return value of type '${typeToString(result)}' is required.`)
      return { k: "return" }
    }
    const value = this.checkExpr(stmt.expression, scope, result)
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

  /**
   * Checks an expression. `expected` is the type required by the context; it
   * only guides literals whose type cannot be inferred alone, like `[]`.
   */
  private checkExpr(node: ts.Expression, scope: Scope, expected?: Type): Operand {
    const result = this.checkExprInner(node, scope, expected)
    if (result.k === "typed") this.info.types.set(node, typeOf(result.expr))
    else if (result.k !== "error") this.info.types.set(node, this.defaultType(result))
    return result
  }

  private checkExprInner(node: ts.Expression, scope: Scope, expected: Type | undefined): Operand {
    if (ts.isParenthesizedExpression(node)) return this.checkExpr(node.expression, scope, expected)
    if (ts.isArrayLiteralExpression(node)) return this.checkArrayLiteral(node, scope, expected)
    if (ts.isObjectLiteralExpression(node)) return this.checkObjectLiteral(node, scope, expected)
    // node.text is normalized ("5.0" becomes "5"); the source spelling decides int vs float.
    if (ts.isNumericLiteral(node)) return numericLiteral(node.getText(this.source.ast))
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
      return typed({ k: "local", type: self.type, local: self })
    }
    if (ts.isNewExpression(node)) return this.checkNew(node, scope)
    if (ts.isBinaryExpression(node)) return this.checkBinary(node, scope)
    if (ts.isPrefixUnaryExpression(node)) return this.checkPrefixUnary(node, scope)
    if (ts.isPostfixUnaryExpression(node)) return this.checkIncDec(node.operand, node.operator, false, scope)
    if (ts.isCallExpression(node)) return this.checkCall(node, scope)
    if (ts.isConditionalExpression(node)) return this.checkConditional(node, scope)
    if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
      return this.fail(node, "Type assertions are not supported in Ore. Use a conversion such as 'i32(x)'.")
    }
    if (ts.isTemplateExpression(node)) return this.checkTemplate(node, scope)
    if (ts.isPropertyAccessExpression(node)) return this.checkProperty(node, scope)
    if (ts.isElementAccessExpression(node)) return this.checkElement(node, scope)
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
      case "class":
        return this.fail(node, `'${node.text}' is a class. Create an instance with 'new ${node.text}(...)'.`)
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
    const equatable = isNumeric(type) || ["bool", "string", "array", "struct", "interface"].includes(type.kind)
    if (ordered ? !(isNumeric(type) || type.kind === "string") : !equatable) {
      return this.fail(node.operatorToken, `Operator '${op}' cannot be applied to type '${typeToString(type)}'.`)
    }
    return typed({ k: "compare", type: types.bool, op, left: l, right: r })
  }

  private checkAssign(node: ts.BinaryExpression, op: ir.ArithOp | undefined, scope: Scope): Operand {
    const target = this.assignTarget(node.left, scope)
    const value = this.checkExpr(node.right, scope, op ? undefined : target?.type)
    if (!target) return errorOperand
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

  private checkIncDec(node: ts.Expression, operator: ts.SyntaxKind, prefix: boolean, scope: Scope): Operand {
    const target = this.assignTarget(node, scope)
    if (!target) return errorOperand
    const op = operator === ts.SyntaxKind.PlusPlusToken ? "++" : "--"
    const type = target.type
    if (!isNumeric(type)) return this.fail(node, `Operator '${op}' cannot be applied to type '${typeToString(type)}'.`)
    return typed({ k: "incdec", type, target: target.lvalue, op, prefix })
  }

  private assignTarget(node: ts.Expression, scope: Scope): { lvalue: ir.LValue; type: Type } | undefined {
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
      const struct = object.type.kind === "struct" ? object.type : undefined
      const field = struct && findField(struct, name)
      if (!struct || !field) return this.error(node.name, `Property '${name}' does not exist on type '${typeToString(object.type)}'.`), undefined
      this.defineMember(node.name, struct, name)
      if (!this.checkAccess(struct, field, name, node.name)) return undefined
      // A constructor may initialize the read-only fields of its own instance.
      const initializing = this.fn?.ctor && this.fn.cls === struct && object.k === "local" && object.local === this.fn.this
      if (field.readonly && !initializing) return this.error(node.name, `Cannot assign to '${name}' because it is a read-only property.`), undefined
      this.info.types.set(node, field.type)
      return { lvalue: { k: "field", object, name }, type: field.type }
    }
    if (!ts.isIdentifier(node)) return this.error(node, "Only variables, fields and array elements can be assigned to."), undefined
    const symbol = scope.lookupValue(node.text)
    if (!symbol) return this.error(node, `Cannot find name '${node.text}'.`), undefined
    this.info.definitions.set(node, symbol.decl)
    if (symbol.k !== "local") return this.error(node, `Cannot assign to '${node.text}' because it is not a variable.`), undefined
    if (!symbol.local.mutable) return this.error(node, `Cannot assign to '${node.text}' because it is a constant.`), undefined
    this.info.types.set(node, symbol.local.type)
    return { lvalue: { k: "local", local: symbol.local }, type: symbol.local.type }
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
    if (ts.isPropertyAccessExpression(callee)) return this.checkMethodCall(node, callee, scope)
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
          if (this.printable(expr, arg)) values.push(expr)
        }
        return typed({ k: "builtin", type: types.void, name: symbol.name, args: values })
      }
      case "func":
        return this.callFunc(symbol.func, args, node, scope, `Function '${symbol.func.sourceName}'`)
      case "class":
        return this.fail(callee, `Class '${callee.text}' must be instantiated with 'new ${callee.text}(...)'.`)
      default:
        return this.fail(callee, `'${callee.text}' is not a function.`)
    }
  }

  private checkNew(node: ts.NewExpression, scope: Scope): Operand {
    if (node.typeArguments) return this.fail(node.typeArguments[0]!, "Type arguments are not supported yet.")
    if (!ts.isIdentifier(node.expression)) return this.fail(node.expression, "Only named classes can be instantiated.")
    const name = node.expression.text
    const symbol = scope.lookupType(name)
    const type = symbol?.type
    if (!type || type.kind !== "struct" || !type.nominal) return this.fail(node.expression, `'${name}' is not a class.`)
    this.info.definitions.set(node.expression, symbol.decl)
    return this.callFunc(type.ctor!, node.arguments ?? [], node, scope, `Constructor of '${name}'`)
  }

  /** A checked call of a function or method with arguments converted to its parameters. */
  private callFunc(func: ir.Func, args: readonly ts.Expression[], node: ts.Node, scope: Scope, what: string, receiver?: ir.Expr): Operand {
    for (const arg of args) if (ts.isSpreadElement(arg)) return this.fail(arg, "Spread arguments are not supported yet.")
    if (args.length !== func.params.length) {
      return this.fail(node, `${what} expects ${func.params.length} argument(s), got ${args.length}.`)
    }
    const params = func.type.params
    const values = args.map((arg, i) => this.coerce(this.checkExpr(arg, scope, params[i]), params[i]!, arg))
    if (receiver) return typed({ k: "method-call", type: func.type.result, func, receiver, args: values })
    return typed({ k: "call", type: func.type.result, func, args: values })
  }

  private checkArrayLiteral(node: ts.ArrayLiteralExpression, scope: Scope, expected: Type | undefined): Operand {
    for (const e of node.elements) {
      if (ts.isSpreadElement(e)) return this.fail(e, "Spread elements are not supported yet.")
      if (ts.isOmittedExpression(e)) return this.fail(node, "Array holes are not supported.")
    }
    if (expected?.kind === "array") {
      const elems = node.elements.map((e) => this.coerce(this.checkExpr(e, scope, expected.elem), expected.elem, e))
      return typed({ k: "array", type: expected, elems })
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

  private checkObjectLiteral(node: ts.ObjectLiteralExpression, scope: Scope, expected: Type | undefined): Operand {
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

  private checkTemplate(node: ts.TemplateExpression, scope: Scope): Operand {
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
  private printable(expr: ir.Expr, node: ts.Node): boolean {
    const type = expr.type
    if (isNumeric(type) || type.kind === "bool" || type.kind === "string") return true
    this.error(node, `Cannot format a value of type '${typeToString(type)}'.`)
    return false
  }

  private checkProperty(node: ts.PropertyAccessExpression, scope: Scope): Operand {
    if (node.questionDotToken) return this.fail(node, "Optional chaining is not supported yet.")
    const target = this.checkExpr(node.expression, scope)
    if (target.k === "error") return target
    const value = this.toDefault(target, node.expression)
    const name = node.name.text
    if (name === "length" && (value.type.kind === "string" || value.type.kind === "array")) return typed({ k: "len", type: types.i64, value })
    if (value.type.kind === "struct") {
      const struct = value.type
      const field = findField(struct, name)
      this.defineMember(node.name, struct, name)
      if (field) {
        if (!this.checkAccess(struct, field, name, node.name)) return errorOperand
        return typed({ k: "field", type: field.type, object: value, name })
      }
      if (findMethod(struct, name)) return this.fail(node.name, `Method '${name}' must be called; method values are not supported yet.`)
    }
    if (value.type.kind === "interface") {
      const index = value.type.members.findIndex((m) => m.name === name)
      const member = value.type.members[index]
      this.defineMember(node.name, value.type, name)
      if (member?.k === "field") return typed({ k: "iface-field", type: member.type, value, index })
      if (member) return this.fail(node.name, `Method '${name}' must be called; method values are not supported yet.`)
    }
    return this.fail(node.name, `Property '${name}' does not exist on type '${typeToString(value.type)}'.`)
  }

  private checkElement(node: ts.ElementAccessExpression, scope: Scope): Operand {
    if (node.questionDotToken) return this.fail(node, "Optional chaining is not supported yet.")
    const target = this.checkExpr(node.expression, scope)
    if (target.k === "error") return target
    const value = this.toDefault(target, node.expression)
    const index = this.checkIndex(node.argumentExpression, scope)
    if (!index) return errorOperand
    if (value.type.kind === "string") return typed({ k: "index", type: types.u8, target: value, index })
    if (value.type.kind === "array") return typed({ k: "index", type: value.type.elem, target: value, index })
    return this.fail(node.expression, `Type '${typeToString(value.type)}' cannot be indexed.`)
  }

  /** Checks an index or offset: any integer type, and untyped constants must not be negative. */
  private checkIndex(node: ts.Expression, scope: Scope, allowNegative = false): ir.Expr | undefined {
    const value = this.checkExpr(node, scope)
    if (value.k === "error") return undefined
    if (value.k === "untyped-int" && value.value < 0n && !allowNegative) return this.error(node, `Index ${value.value} must not be negative.`), undefined
    const expr = value.k === "typed" ? value.expr : this.coerce(value, types.i64, node)
    if (expr.type.kind !== "int") return this.error(node, `An index must be an integer, got '${typeToString(expr.type)}'.`), undefined
    return expr
  }

  private checkMethodCall(node: ts.CallExpression, callee: ts.PropertyAccessExpression, scope: Scope): Operand {
    if (callee.questionDotToken) return this.fail(callee, "Optional chaining is not supported yet.")
    const target = this.checkExpr(callee.expression, scope)
    if (target.k === "error") return target
    const value = this.toDefault(target, callee.expression)
    const name = callee.name.text
    const args = node.arguments
    const type = value.type

    if (type.kind === "struct") {
      const method = findMethod(type, name)
      if (method) {
        this.defineMember(callee.name, type, name)
        if (!this.checkAccess(type, method, name, callee.name)) return errorOperand
        return this.callFunc(method.func, args, node, scope, `Method '${type.name}.${name}'`, value)
      }
      if (findField(type, name)) return this.fail(callee.name, `Field '${name}' is not a method.`)
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
      if (member) return this.fail(callee.name, `Field '${name}' is not a method.`)
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
    return this.fail(callee.name, `Method '${name}' does not exist on type '${typeToString(type)}'.`)
  }

  /** Records the declaration of a field or method for go to definition. */
  private defineMember(node: ts.MemberName, struct: StructType | InterfaceType, name: string) {
    const decl = this.memberDecls.get(struct)?.get(name)
    if (decl && ts.isIdentifier(node)) this.info.definitions.set(node, decl)
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
        if (target.kind === "interface" && (from.kind === "struct" || from.kind === "interface")) {
          const result = this.conformance(from, target)
          if (!result.reason) {
            if (from.kind === "interface") return { k: "to-iface", type: target, value: value.expr, indices: result.indices }
            return { k: "to-iface", type: target, value: value.expr, itab: this.itab(from, target) }
          }
          this.error(node, `Type '${typeToString(from)}' is not assignable to type '${target.name}': ${result.reason}.`)
          return poison(target)
        }
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

  private line(node: ts.Node): number {
    return this.source.position(node.getStart(this.source.ast)).line + 1
  }

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

function isString(value: Operand): value is Extract<Operand, { k: "typed" }> {
  return value.k === "typed" && value.expr.type.kind === "string"
}

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

/** A stable key of a type for interning shapes. */
function typeKey(type: Type): string {
  switch (type.kind) {
    case "array":
      return `${typeKey(type.elem)}[]`
    case "struct":
      return `#${type.id}`
    case "interface":
      return `@${type.id}`
    case "func":
      return `(${type.params.map(typeKey).join(",")})=>${typeKey(type.result)}`
    default:
      return typeToString(type)
  }
}

/** Whether a type has a zero value for variables without an initializer; references do not. */
function hasZeroValue(type: Type): boolean {
  return type.kind !== "struct" && type.kind !== "interface"
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
    case "array":
      return { k: "array", type, elems: [] }
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
    case "for-of":
      return breaks(stmt.body, loopId, true)
    default:
      return false
  }
}
