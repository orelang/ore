import type { Func, InterfaceType, Local, StructType, Type } from "@ore/ir"
import type ts from "typescript"
import type { Operand } from "./operand"

/** A built-in function by its qualified name, such as `Math.sqrt`. */
export type BuiltinFunc = string

/** A declaration with type parameters, and its instances by type arguments. */
export interface Generic {
  name: string
  decl: ts.FunctionDeclaration | ts.ClassDeclaration | ts.InterfaceDeclaration | ts.TypeAliasDeclaration | ts.MethodDeclaration
  params: readonly ts.TypeParameterDeclaration[]
  /** The scope of the declaration. */
  scope: Scope
  instances: Map<string, Func | StructType | InterfaceType | Type>
}

export type ValueSymbol =
  | { k: "local"; local: Local; decl: ts.Node }
  | { k: "const"; value: Operand; type: Type | undefined; decl: ts.Node }
  | { k: "func"; func: Func; decl: ts.Node }
  | { k: "conversion"; type: Type; decl: ts.Node }
  | { k: "builtin"; name: BuiltinFunc; decl: ts.Node }
  | { k: "class"; type: StructType | undefined; decl: ts.Node }
  | { k: "generic-func"; generic: Generic; decl: ts.Node }
  /**
   * A built-in namespace such as `console`, whose members are called as
   * `console.log(...)`. The exports of the runtime module that implements it
   * in Ore, if any, are members too (`fs.stat`, `fs.FileInfo`), before those
   * of builtin.d.ore.
   */
  | { k: "namespace"; name: string; members: Map<string, ValueSymbol>; decl: ts.Node; module?: (name: string) => Exported | undefined }
  /** A module imported with `import * as m`, whose exports are used as `m.name`. */
  | { k: "module"; name: string; exports: (name: string) => Exported | undefined; decl: ts.Node }

/** What a module exports under a name: a value, a type, or both (a class). */
export interface Exported {
  value?: ValueSymbol
  type?: TypeSymbol
}

export interface TypeSymbol {
  type: Type
  decl: ts.Node
  /** Set for a generic declaration, whose `type` is a placeholder. */
  generic?: Generic
}

/** A lexical scope with separate value and type namespaces, as in TypeScript. */
export class Scope {
  private readonly values = new Map<string, ValueSymbol>()
  private readonly types = new Map<string, TypeSymbol>()
  /** Imported names, resolved when looked up so that modules can import each other in cycles. */
  private readonly aliases = new Map<string, () => Exported | undefined>()

  /**
   * @param closure set on the outermost scope of a closure body: names found
   * beyond it are captured by that closure.
   */
  constructor(
    readonly parent?: Scope,
    readonly closure?: Func,
  ) {}

  lookupValue(name: string): ValueSymbol | undefined {
    return this.values.get(name) ?? this.aliases.get(name)?.()?.value ?? this.parent?.lookupValue(name)
  }

  /** A value declared in this scope itself, not in a parent. */
  ownValue(name: string): ValueSymbol | undefined {
    return this.values.get(name) ?? this.aliases.get(name)?.()?.value
  }

  ownType(name: string): TypeSymbol | undefined {
    return this.types.get(name) ?? this.aliases.get(name)?.()?.type
  }

  /** Declares an imported name; returns false if the name is already declared in this scope. */
  declareAlias(name: string, resolve: () => Exported | undefined): boolean {
    if (this.values.has(name) || this.types.has(name) || this.aliases.has(name)) return false
    this.aliases.set(name, resolve)
    return true
  }

  /** Looks up a value and the closures between this scope and its declaration, innermost first. */
  lookupCapturing(name: string): { symbol: ValueSymbol; closures: Func[] } | undefined {
    const closures: Func[] = []
    for (let scope: Scope | undefined = this; scope; scope = scope.parent) {
      const symbol = scope.values.get(name) ?? scope.aliases.get(name)?.()?.value
      if (symbol) return { symbol, closures }
      if (scope.closure) closures.push(scope.closure)
    }
    return undefined
  }

  lookupType(name: string): TypeSymbol | undefined {
    return this.types.get(name) ?? this.aliases.get(name)?.()?.type ?? this.parent?.lookupType(name)
  }

  /** Declares a value; returns false if the name is already declared in this scope. */
  declareValue(name: string, symbol: ValueSymbol): boolean {
    if (this.values.has(name) || this.aliases.has(name)) return false
    this.values.set(name, symbol)
    return true
  }

  declareType(name: string, symbol: TypeSymbol): boolean {
    if (this.types.has(name) || this.aliases.has(name)) return false
    this.types.set(name, symbol)
    return true
  }
}
