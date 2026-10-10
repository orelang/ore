import * as ir from "@ore/ir"
import {
  arrayOf,
  findField,
  findMethod,
  intRange,
  isNumeric,
  isStringLike,
  membersOf,
  sameType,
  typeKey,
  types,
  typeToString,
  type Field,
  type FuncType,
  type InterfaceMember,
  type InterfaceType,
  type LiteralType,
  type MapType,
  type StructType,
  type Type,
  type UnionType,
} from "@ore/ir"
import { diagnosticAt, type Diagnostic, type Source } from "@ore/syntax"
import ts from "typescript"
import { builtinScope } from "./builtins"
import { foldBinary, foldUnary } from "./fold"
import { errorOperand, type Operand } from "./operand"
import { Scope, type Exported, type Generic, type TypeSymbol, type ValueSymbol } from "./symbols"

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
  /**
   * A test program: the entry module's top-level statements, such as
   * `test(...)` calls, become its `main`.
   */
  test?: boolean
}

/** The modules of a program, as loaded by `@ore/project`. */
export interface ProgramInput {
  /** Modules with each module after the modules it imports, the entry last. */
  modules: Source[]
  entry: Source
  /** For each module, the module each import specifier resolves to. */
  imports: Map<Source, Map<string, Source>>
}

/** Checks a single file, or a program of modules, into one IR module. */
export function check(input: Source | ProgramInput, options: CheckOptions = { entry: true }): CheckResult {
  const program = "ast" in input ? { modules: [input], entry: input, imports: new Map() } : input
  return new Checker(program).run(options)
}

/** A module being checked. */
interface ModuleInfo {
  source: Source
  scope: Scope
  /** Prefix of C names of its functions, which must not clash with other modules. */
  prefix: string
  /** Exported names and the local names they refer to; `from` for re-exports. */
  exports: Map<string, { local: string; from?: ModuleInfo }>
}

interface FuncContext {
  /** The return type; `undefined` while it is inferred from return statements of a closure. */
  result: Type | undefined
  /** The closure being checked, if any. */
  closure?: ir.Func
  /** Closures between here and the method that owns `this`, which capture it. */
  thisCaptures?: ir.Func[]
  /** `this` inside a method or constructor. */
  this?: ir.Local
  /** The class whose method or constructor is being checked. */
  cls?: StructType
  ctor?: boolean
  /** Checking field initializers, which cannot use `this`. */
  fieldInit?: boolean
  /** Enclosing loops and switches, innermost last. */
  loops: LoopContext[]
  nextLoopId: number
  /** Label of a labeled statement whose loop has not been entered yet. */
  pendingLabel?: string
}

/** A class declaration between the passes of checking. */
interface ClassInfo {
  decl: ts.ClassDeclaration
  type: StructType
  /** The scope of the class's module. */
  scope: Scope
  /** Base of C names for the class's functions. */
  cname: string
  /** Field initializers by field name, checked before constructor bodies. */
  inits: { name: string; node: ts.Expression; value?: ir.Expr }[]
  /** Constructor parameters that declare fields. */
  paramProps: ir.Local[]
  ctorDecl?: ts.ConstructorDeclaration
  ctorThis: ir.Local
  methods: [ts.MethodDeclaration, ir.Func][]
}

/** A narrowed type of a variable or a field path, keyed by `refKey`. */
interface Fact {
  key: string
  type: Type
}

/** A checked condition with the facts that hold when it is true or false. */
interface Condition {
  expr: ir.Expr
  whenTrue: Fact[]
  whenFalse: Fact[]
}

interface InterfaceInfo {
  decl: ts.InterfaceDeclaration
  type: InterfaceType
  scope: Scope
  state: "declared" | "filling" | "filled"
}

interface LoopContext {
  id: number
  label?: string
  /** A switch can be exited with `break` but not continued. */
  isSwitch?: boolean
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
  private readonly unions = new Map<string, UnionType>()
  private readonly literals = new Map<string, LiteralType>()
  /** The built-in `Error` interface, and the class behind `new Error(...)` once used. */
  private errorType: InterfaceType | undefined
  private basicError: StructType | undefined
  /** Checks of generic instances, run after the other bodies. */
  private readonly pending: (() => void)[] = []
  /** The generic and type arguments of each instance type. */
  private readonly instanceOf = new Map<Type, { generic: Generic; args: Type[] }>()
  private instanceCount = 0
  private nextLambda = 0
  /** The generic instance being checked, named in its diagnostics. */
  private context: string | undefined
  /** Narrowing facts by flow scope, innermost last. */
  private facts: Map<string, Type>[] = [new Map()]
  private readonly itabs = new Map<string, ir.Itab>()
  /** Declarations of fields and methods, for tooling. */
  private readonly memberDecls = new Map<StructType | InterfaceType, Map<string, ts.Node>>()

  private readonly sources = new Map<ts.SourceFile, Source>()
  /** The scope of built-in declarations, for resolving their signatures. */
  private builtins: Scope | undefined
  private readonly modules = new Map<Source, ModuleInfo>()
  /** The C name prefix of the module whose declarations are being declared. */
  private prefix = ""

  constructor(private readonly program: ProgramInput) {
    this.module = { file: program.entry.path, functions: [], structs: [], itabs: [], unions: [] }
    for (const source of program.modules) this.sources.set(source.ast, source)
  }

  run(options: CheckOptions): CheckResult {
    const builtins = builtinScope()
    this.builtins = builtins.scope
    this.sources.set(builtins.source.ast, builtins.source)
    for (const stmt of builtins.source.ast.statements) if (ts.isInterfaceDeclaration(stmt)) this.declareInterface(stmt, builtins.scope)
    const error = builtins.scope.lookupType("Error")?.type
    this.errorType = error?.kind === "interface" ? error : undefined

    const modules = this.program.modules.map((source, i): ModuleInfo => {
      const info: ModuleInfo = { source, scope: new Scope(builtins.scope), prefix: source === this.program.entry ? "" : `m${i}_`, exports: new Map() }
      this.modules.set(source, info)
      return info
    })
    const bodies: [ts.FunctionDeclaration, ir.Func, Scope][] = []
    const each = (pass: (stmt: ts.Statement, module: ModuleInfo) => void) => {
      for (const module of modules) {
        this.prefix = module.prefix
        for (const stmt of module.source.ast.statements) pass(stmt, module)
      }
      this.prefix = ""
    }

    // Pass 1: exports, imports, and names of classes and interfaces, so that
    // types can refer to them in any order and across modules.
    each((stmt, m) => this.declareExports(stmt, m))
    each((stmt, m) => {
      if (ts.isClassDeclaration(stmt)) this.declareClass(stmt, m.scope)
      else if (ts.isInterfaceDeclaration(stmt)) this.declareInterface(stmt, m.scope)
      else if (ts.isImportDeclaration(stmt)) this.declareImport(stmt, m)
    })

    // Pass 2: type aliases, then signatures of functions and class members,
    // so that they can be used before their declaration and recursively.
    each((stmt, m) => ts.isTypeAliasDeclaration(stmt) && this.declareTypeAlias(stmt, m.scope))
    for (const info of this.interfaces.values()) this.fillInterface(info, info.scope)
    each((stmt, m) => {
      if (!ts.isFunctionDeclaration(stmt)) return
      const func = this.declareFunction(stmt, m.scope)
      if (func) bodies.push([stmt, func, m.scope])
    })
    for (const info of this.classes) this.declareClassMembers(info, info.scope)
    this.checkExports(modules)

    // Pass 3: top-level constants in module and source order, field initializers, then bodies.
    const testStatements: ts.Statement[] = []
    each((stmt, m) => {
      const inTest = options.test && m.source === this.program.entry
      if (inTest && (ts.isExpressionStatement(stmt) || ts.isVariableStatement(stmt))) testStatements.push(stmt)
      else if (ts.isVariableStatement(stmt)) this.checkTopLevelVariables(stmt, m.scope)
      else if (!isDeclaration(stmt)) this.error(stmt, this.unsupportedTopLevel(stmt))
    })
    for (const info of this.classes) this.checkFieldInitializers(info, info.scope)
    for (const info of this.classes) this.checkImplements(info, info.scope)
    for (const [decl, func, scope] of bodies) this.checkFunctionBody(decl, func, scope)
    for (const info of this.classes) this.checkClassBodies(info, info.scope)
    if (options.test) this.testMain(testStatements, this.modules.get(this.program.entry)!)
    while (this.pending.length > 0) this.pending.shift()!()

    if (options.entry && !options.test) this.checkEntry(this.modules.get(this.program.entry)!)

    const hasErrors = this.diagnostics.some((d) => d.severity === "error")
    return { module: hasErrors ? undefined : this.module, diagnostics: this.diagnostics, info: this.info }
  }

  /** The `main` of a test program: its top-level statements in order. */
  private testMain(statements: ts.Statement[], entry: ModuleInfo) {
    const func: ir.Func = {
      name: "ore_fn_main",
      sourceName: "main",
      line: 1,
      file: entry.source.path,
      type: { kind: "func", params: [], result: types.void },
      params: [],
      body: { k: "block", body: [] },
      exported: true,
    }
    this.facts = [new Map()]
    this.fn = { result: types.void, loops: [], nextLoopId: 0 }
    const scope = new Scope(entry.scope)
    for (const stmt of statements) this.checkStmt(stmt, scope, func.body.body)
    this.fn = undefined
    this.module.functions.push(func)
  }

  // ---------------------------------------------------------------------------
  // Modules

  /** Records the names a top-level statement exports. */
  private declareExports(stmt: ts.Statement, module: ModuleInfo) {
    const exported = (ts.canHaveModifiers(stmt) && ts.getModifiers(stmt)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) ?? false
    const add = (name: string, local: string, node: ts.Node, from?: ModuleInfo) => {
      if (module.exports.has(name)) this.error(node, `Duplicate export '${name}'.`)
      else module.exports.set(name, { local, from })
    }
    if (exported && ts.getModifiers(stmt as ts.HasModifiers)?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) {
      return this.error(stmt, "Default exports are not supported in Ore. Use named exports.")
    }
    if (exported && ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) if (ts.isIdentifier(d.name)) add(d.name.text, d.name.text, d.name)
    } else if (exported && (ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt) || ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)) && stmt.name) {
      add(stmt.name.text, stmt.name.text, stmt.name)
    } else if (ts.isExportDeclaration(stmt)) {
      // `export { a, b as c }`, or `export { x } from "./m"`.
      const from = stmt.moduleSpecifier ? this.importedModule(stmt.moduleSpecifier, module) : undefined
      if (stmt.moduleSpecifier && !from) return
      if (!stmt.exportClause || !ts.isNamedExports(stmt.exportClause)) return this.error(stmt, "Use 'export { name }' to re-export; 'export *' is not supported.")
      for (const e of stmt.exportClause.elements) add(e.name.text, (e.propertyName ?? e.name).getText(), e, from)
    } else if (ts.isExportAssignment(stmt)) {
      this.error(stmt, "Default exports are not supported in Ore. Use named exports.")
    }
  }

  /** The module an import specifier resolves to; the loader already reported unresolved ones. */
  private importedModule(specifier: ts.Expression, module: ModuleInfo): ModuleInfo | undefined {
    if (!ts.isStringLiteral(specifier)) return undefined
    const target = this.program.imports.get(module.source)?.get(specifier.text)
    return target && this.modules.get(target)
  }

  /** What a module exports under a name, following re-exports. */
  private exportOf(module: ModuleInfo, name: string, seen = new Set<ModuleInfo>()): Exported | undefined {
    const entry = module.exports.get(name)
    if (!entry || seen.has(module)) return undefined
    seen.add(module)
    if (entry.from) return this.exportOf(entry.from, entry.local, seen)
    const value = module.scope.ownValue(entry.local)
    const type = module.scope.ownType(entry.local)
    return value || type ? { value, type } : undefined
  }

  private declareImport(stmt: ts.ImportDeclaration, module: ModuleInfo) {
    const target = this.importedModule(stmt.moduleSpecifier, module)
    const clause = stmt.importClause
    if (!target || !clause) return
    if (clause.name) this.error(clause.name, "Default imports are not supported in Ore. Use 'import { name } from ...'.")
    const bindings = clause.namedBindings
    if (!bindings) return
    if (ts.isNamespaceImport(bindings)) {
      const name = bindings.name.text
      const symbol: ValueSymbol = { k: "module", name, exports: (n) => this.exportOf(target, n), decl: bindings }
      if (!module.scope.declareValue(name, symbol)) this.error(bindings.name, `Duplicate declaration '${name}'.`)
      return
    }
    for (const element of bindings.elements) {
      const imported = (element.propertyName ?? element.name).text
      if (!target.exports.has(imported)) {
        this.error(element.propertyName ?? element.name, `Module '${(stmt.moduleSpecifier as ts.StringLiteral).text}' has no exported member '${imported}'.`)
        continue
      }
      if (!module.scope.declareAlias(element.name.text, () => this.exportOf(target, imported))) {
        this.error(element.name, `Duplicate declaration '${element.name.text}'.`)
      }
    }
  }

  /** Reports exports of names that a module does not declare. */
  private checkExports(modules: ModuleInfo[]) {
    for (const module of modules) {
      for (const [name, entry] of module.exports) {
        if (!entry.from && !this.exportOf(module, name)) {
          const node = module.source.ast.statements.find(ts.isExportDeclaration)
          if (node) this.error(node, `Cannot export '${entry.local}': it is not declared in this module.`)
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Declarations

  private declareTypeAlias(decl: ts.TypeAliasDeclaration, scope: Scope) {
    if (decl.typeParameters) return this.declareGeneric(decl, scope)
    const type = this.resolveType(decl.type, scope)
    if (!type) return
    // An anonymous object type is displayed by the first alias that names it.
    if (type.kind === "struct" && type.name === undefined) type.name = decl.name.text
    if (!scope.declareType(decl.name.text, { type, decl })) this.error(decl.name, `Duplicate type '${decl.name.text}'.`)
  }

  private declareFunction(decl: ts.FunctionDeclaration, scope: Scope): ir.Func | undefined {
    if (!decl.name) return this.error(decl, "A function declaration must have a name."), undefined
    if (decl.modifiers?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword)) return this.declareExtern(decl, scope), undefined
    if (!decl.body) return this.error(decl.name, "A function declaration must have a body."), undefined
    if (decl.typeParameters) return this.declareGeneric(decl, scope), undefined
    if (decl.asteriskToken) this.error(decl.asteriskToken, "Generators are not supported in Ore.")
    for (const mod of decl.modifiers ?? []) {
      if (mod.kind === ts.SyntaxKind.AsyncKeyword) this.error(mod, "'async' is not supported in Ore. Use spawn() and channels.")
      else if (mod.kind === ts.SyntaxKind.DefaultKeyword) this.error(mod, "Default exports are not supported in Ore.")
      else if (mod.kind !== ts.SyntaxKind.ExportKeyword) this.error(mod, `Modifier '${mod.getText()}' is not allowed here.`)
    }

    const exported = decl.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false
    const func = this.makeFunc(decl, scope, decl.name.text, this.prefix + cIdent(decl.name.text), exported)
    if (!scope.declareValue(decl.name.text, { k: "func", func, decl })) {
      this.error(decl.name, `Duplicate declaration '${decl.name.text}'.`)
      return undefined
    }
    return func
  }

  /** `declare function f(...)`: an external C function named `f`. */
  private declareExtern(decl: ts.FunctionDeclaration, scope: Scope) {
    const name = decl.name!.text
    if (decl.body) return this.error(decl.name!, "A declared function cannot have a body.")
    if (decl.typeParameters) return this.error(decl.typeParameters[0]!, "External functions cannot be generic.")
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return this.error(decl.name!, "An external function needs a C name.")
    const params = this.resolveParams(decl.parameters, scope)
    const result = decl.type ? this.resolveType(decl.type, scope) ?? types.void : types.void
    // C can exchange numbers, booleans, strings and pointers.
    const cCompatible = (t: Type) => isNumeric(t) || t.kind === "bool" || t.kind === "string" || t.kind === "ptr"
    decl.parameters.forEach((p, i) => {
      if (params[i] && !cCompatible(params[i]!.type)) this.error(p, `Type '${typeToString(params[i]!.type)}' cannot be passed to C.`)
    })
    if (!cCompatible(result) && result.kind !== "void") this.error(decl.type!, `Type '${typeToString(result)}' cannot be returned from C.`)
    const func: ir.Func = {
      name,
      sourceName: name,
      line: this.line(decl.name!),
      file: this.sourceOf(decl).path,
      type: { kind: "func", params: params.map((p) => p.type), result },
      params,
      body: { k: "block", body: [] },
      exported: false,
      extern: true,
    }
    this.module.functions.push(func)
    if (!scope.declareValue(name, { k: "func", func, decl })) this.error(decl.name!, `Duplicate declaration '${name}'.`)
  }

  /** A function with the signature of a declaration, resolved in `scope`; the body is checked later. */
  private makeFunc(decl: ts.FunctionDeclaration, scope: Scope, sourceName: string, cname: string, exported: boolean): ir.Func {
    const params = this.resolveParams(decl.parameters, scope)
    const result = decl.type ? this.resolveType(decl.type, scope) ?? types.void : types.void
    const func: ir.Func = {
      name: `ore_fn_${cname}`,
      sourceName,
      line: this.line(decl.name!),
      file: this.sourceOf(decl).path,
      type: { kind: "func", params: params.map((p) => p.type), result },
      params,
      body: { k: "block", body: [] },
      exported,
    }
    this.module.functions.push(func)
    return func
  }

  // ---------------------------------------------------------------------------
  // Generics

  private declareGeneric(decl: Generic["decl"], scope: Scope) {
    const name = decl.name!.text
    const params = decl.typeParameters!
    for (const p of params) if (p.default) this.error(p.default, "Default type arguments are not supported yet.")
    const generic: Generic = { name, decl, params, scope, instances: new Map() }
    const declared = ts.isFunctionDeclaration(decl)
      ? scope.declareValue(name, { k: "generic-func", generic, decl })
      : scope.declareType(name, { type: types.never, decl, generic }) && (!ts.isClassDeclaration(decl) || scope.declareValue(name, { k: "class", type: undefined, decl }))
    if (!declared) this.error(decl.name!, `Duplicate declaration '${name}'.`)
  }

  /**
   * The instance of a generic for type arguments, created once: a function
   * (whose body is checked later), a class, an interface or a type.
   */
  private instantiate(generic: Generic, args: Type[], node: ts.Node): ir.Func | Type | undefined {
    if (args.length !== generic.params.length) {
      return this.error(node, `'${generic.name}' expects ${generic.params.length} type argument(s), got ${args.length}.`), undefined
    }
    const key = args.map(typeKey).join(",")
    const existing = generic.instances.get(key)
    if (existing) return existing
    if (++this.instanceCount > 1000) return this.error(node, `Too many instances of generics; '${generic.name}' may instantiate itself endlessly.`), undefined

    const scope = new Scope(generic.scope)
    generic.params.forEach((p, i) => scope.declareType(p.name.text, { type: args[i]!, decl: p }))
    for (const [i, p] of generic.params.entries()) {
      const constraint = p.constraint && this.resolveType(p.constraint, scope)
      if (constraint && !this.satisfies(args[i]!, constraint)) {
        return this.error(node, `Type '${typeToString(args[i]!)}' does not satisfy the constraint '${typeToString(constraint)}' of '${p.name.text}'.`), undefined
      }
    }
    const label = `${generic.name}<${args.map(typeToString).join(", ")}>`
    const cname = `${cIdent(generic.name)}_${this.instanceCount}`
    const decl = generic.decl
    const inContext = (check: () => void) => () => {
      const saved = this.context
      this.context = label
      try {
        check()
      } finally {
        this.context = saved
      }
    }

    if (ts.isTypeAliasDeclaration(decl)) {
      const type = this.resolveType(decl.type, scope)
      if (type?.kind === "struct" && type.name === undefined) type.name = label
      if (type) generic.instances.set(key, type)
      return type
    }
    if (ts.isFunctionDeclaration(decl)) {
      const func = this.makeFunc(decl, scope, label, cname, false)
      generic.instances.set(key, func)
      this.pending.push(inContext(() => this.checkFunctionBody(decl, func, scope)))
      return func
    }
    if (ts.isInterfaceDeclaration(decl)) {
      const type: InterfaceType = { kind: "interface", id: this.nextStructId++, name: label, members: [] }
      generic.instances.set(key, type)
      this.instanceOf.set(type, { generic, args })
      this.memberDecls.set(type, new Map())
      this.fillInterface({ decl, type, scope, state: "declared" }, scope)
      return type
    }
    const type: StructType = { kind: "struct", id: this.nextStructId++, name: label, nominal: true, fields: [], methods: [] }
    generic.instances.set(key, type)
    this.instanceOf.set(type, { generic, args })
    this.module.structs.push(type)
    this.memberDecls.set(type, new Map())
    const info: ClassInfo = { decl, type, scope, cname, inits: [], paramProps: [], ctorThis: this.newLocal("this", type, false), methods: [] }
    this.declareClassMembers(info, scope)
    this.pending.push(
      inContext(() => {
        this.checkFieldInitializers(info, scope)
        this.checkImplements(info, scope)
        this.checkClassBodies(info, scope)
      }),
    )
    return type
  }

  /** Whether a type argument satisfies a constraint. */
  private satisfies(arg: Type, constraint: Type): boolean {
    if (sameType(arg, constraint)) return true
    if (constraint.kind === "interface" && (arg.kind === "struct" || arg.kind === "interface")) return !this.conformance(arg, constraint).reason
    return membersOf(arg).every((a) => membersOf(constraint).some((c) => memberOf(a, c)))
  }

  /**
   * Infers type arguments of a generic from the types of arguments, by
   * matching parameter type annotations against them.
   */
  private inferTypeArgs(generic: Generic, params: readonly ts.ParameterDeclaration[], argTypes: (Type | undefined)[], node: ts.Node): Type[] | undefined {
    const names = generic.params.map((p) => p.name.text)
    const bindings = new Map<string, Type>()
    params.forEach((p, i) => p.type && argTypes[i] && this.inferFrom(p.type, argTypes[i]!, names, bindings, generic.scope))
    const missing = names.filter((n) => !bindings.has(n))
    if (missing.length > 0) {
      return this.error(node, `Cannot infer type argument${missing.length > 1 ? "s" : ""} ${missing.map((m) => `'${m}'`).join(", ")} of '${generic.name}'. Specify them, e.g. '${generic.name}<...>(...)'.`), undefined
    }
    return names.map((n) => bindings.get(n)!)
  }

  /** Binds type parameters `names` in annotation `n` by matching it against `type`. */
  private inferFrom(n: ts.TypeNode, type: Type, names: string[], bindings: Map<string, Type>, scope: Scope): void {
    const infer = (node: ts.TypeNode, t: Type): void => this.inferFrom(node, t, names, bindings, scope)
    if (ts.isParenthesizedTypeNode(n)) return infer(n.type, type)
    if (ts.isArrayTypeNode(n)) return type.kind === "array" ? infer(n.elementType, type.elem) : undefined
    if (ts.isTypeReferenceNode(n) && ts.isIdentifier(n.typeName)) {
      const name = n.typeName.text
      if (names.includes(name) && !n.typeArguments) {
        if (!bindings.has(name)) bindings.set(name, type)
        return
      }
      if (name === "Array" && n.typeArguments?.length === 1) return type.kind === "array" ? infer(n.typeArguments[0]!, type.elem) : undefined
      if (name === "Map" && n.typeArguments?.length === 2 && type.kind === "map") {
        infer(n.typeArguments[0]!, type.key)
        infer(n.typeArguments[1]!, type.value)
        return
      }
      const symbol = scope.lookupType(name)
      const generic = symbol?.generic
      if (!n.typeArguments || !generic) return
      const instance = this.instanceOf.get(type)
      if (instance?.generic === generic) {
        n.typeArguments.forEach((a, i) => instance.args[i] && infer(a, instance.args[i]!))
      } else if (ts.isTypeAliasDeclaration(generic.decl)) {
        // A generic alias: infer its parameters from its definition, then match its type arguments.
        const inner = generic.params.map((p) => p.name.text)
        const found = new Map<string, Type>()
        this.inferFrom(generic.decl.type, type, inner, found, generic.scope)
        n.typeArguments.forEach((a, i) => {
          const t = found.get(inner[i]!)
          if (t) infer(a, t)
        })
      } else if (ts.isInterfaceDeclaration(generic.decl) && (type.kind === "struct" || type.kind === "interface")) {
        // A class or object for a generic interface: infer the interface's
        // parameters from the members it has, then match its type arguments.
        const inner = generic.params.map((p) => p.name.text)
        const found = new Map<string, Type>()
        for (const member of generic.decl.members) {
          if (!member.name || !ts.isIdentifier(member.name)) continue
          const name = member.name.text
          if (ts.isPropertySignature(member) && member.type) {
            const field = fieldType(type, name)
            if (field) this.inferFrom(member.type, field, inner, found, generic.scope)
          } else if (ts.isMethodSignature(member)) {
            const method = methodType(type, name)
            if (!method) continue
            member.parameters.forEach((p, i) => p.type && method.params[i] && this.inferFrom(p.type, method.params[i]!, inner, found, generic.scope))
            if (member.type) this.inferFrom(member.type, method.result, inner, found, generic.scope)
          }
        }
        n.typeArguments.forEach((a, i) => {
          const t = found.get(inner[i]!)
          if (t) infer(a, t)
        })
      }
      return
    }
    if (ts.isUnionTypeNode(n)) {
      // Members without type parameters are matched exactly; the rest of the type goes to the one generic member.
      const open = n.types.filter((t) => mentions(t, names))
      if (open.length !== 1) return
      const closed = n.types.filter((t) => !mentions(t, names)).map((t) => this.resolveType(t, scope))
      const rest = membersOf(type).filter((m) => !closed.some((c) => c && sameType(c, m)))
      if (rest.length > 0) infer(open[0]!, this.unionOf(rest))
      return
    }
    if (ts.isTypeLiteralNode(n)) {
      for (const member of n.members) {
        if (ts.isPropertySignature(member) && member.type && ts.isIdentifier(member.name)) {
          const field = fieldType(type, member.name.text)
          if (field) infer(member.type, field)
        }
      }
    }
  }

  /**
   * Checks a call of a generic function or constructor: arguments are checked
   * first (with their parameter type when it has no type parameters), then the
   * type arguments are taken from `typeArgs` or inferred.
   */
  private genericCall(
    generic: Generic,
    params: readonly ts.ParameterDeclaration[],
    typeArgs: readonly ts.TypeNode[] | undefined,
    args: readonly ts.Expression[],
    node: ts.Node,
    scope: Scope,
  ): { instance: ir.Func | Type; operands: Operand[] } | undefined {
    for (const arg of args) if (ts.isSpreadElement(arg)) return this.error(arg, "Spread arguments are not supported yet."), undefined
    const names = generic.params.map((p) => p.name.text)
    if (typeArgs) {
      // With explicit type arguments, the arguments are checked against the instance.
      const explicit: Type[] = []
      for (const t of typeArgs) {
        const type = this.resolveValueType(t, scope)
        if (!type) return undefined
        explicit.push(type)
      }
      const instance = this.instantiate(generic, explicit, node)
      return instance ? { instance, operands: [] } : undefined
    }
    const operands = args.map((arg, i) => {
      const p = params[i]?.type
      const expected = p && !mentions(p, names) ? this.resolveType(p, generic.scope) : undefined
      return this.checkExpr(arg, scope, expected)
    })
    if (operands.some((o) => o.k === "error")) return undefined
    const argTypes = operands.map((o, i) => (o.k === "typed" ? o.expr.type : o.k === "error" ? undefined : this.defaultType(o)))
    const typeArgsResolved = this.inferTypeArgs(generic, params, argTypes, node)
    if (!typeArgsResolved) return undefined
    const instance = this.instantiate(generic, typeArgsResolved, node)
    return instance ? { instance, operands } : undefined
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
    this.facts = [new Map()]
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
          name: `ore_m_${info.cname}_${cIdent(name)}`,
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
      this.facts = [new Map()]
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
      this.facts = [new Map()]
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
    if (decl.typeParameters) return this.declareGeneric(decl, scope)
    const type: InterfaceType = { kind: "interface", id: this.nextStructId++, name, members: [] }
    if (!scope.declareType(name, { type, decl })) return this.error(decl.name, `Duplicate type '${name}'.`)
    this.interfaces.set(type, { decl, type, scope, state: "declared" })
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

  private checkEntry(entry: ModuleInfo) {
    const main = entry.scope.ownValue("main")
    if (!main || main.k !== "func") {
      return this.diagnostics.push({
        source: entry.source,
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
  private typeSymbol(name: ts.EntityName | ts.Expression, scope: Scope): TypeSymbol | undefined {
    if (ts.isIdentifier(name)) {
      const symbol = scope.lookupType(name.text)
      if (!symbol) return this.error(name, `Cannot find type '${name.text}'.`), undefined
      this.info.definitions.set(name, symbol.decl)
      return symbol
    }
    const left = ts.isQualifiedName(name) ? name.left : ts.isPropertyAccessExpression(name) ? name.expression : undefined
    const right = ts.isQualifiedName(name) ? name.right : ts.isPropertyAccessExpression(name) ? name.name : undefined
    const module = left && ts.isIdentifier(left) ? scope.lookupValue(left.text) : undefined
    if (module?.k !== "module" || !right || !ts.isIdentifier(right)) return this.error(name, "Only types of modules imported with '* as' can be qualified."), undefined
    this.info.definitions.set(left as ts.Identifier, module.decl)
    const symbol = module.exports(right.text)?.type
    if (!symbol) return this.error(right, `Module '${module.name}' has no exported type '${right.text}'.`), undefined
    this.info.definitions.set(right, symbol.decl)
    return symbol
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

  private mapOf(key: Type, value: Type, node: ts.Node): MapType | undefined {
    const hashable = isNumeric(key) || ["bool", "string", "literal", "struct", "array", "interface", "map"].includes(key.kind)
    if (!hashable) return this.error(node, `Type '${typeToString(key)}' cannot be a Map key.`), undefined
    return { kind: "map", key, value }
  }

  private literal(value: string): LiteralType {
    let type = this.literals.get(value)
    if (!type) {
      type = { kind: "literal", value }
      this.literals.set(value, type)
    }
    return type
  }

  /** The normalized union of types: flattened, deduplicated and in canonical order. */
  private unionOf(types_: readonly Type[]): Type {
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
  private without(type: Type, drop: (t: Type) => boolean): Type {
    return this.unionOf(membersOf(type).filter((m) => !drop(m)))
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
    if (ts.isComputedPropertyName(name) && isSymbolDispose(name.expression)) return disposeName
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
        statements[i] = { k: "expr", expr: { k: "assign", type: s.local.type, target: { k: "local", local: s.local }, value: s.init! }, line: s.line }
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
  private checkStatements(stmts: readonly ts.Statement[], scope: Scope, out: ir.Stmt[]) {
    for (const [i, stmt] of stmts.entries()) {
      if (ts.isVariableStatement(stmt) && stmt.declarationList.flags & ts.NodeFlags.Using) {
        this.checkUsing(stmt, stmts.slice(i + 1), scope, out)
        return
      }
      this.checkStmt(stmt, scope, out)
    }
  }

  private checkUsing(stmt: ts.VariableStatement, rest: readonly ts.Statement[], scope: Scope, out: ir.Stmt[]) {
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
  private disposeCall(value: ir.Expr): ir.Expr | undefined {
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
  private declareNestedFunction(decl: ts.FunctionDeclaration, scope: Scope): ir.Local | undefined {
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
  private checkNested(stmt: ts.Statement, scope: Scope): ir.Stmt {
    if (ts.isBlock(stmt)) return this.checkBlock(stmt, scope)
    const body: ir.Stmt[] = []
    this.withFacts([], () => this.checkStmt(stmt, new Scope(scope), body))
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
      const condition = this.condition(stmt.expression, scope)
      const then = this.withFacts(condition.whenTrue, () => this.checkNested(stmt.thenStatement, scope))
      const elseStmt = stmt.elseStatement ? this.withFacts(condition.whenFalse, () => this.checkNested(stmt.elseStatement!, scope)) : undefined
      out.push({ k: "if", cond: condition.expr, then, else: elseStmt })
      // After `if (x === null) return`, x is not null for the rest of the block.
      const thenExits = terminates(then)
      const elseExits = elseStmt !== undefined && terminates(elseStmt)
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
    } else {
      this.error(stmt, "This statement is not supported yet.")
    }
  }

  private checkVariables(list: ts.VariableDeclarationList, scope: Scope, out: ir.Stmt[]) {
    const isConst = (list.flags & ts.NodeFlags.Const) !== 0
    if (!isConst && !(list.flags & ts.NodeFlags.Let)) {
      if (list.flags & (ts.NodeFlags.Using | ts.NodeFlags.AwaitUsing)) return this.error(list, "'using' must be a statement directly in a block.")
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
          if (type.kind === "null") this.error(decl.initializer!, `Cannot infer a type from 'null'. Add a type annotation, e.g. 'let ${name}: T | null = null'.`)
        } else {
          type = types.i64
          init = zeroValue(type)
        }
        const local = this.newLocal(name, type, !isConst)
        symbol = { k: "local", local, decl }
        this.info.types.set(decl.name, type)
        out.push({ k: "let", local, init })
        const initType = decl.initializer && this.info.types.get(decl.initializer)
        if (initType) this.narrowTo(`L${local.id}`, type, initType)
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

  private checkForOf(stmt: ts.ForOfStatement, outer: Scope): ir.ForOfStmt | undefined {
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
    let bindings: [ts.Identifier, Type][]
    if (type.kind === "map") {
      const pattern = decl.name
      const names = ts.isArrayBindingPattern(pattern) ? pattern.elements.map((e) => (ts.isBindingElement(e) && ts.isIdentifier(e.name) && !e.dotDotDotToken && !e.initializer ? e.name : undefined)) : []
      if (names.length !== 2 || !names[0] || !names[1]) return this.error(decl.name, "Iterate a Map with 'for (const [key, value] of map)'."), undefined
      bindings = [[names[0], type.key], [names[1], type.value]]
    } else {
      if (!ts.isIdentifier(decl.name)) return this.error(decl.name, "Destructuring is not supported yet."), undefined
      if (type.kind === "array") bindings = [[decl.name, type.elem]]
      else if (type.kind === "string") bindings = [[decl.name, types.i32]]
      else return this.error(stmt.expression, `Type '${typeToString(type)}' is not iterable.`), undefined
    }

    this.invalidateAssigned(stmt.statement, outer)
    const scope = new Scope(outer)
    const locals = bindings.map(([name, t]) => {
      const local = this.newLocal(name.text, t, mutable)
      if (!scope.declareValue(local.name, { k: "local", local, decl: name.parent })) this.error(name, `Duplicate name '${name.text}'.`)
      this.info.types.set(name, t)
      return local
    })
    const loop = this.checkLoopBody(stmt.statement, scope)
    return Object.assign(loop.ir, { k: "for-of" as const, id: loop.id, local: locals[0]!, value: locals[1], iterable, body: loop.body })
  }

  private checkSwitch(stmt: ts.SwitchStatement, outer: Scope): ir.SwitchStmt | undefined {
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
      this.error(stmt.expression, "A function without a return type annotation cannot return a value.")
      return { k: "return" }
    }
    return { k: "return", value: this.coerce(value, result, stmt.expression) }
  }

  private checkCondition(node: ts.Expression, scope: Scope): ir.Expr {
    return this.coerce(this.checkExpr(node, scope), types.bool, node)
  }

  // ---------------------------------------------------------------------------
  // Closures

  /** Records that closures, innermost first, capture a local of an enclosing function. */
  private capture(local: ir.Local, closures: ir.Func[]) {
    if (closures.length === 0) return
    local.captured = true
    for (const f of closures) if (!f.captures!.includes(local)) f.captures!.push(local)
  }

  /**
   * Checks an arrow function, function expression or nested function into a
   * closure. Parameter and return types come from annotations or from the
   * expected function type; otherwise the return type is inferred.
   */
  private checkClosure(node: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration, outer: Scope, expected?: Type, inferResult = false): Operand {
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
      if (!ts.isIdentifier(p.name)) return this.fail(p.name, "Destructuring parameters are not supported yet.")
      if (p.dotDotDotToken || p.questionToken || p.initializer) return this.fail(p, "Optional, default and rest parameters are not supported yet.")
      const type = p.type ? this.resolveValueType(p.type, outer) : want?.params[i]
      if (!type) return this.fail(p.name, `Parameter '${p.name.text}' needs a type annotation here.`)
      if (p.type && want && !sameType(type, want.params[i]!)) {
        return this.fail(p.type, `Parameter type '${typeToString(type)}' does not match the expected '${typeToString(want.params[i]!)}'.`)
      }
      this.info.types.set(p.name, type)
      params.push(this.newLocal(p.name.text, type, true))
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
    const scope = this.paramScope(node.parameters, params, new Scope(outer, func))

    // Arrow functions keep the `this` of the enclosing method; function expressions have none.
    const isArrow = ts.isArrowFunction(node)
    const savedFn = this.fn
    const savedFacts = this.facts
    this.facts = [new Map()]
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
      const result = this.fn.result ?? types.void
      func.type = { kind: "func", params: func.type.params, result }
      this.checkReturns(func, node.type ?? node)
    } finally {
      this.fn = savedFn
      this.facts = savedFacts
    }
    return typed({ k: "closure", type: func.type, func })
  }

  // ---------------------------------------------------------------------------
  // Narrowing

  /** Checks a condition and the facts it establishes when true and when false. */
  private condition(node: ts.Expression, scope: Scope): Condition {
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
  private literalFacts(subject: ts.Expression, values: Set<string>, scope: Scope): [Fact[], Fact[]] {
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
  private refKey(node: ts.Expression, scope: Scope): string | undefined {
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
  private narrowed(key: string, expr: ir.Expr): ir.Expr {
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
  private narrowConvert(expr: ir.Expr, type: Type): ir.Expr {
    if (sameType(type, expr.type)) return expr
    if (type.kind === "struct" && expr.type.kind === "interface") return { k: "downcast", type, value: expr }
    if (type.kind === "struct" && expr.type.kind === "union" && !expr.type.members.some((m) => sameType(m, type))) {
      const via = this.interfaceFor(expr.type, type)
      if (via) return { k: "downcast", type, value: { k: "recast", type: via, value: expr } }
    }
    return { k: "recast", type, value: expr }
  }

  private withFacts<T>(facts: Fact[], check: () => T): T {
    this.facts.push(new Map(facts.map((f) => [f.key, f.type])))
    try {
      return check()
    } finally {
      this.facts.pop()
    }
  }

  /** Adds facts that hold for the rest of the current flow scope. */
  private addFacts(facts: Fact[]) {
    for (const f of facts) this.facts.at(-1)!.set(f.key, f.type)
  }

  /** Forgets facts about a variable or field path and paths through it, after it may have changed. */
  private invalidate(key: string) {
    for (const frame of this.facts) {
      for (const k of frame.keys()) if (k === key || k.startsWith(`${key}.`)) frame.delete(k)
    }
  }

  /** Forgets facts about variables assigned anywhere in a loop, which may change between iterations. */
  private invalidateAssigned(node: ts.Node, scope: Scope) {
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
    if (ts.isNewExpression(node)) return this.checkNew(node, scope, expected)
    if (ts.isBinaryExpression(node) && (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken || node.operatorToken.kind === ts.SyntaxKind.BarBarToken)) {
      return typed(this.condition(node, scope).expr)
    }
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

  private checkIdentifier(node: ts.Identifier, scope: Scope): Operand {
    const found = scope.lookupCapturing(node.text)
    const symbol = found?.symbol
    if (symbol?.k === "local") this.capture(symbol.local, found!.closures)
    if (!symbol && node.text === "undefined") return this.fail(node, "'undefined' is not supported in Ore. Use 'null'.")
    if (!symbol) return this.fail(node, unknownName(node.text))
    this.info.definitions.set(node, symbol.decl)
    return this.symbolValue(symbol, node)
  }

  /** The value of a symbol named by `node`, or an error for names that are not values. */
  private symbolValue(symbol: ValueSymbol, node: ts.Identifier | ts.MemberName): Operand {
    switch (symbol.k) {
      case "local":
        return typed(this.narrowed(`L${symbol.local.id}`, { k: "local", type: symbol.local.type, local: symbol.local }))
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
    if (compare) return this.compare(compare, this.checkExpr(node.left, scope), this.checkExpr(node.right, scope), node.operatorToken, node.left, node.right)
    if (op === K.CommaToken) return this.fail(node.operatorToken, "The comma operator is not supported in Ore.")
    if (op === K.QuestionQuestionToken) return this.checkCoalesce(node, scope)
    if (op === K.AsteriskAsteriskToken) return this.fail(node.operatorToken, "'**' is not supported yet.")
    if (op === K.InstanceOfKeyword) return this.checkInstanceOf(node, scope)
    if (op === K.InKeyword) return this.fail(node.operatorToken, "'in' is not supported in Ore.")
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

  private compare(op: ir.CompareOp, left: Operand, right: Operand, opNode: ts.Node, leftNode: ts.Node, rightNode: ts.Node): Operand {
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
    // A member compares with a union containing it.
    if (!sameType(l.type, r.type) && r.type.kind === "union") l = this.coerce(typed(l), r.type, leftNode)
    else if (!sameType(l.type, r.type) && l.type.kind === "union") r = this.coerce(typed(r), l.type, rightNode)
    const type = typeOf(l)
    if (!sameType(type, typeOf(r))) {
      return this.fail(opNode, `Cannot compare '${typeToString(type)}' with '${typeToString(typeOf(r))}'.`)
    }
    const ordered = op !== "===" && op !== "!=="
    const equatable = isNumeric(type) || ["bool", "string", "array", "struct", "interface", "union", "map", "literal", "func", "ptr"].includes(type.kind)
    if (ordered ? !(isNumeric(type) || type.kind === "string") : !equatable) {
      return this.fail(opNode, `Operator '${op}' cannot be applied to type '${typeToString(type)}'.`)
    }
    return typed({ k: "compare", type: types.bool, op, left: l, right: r })
  }

  private checkAssign(node: ts.BinaryExpression, op: ir.ArithOp | undefined, scope: Scope): Operand {
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

  /** Adds a fact that a reference of a union type holds a value of a narrower type. */
  private narrowTo(key: string, declared: Type, actual: Type) {
    if (declared.kind !== "union" || sameType(declared, actual) || actual.kind === "null") return
    if (membersOf(actual).every((a) => declared.members.some((m) => sameType(m, a)))) this.addFacts([{ key, type: actual }])
  }

  private checkAssignInner(node: ts.BinaryExpression, op: ir.ArithOp | undefined, scope: Scope): Operand {
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
    const found = scope.lookupCapturing(node.text)
    const symbol = found?.symbol
    if (!symbol) return this.error(node, `Cannot find name '${node.text}'.`), undefined
    this.info.definitions.set(node, symbol.decl)
    if (symbol.k !== "local") return this.error(node, `Cannot assign to '${node.text}' because it is not a variable.`), undefined
    if (!symbol.local.mutable) return this.error(node, `Cannot assign to '${node.text}' because it is a constant.`), undefined
    this.capture(symbol.local, found!.closures)
    symbol.local.assigned = true
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
    const condition = this.condition(node.condition, scope)
    const cond = condition.expr
    const whenTrue = this.withFacts(condition.whenTrue, () => this.checkExpr(node.whenTrue, scope))
    const whenFalse = this.withFacts(condition.whenFalse, () => this.checkExpr(node.whenFalse, scope))
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

  private checkCall(node: ts.CallExpression, scope: Scope): Operand {
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
    if (node.typeArguments) return this.fail(node.typeArguments[0]!, "Type arguments are only allowed for generic functions.")
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
      if (ns.name === "internal" && !this.sourceOf(node).path.startsWith("ore:")) {
        return this.fail(callee.expression, "'internal' is only for the standard library.")
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
    for (const arg of args) if (ts.isSpreadElement(arg)) return this.fail(arg, "Spread arguments are not supported yet.")

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
  private arrayMethod(array: ir.Expr, type: ir.ArrayType, name: string, node: ts.CallExpression, callee: ts.PropertyAccessExpression, scope: Scope): Operand {
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
  private callback(node: ts.Expression, scope: Scope, params: Type[], result: Type | undefined, ignoreResult = false): { expr: ir.Expr; arity: number; result: Type } | undefined {
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
  private builtinCall(name: string, decl: ts.FunctionDeclaration, node: ts.CallExpression, scope: Scope): Operand {
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

  /** Calls a function value with arguments converted to its parameters. */
  private callValue(callee: Operand, node: ts.CallExpression, scope: Scope): Operand {
    if (callee.k !== "typed") return callee.k === "error" ? callee : this.fail(node.expression, "A constant is not a function.")
    const type = callee.expr.type
    if (type.kind !== "func") return this.fail(node.expression, `A value of type '${typeToString(type)}' is not a function.`)
    const args = node.arguments
    for (const arg of args) if (ts.isSpreadElement(arg)) return this.fail(arg, "Spread arguments are not supported yet.")
    if (args.length !== type.params.length) return this.fail(node, `This function expects ${type.params.length} argument(s), got ${args.length}.`)
    const values = args.map((arg, i) => this.coerce(this.checkExpr(arg, scope, type.params[i]), type.params[i]!, arg))
    return typed({ k: "call-value", type: type.result, callee: callee.expr, args: values })
  }

  private checkNew(node: ts.NewExpression, scope: Scope, expected?: Type): Operand {
    const qualified = ts.isPropertyAccessExpression(node.expression)
    if (!ts.isIdentifier(node.expression) && !qualified) return this.fail(node.expression, "Only named classes can be instantiated.")
    const name = node.expression.getText()
    const symbol = qualified ? this.typeSymbol(node.expression, scope) : scope.lookupType(name)
    if (qualified && !symbol) return errorOperand
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
  private basicErrorClass(): StructType {
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

  private callFunc(func: ir.Func, args: readonly ts.Expression[], node: ts.Node, scope: Scope, what: string, receiver?: ir.Expr, operands?: Operand[]): Operand {
    for (const arg of args) if (ts.isSpreadElement(arg)) return this.fail(arg, "Spread arguments are not supported yet.")
    if (args.length !== func.params.length) {
      return this.fail(node, `${what} expects ${func.params.length} argument(s), got ${args.length}.`)
    }
    const params = func.type.params
    const values = args.map((arg, i) => this.coerce(operands?.[i] ?? this.checkExpr(arg, scope, params[i]), params[i]!, arg))
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
    const simple = (t: Type) => isNumeric(t) || t.kind === "bool" || isStringLike(t) || t.kind === "null"
    if (membersOf(type).every(simple)) return true
    this.error(node, `Cannot format a value of type '${typeToString(type)}'.`)
    return false
  }

  /**
   * The exported value `m.name` of a module imported as `* as m`, or
   * undefined if the expression is not such an access. Reports missing exports.
   */
  private moduleMember(node: ts.Expression, scope: Scope): ValueSymbol | undefined {
    if (!ts.isPropertyAccessExpression(node) || !ts.isIdentifier(node.expression)) return undefined
    const module = scope.lookupValue(node.expression.text)
    if (module?.k === "namespace") {
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

  private checkProperty(node: ts.PropertyAccessExpression, scope: Scope): Operand {
    const member = this.moduleMember(node, scope)
    if (member) return this.symbolValue(member, node.name)
    const target = this.checkExpr(node.expression, scope)
    if (target.k === "error") return target
    const value = this.toDefault(target, node.expression)
    if (node.questionDotToken) return this.optional(value, node, (v) => this.member(v, node))
    const result = this.member(value, node)
    const key = this.refKey(node, scope)
    return result.k === "typed" && key ? typed(this.narrowed(key, result.expr)) : result
  }

  /** Reads the field or length named by a property access from a value. */
  private member(value: ir.Expr, node: ts.PropertyAccessExpression): Operand {
    const name = node.name.text
    if (name === "length" && (value.type.kind === "string" || value.type.kind === "array")) return typed({ k: "len", type: types.i64, value })
    if (name === "length" && membersOf(value.type).every(isStringLike)) {
      return typed({ k: "len", type: types.i64, value: { k: "recast", type: types.string, value } })
    }
    if (name === "size" && value.type.kind === "map") return typed({ k: "map", op: "size", type: types.i64, mapType: value.type, map: value })
    if (value.type.kind === "struct") {
      const struct = value.type
      const field = findField(struct, name)
      this.defineMember(node.name, struct, name)
      if (field) {
        if (!this.checkAccess(struct, field, name, node.name)) return errorOperand
        return typed({ k: "field", type: field.type, object: value, name })
      }
      const method = findMethod(struct, name)
      if (method) {
        if (!this.checkAccess(struct, method, name, node.name)) return errorOperand
        return typed({ k: "bound-method", type: method.func.type, receiver: value, func: method.func })
      }
    }
    if (value.type.kind === "interface") {
      const index = value.type.members.findIndex((m) => m.name === name)
      const member = value.type.members[index]
      this.defineMember(node.name, value.type, name)
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
    return this.fail(node.name, this.noProperty(value.type, name))
  }

  private noProperty(type: Type, name: string): string {
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
  private optional(value: ir.Expr, node: ts.Node, access: (value: ir.Expr) => Operand): Operand {
    if (!membersOf(value.type).some((m) => m.kind === "null")) return access(value)
    const binding = this.newLocal("opt", this.without(value.type, (m) => m.kind === "null"), false)
    const body = access({ k: "local", type: binding.type, local: binding })
    if (body.k !== "typed") return body
    const resultType = body.expr.type
    if (resultType.kind === "void") return typed({ k: "optional", type: types.void as unknown as UnionType, value, binding, body: body.expr })
    const type = this.unionOf([resultType, types.null]) as UnionType
    return typed({ k: "optional", type, value, binding, body: this.coerce(body, type, node) })
  }

  private checkInstanceOf(node: ts.BinaryExpression, scope: Scope): Operand {
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
  private instanceTest(value: ir.Expr, target: StructType | InterfaceType): ir.Expr | undefined {
    const type = value.type
    if (sameType(type, target)) return { k: "bool", type: types.bool, value: true }
    if (type.kind === "union" && type.members.some((m) => sameType(m, target))) return { k: "is", type: types.bool, value, member: target }
    if (target.kind !== "struct") return undefined
    if (type.kind === "interface" && !this.conformance(target, type).reason) return { k: "is", type: types.bool, value, member: target }
    const via = this.interfaceFor(type, target)
    return via && { k: "is", type: types.bool, value, member: target, via }
  }

  /** The interface member of a union that a class implements, if exactly one. */
  private interfaceFor(type: Type, cls: StructType): InterfaceType | undefined {
    if (type.kind !== "union") return undefined
    const ifaces = type.members.filter((m): m is InterfaceType => m.kind === "interface" && !this.conformance(cls, m).reason)
    return ifaces.length === 1 ? ifaces[0] : undefined
  }

  private instanceOfTarget(node: ts.Expression, scope: Scope): StructType | InterfaceType | undefined {
    const symbol = ts.isIdentifier(node) ? scope.lookupType(node.text) : undefined
    if (ts.isIdentifier(node) && symbol) this.info.definitions.set(node, symbol.decl)
    const type = symbol?.type
    if ((type?.kind === "struct" && type.nominal) || type?.kind === "interface") return type
    this.error(node, "The right side of 'instanceof' must be a class or an interface.")
    return undefined
  }

  private checkNonNull(node: ts.NonNullExpression, scope: Scope): Operand {
    const operand = this.checkExpr(node.expression, scope)
    if (operand.k !== "typed") return operand
    const value = operand.expr
    if (!membersOf(value.type).some((m) => m.kind === "null")) return this.fail(node, `Type '${typeToString(value.type)}' cannot be null; '!' is not needed.`)
    return typed({ k: "recast", type: this.without(value.type, (m) => m.kind === "null"), value })
  }

  private checkCoalesce(node: ts.BinaryExpression, scope: Scope): Operand {
    const operand = this.checkExpr(node.left, scope)
    if (operand.k !== "typed") return operand.k === "error" ? operand : this.fail(node.left, "The left side of '??' cannot be null.")
    const value = operand.expr
    if (!membersOf(value.type).some((m) => m.kind === "null")) return this.fail(node.left, `Type '${typeToString(value.type)}' cannot be null; '??' is not needed.`)
    const type = this.without(value.type, (m) => m.kind === "null")
    const fallback = this.coerce(this.checkExpr(node.right, scope, type), type, node.right)
    return typed({ k: "coalesce", type, value, fallback })
  }

  private checkElement(node: ts.ElementAccessExpression, scope: Scope): Operand {
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
  private checkIndex(node: ts.Expression, scope: Scope, allowNegative = false): ir.Expr | undefined {
    const value = this.checkExpr(node, scope)
    if (value.k === "error") return undefined
    if (value.k === "untyped-int" && value.value < 0n && !allowNegative) return this.error(node, `Index ${value.value} must not be negative.`), undefined
    const expr = value.k === "typed" ? value.expr : this.coerce(value, types.i64, node)
    if (expr.type.kind !== "int") return this.error(node, `An index must be an integer, got '${typeToString(expr.type)}'.`), undefined
    return expr
  }

  private checkMethodCall(node: ts.CallExpression, callee: ts.PropertyAccessExpression, scope: Scope): Operand {
    const target = this.checkExpr(callee.expression, scope)
    if (target.k === "error") return target
    const value = this.toDefault(target, callee.expression)
    if (callee.questionDotToken) return this.optional(value, node, (v) => this.methodCall(v, node, callee, scope))
    return this.methodCall(value, node, callee, scope)
  }

  private methodCall(value: ir.Expr, node: ts.CallExpression, callee: ts.PropertyAccessExpression, scope: Scope): Operand {
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
      const field = findField(type, name)
      if (field?.type.kind === "func") return this.callValue(this.member(value, callee), node, scope)
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
      if (member?.type.kind === "func") return this.callValue(this.member(value, callee), node, scope)
      if (member) return this.fail(callee.name, `Field '${name}' is not a method.`)
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
  private coerceToUnion(value: Operand, target: UnionType, node: ts.Node): ir.Expr {
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

  /** The module a node belongs to. */
  private sourceOf(node: ts.Node): Source {
    return this.sources.get(node.getSourceFile())!
  }

  private line(node: ts.Node): number {
    const source = this.sourceOf(node)
    return source.position(node.getStart(source.ast)).line + 1
  }

  private newLocal(name: string, type: Type, mutable: boolean): ir.Local {
    return { id: this.nextLocalId++, name, type, mutable }
  }

  private error(node: ts.Node, message: string) {
    const d = diagnosticAt(this.sourceOf(node), node, this.context ? `${message} (in '${this.context}')` : message)
    // Generic instances can repeat the same error.
    if (!this.diagnostics.some((e) => e.start === d.start && e.message === d.message)) this.diagnostics.push(d)
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

/** String methods: parameter types, how many trailing ones are optional, and the result. */
const stringMethods: Record<string, [Type[], number, Type]> = {
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
const arrayMethods = new Map<string, [number, number]>([
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

const compareOps = new Map<ts.SyntaxKind, ir.CompareOp>([
  [K.EqualsEqualsEqualsToken, "==="],
  [K.ExclamationEqualsEqualsToken, "!=="],
  [K.LessThanToken, "<"],
  [K.LessThanEqualsToken, "<="],
  [K.GreaterThanToken, ">"],
  [K.GreaterThanEqualsToken, ">="],
])

/** `null` before it gets a union type from the context. */
const nullOperand = { k: "null", type: types.null } as unknown as ir.Expr

/** The member name of `[Symbol.dispose]`. */
const disposeName = "[Symbol.dispose]"

function isSymbolDispose(node: ts.Expression): boolean {
  return ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "Symbol" && node.name.text === "dispose"
}

/** Built-in functions that moved into namespaces. */
const renamed: Record<string, string> = { println: "console.log", print: "console.write", panic: "process.panic" }

function unknownName(name: string): string {
  const hint = renamed[name]
  return hint ? `Cannot find name '${name}'. Use '${hint}'.` : `Cannot find name '${name}'.`
}

/** A C identifier for a source name: other characters become `_x<hex>_`. */
function cIdent(name: string): string {
  return name.replace(/[^A-Za-z0-9_]/g, (c) => `_x${c.codePointAt(0)!.toString(16)}_`)
}

/** Whether a type annotation refers to any of the type parameter names. */
function mentions(node: ts.Node, names: string[]): boolean {
  if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName) && names.includes(node.typeName.text)) return true
  return ts.forEachChild(node, (child) => mentions(child, names) || undefined) ?? false
}

/** Whether a value of type `from` can be a member `m` of a union: the same type, or a string literal for `string`. */
function memberOf(from: Type, m: Type): boolean {
  return sameType(from, m) || (from.kind === "literal" && m.kind === "string")
}

/** The type of a public field of a struct or interface, if it has one. */
function fieldType(type: Type, name: string): Type | undefined {
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
function methodType(type: Type, name: string): FuncType | undefined {
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
export function typeofName(type: Type): string {
  if (isNumeric(type)) return "number"
  if (type.kind === "bool") return "boolean"
  if (isStringLike(type)) return "string"
  return "object"
}

/** Statements handled by the declaration passes. */
function isDeclaration(stmt: ts.Statement): boolean {
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

function isStringLiteralNode(node: ts.Node): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
}

function canBeNull(type: Type): boolean {
  return membersOf(type).some((m) => m.kind === "null")
}

function isNull(value: Operand): boolean {
  return value.k === "typed" && value.expr.type.kind === "null"
}

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

/** Whether a type has a zero value for variables without an initializer; references do not. */
function hasZeroValue(type: Type): boolean {
  if (type.kind === "union") return type.members.some((m) => m.kind === "null")
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
    case "switch":
      return stmt.clauses.some((c) => c.body.some((s) => breaks(s, loopId, true)))
    case "using":
      return stmt.body.some((s) => breaks(s, loopId, nested))
    default:
      return false
  }
}
