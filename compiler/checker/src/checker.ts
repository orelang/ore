// The checker of a program: runs the layers over every module, in passes, into one IR module.
import * as ir from "@ore/ir"
import { types } from "@ore/ir"
import type { Source } from "@ore/syntax"
import ts from "typescript"
import { builtinScope, namespaceModules } from "./builtins"
import { Scope } from "./symbols"
import type { CheckResult, ProgramInput, ModuleInfo } from "./context"
import { isDeclaration } from "./helpers"
import { CallChecker } from "./calls"

export type { CheckInfo, CheckResult, ProgramInput } from "./context"
export { typeOf } from "./helpers"

/** Checks a single file, or a program of modules, into one IR module. */
export function check(input: Source | ProgramInput): CheckResult {
  const program = "ast" in input ? { modules: [input], entry: input, imports: new Map() } : input
  return new Checker(program).run()
}

/** A program being checked. */
export class Checker extends CallChecker {
  run(): CheckResult {
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
    // Built-in namespaces implemented in Ore take the exports of their module.
    for (const [ns, path] of Object.entries(namespaceModules)) {
      const symbol = builtins.scope.lookupValue(ns)
      const module = modules.find((m) => m.source.path === path)
      if (symbol?.k === "namespace" && module) symbol.module = (name) => this.exportOf(module, name)
    }
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
    each((stmt) => this.checkStrictNames(stmt, false))
    each((stmt, m) => this.declareExports(stmt, m))
    each((stmt) => this.checkDirectives(stmt))
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

    // Pass 3: constants in module and source order, field initializers, the
    // top-level code of each module, which declares its global variables, then
    // bodies, which can use the globals.
    const constants = new Set<ts.Statement>()
    each((stmt, m) => {
      if (ts.isEnumDeclaration(stmt) || ts.isModuleDeclaration(stmt)) this.error(stmt, this.unsupportedTopLevel(stmt))
      else if (ts.isVariableStatement(stmt) && this.isConstantStatement(stmt, m.scope) && this.checkTopLevelConstants(stmt, m.scope)) constants.add(stmt)
    })
    for (const info of this.classes) this.checkFieldInitializers(info, info.scope)
    for (const info of this.classes) this.checkImplements(info, info.scope)
    for (const m of modules) this.checkTopLevel(m, (stmt) => !isDeclaration(stmt) && !constants.has(stmt) && !ts.isEnumDeclaration(stmt) && !ts.isModuleDeclaration(stmt))
    for (const [decl, func, scope] of bodies) this.checkFunctionBody(decl, func, scope)
    for (const info of this.classes) this.checkClassBodies(info, info.scope)
    while (this.pending.length > 0) this.pending.shift()!()
    this.localizeGlobals()
    this.checkUnassigned()

    const hasErrors = this.diagnostics.some((d) => d.severity === "error")
    return { module: hasErrors ? undefined : this.module, diagnostics: this.diagnostics, info: this.info }
  }

  /**
   * The top-level code of a module, run when the program starts: its
   * variables are globals, visible to the functions of the module.
   */
  protected checkTopLevel(module: ModuleInfo, isCode: (stmt: ts.Statement) => boolean) {
    const func: ir.Func = {
      name: `ore_init_${module.prefix}`,
      sourceName: "<top level>",
      line: 1,
      file: module.source.path,
      type: { kind: "func", params: [], result: types.void },
      params: [],
      body: { k: "block", body: [] },
      exported: false,
    }
    this.prefix = module.prefix
    this.globals = module.scope
    this.facts = [new Map()]
    this.fn = { result: types.void, loops: [], nextLoopId: 0, topLevel: true }
    this.withFacts([], () => this.checkStatements(module.source.ast.statements.filter(isCode), module.scope, func.body.body))
    this.fn = undefined
    this.globals = undefined
    this.prefix = ""
    this.module.functions.push(func)
    this.module.inits.push(func)
  }
}
