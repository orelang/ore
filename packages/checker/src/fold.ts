import { types, type ArithOp, type CompareOp } from "@ore/ir"
import type { Operand } from "./operand"

type Untyped = Extract<Operand, { k: "untyped-int" | "untyped-float" }>

/** Folds a binary operation on two untyped constants. Returns an error message on failure. */
export function foldBinary(op: ArithOp | CompareOp, a: Untyped, b: Untyped): Operand | string {
  if (a.k === "untyped-int" && b.k === "untyped-int") return foldInt(op, a.value, b.value)
  if (op === "&" || op === "|" || op === "^" || op === "<<" || op === ">>") {
    return `Operator '${op}' requires integer operands.`
  }
  return foldFloat(op, Number(a.value), Number(b.value))
}

export function foldUnary(op: "-" | "~" | "+", a: Untyped): Operand | string {
  if (op === "+") return a
  if (a.k === "untyped-float") return op === "-" ? { k: "untyped-float", value: -a.value } : "Operator '~' requires an integer operand."
  return { k: "untyped-int", value: op === "-" ? -a.value : ~a.value }
}

const maxShift = 1024n

function foldInt(op: ArithOp | CompareOp, a: bigint, b: bigint): Operand | string {
  const int = (value: bigint): Operand => ({ k: "untyped-int", value })
  switch (op) {
    case "+": return int(a + b)
    case "-": return int(a - b)
    case "*": return int(a * b)
    case "/": return b === 0n ? "Division by zero." : int(a / b)
    case "%": return b === 0n ? "Division by zero." : int(a % b)
    case "&": return int(a & b)
    case "|": return int(a | b)
    case "^": return int(a ^ b)
    case "<<":
    case ">>":
      if (b < 0n) return "Shift count must not be negative."
      if (b > maxShift) return `Shift count ${b} is too large.`
      return int(op === "<<" ? a << b : a >> b)
    default: return bool(compare(op, a, b))
  }
}

function foldFloat(op: ArithOp | CompareOp, a: number, b: number): Operand | string {
  const float = (value: number): Operand => ({ k: "untyped-float", value })
  switch (op) {
    case "+": return float(a + b)
    case "-": return float(a - b)
    case "*": return float(a * b)
    case "/": return b === 0 ? "Division by zero." : float(a / b)
    case "%": return b === 0 ? "Division by zero." : float(a % b)
    case "&":
    case "|":
    case "^":
    case "<<":
    case ">>":
      return `Operator '${op}' requires integer operands.`
    default: return bool(compare(op, a, b))
  }
}

function compare<T extends bigint | number>(op: CompareOp, a: T, b: T): boolean {
  switch (op) {
    case "===": return a === b
    case "!==": return a !== b
    case "<": return a < b
    case "<=": return a <= b
    case ">": return a > b
    case ">=": return a >= b
  }
}

function bool(value: boolean): Operand {
  return { k: "typed", expr: { k: "bool", type: types.bool, value } }
}
