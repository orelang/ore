import type { Expr } from "@ore/ir"

/**
 * The result of checking an expression.
 *
 * Numeric literals and expressions made only of them are untyped constants
 * with arbitrary precision (as in Go). They get a concrete type when used in
 * a typed context, or a default type (`int`, `f64`) otherwise.
 */
export type Operand =
  | { k: "untyped-int"; value: bigint }
  | { k: "untyped-float"; value: number }
  | { k: "typed"; expr: Expr }
  /** An expression with an already reported error. Converts silently to anything. */
  | { k: "error" }

export const errorOperand: Operand = { k: "error" }
