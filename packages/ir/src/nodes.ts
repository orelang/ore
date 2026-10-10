import type { BoolType, FloatType, FuncType, IntType, StringType, Type } from "./types"

/**
 * Typed, name-resolved, structured IR produced by the checker.
 *
 * All implicit behavior of the source is explicit here: numeric literals have
 * concrete types, conversions are `convert` nodes, compound assignments are
 * expanded, and every local has a unique id.
 */

export interface Module {
  functions: Func[]
}

export interface Func {
  /** Unique symbol name, safe to use in the target language. */
  name: string
  /** Name as written in the source. */
  sourceName: string
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

export type Stmt = Block | LetStmt | ExprStmt | IfStmt | LoopStmt | BreakStmt | ContinueStmt | ReturnStmt

export interface Block {
  k: "block"
  body: Stmt[]
}

export interface LetStmt {
  k: "let"
  local: Local
  init: Expr
}

export interface ExprStmt {
  k: "expr"
  expr: Expr
}

export interface IfStmt {
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
export interface LoopStmt {
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

/** Exits the innermost loop, or the loop with id `target` for a labeled break. */
export interface BreakStmt {
  k: "break"
  target?: number
}

/** Continues the innermost loop, or the loop with id `target` for a labeled continue. */
export interface ContinueStmt {
  k: "continue"
  target?: number
}

export interface ReturnStmt {
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

export interface Assign {
  k: "assign"
  type: Type
  target: Local
  value: Expr
}

export interface IncDec {
  k: "incdec"
  type: IntType | FloatType
  target: Local
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
