// Classes and interfaces: members, constructors, accessors, conformance and interface tables.
import * as ir from "@ore/ir"
import { findField, findMethod, sameType, types, typeToString, type InterfaceMember, type InterfaceType, type StructType, type Type } from "@ore/ir"
import ts from "typescript"
import { Scope, type Generic } from "./symbols"
import type { ClassInfo, Accessor, InterfaceInfo } from "./context"
import { cIdent, hasZeroValue } from "./helpers"
import { DeclarationChecker } from "./declarations"

export abstract class ClassChecker extends DeclarationChecker {
  protected declareClass(decl: ts.ClassDeclaration, scope: Scope) {
    if (!decl.name) return this.error(decl, "A class declaration must have a name.")
    const name = decl.name.text
    if (decl.typeParameters) return this.declareGeneric(decl, scope)
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
    this.classes.push({ decl, type, scope, cname: this.prefix + cIdent(name), inits: [], paramProps: [], ctorThis, methods: [] })
  }

  protected declareClassMembers(info: ClassInfo, scope: Scope) {
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
        if (!member.body) {
          this.error(member.name, "A method must have a body.")
          continue
        }
        if (member.typeParameters) {
          for (const p of member.typeParameters) if (p.default) this.error(p.default, "Default type arguments are not supported yet.")
          const generic: Generic = { name, decl: member, params: member.typeParameters, scope, instances: new Map() }
          if (!this.genericMethods.has(type)) this.genericMethods.set(type, new Map())
          this.genericMethods.get(type)!.set(name, { generic, info, private: flags.private })
          continue
        }
        const func = this.makeMethod(member, info, scope, `${className}.${name}`, `ore_m_${info.cname}_${cIdent(name)}`)
        type.methods.push({ name, func, private: flags.private })
        info.methods.push([member, func])
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
        this.declareAccessor(member, info, scope, flags.private)
      } else {
        this.error(member, "This class member is not supported.")
      }
    }
    type.ctor ??= this.ctorFunc(info, [], decl.name!)
  }

  protected ctorFunc(info: ClassInfo, params: ir.Local[], node: ts.Node): ir.Func {
    const func: ir.Func = {
      name: `ore_new_${info.cname}`,
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

  protected memberModifiers(node: ts.Node): { private: boolean; readonly: boolean; any: boolean } {
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
  protected checkFieldInitializers(info: ClassInfo, scope: Scope) {
    // Initializers run before the constructor body but cannot use `this`.
    this.facts = [new Map()]
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

  protected checkClassBodies(info: ClassInfo, outer: Scope) {
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
      const prologue: ir.Stmt[] = []
      const scope = this.paramScope(info.ctorDecl.parameters, ctor.params, outer, prologue)
      this.facts = [new Map()]
      this.fn = { result: types.void, loops: [], nextLoopId: 0, this: self, cls: type, ctor: true }
      body.push(...prologue, ...this.checkBlock(info.ctorDecl.body!, scope).body)
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

    for (const [decl, func] of info.methods) this.checkMethodBody(decl, func, type, outer)
  }

  /** A getter or setter: a method named `get_x` or `set_x`, called by reads and writes of property `x`. */
  protected declareAccessor(member: ts.AccessorDeclaration, info: ClassInfo, scope: Scope, isPrivate: boolean) {
    const name = this.memberName(member.name)
    if (name === undefined) return
    const { type } = info
    const decls = this.memberDecls.get(type)!
    const accessors = this.accessors.get(type) ?? new Map<string, Accessor>()
    this.accessors.set(type, accessors)
    const existing = accessors.get(name)
    const getter = ts.isGetAccessor(member)
    if ((decls.has(name) && !existing) || (existing && (getter ? existing.get : existing.set))) return this.error(member.name, `Duplicate member '${name}'.`)
    decls.set(name, member)
    if (!member.body) return this.error(member.name, "A getter or setter must have a body.")
    if (getter && !member.type) return this.error(member.name, `Getter '${name}' must have a return type annotation.`)
    if (!getter && (member.parameters.length !== 1 || !member.parameters[0]!.type)) return this.error(member.name, `Setter '${name}' must take one parameter with a type annotation.`)
    const kind = getter ? "get" : "set"
    const func = this.makeMethod(member, info, scope, `${type.name}.${kind} ${name}`, `ore_m_${info.cname}_${kind}_${cIdent(name)}`)
    info.methods.push([member, func])
    const propertyType = getter ? func.type.result : func.type.params[0]!
    if (existing && !sameType(existing.type, propertyType)) {
      return this.error(member.name, `The getter and setter of '${name}' must have the same type, got '${typeToString(existing.type)}' and '${typeToString(propertyType)}'.`)
    }
    const property = existing ?? { type: propertyType, private: isPrivate }
    property[kind] = func
    accessors.set(name, property)
  }

  /** The accessor property `name` of a struct, if any. */
  protected accessor(type: Type, name: string): Accessor | undefined {
    return type.kind === "struct" ? this.accessors.get(type)?.get(name) : undefined
  }

  /** A method with the signature of a declaration, resolved in `scope`; the body is checked later. */
  protected makeMethod(decl: ts.MethodDeclaration | ts.AccessorDeclaration, info: ClassInfo, scope: Scope, sourceName: string, cname: string): ir.Func {
    const params = this.resolveParams(decl.parameters, scope)
    const result = decl.type ? this.resolveType(decl.type, scope) ?? types.void : types.void
    const func: ir.Func = {
      name: cname,
      sourceName,
      line: this.line(decl.name),
      type: { kind: "func", params: params.map((p) => p.type), result },
      params,
      receiver: this.newLocal("this", info.type, false),
      body: { k: "block", body: [] },
      exported: false,
    }
    this.module.functions.push(func)
    return func
  }

  protected checkMethodBody(decl: ts.MethodDeclaration | ts.AccessorDeclaration, func: ir.Func, type: StructType, outer: Scope) {
    const prologue: ir.Stmt[] = []
    const scope = this.paramScope(decl.parameters, func.params, outer, prologue)
    this.facts = [new Map()]
    this.fn = { result: func.type.result, loops: [], nextLoopId: 0, this: func.receiver, cls: type }
    func.body = this.checkBlock(decl.body!, scope)
    func.body.body.unshift(...prologue)
    this.fn = undefined
    this.checkReturns(func, decl.type ?? decl.name)
  }

  /** Checks that a class has the members of the interfaces it `implements`. */
  protected checkImplements(info: ClassInfo, scope: Scope) {
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

  protected declareInterface(decl: ts.InterfaceDeclaration, scope: Scope) {
    const name = decl.name.text
    if (decl.typeParameters) return this.declareGeneric(decl, scope)
    const type: InterfaceType = { kind: "interface", id: this.nextStructId++, name, members: [] }
    if (!scope.declareType(name, { type, decl })) return this.error(decl.name, `Duplicate type '${name}'.`)
    this.interfaces.set(type, { decl, type, scope, state: "declared" })
    this.memberDecls.set(type, new Map())
  }

  protected fillInterface(info: InterfaceInfo, scope: Scope) {
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
        if (member.typeParameters) this.error(member.typeParameters[0]!, "Generic methods are not supported in interfaces: calls through an interface cannot pick an instance.")
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
  protected conformance(from: StructType | InterfaceType, iface: InterfaceType): { reason?: string; indices?: number[] } {
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
  protected itab(struct: StructType, iface: InterfaceType): ir.Itab {
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
  protected checkAccess(struct: StructType, member: { private?: boolean }, name: string, node: ts.Node): boolean {
    if (!member.private || this.fn?.cls === struct) return true
    this.error(node, `'${name}' is private and only accessible inside class '${struct.name}'.`)
    return false
  }
}
