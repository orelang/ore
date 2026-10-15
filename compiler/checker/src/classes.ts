// Classes and interfaces: members, inheritance, constructors, accessors, conformance and interface tables.
import * as ir from "@ore/ir"
import { findField, findMethod, isSubclass, overridden, sameType, types, typeToString, type InterfaceMember, type InterfaceType, type StructType, type Type } from "@ore/ir"
import ts from "typescript"
import { Scope, type Generic } from "./symbols"
import type { ClassInfo, Accessor, InterfaceInfo, MemberFlags } from "./context"
import { cIdent, findThis, hasZeroValue, indexSignatureMessage, zeroNeedsInit, zeroValue } from "./helpers"
import { DeclarationChecker } from "./declarations"

/** What a member of a class is, for messages about inherited members. */
type MemberKind = "field" | "method" | "generic method" | "accessor"

export abstract class ClassChecker extends DeclarationChecker {
  protected declareClass(decl: ts.ClassDeclaration, scope: Scope) {
    if (!decl.name) return this.error(decl, "A class declaration must have a name.")
    const name = decl.name.text
    if (decl.typeParameters) return this.declareGeneric(decl, scope)
    for (const mod of decl.modifiers ?? []) {
      if (mod.kind !== ts.SyntaxKind.ExportKeyword && mod.kind !== ts.SyntaxKind.AbstractKeyword) this.error(mod, `Modifier '${mod.getText()}' is not allowed on classes.`)
    }
    const type: StructType = { kind: "struct", id: this.nextStructId++, name, nominal: true, fields: [], methods: [] }
    if (!scope.declareType(name, { type, decl }) || !scope.declareValue(name, { k: "class", type, decl })) {
      return this.error(decl.name, `Duplicate declaration '${name}'.`)
    }
    this.module.structs.push(type)
    this.memberDecls.set(type, new Map())
    this.classes.push(this.classInfo(decl, type, scope, this.prefix + cIdent(name)))
  }

  /** The state of a class or generic class instance between the passes, registered by its type. */
  protected classInfo(decl: ts.ClassDeclaration, type: StructType, scope: Scope, cname: string): ClassInfo {
    const info: ClassInfo = {
      decl,
      type,
      scope,
      cname,
      inits: [],
      paramProps: [],
      ctorThis: this.newLocal("this", type, false),
      ctorParams: [],
      methods: [],
      abstract: decl.modifiers?.some((m) => m.kind === ts.SyntaxKind.AbstractKeyword) ?? false,
      baseState: "none",
      members: "pending",
      waiting: [],
      initsChecked: false,
      protected: new Set(),
    }
    this.classInfos.set(type, info)
    return info
  }

  /** Resolves the `extends` clause of a class into `type.base`, once; a class cannot extend itself. */
  protected resolveBase(info: ClassInfo) {
    if (info.baseState !== "none") return
    info.baseState = "resolving"
    for (const clause of info.decl.heritageClauses ?? []) {
      if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue
      if (clause.types.length !== 1) {
        this.error(clause, "Classes can only extend a single class.")
        continue
      }
      const ref = clause.types[0]!
      const base = this.baseClass(ref, info.scope)
      if (!base) continue
      this.resolveBase(this.classInfos.get(base)!)
      if (isSubclass(base, info.type)) {
        this.error(ref, `Class '${info.type.name}' extends itself.`)
        continue
      }
      info.type.base = base
    }
    info.baseState = "done"
  }

  /** The class named by an `extends` clause: a class, or an instance of a generic class. */
  protected baseClass(ref: ts.ExpressionWithTypeArguments, scope: Scope): StructType | undefined {
    const symbol = this.typeSymbol(ref.expression, scope)
    if (!symbol) return undefined
    let type: Type | undefined = symbol.type
    if (symbol.generic) {
      if (!ref.typeArguments) return this.error(ref, `Generic type '${symbol.generic.name}' requires type arguments.`), undefined
      const args: Type[] = []
      for (const a of ref.typeArguments) {
        const arg = this.resolveValueType(a, scope)
        if (!arg) return undefined
        args.push(arg)
      }
      type = this.instantiate(symbol.generic, args, ref) as Type | undefined
    } else if (ref.typeArguments) {
      return this.error(ref, `Type '${ref.expression.getText()}' is not generic.`), undefined
    }
    if (type?.kind === "struct" && this.classInfos.has(type)) return type
    if (type) this.error(ref.expression, "A class can only extend a class.")
    return undefined
  }

  protected declareClassMembers(info: ClassInfo, scope: Scope) {
    if (info.members !== "pending") return
    info.members = "declaring"
    const { decl, type } = info
    this.resolveBase(info)
    const base = type.base
    const baseInfo = base && this.classInfos.get(base)
    if (baseInfo) {
      this.declareClassMembers(baseInfo, baseInfo.scope)
      if (baseInfo.members !== "done") {
        // The base class is a generic instance whose members are being
        // declared and refer to this class: declare these after them.
        info.members = "pending"
        baseInfo.waiting.push(info)
        return
      }
    }
    const className = type.name!
    const decls = this.memberDecls.get(type)!
    // The members of the base class come first, in its order.
    const inherited = new Set<string>()
    if (base) {
      type.fields.push(...base.fields)
      type.methods.push(...base.methods)
      for (const [name, node] of this.memberDecls.get(base)!) {
        decls.set(name, node)
        inherited.add(name)
      }
    }
    const own = new Set<string>()
    const declare = (name: string, node: ts.Node, nameNode: ts.Node): boolean => {
      if (own.has(name) || (decls.has(name) && !inherited.has(name))) {
        this.error(nameNode, `Duplicate member '${name}'.`)
        return false
      }
      own.add(name)
      decls.set(name, node)
      return true
    }

    for (const member of decl.members) {
      if (ts.isSemicolonClassElement(member)) continue
      const flags = this.memberModifiers(member)
      if (flags.abstract && !ts.isMethodDeclaration(member)) this.error(member, "Only methods can be abstract.")
      if (ts.isPropertyDeclaration(member)) {
        const name = this.memberName(member.name)
        if (name === undefined || !this.checkInherited(info, name, "field", member.name, flags) || !declare(name, member, member.name)) continue
        if (member.exclamationToken) this.error(member.exclamationToken, "Definitely-assigned fields are not supported.")
        let fieldType: Type | undefined
        if (member.type) fieldType = this.resolveValueType(member.type, scope)
        else if (member.questionToken) this.error(member.name, `Optional field '${name}' needs a type annotation.`)
        else if (!member.initializer) this.error(member.name, `Field '${name}' needs a type annotation or an initializer.`)
        // `x?: T` is `T | null`, null unless initialized.
        if (fieldType && member.questionToken) fieldType = this.unionOf([fieldType, types.null])
        if (member.initializer) info.inits.push({ name, node: member.initializer })
        // A field without an annotation gets its type from the initializer later.
        type.fields.push({ name, type: fieldType ?? types.void, readonly: flags.readonly, private: flags.private || flags.protected })
        if (flags.protected) info.protected.add(name)
        if (fieldType) this.info.types.set(member.name, fieldType)
      } else if (ts.isMethodDeclaration(member)) {
        const name = this.memberName(member.name)
        if (name === undefined) continue
        if (!this.checkInherited(info, name, member.typeParameters ? "generic method" : "method", member.name, flags) || !declare(name, member, member.name)) continue
        if (flags.readonly) this.error(member, "Methods cannot be 'readonly'.")
        if (member.asteriskToken) this.error(member.asteriskToken, "Generators are not supported in Ore.")
        if (member.questionToken) this.error(member.questionToken, "Optional methods are not supported.")
        if (flags.abstract) {
          if (!info.abstract) this.error(member.name, "Abstract methods can only appear within an abstract class.")
          if (member.body) this.error(member.name, `Method '${name}' cannot have an implementation because it is marked abstract.`)
          if (member.typeParameters) {
            this.error(member.name, "Generic methods cannot be abstract.")
            continue
          }
        } else if (!member.body) {
          this.error(member.name, "A method must have a body.")
          continue
        }
        if (member.typeParameters) {
          for (const p of member.typeParameters) if (p.default) this.error(p.default, "Default type arguments are not supported yet.")
          const generic: Generic = { name, decl: member, params: member.typeParameters, scope, instances: new Map() }
          if (!this.genericMethods.has(type)) this.genericMethods.set(type, new Map())
          this.genericMethods.get(type)!.set(name, { generic, info, private: flags.private || flags.protected })
          if (flags.protected) info.protected.add(name)
          continue
        }
        const func = this.makeMethod(member, info, scope, `${className}.${name}`, `ore_m_${info.cname}_${cIdent(name)}`)
        if (flags.abstract) {
          // Never called: the classes that can be instantiated override it.
          const message: ir.Expr = { k: "string", type: types.string, value: `abstract method ${className}.${name} called` }
          func.body = { k: "block", body: [{ k: "expr", expr: { k: "builtin", type: types.never, name: "process.panic", args: [message] } }] }
          this.abstractMethods.set(func, type)
        } else {
          info.methods.push([member, func])
        }
        if (flags.protected) info.protected.add(name)
        const method: ir.Method = { name, func, private: flags.private || flags.protected }
        const index = type.methods.findIndex((m) => m.name === name)
        if (index === -1) type.methods.push(method)
        else {
          this.checkOverride(type.methods[index]!, method, base!, member.name, flags)
          type.methods[index] = method
        }
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
          if (!this.checkInherited(info, p.name.text, "field", p.name, pflags) || !declare(p.name.text, p, p.name)) return
          type.fields.push({ name: p.name.text, type: params[i]!.type, readonly: pflags.readonly, private: pflags.private || pflags.protected })
          if (pflags.protected) info.protected.add(p.name.text)
          info.paramProps.push(params[i]!)
        })
        info.ctorParams = params
        type.ctor = this.ctorFunc(info, params, member)
      } else if (ts.isGetAccessor(member) || ts.isSetAccessor(member)) {
        this.declareAccessor(member, info, scope, flags)
      } else {
        this.error(member, ts.isIndexSignatureDeclaration(member) ? indexSignatureMessage : "This class member is not supported.")
      }
    }
    if (!type.ctor && baseInfo) {
      // Without a constructor, a subclass takes the parameters of its base class's and passes them on.
      const params = baseInfo.ctorParams.map((p) => this.newLocal(p.name, p.type, false))
      const signature = this.signatures.get(baseInfo.ctorParams)
      if (signature) this.signatures.set(params, signature)
      info.ctorParams = params
      type.ctor = this.ctorFunc(info, params, decl.name!)
    }
    type.ctor ??= this.ctorFunc(info, [], decl.name!)
    if (!info.abstract) {
      for (const m of type.methods) {
        const owner = this.abstractMethods.get(m.func)
        if (owner && owner !== type) this.error(decl.name!, `Non-abstract class '${className}' does not implement inherited abstract member '${m.name}' from class '${owner.name}'.`)
      }
    }
    info.members = "done"
    for (const waiting of info.waiting.splice(0)) this.declareClassMembers(waiting, waiting.scope)
  }

  /**
   * Checks a member of a class against its base class: a method may override
   * a method, other members cannot redeclare inherited ones, and private
   * members of the base class cannot be redeclared at all. Reports `override`
   * on a member that overrides nothing. False if the member is not declared.
   */
  protected checkInherited(info: ClassInfo, name: string, kind: MemberKind, nameNode: ts.Node, flags: MemberFlags): boolean {
    const base = info.type.base
    const inherited = base && this.classMember(base, name)
    if (flags.override && (kind !== "method" || inherited?.kind !== "method")) {
      this.error(
        nameNode,
        base
          ? `This member cannot have an 'override' modifier because it is not declared in the base class '${base.name}'.`
          : `This member cannot have an 'override' modifier because its containing class '${info.type.name}' does not extend another class.`,
      )
    }
    if (!base || !inherited) return true
    const owner = this.declaringClass(base, name)
    if (inherited.private && !this.classInfos.get(owner)?.protected.has(name)) {
      this.error(nameNode, `'${name}' is private in base class '${owner.name}' and cannot be redeclared.`)
      return false
    }
    if (kind === "method" && inherited.kind === "method") return true
    this.error(
      nameNode,
      kind === "accessor" && inherited.kind === "accessor"
        ? `Accessors cannot be overridden yet: '${name}' is an accessor of base class '${base.name}'.`
        : `'${name}' is already declared in base class '${base.name}' as a ${inherited.kind}; only methods can be overridden.`,
    )
    return false
  }

  /** Checks that a method overrides an inherited one with the same type, and is as visible. */
  protected checkOverride(old: ir.Method, method: ir.Method, base: StructType, nameNode: ts.Node, flags: MemberFlags) {
    if (!sameType(old.func.type, method.func.type)) {
      this.error(nameNode, `Method '${method.name}' must have the type of the method it overrides in '${base.name}': '${typeToString(old.func.type)}', not '${typeToString(method.func.type)}'.`)
    } else if (flags.private) {
      this.error(nameNode, `Method '${method.name}' overrides a method of '${base.name}' and cannot be private.`)
    } else if (flags.protected && !old.private) {
      this.error(nameNode, `Method '${method.name}' is public in '${base.name}' and must stay public.`)
    }
  }

  /** A member of a class, inherited ones included: its kind, and whether it is private or protected. */
  protected classMember(s: StructType, name: string): { kind: MemberKind; private: boolean } | undefined {
    const field = findField(s, name)
    if (field) return { kind: "field", private: field.private === true }
    const method = findMethod(s, name)
    if (method) return { kind: "method", private: method.private }
    const generic = this.genericMethod(s, name)
    if (generic) return { kind: "generic method", private: generic.private }
    const accessor = this.accessor(s, name)
    if (accessor) return { kind: "accessor", private: accessor.private }
    return undefined
  }

  /** The class that declares member `name` of class `s` first: `s`, or the base class it inherits it from. */
  protected declaringClass(s: StructType, name: string): StructType {
    let owner = s
    while (owner.base && this.classMember(owner.base, name)) owner = owner.base
    return owner
  }

  /** The generic method `name` of a class, inherited ones included. */
  protected genericMethod(s: StructType, name: string): { generic: Generic; info: ClassInfo; private: boolean } | undefined {
    for (let t: StructType | undefined = s; t; t = t.base) {
      const found = this.genericMethods.get(t)?.get(name)
      if (found) return found
    }
    return undefined
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

  /**
   * The initialization of a class with subclasses, which they call from
   * `super(...)`: it takes the parameters of the constructor, which then
   * gets copies of them, and its body is moved there by `finishClasses`.
   */
  protected initOf(info: ClassInfo): ir.Func {
    if (info.init) return info.init
    const ctor = info.type.ctor!
    const init: ir.Func = {
      name: `ore_ctor_${info.cname}`,
      sourceName: `${info.type.name}.constructor`,
      line: ctor.line,
      type: { kind: "func", params: ctor.type.params, result: info.type },
      params: info.ctorParams,
      receiver: info.ctorThis,
      body: { k: "block", body: [] },
      exported: false,
    }
    this.module.functions.push(init)
    const params = info.ctorParams.map((p) => this.newLocal(p.name, p.type, false))
    const signature = this.signatures.get(info.ctorParams)
    if (signature) this.signatures.set(params, signature)
    ctor.params = params
    info.init = init
    return init
  }

  /**
   * Once every body is checked: the constructor of a class with subclasses
   * allocates the instance and calls its initialization, and the calls of
   * methods that a subclass of the receiver's class overrides dispatch
   * through the class table.
   */
  protected finishClasses() {
    for (const info of this.classInfos.values()) {
      const init = info.init
      const ctor = info.type.ctor
      if (!init || !ctor || ctor.body.body.length === 0) continue
      init.body = { k: "block", body: ctor.body.body.slice(1) }
      const self = this.newLocal("this", info.type, false)
      const ref: ir.Expr = { k: "local", type: info.type, local: self }
      const args = ctor.params.map((p): ir.Expr => ({ k: "local", type: p.type, local: p }))
      ctor.body = {
        k: "block",
        body: [
          { k: "let", local: self, init: { k: "alloc", type: info.type } },
          { k: "return", value: { k: "method-call", type: info.type, func: init, receiver: ref, args } },
        ],
      }
    }
    const bases = new Set<StructType>()
    for (const s of this.module.structs) if (s.base) bases.add(s.base)
    if (bases.size === 0) return
    for (const { node, name } of this.dispatches) {
      const s = node.receiver.type
      if (s.kind === "struct" && bases.has(s) && overridden(this.module.structs, s, name)) node.virtual = true
    }
  }

  /** Records a call or bound value of method `name`, which may need to dispatch. */
  protected dispatch(expr: ir.Expr, name: string) {
    const node = expr.k === "bind" ? expr.body : expr
    if (node.k === "method-call" || node.k === "bound-method") this.dispatches.push({ node, name })
  }

  protected memberModifiers(node: ts.Node): MemberFlags {
    const flags = { private: false, protected: false, readonly: false, abstract: false, override: false, any: false }
    for (const mod of (ts.canHaveModifiers(node) && ts.getModifiers(node)) || []) {
      flags.any = true
      switch (mod.kind) {
        case ts.SyntaxKind.PrivateKeyword:
          flags.private = true
          break
        case ts.SyntaxKind.ProtectedKeyword:
          flags.protected = true
          break
        case ts.SyntaxKind.ReadonlyKeyword:
          flags.readonly = true
          break
        case ts.SyntaxKind.AbstractKeyword:
          flags.abstract = true
          break
        case ts.SyntaxKind.OverrideKeyword:
          flags.override = true
          break
        case ts.SyntaxKind.PublicKeyword:
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
    if (info.initsChecked) return
    info.initsChecked = true
    const base = info.type.base
    const baseInfo = base && this.classInfos.get(base)
    if (baseInfo) {
      // The inherited fields whose types come from their initializers.
      this.checkFieldInitializers(baseInfo, baseInfo.scope)
      base!.fields.forEach((f, i) => (info.type.fields[i] = f))
    }
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
    const setField = (name: string, value: ir.Expr): ir.Expr => ({ k: "assign", type: value.type, target: { k: "field", object: thisRef, name }, value })
    const base = type.base
    const baseInfo = base && this.classInfos.get(base)

    // Constructor: allocate, assign parameter properties, run field initializers, then the body.
    // With a base class, `super(...)` initializes the base class, then assigns and runs those.
    const inits: ir.Expr[] = []
    for (const p of info.paramProps) inits.push(setField(p.name, { k: "local", type: p.type, local: p }))
    for (const init of info.inits) if (init.value) inits.push(setField(init.name, init.value))
    const body: ir.Stmt[] = [{ k: "let", local: self, init: { k: "alloc", type } }]
    // Other fields start at their zero value: the allocation is zeroed, which is not `""`, `[]` or `null` of every type.
    // Inherited fields are the base class's initialization's.
    const initialized = new Set([...info.paramProps.map((p) => p.name), ...info.inits.map((i) => i.name)])
    for (const field of type.fields.slice(base?.fields.length ?? 0)) {
      if (!initialized.has(field.name) && zeroNeedsInit(field.type)) body.push({ k: "expr", expr: setField(field.name, zeroValue(field.type)) })
    }
    if (baseInfo && !info.ctorDecl) {
      const args = info.ctorParams.map((p): ir.Expr => ({ k: "local", type: p.type, local: p }))
      body.push({ k: "expr", expr: { k: "method-call", type: base!, func: this.initOf(baseInfo), receiver: thisRef, args } })
    }
    if (!baseInfo || !info.ctorDecl) for (const e of inits) body.push({ k: "expr", expr: e })
    if (info.ctorDecl) {
      const prologue: ir.Stmt[] = []
      const scope = this.paramScope(info.ctorDecl.parameters, info.ctorParams, outer, prologue)
      this.facts = [new Map()]
      this.fn = { result: types.void, loops: [], nextLoopId: 0, this: self, cls: type, ctor: true }
      if (baseInfo) {
        this.fn.superCall = this.superStatement(info.ctorDecl)
        this.fn.superInits = inits
      }
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
    // Inherited fields are the base class's to initialize.
    for (const field of type.fields.slice(base?.fields.length ?? 0)) {
      if (!hasZeroValue(field.type) && !assigned.has(field.name)) {
        const decl = this.memberDecls.get(type)!.get(field.name) as ts.PropertyDeclaration
        this.error(decl.name, `Field '${field.name}' of type '${typeToString(field.type)}' must be initialized in its declaration or at the top level of the constructor.`)
      }
    }

    for (const [decl, func] of info.methods) this.checkMethodBody(decl, func, type, outer)
  }

  /**
   * The `super(...)` call that the constructor of a class with a base class
   * must make: a statement at the top level of its body, after statements
   * that do not use `this`.
   */
  protected superStatement(decl: ts.ConstructorDeclaration): ts.CallExpression | undefined {
    const stmts = decl.body!.statements
    const index = stmts.findIndex((s) => ts.isExpressionStatement(s) && ts.isCallExpression(s.expression) && s.expression.expression.kind === ts.SyntaxKind.SuperKeyword)
    if (index === -1) return this.error(decl, "Constructors for derived classes must contain a 'super' call."), undefined
    for (const stmt of stmts.slice(0, index)) {
      const use = findThis(stmt)
      if (use) {
        this.error(use, "'super' must be called before accessing 'this' in the constructor of a derived class.")
        break
      }
    }
    return (stmts[index] as ts.ExpressionStatement).expression as ts.CallExpression
  }

  /** A getter or setter: a method named `get_x` or `set_x`, called by reads and writes of property `x`. */
  protected declareAccessor(member: ts.AccessorDeclaration, info: ClassInfo, scope: Scope, flags: MemberFlags) {
    const name = this.memberName(member.name)
    if (name === undefined) return
    if (!this.checkInherited(info, name, "accessor", member.name, flags)) return
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
    if (flags.protected) info.protected.add(name)
    const property = existing ?? { type: propertyType, private: flags.private || flags.protected }
    property[kind] = func
    accessors.set(name, property)
  }

  /** The accessor property `name` of a class, inherited ones included, if any. */
  protected accessor(type: Type, name: string): Accessor | undefined {
    for (let s = type.kind === "struct" ? type : undefined; s; s = s.base) {
      const found = this.accessors.get(s)?.get(name)
      if (found) return found
    }
    return undefined
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
        this.error(member, ts.isIndexSignatureDeclaration(member) ? indexSignatureMessage : "Call and construct signatures are not supported.")
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

  /** Reports access to a private member from outside its class, or to a protected one from outside its class and subclasses. */
  protected checkAccess(struct: StructType, member: { private?: boolean }, name: string, node: ts.Node): boolean {
    if (!member.private) return true
    const owner = this.declaringClass(struct, name)
    const cls = this.fn?.cls
    if (cls === owner) return true
    const isProtected = this.classInfos.get(owner)?.protected.has(name) ?? false
    if (isProtected && cls && isSubclass(cls, owner)) return true
    this.error(node, isProtected ? `'${name}' is protected and only accessible inside class '${owner.name}' and its subclasses.` : `'${name}' is private and only accessible inside class '${owner.name}'.`)
    return false
  }
}
