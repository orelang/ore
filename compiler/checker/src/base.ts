// The state of the checker, diagnostics, types and conversions of operands: what every layer uses.
import * as ir from "@ore/ir"
import {
  arrayOf,
  intRange,
  isNumeric,
  isStringLike,
  membersOf,
  sameType,
  typeKey,
  types,
  typeToString,
  type Field,
  type InterfaceType,
  type LiteralType,
  type MapType,
  type SetType,
  type StructType,
  type Type,
  type UnionType,
} from "@ore/ir"
import { diagnosticAt, type Diagnostic, type Source } from "@ore/syntax"
import ts from "typescript"
import { errorOperand, type Operand } from "./operand"
import { Scope, type Generic, type TypeSymbol } from "./symbols"
import type { CheckInfo, ProgramInput, ModuleInfo, Signature, FuncContext, ClassInfo, Accessor, AssignTarget, InterfaceInfo } from "./context"
import { disposeName, hashable, indexSignatureMessage, isSymbolDispose, memberOf, typeOf, floatLit, poison } from "./helpers"

/** A program being checked; see Checker in checker.ts. */
export abstract class CheckerBase {
  protected abstract assignTarget(node: ts.Expression, scope: Scope): AssignTarget | undefined
  protected abstract bindPattern(name: ts.BindingName, value: ir.Expr, mutable: boolean, scope: Scope, out: ir.Stmt[]): void
  protected abstract checkBlock(block: ts.Block, scope: Scope): ir.Block
  protected abstract checkCall(node: ts.CallExpression, scope: Scope): Operand
  protected abstract checkClassBodies(info: ClassInfo, outer: Scope): void
  protected abstract checkClosure(node: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration, outer: Scope, expected?: Type, inferResult?: boolean): Operand
  protected abstract checkExpr(node: ts.Expression, scope: Scope, expected?: Type): Operand
  protected abstract checkFieldInitializers(info: ClassInfo, scope: Scope): void
  protected abstract checkImplements(info: ClassInfo, scope: Scope): void
  protected abstract checkMethodBody(decl: ts.MethodDeclaration | ts.AccessorDeclaration, func: ir.Func, type: StructType, outer: Scope): void
  protected abstract checkNew(node: ts.NewExpression, scope: Scope, expected?: Type): Operand
  protected abstract compare(op: ir.CompareOp, left: Operand, right: Operand, opNode: ts.Node, leftNode: ts.Node, rightNode: ts.Node): Operand
  protected abstract conformance(from: StructType | InterfaceType, iface: InterfaceType): { reason?: string; indices?: number[] }
  protected abstract declareClassMembers(info: ClassInfo, scope: Scope): void
  protected abstract fillInterface(info: InterfaceInfo, scope: Scope): void
  protected abstract instantiate(generic: Generic, args: Type[], node: ts.Node): ir.Func | Type | undefined
  protected abstract interfaceFor(type: Type, cls: StructType): InterfaceType | undefined
  protected abstract itab(struct: StructType, iface: InterfaceType): ir.Itab
  protected abstract makeMethod(decl: ts.MethodDeclaration | ts.AccessorDeclaration, info: ClassInfo, scope: Scope, sourceName: string, cname: string): ir.Func
  protected abstract member(value: ir.Expr, nameNode: ts.Node, name: string): Operand
  protected abstract narrowTo(key: string, declared: Type, actual: Type): void
  protected abstract settle(local: ir.Local, value: Operand, node: ts.Node): boolean
  protected abstract writeAccessor(target: AssignTarget, node: ts.Node, next: (old: () => ir.Expr) => ir.Expr | undefined, yieldOld: boolean): Operand

  protected readonly diagnostics: Diagnostic[] = []

  protected readonly info: CheckInfo = { types: new Map(), definitions: new Map() }

  protected readonly module: ir.Module

  protected nextLocalId = 0

  protected readonly localsById = new Map<number, ir.Local>()

  protected fn: FuncContext | undefined

  /** The scope of the module whose top-level code is being checked: its variables are globals. */
  protected globals: Scope | undefined

  /** Anonymous struct types by shape key. */
  protected readonly shapes = new Map<string, StructType>()

  protected nextStructId = 0

  protected readonly classes: ClassInfo[] = []

  protected readonly interfaces = new Map<InterfaceType, InterfaceInfo>()

  protected readonly unions = new Map<string, UnionType>()

  protected readonly literals = new Map<string, LiteralType>()

  /** The built-in `Error` interface, and the class behind `new Error(...)` once used. */
  protected errorType: InterfaceType | undefined

  protected basicError: StructType | undefined

  /** Checks of generic instances, run after the other bodies. */
  protected readonly pending: (() => void)[] = []

  /** The generic and type arguments of each instance type. */
  protected readonly instanceOf = new Map<Type, { generic: Generic; args: Type[] }>()

  protected instanceCount = 0

  protected nextLambda = 0

  /** The generic instance being checked, named in its diagnostics. */
  protected context: string | undefined

  /** Narrowing facts by flow scope, innermost last. */
  protected facts: Map<string, Type>[] = [new Map()]

  protected readonly itabs = new Map<string, ir.Itab>()

  /** Declarations of fields and methods, for tooling. */
  protected readonly memberDecls = new Map<StructType | InterfaceType, Map<string, ts.Node>>()

  /** Variables declared without a value that must be assigned before they are read. */
  protected readonly unassigned = new Set<ir.Local>()

  /** Variables declared without a type or a value, typed by their first assignment. */
  protected readonly untyped = new Set<ir.Local>()

  /** Where variables and closures were written, for messages about reads of unassigned variables. */
  protected readonly refNodes = new WeakMap<object, ts.Node>()

  protected readonly declNodes = new Map<ir.Local, ts.Node>()

  /** Variables whose initializer has an error, so that their type is unknown. */
  protected readonly poisoned = new Set<ir.Local>()
  /** Variables already reported as read before assigned. */
  protected readonly readEarly = new Set<ir.Local>()

  /** Records the declarations that import specifiers refer to, once all are declared. */
  protected readonly specifiers: (() => void)[] = []

  /** Getters and setters of classes by property name. */
  protected readonly accessors = new Map<StructType, Map<string, Accessor>>()

  /** Generic methods of classes by name, instantiated per call like generic functions. */
  protected readonly genericMethods = new Map<StructType, Map<string, { generic: Generic; info: ClassInfo; private: boolean }>>()

  /** Optional and rest parameters of functions, by their parameter list. */
  protected readonly signatures = new WeakMap<ir.Local[], Signature>()

  /** C names of exported variables. */
  protected readonly exportedVariables = new Set<string>()
  /** Functions by their `//ore:export` name. */
  protected readonly exportNames = new Map<string, ir.Func>()

  protected readonly sources = new Map<ts.SourceFile, Source>()

  /** The scope of built-in declarations, for resolving their signatures. */
  protected builtins: Scope | undefined

  protected readonly modules = new Map<Source, ModuleInfo>()

  /** The C name prefix of the module whose declarations are being declared. */
  protected prefix = ""

  constructor(protected readonly program: ProgramInput) {
    this.module = { file: program.entry.path, functions: [], inits: [], structs: [], itabs: [], unions: [] }
    for (const source of program.modules) this.sources.set(source.ast, source)
  }

  protected resolveType(node: ts.TypeNode, scope: Scope): Type | undefined {
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
      case ts.SyntaxKind.UndefinedKeyword:
        return this.error(node, "'undefined' is not supported in Ore. Use 'null'."), undefined
    }
    if (ts.isLiteralTypeNode(node) && node.literal.kind === ts.SyntaxKind.NullKeyword) return types.null
    if (ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)) return this.literal(node.literal.text)
    if (ts.isLiteralTypeNode(node)) return this.error(node, "Only string literal types are supported yet."), undefined
    if (ts.isUnionTypeNode(node)) {
      const members: Type[] = []
      for (const m of node.types) {
        const type = this.resolveType(m, scope)
        if (!type) return undefined
        if (type.kind === "void" || type.kind === "never") return this.error(m, `A union cannot contain '${type.kind}'.`), undefined
        members.push(type)
      }
      return this.unionOf(members)
    }
    if (ts.isArrayTypeNode(node)) {
      const elem = this.resolveValueType(node.elementType, scope)
      return elem && arrayOf(elem)
    }
    if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName) && node.typeName.text === "Map" && !scope.lookupType("Map")) {
      if (node.typeArguments?.length !== 2) return this.error(node, "'Map' expects exactly 2 type arguments."), undefined
      const key = this.resolveValueType(node.typeArguments[0]!, scope)
      const value = this.resolveValueType(node.typeArguments[1]!, scope)
      return key && value ? this.mapOf(key, value, node.typeArguments[0]!) : undefined
    }
    if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName) && node.typeName.text === "Set" && !scope.lookupType("Set")) {
      if (node.typeArguments?.length !== 1) return this.error(node, "'Set' expects exactly 1 type argument."), undefined
      const elem = this.resolveValueType(node.typeArguments[0]!, scope)
      return elem && this.setOf(elem, node.typeArguments[0]!)
    }
    if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName) && node.typeName.text === "Chan" && !scope.lookupType("Chan")) {
      if (node.typeArguments?.length !== 1) return this.error(node, "'Chan' expects exactly 1 type argument."), undefined
      const elem = this.resolveValueType(node.typeArguments[0]!, scope)
      return elem && { kind: "chan", elem }
    }
    if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName) && node.typeName.text === "Array" && !scope.lookupType("Array")) {
      if (node.typeArguments?.length !== 1) return this.error(node, "'Array' expects exactly 1 type argument."), undefined
      const elem = this.resolveValueType(node.typeArguments[0]!, scope)
      return elem && arrayOf(elem)
    }
    if (ts.isTypeReferenceNode(node)) {
      const symbol = this.typeSymbol(node.typeName, scope)
      if (!symbol) return undefined
      if (symbol.generic) {
        if (!node.typeArguments) return this.error(node, `Generic type '${symbol.generic.name}' requires type arguments.`), undefined
        const args: Type[] = []
        for (const a of node.typeArguments) {
          const type = this.resolveValueType(a, scope)
          if (!type) return undefined
          args.push(type)
        }
        return this.instantiate(symbol.generic, args, node) as Type | undefined
      }
      if (node.typeArguments) return this.error(node, `Type '${node.typeName.getText()}' is not generic.`), undefined
      return symbol.type
    }
    if (ts.isParenthesizedTypeNode(node)) return this.resolveType(node.type, scope)
    if (ts.isTypeLiteralNode(node)) return this.resolveTypeLiteral(node, scope)
    if (ts.isFunctionTypeNode(node)) {
      if (node.typeParameters) return this.error(node.typeParameters[0]!, "Generic function types are not supported."), undefined
      const params: Type[] = []
      for (const p of node.parameters) {
        if (!p.type || p.dotDotDotToken || p.questionToken) return this.error(p, "Parameters of function types need a type and cannot be optional or rest parameters."), undefined
        const t = this.resolveValueType(p.type, scope)
        if (!t) return undefined
        params.push(t)
      }
      const result = this.resolveType(node.type, scope)
      return result && { kind: "func", params, result }
    }
    this.error(node, "This kind of type is not supported yet.")
    return undefined
  }

  /** The type named by `T` or `m.T` (an export of a module imported as `* as m`); reports missing names. */
  protected typeSymbol(name: ts.EntityName | ts.Expression, scope: Scope): TypeSymbol | undefined {
    if (ts.isIdentifier(name)) {
      const symbol = scope.lookupType(name.text)
      if (!symbol) return this.error(name, `Cannot find type '${name.text}'.`), undefined
      this.info.definitions.set(name, symbol.decl)
      return symbol
    }
    const left = ts.isQualifiedName(name) ? name.left : ts.isPropertyAccessExpression(name) ? name.expression : undefined
    const right = ts.isQualifiedName(name) ? name.right : ts.isPropertyAccessExpression(name) ? name.name : undefined
    const module = left && ts.isIdentifier(left) ? scope.lookupValue(left.text) : undefined
    // A type of a built-in namespace implemented in Ore, such as `fs.FileInfo`.
    const exports = module?.k === "module" ? module.exports : module?.k === "namespace" ? module.module : undefined
    if ((module?.k !== "module" && module?.k !== "namespace") || !exports || !right || !ts.isIdentifier(right)) return this.error(name, "Only types of modules imported with '* as' can be qualified."), undefined
    this.info.definitions.set(left as ts.Identifier, module.decl)
    const symbol = exports(right.text)?.type
    if (!symbol) return this.error(right, module.k === "namespace" ? `'${module.name}' has no type '${right.text}'.` : `Module '${module.name}' has no exported type '${right.text}'.`), undefined
    this.info.definitions.set(right, symbol.decl)
    return symbol
  }

  protected resolveTypeLiteral(node: ts.TypeLiteralNode, scope: Scope): Type | undefined {
    const fields: Field[] = []
    for (const member of node.members) {
      if (!ts.isPropertySignature(member)) {
        this.error(
          member,
          ts.isMethodSignature(member) ? "Methods in object types are not supported yet. Use an interface."
          : ts.isIndexSignatureDeclaration(member) ? indexSignatureMessage
          : "Only properties are supported in object types.",
        )
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

  protected mapOf(key: Type, value: Type, node: ts.Node): MapType | undefined {
    if (!hashable(key)) return this.error(node, `Type '${typeToString(key)}' cannot be a Map key.`), undefined
    return { kind: "map", key, value }
  }

  protected setOf(elem: Type, node: ts.Node): SetType | undefined {
    if (!hashable(elem)) return this.error(node, `Type '${typeToString(elem)}' cannot be an element of a Set.`), undefined
    return { kind: "set", elem }
  }

  protected literal(value: string): LiteralType {
    let type = this.literals.get(value)
    if (!type) {
      type = { kind: "literal", value }
      this.literals.set(value, type)
    }
    return type
  }

  /** The normalized union of types: flattened, deduplicated and in canonical order. */
  protected unionOf(types_: readonly Type[]): Type {
    const members: Type[] = []
    for (const t of types_.flatMap((t) => membersOf(t))) {
      if (t.kind !== "never" && !members.some((m) => sameType(m, t))) members.push(t)
    }
    // `string` includes every string literal type.
    if (members.some((m) => m.kind === "string")) members.splice(0, members.length, ...members.filter((m) => m.kind !== "literal"))
    if (members.length === 0) return types.never
    if (members.length === 1) return members[0]!
    members.sort((a, b) => (typeKey(a) < typeKey(b) ? -1 : typeKey(a) > typeKey(b) ? 1 : 0))
    const key = members.map(typeKey).join("|")
    let union = this.unions.get(key)
    if (!union) {
      union = { kind: "union", id: this.unions.size, members }
      this.unions.set(key, union)
      this.module.unions.push(union)
    }
    return union
  }

  /** A type without some of its members, such as `null`. */
  protected without(type: Type, drop: (t: Type) => boolean): Type {
    return this.unionOf(membersOf(type).filter((m) => !drop(m)))
  }

  /** The interned anonymous struct type with these fields. */
  protected shape(fields: Field[]): StructType {
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
  protected memberName(name: ts.PropertyName): string | undefined {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text
    if (ts.isComputedPropertyName(name) && isSymbolDispose(name.expression)) return disposeName
    if (ts.isPrivateIdentifier(name)) this.error(name, "'#' private names are not supported. Use the 'private' modifier.")
    else this.error(name, "Computed property names are not supported.")
    return undefined
  }

  /** Resolves the type of a variable or parameter, which cannot be `void` or `never`. */
  protected resolveValueType(node: ts.TypeNode, scope: Scope): Type | undefined {
    const type = this.resolveType(node, scope)
    if (type && (type.kind === "void" || type.kind === "never")) {
      this.error(node, `A value cannot have type '${type.kind}'.`)
      return undefined
    }
    return type
  }

  /** Converts an operand to `target`, reporting an error if it is not assignable. */
  protected coerce(value: Operand, target: Type, node: ts.Node): ir.Expr {
    switch (value.k) {
      case "error":
        return poison(target)
      case "typed": {
        const from = typeOf(value.expr)
        if (sameType(from, target) || from.kind === "never") return value.expr
        const targetMembers = membersOf(target)
        // A string literal expression has the literal type its context asks for.
        const lit = value.expr.k === "string" ? targetMembers.find((m) => m.kind === "literal" && m.value === (value.expr as ir.StringLit).value) : undefined
        if (lit) {
          const retyped: ir.Expr = { ...(value.expr as ir.StringLit), type: lit as LiteralType }
          return target.kind === "union" ? { k: "recast", type: target, value: retyped } : retyped
        }
        // String literal types widen to `string`.
        if (target.kind === "string" && membersOf(from).every(isStringLike)) return { k: "recast", type: target, value: value.expr }
        if (from.kind === "null") {
          if (target.kind === "union" && targetMembers.some((m) => m.kind === "null")) return { k: "null", type: target }
          this.error(node, `Type 'null' is not assignable to type '${typeToString(target)}'.`)
          return poison(target)
        }
        // A member, or a union of members, converts to a union containing them.
        if (target.kind === "union" && membersOf(from).every((f) => targetMembers.some((m) => memberOf(f, m)))) {
          return { k: "recast", type: target, value: value.expr }
        }
        if (target.kind === "union") {
          // A struct converts to an interface member it implements, if there is exactly one.
          const ifaces = targetMembers.filter((m): m is InterfaceType => m.kind === "interface" && (from.kind === "struct" || from.kind === "interface") && !this.conformance(from, m).reason)
          if (ifaces.length === 1) return { k: "recast", type: target, value: this.coerce(value, ifaces[0]!, node) }
        }
        if (from.kind === "union" && membersOf(from).some((m) => m.kind === "null") && sameType(this.without(from, (m) => m.kind === "null"), target)) {
          this.error(node, `Type '${typeToString(from)}' is not assignable to type '${typeToString(target)}': the value may be null. Check it with '!== null' first, or use '??' or '!'.`)
          return poison(target)
        }
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
        if (target.kind === "union") return this.coerceToUnion(value, target, node)
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
        if (target.kind === "union") return this.coerceToUnion(value, target, node)
        if (target.kind === "float") return floatLit(target, value.value)
        if (target.kind === "int") this.error(node, `A floating-point constant is not assignable to integer type '${target.name}'. Use '${target.name}(...)' to truncate.`)
        else this.error(node, `A floating-point constant is not assignable to type '${typeToString(target)}'.`)
        return poison(target)
      }
    }
  }

  /** Converts an untyped constant to the numeric member of a union: its default type if present, else the only one. */
  protected coerceToUnion(value: Operand, target: UnionType, node: ts.Node): ir.Expr {
    // A float constant fits only float members; an integer constant fits any numeric member.
    const numeric = target.members.filter((m) => (value.k === "untyped-float" ? m.kind === "float" : isNumeric(m)))
    const preferred = numeric.find((m) => sameType(m, this.defaultType(value))) ?? (numeric.length === 1 ? numeric[0] : undefined)
    if (!preferred) {
      this.error(node, numeric.length === 0 ? `A numeric constant is not assignable to type '${typeToString(target)}'.` : `Ambiguous constant for type '${typeToString(target)}'. Convert it explicitly, e.g. '${typeToString(numeric[0]!)}(...)'.`)
      return poison(target)
    }
    return { k: "recast", type: target, value: this.coerce(value, preferred, node) }
  }

  /** Gives an untyped constant its default type: `int` for integers, `f64` for floats. */
  protected toDefault(value: Operand, node: ts.Node): ir.Expr {
    if (value.k === "typed") return value.expr
    if (value.k === "error") return poison(types.i64)
    return this.coerce(value, this.defaultType(value), node)
  }

  protected defaultType(value: Operand): Type {
    return value.k === "untyped-float" ? types.f64 : types.i64
  }

  /**
   * Brings two operands to a common type: an untyped side takes the type of
   * the typed side. Returns undefined operands if that fails, so that the
   * enclosing expression reports nothing more.
   */
  protected unify(a: Operand, b: Operand, aNode: ts.Node, bNode: ts.Node): [ir.Expr | undefined, ir.Expr | undefined] {
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

  /** The module a node belongs to. */
  protected sourceOf(node: ts.Node): Source {
    return this.sources.get(node.getSourceFile())!
  }

  protected line(node: ts.Node): number {
    const source = this.sourceOf(node)
    return source.position(node.getStart(source.ast)).line + 1
  }

  protected newLocal(name: string, type: Type, mutable: boolean): ir.Local {
    const local: ir.Local = { id: this.nextLocalId++, name, type, mutable }
    this.localsById.set(local.id, local)
    return local
  }

  protected error(node: ts.Node, message: string) {
    const d = diagnosticAt(this.sourceOf(node), node, this.context ? `${message} (in '${this.context}')` : message)
    // Generic instances can repeat the same error.
    if (!this.diagnostics.some((e) => e.start === d.start && e.message === d.message)) this.diagnostics.push(d)
  }

  protected fail(node: ts.Node, message: string): Operand {
    this.error(node, message)
    return errorOperand
  }
}
