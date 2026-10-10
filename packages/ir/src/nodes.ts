import type { ArrayType, BoolType, FloatType, FuncType, IntType, StringType, Type } from "./types"

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

export type Stmt = Block | LetStmt | ExprStmt | IfStmt | LoopStmt | ForOfStmt | BreakStmt | ContinueStmt | ReturnStmt

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

/** Exits the innermost loop, or the loop with id `target` for a labeled break. */
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
