export type IntName = "i8" | "i16" | "i32" | "i64" | "u8" | "u16" | "u32" | "u64"
export type FloatName = "f32" | "f64"

export interface IntType {
  readonly kind: "int"
  readonly name: IntName
  readonly bits: 8 | 16 | 32 | 64
  readonly signed: boolean
}

export interface FloatType {
  readonly kind: "float"
  readonly name: FloatName
  readonly bits: 32 | 64
}

export interface BoolType {
  readonly kind: "bool"
}

export interface StringType {
  readonly kind: "string"
}

export interface VoidType {
  readonly kind: "void"
}

/** The type of expressions that never complete, such as `panic(...)`. */
export interface NeverType {
  readonly kind: "never"
}

export interface FuncType {
  readonly kind: "func"
  readonly params: readonly Type[]
  readonly result: Type
}

export type PrimitiveType = IntType | FloatType | BoolType | StringType | VoidType | NeverType
export type Type = PrimitiveType | FuncType

const int = (name: IntName, bits: IntType["bits"], signed: boolean): IntType => ({ kind: "int", name, bits, signed })

/** Primitive types are singletons and can be compared by identity. */
export const types = {
  i8: int("i8", 8, true),
  i16: int("i16", 16, true),
  i32: int("i32", 32, true),
  i64: int("i64", 64, true),
  u8: int("u8", 8, false),
  u16: int("u16", 16, false),
  u32: int("u32", 32, false),
  u64: int("u64", 64, false),
  f32: { kind: "float", name: "f32", bits: 32 } as FloatType,
  f64: { kind: "float", name: "f64", bits: 64 } as FloatType,
  bool: { kind: "bool" } as BoolType,
  string: { kind: "string" } as StringType,
  void: { kind: "void" } as VoidType,
  never: { kind: "never" } as NeverType,
} as const

export function isNumeric(t: Type): t is IntType | FloatType {
  return t.kind === "int" || t.kind === "float"
}

export function sameType(a: Type, b: Type): boolean {
  if (a === b) return true
  if (a.kind !== "func" || b.kind !== "func") return false
  return a.params.length === b.params.length
    && a.params.every((p, i) => sameType(p, b.params[i]!))
    && sameType(a.result, b.result)
}

export function typeToString(t: Type): string {
  switch (t.kind) {
    case "int":
    case "float":
      return t.name
    case "func":
      return `(${t.params.map(typeToString).join(", ")}) => ${typeToString(t.result)}`
    default:
      return t.kind
  }
}

/** Smallest and largest value of an integer type. */
export function intRange(t: IntType): [bigint, bigint] {
  const bits = BigInt(t.bits)
  return t.signed ? [-(1n << (bits - 1n)), (1n << (bits - 1n)) - 1n] : [0n, (1n << bits) - 1n]
}
