// Types shared by the layers of the checker.
import type * as ir from "@ore/ir"
import type { InterfaceType, StructType, Type } from "@ore/ir"
import type { Diagnostic, Source } from "@ore/syntax"
import type ts from "typescript"
import type { Scope } from "./symbols"

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

/** The modules of a program, as loaded by `@ore/project`. */
export interface ProgramInput {
  /** Modules with each module after the modules it imports, the entry last. */
  modules: Source[]
  entry: Source
  /** For each module, the module each import specifier resolves to. */
  imports: Map<Source, Map<string, Source>>
  /** For each module, the contents of the files it imports as text, by specifier. */
  texts?: Map<Source, Map<string, string>>
}

/** A module being checked. */
export interface ModuleInfo {
  source: Source
  scope: Scope
  /** Prefix of C names of its functions, which must not clash with other modules. */
  prefix: string
  /** Exported names and the local names they refer to; `from` for re-exports. */
  exports: Map<string, { local: string; from?: ModuleInfo }>
}

/** How a function with optional or rest parameters may be called. */
export interface Signature {
  parameters: readonly ts.ParameterDeclaration[]
  /** The scope of the declaration, in which default values are checked. */
  scope: Scope
  /** Parameters before the first optional or rest one. */
  required: number
  /** The last parameter is a rest parameter, an array of the extra arguments. */
  rest: boolean
}

export interface FuncContext {
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
  /** Checking the top-level code of a module. */
  topLevel?: boolean
  /** In the constructor of a class with a base class: the `super(...)` call it must make. */
  superCall?: ts.CallExpression
  /** What `super(...)` runs after the base class's initialization: the parameter properties and field initializers of the class. */
  superInits?: ir.Expr[]
  /** Enclosing loops and switches, innermost last. */
  loops: LoopContext[]
  nextLoopId: number
  /** Label of a labeled statement whose loop has not been entered yet. */
  pendingLabel?: string
}

/** A class declaration between the passes of checking. */
export interface ClassInfo {
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
  /** The parameters of the constructor, which its body uses; once `init` exists, the constructor itself has copies. */
  ctorParams: ir.Local[]
  methods: [ts.MethodDeclaration | ts.AccessorDeclaration, ir.Func][]
  /** Declared `abstract`: cannot be instantiated. */
  abstract: boolean
  /** The `extends` clause: not resolved yet, being resolved, or resolved into `type.base`. */
  baseState: "none" | "resolving" | "done"
  /** The members: not declared yet, being declared, or declared. */
  members: "pending" | "declaring" | "done"
  /** Subclasses that wait for the members of this class, being declared, to declare theirs. */
  waiting: ClassInfo[]
  /** The field initializers are checked, and the types of fields without annotations known. */
  initsChecked: boolean
  /**
   * For a class with subclasses: the initialization of an allocated instance
   * (parameter properties, field initializers, constructor body), which the
   * constructor and `super(...)` of the subclasses call.
   */
  init?: ir.Func
  /** Names of the members declared `protected` by this class. */
  protected: Set<string>
}

/** The modifiers of a class member. */
export interface MemberFlags {
  private: boolean
  protected: boolean
  readonly: boolean
  abstract: boolean
  override: boolean
  /** Any modifier: a constructor parameter with one declares a field. */
  any: boolean
}

/** A property defined by a getter, a setter, or both. */
export interface Accessor {
  type: Type
  get?: ir.Func
  set?: ir.Func
  private: boolean
}

/** Where an assignment stores: a place, or the setter of an accessor property. */
export type AssignTarget = { lvalue: ir.LValue; type: Type; accessor?: undefined } | { accessor: { object: ir.Expr; property: Accessor; name: string }; type: Type; lvalue?: undefined }

/** A narrowed type of a variable or a field path, keyed by `refKey`. */
export interface Fact {
  key: string
  type: Type
}

/** A checked condition with the facts that hold when it is true or false. */
export interface Condition {
  expr: ir.Expr
  whenTrue: Fact[]
  whenFalse: Fact[]
}

export interface InterfaceInfo {
  decl: ts.InterfaceDeclaration
  type: InterfaceType
  scope: Scope
  state: "declared" | "filling" | "filled"
}

export interface LoopContext {
  id: number
  label?: string
  /** A switch can be exited with `break` but not continued. */
  isSwitch?: boolean
  /** Shared with the IR loop so a labeled jump can mark it. */
  ir: { labeled: boolean }
}

/** An `//ore:` comment before a top-level declaration. */
export interface Directive {
  name: string
  arg: string
  pos: number
  end: number
}
