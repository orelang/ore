import type { Func, InterfaceType, Local, StructType, Type } from "@ore/ir"
import type ts from "typescript"
import type { Operand } from "./operand"

export type BuiltinFunc = "println" | "print" | "panic"

/** A declaration with type parameters, and its instances by type arguments. */
export interface Generic {
  name: string
  decl: ts.FunctionDeclaration | ts.ClassDeclaration | ts.InterfaceDeclaration | ts.TypeAliasDeclaration
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

  constructor(readonly parent?: Scope) {}

  lookupValue(name: string): ValueSymbol | undefined {
    return this.values.get(name) ?? this.parent?.lookupValue(name)
  }

  lookupType(name: string): TypeSymbol | undefined {
    return this.types.get(name) ?? this.parent?.lookupType(name)
  }

  /** Declares a value; returns false if the name is already declared in this scope. */
  declareValue(name: string, symbol: ValueSymbol): boolean {
    if (this.values.has(name)) return false
    this.values.set(name, symbol)
    return true
  }

  declareType(name: string, symbol: TypeSymbol): boolean {
    if (this.types.has(name)) return false
    this.types.set(name, symbol)
    return true
  }
}
