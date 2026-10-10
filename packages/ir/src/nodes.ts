import type { ArrayType, BoolType, FloatType, FuncType, IntType, InterfaceType, StringType, StructType, Type, UnionType } from "./types"

/**
 * Typed, name-resolved, structured IR produced by the checker.
 *
 * All implicit behavior of the source is explicit here: numeric literals have
 * concrete types, conversions are `convert` nodes, compound assignments are
 * expanded, and every local has a unique id.
 */

export interface Module {
  /** Path of the source file, as given to the compiler. */
  file: string
  functions: Func[]
  /** Every struct type used by the module. */
  structs: StructType[]
  /** Interface tables of structs converted to interfaces. */
  itabs: Itab[]
  /** Every union type used by the module. */
  unions: UnionType[]
}

/** The table for a struct used as an interface; see `InterfaceType`. */
export interface Itab {
  id: number
  struct: StructType
  iface: InterfaceType
}

export interface Func {
  /** Unique symbol name, safe to use in the target language. */
  name: string
  /** Name as written in the source. */
  sourceName: string
  /** 1-based source line of the declaration. */
  line: number
  type: FuncType
  params: Local[]
  /** `this` of a method, passed before the parameters. */
  receiver?: Local
  body: Block
  exported: boolean
}

export interface Local {
  id: number
  name: string
  type: Type
  mutable: boolean
}

interface StmtBase {
  /** 1-based source line, for debug info and stack traces. */
  line?: number
}

export type Stmt = Block | LetStmt | ExprStmt | IfStmt | LoopStmt | ForOfStmt | SwitchStmt | BreakStmt | ContinueStmt | ReturnStmt

export interface Block extends StmtBase {
  k: "block"
  body: Stmt[]
}

export interface LetStmt extends StmtBase {
  k: "let"
  local: Local
  init: Expr
}

export interface ExprStmt extends StmtBase {
  k: "expr"
  expr: Expr
}

export interface IfStmt extends StmtBase {
  k: "if"
  cond: Expr
  then: Stmt
  else?: Stmt
}

/**
 * A loop. `while (c) s` has `cond`; `for (;c;u) s` has `cond` and `update`;
 * `do s while (c)` has `cond` and `condAfter`; a missing `cond` loops forever.
 * `continue` jumps to `update`, then to the condition check.
 */
export interface LoopStmt extends StmtBase {
  k: "loop"
  /** Unique within the function; the target of labeled `break` / `continue`. */
  id: number
  /** Set when a labeled `break` / `continue` targets this loop. */
  labeled: boolean
  cond?: Expr
  condAfter: boolean
  update?: Expr
  body: Stmt
}

/**
 * `for (const x of iterable)`: over array elements, or over the runes (`i32`)
 * of a string. The array length is re-read on every iteration.
 */
export interface ForOfStmt extends StmtBase {
  k: "for-of"
  id: number
  labeled: boolean
  local: Local
  iterable: Expr
  body: Stmt
}

/**
 * `switch`: `value` is stored in `local`, then the `test` of each clause is
 * evaluated in order until one is true (a clause without `test` is
 * `default`, chosen when none matches). Execution starts at that clause and
 * falls through the following ones until a `break`.
 */
export interface SwitchStmt extends StmtBase {
  k: "switch"
  id: number
  labeled: boolean
  local: Local
  value: Expr
  clauses: { test?: Expr; body: Stmt[] }[]
}

/** Exits the innermost loop or switch, or the one with id `target` for a labeled break. */
export interface BreakStmt extends StmtBase {
  k: "break"
  target?: number
}

/** Continues the innermost loop, or the loop with id `target` for a labeled continue. */
export interface ContinueStmt extends StmtBase {
  k: "continue"
  target?: number
}

export interface ReturnStmt extends StmtBase {
  k: "return"
  value?: Expr
}

export type ArithOp = "+" | "-" | "*" | "/" | "%" | "&" | "|" | "^" | "<<" | ">>"
export type CompareOp = "===" | "!==" | "<" | "<=" | ">" | ">="

export type Expr =
  | IntLit
  | FloatLit
  | BoolLit
  | StringLit
  | LocalRef
  | Assign
  | IncDec
  | Arith
  | Compare
  | Logical
  | Unary
  | Not
  | Convert
  | Call
  | BuiltinCall
  | Conditional
  | Concat
  | Index
  | Len
  | Slice
  | ArrayLit
  | Push
  | Pop
  | ObjectLit
  | FieldGet
  | Alloc
  | MethodCall
  | ToIface
  | IfaceField
  | IfaceCall
  | NullLit
  | Recast
  | IsNull
  | Optional
  | Coalesce

export interface IntLit {
  k: "int"
  type: IntType
  value: bigint
}

export interface FloatLit {
  k: "float"
  type: FloatType
  value: number
}

export interface BoolLit {
  k: "bool"
  type: BoolType
  value: boolean
}

export interface StringLit {
  k: "string"
  type: StringType
  value: string
}

export interface LocalRef {
  k: "local"
  type: Type
  local: Local
}

/** A place that can be assigned to. */
export type LValue =
  | { k: "local"; local: Local }
  /** A bounds-checked array element. */
  | { k: "element"; array: Expr; index: Expr }
  /** A field of a struct reference. */
  | { k: "field"; object: Expr; name: string }
  /** The field at `index` of an interface's members. */
  | { k: "iface-field"; value: Expr; index: number }

/**
 * Assignment. With `op` it is a compound assignment `target op= value`, where
 * `value` is already converted as the right operand of `op` and the target is
 * evaluated once. Compound assignments to locals are expanded by the checker.
 */
export interface Assign {
  k: "assign"
  type: Type
  target: LValue
  op?: ArithOp
  value: Expr
}

export interface IncDec {
  k: "incdec"
  type: IntType | FloatType
  target: LValue
  op: "++" | "--"
  prefix: boolean
}

/**
 * Arithmetic and bitwise operations. Both operands have the result type,
 * except the right operand of `<<` / `>>`, which may be any integer type.
 */
export interface Arith {
  k: "arith"
  type: IntType | FloatType
  op: ArithOp
  left: Expr
  right: Expr
}

export interface Compare {
  k: "compare"
  type: BoolType
  op: CompareOp
  left: Expr
  right: Expr
}

export interface Logical {
  k: "logical"
  type: BoolType
  op: "&&" | "||"
  left: Expr
  right: Expr
}

export interface Unary {
  k: "unary"
  type: IntType | FloatType
  op: "-" | "~"
  operand: Expr
}

export interface Not {
  k: "not"
  type: BoolType
  operand: Expr
}

/** Numeric conversion between distinct numeric types. */
export interface Convert {
  k: "convert"
  type: IntType | FloatType
  value: Expr
}

export interface Call {
  k: "call"
  type: Type
  func: Func
  args: Expr[]
}

export type BuiltinName = "println" | "print" | "panic"

export interface BuiltinCall {
  k: "builtin"
  type: Type
  name: BuiltinName
  args: Expr[]
}

export interface Conditional {
  k: "cond"
  type: Type
  cond: Expr
  then: Expr
  else: Expr
}

/** String concatenation; non-string parts are formatted like `print` does. */
export interface Concat {
  k: "concat"
  type: StringType
  parts: Expr[]
}

/** Bounds-checked element read: an array element or a byte of a string. The index has any integer type. */
export interface Index {
  k: "index"
  type: Type
  target: Expr
  index: Expr
}

/** Length of an array, or of a string in bytes. */
export interface Len {
  k: "len"
  type: IntType
  value: Expr
}

/** JavaScript `slice`: a substring of byte offsets, or a copy of a range of an array. */
export interface Slice {
  k: "slice"
  type: Type
  value: Expr
  start?: Expr
  end?: Expr
}

export interface ArrayLit {
  k: "array"
  type: ArrayType
  elems: Expr[]
}

/** `array.push(...values)`; evaluates to the new length. */
export interface Push {
  k: "push"
  type: IntType
  array: Expr
  values: Expr[]
}

/** `array.pop()`; panics on an empty array. */
export interface Pop {
  k: "pop"
  type: Type
  array: Expr
}

/** Allocates a struct and initializes its fields in source order. */
export interface ObjectLit {
  k: "object"
  type: StructType
  fields: { name: string; value: Expr }[]
}

export interface FieldGet {
  k: "field"
  type: Type
  object: Expr
  name: string
}

/** A new zeroed instance of a struct; used at the start of constructors. */
export interface Alloc {
  k: "alloc"
  type: StructType
}

/** A direct call of a class method. */
export interface MethodCall {
  k: "method-call"
  type: Type
  func: Func
  receiver: Expr
  args: Expr[]
}

/**
 * Converts a struct to an interface with a static table, or an interface to
 * another interface by picking table entries: entry `i` of the result is
 * entry `indices[i]` of the source.
 */
export interface ToIface {
  k: "to-iface"
  type: InterfaceType
  value: Expr
  itab?: Itab
  indices?: number[]
}

/** Reads the field at `index` of an interface's members. */
export interface IfaceField {
  k: "iface-field"
  type: Type
  value: Expr
  index: number
}

/** Calls the method at `index` of an interface's members. */
export interface IfaceCall {
  k: "iface-call"
  type: Type
  value: Expr
  index: number
  method: FuncType
  args: Expr[]
}

/** `null` of a union type that contains `null`. */
export interface NullLit {
  k: "null"
  type: UnionType
}

/**
 * Converts between a union and its members: a member to a union containing it
 * (or containing all its members), or a union to a member or a smaller union.
 * Narrowing checks at run time that the value is one of the target's members
 * and panics otherwise.
 */
export interface Recast {
  k: "recast"
  type: Type
  value: Expr
}

/** Whether a value of a union type is `null`. */
export interface IsNull {
  k: "is-null"
  type: BoolType
  value: Expr
}

/**
 * Optional chaining `value?.…`: `null` if `value` is null, else `body`
 * evaluated with `binding` set to the non-null value and converted to `type`.
 */
export interface Optional {
  k: "optional"
  type: UnionType
  value: Expr
  binding: Local
  body: Expr
}

/** `value ?? fallback`: the non-null value, or `fallback`. */
export interface Coalesce {
  k: "coalesce"
  type: Type
  value: Expr
  fallback: Expr
}
