// Modules, directives, declarations of functions and types, generics, classes and interfaces.
import * as ir from "@ore/ir"
import { checkAssigned } from "./assigned"
import { isNumeric, membersOf, sameType, typeKey, types, typeToString, type InterfaceType, type StructType, type Type } from "@ore/ir"
import { importsText, type Source } from "@ore/syntax"
import ts from "typescript"
import type { Operand } from "./operand"
import { Scope, type Exported, type Generic, type ValueSymbol } from "./symbols"
import type { ModuleInfo, ClassInfo, Directive } from "./context"
import {
  cIdent,
  mentions,
  memberOf,
  fieldType,
  methodType,
  directiveKinds,
  isStringLiteralNode,
  isLiteral,
  terminates,
  visitLocals,
  paramName,
} from "./helpers"
import { CheckerBase } from "./base"

export abstract class DeclarationChecker extends CheckerBase {
  /** The `//ore:name argument` comments before a statement. */
  protected directives(stmt: ts.Statement): Directive[] {
    const text = stmt.getSourceFile().text
    const found: Directive[] = []
    for (const range of ts.getLeadingCommentRanges(text, stmt.pos) ?? []) {
      const comment = text.slice(range.pos, range.end)
      // A comment may follow the directive: `//ore:noinline // keeps the frame`.
      const match = /^\/\/ore:(\S*)\s*(.*?)\s*(\/\/.*)?$/.exec(comment)
      if (match) found.push({ name: match[1]!, arg: match[2]!, pos: range.pos, end: range.end })
    }
    return found
  }

  /**
   * Whether a module may use `internal` and `//ore:runtime`: a module of the
   * standard library, or one that starts with `//ore:internal`.
   */
  protected isInternal(source: Source): boolean {
    if (source.path.startsWith("ore:")) return true
    const first = source.ast.statements[0]
    return first !== undefined && this.directives(first).some((d) => d.name === "internal")
  }

  protected directiveError(stmt: ts.Statement, d: Directive, message: string) {
    this.diagnostics.push({ source: this.sourceOf(stmt), start: d.pos, length: d.end - d.pos, severity: "error", message })
  }

  /** Reports unknown directives and directives on statements they do not apply to. */
  protected checkDirectives(stmt: ts.Statement) {
    for (const d of this.directives(stmt)) {
      const kind = directiveKinds.get(d.name)
      if (!kind) {
        this.directiveError(stmt, d, `Unknown directive '//ore:${d.name}'. Known: ${[...directiveKinds.keys()].map((k) => `//ore:${k}`).join(", ")}.`)
        continue
      }
      const named = d.name === "export" || d.name === "runtime"
      if (named ? d.arg === "" : d.arg !== "") {
        this.directiveError(stmt, d, named ? `'//ore:${d.name}' needs a C name, e.g. '//ore:${d.name} my_function'.` : `'//ore:${d.name}' takes no argument.`)
        continue
      }
      if (d.name === "runtime" && !this.isInternal(this.sourceOf(stmt))) {
        this.directiveError(stmt, d, "'//ore:runtime' is only for the standard library. Add '//ore:internal' at the top of the file to use it here.")
        continue
      }
      if (kind === "module") {
        if (stmt.getSourceFile().statements[0] !== stmt) this.directiveError(stmt, d, `'//ore:${d.name}' goes at the top of the file, before the first statement.`)
        continue
      }
      // `//ore:export` also names a top-level variable for C.
      if (d.name === "export" && ts.isVariableStatement(stmt)) {
        const ok =
          (stmt.declarationList.flags & ts.NodeFlags.BlockScoped) === ts.NodeFlags.Let &&
          stmt.declarationList.declarations.length === 1 &&
          ts.isIdentifier(stmt.declarationList.declarations[0]!.name)
        if (!ok) this.directiveError(stmt, d, "'//ore:export' applies to a function, or to a top-level 'let' of one name.")
        continue
      }
      if (kind === "function") {
        const ok = ts.isFunctionDeclaration(stmt) && stmt.body !== undefined && !stmt.typeParameters
        if (!ok) this.directiveError(stmt, d, `'//ore:${d.name}' applies to a function declaration with a body, not generic.`)
      } else {
        const ok =
          ts.isVariableStatement(stmt) &&
          (stmt.declarationList.flags & ts.NodeFlags.BlockScoped) === ts.NodeFlags.Let &&
          stmt.declarationList.declarations.every((v) => ts.isIdentifier(v.name))
        if (!ok) this.directiveError(stmt, d, "'//ore:threadlocal' applies to a top-level 'let' of plain names.")
      }
    }
  }

  /** Sets the attributes of a function from its directives. */
  protected applyFuncDirectives(decl: ts.FunctionDeclaration, func: ir.Func) {
    const directives = this.directives(decl).filter((d) => directiveKinds.get(d.name) === "function")
    if (directives.length === 0) return
    const attributes: ir.FuncAttributes = {}
    for (const d of directives) {
      if (d.name === "noinline") attributes.noinline = true
      else if (d.name === "inline") attributes.inline = true
      else if (d.name === "cold") attributes.cold = true
      else if (d.name === "naked") {
        // The body runs without a frame, so it may hold nothing but assembly, chosen by `if` on the target.
        const asmOnly = (s: ts.Statement): boolean =>
          ts.isBlock(s)
            ? s.statements.every(asmOnly)
            : ts.isIfStatement(s)
              ? asmOnly(s.thenStatement) && (!s.elseStatement || asmOnly(s.elseStatement))
              : ts.isExpressionStatement(s) &&
                ts.isCallExpression(s.expression) &&
                s.expression.expression.getText() === "unsafe.asm" &&
                s.expression.arguments.length === 2
        if (!decl.body!.statements.every(asmOnly)) this.directiveError(decl, d, "A '//ore:naked' function holds only 'unsafe.asm(template, constraints)' statements.")
        else {
          attributes.naked = true
          attributes.noinline = true
        }
      }
      else if (d.name === "runtime" && d.arg !== "" && this.isInternal(this.sourceOf(decl))) attributes.runtime = d.arg
      else if (d.name === "export" && d.arg !== "") {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(d.arg)) {
          this.directiveError(decl, d, `'${d.arg}' is not a C name.`)
          continue
        }
        // C passes numbers, booleans and pointers; strings and objects have no C form.
        const cType = (t: Type) => isNumeric(t) || t.kind === "bool" || t.kind === "ptr"
        const bad = [...func.type.params, ...(func.type.result.kind === "void" ? [] : [func.type.result])].find((t) => !cType(t))
        if (bad) {
          this.directiveError(decl, d, `An exported function takes and returns numbers, 'bool' and 'ptr' only, not '${typeToString(bad)}'.`)
          continue
        }
        if (this.signatures.has(func.params)) {
          this.directiveError(decl, d, "An exported function cannot have optional or rest parameters.")
          continue
        }
        const other = this.exportNames.get(d.arg)
        if (other) {
          this.directiveError(decl, d, `'${d.arg}' is already exported by '${other.sourceName}'.`)
          continue
        }
        this.exportNames.set(d.arg, func)
        attributes.exportName = d.arg
        func.name = d.arg
      }
    }
    if (attributes.noinline && attributes.inline) this.error(decl.name!, "A function cannot be both '//ore:noinline' and '//ore:inline'.")
    func.attributes = attributes
  }

  /** Gives a top-level variable a C name, if its type allows it. */
  protected exportVariable(decl: ts.VariableDeclaration, local: ir.Local, name: string) {
    const type = local.type
    if (!isNumeric(type) && type.kind !== "bool" && type.kind !== "ptr") {
      return this.error(decl.name, `An exported variable holds a number, 'bool' or 'ptr', not '${typeToString(type)}'.`)
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return this.error(decl.name, `'${name}' is not a C name.`)
    if (this.exportedVariables.has(name)) return this.error(decl.name, `'${name}' is already exported.`)
    this.exportedVariables.add(name)
    local.exportName = name
  }

  /** Makes a top-level variable thread-local, if its type and declaration allow it. */
  protected threadLocal(decl: ts.VariableDeclaration, local: ir.Local) {
    const type = local.type
    // The collector does not scan thread-local storage, so it may not hold references.
    if (!isNumeric(type) && type.kind !== "bool" && type.kind !== "ptr") {
      return this.error(decl.name, `A thread-local variable holds a number, 'bool' or 'ptr', not '${typeToString(type)}'.`)
    }
    if (decl.initializer || !decl.type) {
      return this.error(decl.name, "A thread-local variable starts at zero in each thread: write 'let name: T' with a type and no value.")
    }
    local.threadLocal = true
  }

  /** Reports variables that may be read before they are assigned; see `checkAssigned`. */
  protected checkUnassigned() {
    for (const local of this.untyped) {
      if (!this.readEarly.has(local)) this.error(this.declNodes.get(local)!, `Variable '${local.name}' needs a type annotation or an initializer.`)
    }
    for (const local of this.unassigned) {
      // Functions may run at any time, so a global they use needs its value at once.
      if (local.global) this.error(this.declNodes.get(local)!, `Variable '${local.name}' is used by functions, so it must have a value where it is declared.`)
    }
    if (this.unassigned.size === 0) return
    for (const func of this.module.functions) {
      if (func.extern) continue
      checkAssigned(func.body, this.unassigned, (local, at) => {
        if (this.readEarly.has(local) || this.untyped.has(local)) return
        this.error(this.refNodes.get(at) ?? this.declNodes.get(local)!, `Variable '${local.name}' is used before being assigned.`)
      })
    }
  }

  /**
   * Top-level variables used only by the top-level code of their module stay
   * locals of it, which are faster than globals and may live on the stack.
   */
  protected localizeGlobals() {
    const owners = new Map<ir.Local, ir.Func>()
    for (const init of this.module.inits) visitLocals(init.body, (local) => local.global && owners.set(local, init))
    const shared = new Set<ir.Local>()
    for (const func of this.module.functions) visitLocals(func.body, (local) => local.global && owners.get(local) !== func && shared.add(local))
    for (const local of owners.keys()) if (!shared.has(local) && !local.threadLocal && !local.exportName) local.global = false
  }

  /** Whether a top-level `const` statement declares only constants, known before any code runs. */
  protected isConstantStatement(stmt: ts.VariableStatement, scope: Scope): boolean {
    const list = stmt.declarationList
    if ((list.flags & (ts.NodeFlags.Const | ts.NodeFlags.Using)) !== ts.NodeFlags.Const) return false
    const constant = (e: ts.Expression): boolean => {
      if (ts.isNumericLiteral(e) || isStringLiteralNode(e) || e.kind === ts.SyntaxKind.TrueKeyword || e.kind === ts.SyntaxKind.FalseKeyword) return true
      if (ts.isParenthesizedExpression(e)) return constant(e.expression)
      if (ts.isPrefixUnaryExpression(e)) return constant(e.operand)
      if (ts.isBinaryExpression(e)) {
        const op = e.operatorToken.kind
        return !(op >= ts.SyntaxKind.FirstAssignment && op <= ts.SyntaxKind.LastAssignment) && constant(e.left) && constant(e.right)
      }
      if (ts.isConditionalExpression(e)) return constant(e.condition) && constant(e.whenTrue) && constant(e.whenFalse)
      if (ts.isIdentifier(e)) return scope.lookupValue(e.text)?.k === "const"
      return false
    }
    return list.declarations.every((d) => ts.isIdentifier(d.name) && d.initializer !== undefined && constant(d.initializer))
  }

  /** Records the names a top-level statement exports. */
  protected declareExports(stmt: ts.Statement, module: ModuleInfo) {
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
  protected importedModule(specifier: ts.Expression, module: ModuleInfo): ModuleInfo | undefined {
    if (!ts.isStringLiteral(specifier)) return undefined
    const target = this.program.imports.get(module.source)?.get(specifier.text)
    return target && this.modules.get(target)
  }

  /** What a module exports under a name, following re-exports. */
  protected exportOf(module: ModuleInfo, name: string, seen = new Set<ModuleInfo>()): Exported | undefined {
    const entry = module.exports.get(name)
    if (!entry || seen.has(module)) return undefined
    seen.add(module)
    if (entry.from) return this.exportOf(entry.from, entry.local, seen)
    const value = module.scope.ownValue(entry.local)
    const type = module.scope.ownType(entry.local)
    return value || type ? { value, type } : undefined
  }

  protected declareImport(stmt: ts.ImportDeclaration, module: ModuleInfo) {
    if (importsText(stmt)) return this.declareTextImport(stmt, module)
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
      this.specifiers.push(() => {
        const exported = this.exportOf(target, imported)
        const decl = exported?.value?.decl ?? exported?.type?.decl
        if (decl) this.info.definitions.set(element.propertyName && ts.isIdentifier(element.propertyName) ? element.propertyName : element.name, decl)
      })
    }
  }

  /**
   * `import name from "./file" with { type: "text" }`: the file's contents,
   * read when the program is compiled, as a string constant.
   */
  protected declareTextImport(stmt: ts.ImportDeclaration, module: ModuleInfo) {
    const clause = stmt.importClause
    const specifier = stmt.moduleSpecifier as ts.StringLiteral
    if (!clause?.name || clause.namedBindings) {
      return this.error(stmt, `A text import has one name: 'import text from "${specifier.text}" with { type: "text" }'.`)
    }
    // The loader reported a missing file.
    const contents = this.program.texts?.get(module.source)?.get(specifier.text)
    if (contents === undefined) return
    const value: Operand = { k: "typed", expr: { k: "string", type: types.string, value: contents } }
    const name = clause.name.text
    if (!module.scope.declareValue(name, { k: "const", value, type: types.string, decl: clause })) this.error(clause.name, `Duplicate declaration '${name}'.`)
  }

  /** Reports exports of names that a module does not declare. */
  protected checkExports(modules: ModuleInfo[]) {
    for (const resolve of this.specifiers) resolve()
    for (const module of modules) {
      // `export { a, b as c }` refers to declarations of the module.
      for (const stmt of module.source.ast.statements) {
        if (!ts.isExportDeclaration(stmt) || stmt.moduleSpecifier || !stmt.exportClause || !ts.isNamedExports(stmt.exportClause)) continue
        for (const e of stmt.exportClause.elements) {
          const local = e.propertyName ?? e.name
          const symbol = ts.isIdentifier(local) ? module.scope.lookupValue(local.text) ?? module.scope.lookupType(local.text) : undefined
          if (symbol && ts.isIdentifier(local)) this.info.definitions.set(local, symbol.decl)
        }
      }
      for (const [name, entry] of module.exports) {
        if (!entry.from && !this.exportOf(module, name)) {
          const node = module.source.ast.statements.find(ts.isExportDeclaration)
          if (node) this.error(node, `Cannot export '${entry.local}': it is not declared in this module.`)
        }
      }
    }
  }

  protected declareTypeAlias(decl: ts.TypeAliasDeclaration, scope: Scope) {
    if (decl.typeParameters) return this.declareGeneric(decl, scope)
    const type = this.resolveType(decl.type, scope)
    if (!type) return
    // An anonymous object type or a union is displayed by the first alias that names it.
    if ((type.kind === "struct" || type.kind === "union") && type.name === undefined) type.name = decl.name.text
    if (!scope.declareType(decl.name.text, { type, decl })) this.error(decl.name, `Duplicate type '${decl.name.text}'.`)
  }

  protected declareFunction(decl: ts.FunctionDeclaration, scope: Scope): ir.Func | undefined {
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
    this.applyFuncDirectives(decl, func)
    if (!scope.declareValue(decl.name.text, { k: "func", func, decl })) {
      this.error(decl.name, `Duplicate declaration '${decl.name.text}'.`)
      return undefined
    }
    return func
  }

  /** `declare function f(...)`: an external C function named `f`. */
  protected declareExtern(decl: ts.FunctionDeclaration, scope: Scope) {
    const name = decl.name!.text
    if (decl.body) return this.error(decl.name!, "A declared function cannot have a body.")
    if (decl.typeParameters) return this.error(decl.typeParameters[0]!, "External functions cannot be generic.")
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return this.error(decl.name!, "An external function needs a C name.")
    let params = this.resolveParams(decl.parameters, scope)
    // `...args: T[]` declares a variadic C function, such as fcntl or printf. C
    // promotes the arguments after the fixed ones, to an int64, a double or a pointer.
    let variadic: Type | undefined
    const last = decl.parameters.at(-1)
    if (last?.dotDotDotToken) {
      const rest = params.at(-1)?.type
      const elem = rest?.kind === "array" ? rest.elem : undefined
      if (!elem || !((elem.kind === "int" && elem.bits === 64) || (elem.kind === "float" && elem.bits === 64) || elem.kind === "ptr")) {
        this.error(last, "The variadic arguments of a C function are i64, f64 or ptr, as C promotes them: write '...args: i64[]'.")
      }
      variadic = elem
      params = params.slice(0, -1)
    } else if (this.signatures.has(params)) {
      this.error(decl.name!, "An external function cannot have optional parameters.")
    }
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
      variadic,
    }
    this.module.functions.push(func)
    if (!scope.declareValue(name, { k: "func", func, decl })) this.error(decl.name!, `Duplicate declaration '${name}'.`)
  }

  /** A function with the signature of a declaration, resolved in `scope`; the body is checked later. */
  protected makeFunc(decl: ts.FunctionDeclaration, scope: Scope, sourceName: string, cname: string, exported: boolean): ir.Func {
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

  protected declareGeneric(decl: Exclude<Generic["decl"], ts.MethodDeclaration>, scope: Scope) {
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
  protected instantiate(generic: Generic, args: Type[], node: ts.Node): ir.Func | Type | undefined {
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
    if (ts.isMethodDeclaration(decl)) {
      const owner = this.genericMethodOwner(generic)!
      const func = this.makeMethod(decl, owner, scope, `${owner.type.name}.${label}`, `ore_m_${owner.cname}_${cname}`)
      generic.instances.set(key, func)
      this.pending.push(inContext(() => this.checkMethodBody(decl, func, owner.type, scope)))
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

  /** The class declaring a generic method. */
  protected genericMethodOwner(generic: Generic): ClassInfo | undefined {
    for (const methods of this.genericMethods.values()) for (const m of methods.values()) if (m.generic === generic) return m.info
    return undefined
  }

  /** Whether a type argument satisfies a constraint. */
  protected satisfies(arg: Type, constraint: Type): boolean {
    if (sameType(arg, constraint)) return true
    if (constraint.kind === "interface" && (arg.kind === "struct" || arg.kind === "interface")) return !this.conformance(arg, constraint).reason
    return membersOf(arg).every((a) => membersOf(constraint).some((c) => memberOf(a, c)))
  }

  /**
   * Infers type arguments of a generic from the types of arguments, by
   * matching parameter type annotations against them.
   */
  protected inferTypeArgs(generic: Generic, params: readonly ts.ParameterDeclaration[], argTypes: (Type | undefined)[], node: ts.Node): Type[] | undefined {
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
  protected inferFrom(n: ts.TypeNode, type: Type, names: string[], bindings: Map<string, Type>, scope: Scope): void {
    const infer = (node: ts.TypeNode, t: Type): void => this.inferFrom(node, t, names, bindings, scope)
    if (ts.isParenthesizedTypeNode(n)) return infer(n.type, type)
    if (ts.isFunctionTypeNode(n)) {
      if (type.kind !== "func") return
      n.parameters.forEach((p, i) => p.type && type.params[i] && infer(p.type, type.params[i]!))
      return infer(n.type, type.result)
    }
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
  protected genericCall(
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
    // Function literals for parameters such as `f: (x: T) => U` come last: the
    // other arguments bind the types of their parameters (`T`), and their
    // results bind the rest (`U`).
    const deferred = (arg: ts.Expression, p: ts.TypeNode | undefined): p is ts.FunctionTypeNode =>
      (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) && p !== undefined && ts.isFunctionTypeNode(p) && mentions(p, names)
    const found: (Operand | undefined)[] = args.map((arg, i) => {
      const p = params[i]?.type
      if (deferred(arg, p)) return undefined
      const expected = p && !mentions(p, names) ? this.resolveType(p, generic.scope) : undefined
      return this.checkExpr(arg, scope, expected)
    })
    const bindings = new Map<string, Type>()
    const bind = (i: number) => {
      const o = found[i]
      const p = params[i]?.type
      if (o && o.k !== "error" && p) this.inferFrom(p, o.k === "typed" ? o.expr.type : this.defaultType(o), names, bindings, generic.scope)
    }
    args.forEach((_, i) => bind(i))
    args.forEach((arg, i) => {
      const p = params[i]?.type
      if (found[i] || !deferred(arg, p)) return
      const unbound = names.filter((n) => !bindings.has(n))
      const known = new Scope(generic.scope)
      for (const [n, t] of bindings) known.declareType(n, { type: t, decl: p })
      const paramTypes = p.parameters.map((q) => (q.type && !mentions(q.type, unbound) ? this.resolveType(q.type, known) : undefined))
      if (paramTypes.some((t) => t === undefined)) {
        found[i] = this.checkExpr(arg, scope)
      } else {
        const resultKnown = !mentions(p.type, unbound)
        const result = resultKnown ? this.resolveType(p.type, known) ?? types.void : types.void
        found[i] = this.checkClosure(arg as ts.ArrowFunction | ts.FunctionExpression, scope, { kind: "func", params: paramTypes as Type[], result }, !resultKnown)
      }
      bind(i)
    })
    const operands = found as Operand[]
    if (operands.some((o) => o.k === "error")) return undefined
    const argTypes = operands.map((o, i) => (o.k === "typed" ? o.expr.type : o.k === "error" ? undefined : this.defaultType(o)))
    const typeArgsResolved = this.inferTypeArgs(generic, params, argTypes, node)
    if (!typeArgsResolved) return undefined
    const instance = this.instantiate(generic, typeArgsResolved, node)
    return instance ? { instance, operands } : undefined
  }

  /**
   * Resolves parameters into locals; parameter properties are allowed only by
   * the caller. Optional (`x?: T`, `x = value`) and rest (`...xs: T[]`)
   * parameters are recorded in `signatures`.
   */
  protected resolveParams(parameters: readonly ts.ParameterDeclaration[], scope: Scope): ir.Local[] {
    const params: ir.Local[] = []
    // Default values may use the parameters before them: each parameter is
    // declared in a scope of its own, so a value checked later sees only those.
    let defaults = new Scope(scope)
    let required = -1
    let rest = false
    for (const [i, p] of parameters.entries()) {
      let type: Type | undefined
      if (p.type) type = this.resolveValueType(p.type, scope)
      else if (p.initializer) {
        const value = this.checkDefault(p.initializer, defaults, undefined)
        if (value) type = value.type
      } else this.error(p.name, `Parameter '${p.name.getText()}' must have a type annotation.`)
      // A value with a declared type is checked once every declaration is known,
      // since it may construct a class or use a constant declared further down.
      if (type && p.type && p.initializer) {
        const [initializer, before, declared] = [p.initializer, defaults, type]
        this.pending.push(() => void this.checkDefault(initializer, before, declared))
      }
      if (type && p.questionToken) type = this.unionOf([type, types.null])
      if (p.dotDotDotToken) {
        if (i !== parameters.length - 1) this.error(p, "A rest parameter must be the last parameter.")
        else if (type && type.kind !== "array") this.error(p.type ?? p, "A rest parameter must have an array type.")
        else rest = true
      }
      if (p.initializer && p.questionToken) this.error(p.questionToken, "A parameter with a default value is already optional.")
      const optional = p.initializer !== undefined || p.questionToken !== undefined || (p.dotDotDotToken !== undefined && i === parameters.length - 1)
      if (optional && required === -1) required = i
      if (!optional && required !== -1) this.error(p, "A required parameter cannot follow an optional or rest parameter.")
      if (type) this.info.types.set(p.name, type)
      const local = this.newLocal(paramName(p, i), type ?? types.i64, true)
      params.push(local)
      if (ts.isIdentifier(p.name)) {
        defaults = new Scope(defaults)
        defaults.declareValue(local.name, { k: "local", local, decl: p })
      }
    }
    if (required !== -1) this.signatures.set(params, { parameters, scope, required, rest })
    return params
  }

  /** Checks a default parameter value, for its type and errors; the value is created again at each call. */
  protected checkDefault(node: ts.Expression, scope: Scope, type: Type | undefined): ir.Expr | undefined {
    const saved = [this.fn, this.facts] as const
    this.fn ??= { result: types.void, loops: [], nextLoopId: 0 }
    this.facts = [new Map()]
    try {
      const value = this.checkExpr(node, scope, type)
      if (value.k === "error") return undefined
      return type ? this.coerce(value, type, node) : this.toDefault(value, node)
    } finally {
      ;[this.fn, this.facts] = saved
    }
  }

  /**
   * A scope with the parameters of a function declared. The names of
   * destructured parameters are declared by statements added to `prologue`,
   * which go before the body.
   */
  protected paramScope(parameters: readonly ts.ParameterDeclaration[], locals: ir.Local[], outer: Scope, prologue: ir.Stmt[]): Scope {
    const scope = new Scope(outer)
    parameters.forEach((p, i) => {
      const local = locals[i]
      if (!local) return
      if (ts.isIdentifier(p.name)) {
        if (!scope.declareValue(local.name, { k: "local", local, decl: p })) this.error(p.name, `Duplicate parameter '${local.name}'.`)
      } else {
        this.bindPattern(p.name, { k: "local", type: local.type, local }, true, scope, prologue)
      }
    })
    return scope
  }

  protected checkFunctionBody(decl: ts.FunctionDeclaration, func: ir.Func, outer: Scope) {
    const prologue: ir.Stmt[] = []
    const scope = this.paramScope(decl.parameters, func.params, outer, prologue)
    this.facts = [new Map()]
    this.fn = { result: func.type.result, loops: [], nextLoopId: 0 }
    func.body = this.checkBlock(decl.body!, scope)
    func.body.body.unshift(...prologue)
    this.fn = undefined
    this.checkReturns(func, decl.type ?? decl.name!)
    // Without a frame, a naked function can branch only on what is known at compile time.
    if (func.attributes?.naked) {
      const constant = (st: ir.Stmt): boolean =>
        st.k === "block" ? st.body.every(constant) : st.k === "if" ? st.cond.k === "bool" && constant(st.then) && (!st.else || constant(st.else)) : true
      if (!func.body.body.every(constant)) this.error(decl.name!, "A '//ore:naked' function can branch only on conditions known at compile time, such as 'target.arch'.")
    }
  }

  protected checkReturns(func: ir.Func, node: ts.Node) {
    const result = func.type.result
    // A naked function returns from its assembly.
    if (result.kind !== "void" && !func.attributes?.naked && !terminates(func.body)) {
      this.error(node, `Function '${func.sourceName}' must return a value of type '${typeToString(result)}' on every path.`)
    }
  }

  /**
   * Declares the constants of a top-level `const` statement whose initializers
   * are made of literals and constants. Returns false, declaring nothing, when
   * a value is not a constant after all, such as a literal converted to a
   * union: the statement then declares global variables.
   */
  protected checkTopLevelConstants(stmt: ts.VariableStatement, scope: Scope): boolean {
    const errors = this.diagnostics.length
    const constants: [ts.Identifier, Operand, Type | undefined, ts.VariableDeclaration][] = []
    for (const decl of stmt.declarationList.declarations) {
      const declared = decl.type ? this.resolveValueType(decl.type, scope) : undefined
      let value = this.checkExpr(decl.initializer!, scope)
      if (declared) value = { k: "typed", expr: this.coerce(value, declared, decl.initializer!) }
      constants.push([decl.name as ts.Identifier, value, declared, decl])
    }
    if (this.diagnostics.length === errors && constants.some(([, value]) => value.k === "typed" && !isLiteral(value.expr))) return false
    for (const [name, value, type, decl] of constants) {
      if (!scope.declareValue(name.text, { k: "const", value, type, decl })) this.error(name, `Duplicate declaration '${name.text}'.`)
    }
    return true
  }

  protected unsupportedTopLevel(stmt: ts.Statement): string {
    if (ts.isEnumDeclaration(stmt)) return "Enums are not supported in Ore. Use a union of literal types."
    if (ts.isModuleDeclaration(stmt)) return "Namespaces are not supported in Ore. Use modules."
    return "This declaration is not supported at the top level."
  }
}
