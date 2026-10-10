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

/** `T[]`: a reference to a growable array. */
export interface ArrayType {
  readonly kind: "array"
  readonly elem: Type
}

import type { Func } from "./nodes"

export interface Field {
  readonly name: string
  readonly type: Type
  readonly readonly: boolean
  /** Accessible only inside the class that declares it. */
  readonly private?: boolean
}

export interface Method {
  readonly name: string
  readonly func: Func
  readonly private: boolean
}

/**
 * A heap-allocated record, used through references.
 *
 * A class is nominal: each declaration is its own type, with fields in
 * declaration order. Anonymous object types (`{ x: f64 }`, object literals)
 * are interned by shape, so two of them are the same type exactly when they
 * are the same object; their fields are sorted by name.
 */
export interface StructType {
  readonly kind: "struct"
  /** Unique per program; used for names in generated code. */
  readonly id: number
  /** Class name, a type alias name, or undefined for an anonymous shape. */
  name: string | undefined
  /** Whether this is a class. */
  readonly nominal: boolean
  fields: Field[]
  /** Methods of a class; empty for object types. */
  methods: Method[]
  /** The constructor of a class: returns a new instance. */
  ctor?: Func
}

export type InterfaceMember =
  | { readonly k: "field"; readonly name: string; readonly type: Type; readonly readonly: boolean }
  | { readonly k: "method"; readonly name: string; readonly type: FuncType }

/**
 * A structural interface. A value is a reference to any struct that has the
 * members, paired with a table that holds, for each member in `members`
 * order, the field offset or the method.
 */
export interface InterfaceType {
  readonly kind: "interface"
  readonly id: number
  readonly name: string
  /** Sorted by name; the layout of the table. */
  members: InterfaceMember[]
}

/** The type of `null`; appears in unions such as `Node | null`. */
export interface NullType {
  readonly kind: "null"
}

/**
 * A union of two or more types. Members are normalized: no nested unions, no
 * duplicates, and a canonical order, so equal unions have equal members.
 */
export interface UnionType {
  readonly kind: "union"
  /** Unique per program; used for names in generated code. */
  readonly id: number
  readonly members: readonly Type[]
}

export type PrimitiveType = IntType | FloatType | BoolType | StringType | VoidType | NeverType | NullType
export type Type = PrimitiveType | FuncType | ArrayType | StructType | InterfaceType | UnionType

export function findField(t: StructType, name: string): Field | undefined {
  return t.fields.find((f) => f.name === name)
}

export function findMethod(t: StructType, name: string): Method | undefined {
  return t.methods.find((m) => m.name === name)
}

export function arrayOf(elem: Type): ArrayType {
  return { kind: "array", elem }
}

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
  null: { kind: "null" } as NullType,
} as const

export function isNumeric(t: Type): t is IntType | FloatType {
  return t.kind === "int" || t.kind === "float"
}

/** Interface pairs assumed equal while comparing recursive interfaces. */
const assumed: [InterfaceType, InterfaceType][] = []

/** Whether two interfaces have the same members; recursive interfaces are compared coinductively. */
function sameInterface(a: InterfaceType, b: InterfaceType): boolean {
  if (a.members.length !== b.members.length) return false
  if (assumed.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) return true
  assumed.push([a, b])
  try {
    return a.members.every((m, i) => {
      const n = b.members[i]!
      return m.k === n.k && m.name === n.name && sameType(m.type, n.type)
    })
  } finally {
    assumed.pop()
  }
}

export function sameType(a: Type, b: Type): boolean {
  if (a === b) return true
  if (a.kind === "array" && b.kind === "array") return sameType(a.elem, b.elem)
  if (a.kind === "interface" && b.kind === "interface") return sameInterface(a, b)
  if (a.kind === "union" && b.kind === "union") {
    return a.members.length === b.members.length && a.members.every((m, i) => sameType(m, b.members[i]!))
  }
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
    case "array":
      return t.elem.kind === "func" ? `(${typeToString(t.elem)})[]` : `${typeToString(t.elem)}[]`
    case "struct":
      return t.name ?? `{ ${t.fields.map((f) => `${f.readonly ? "readonly " : ""}${f.name}: ${typeToString(f.type)}`).join("; ")} }`
    case "interface":
      return t.name
    case "union":
      return t.members.map((m) => (m.kind === "func" ? `(${typeToString(m)})` : typeToString(m))).join(" | ")
    default:
      return t.kind
  }
}

/** Smallest and largest value of an integer type. */
export function intRange(t: IntType): [bigint, bigint] {
  const bits = BigInt(t.bits)
  return t.signed ? [-(1n << (bits - 1n)), (1n << (bits - 1n)) - 1n] : [0n, (1n << bits) - 1n]
}

/** A stable key of a type, for interning and canonical ordering. */
export function typeKey(type: Type): string {
  switch (type.kind) {
    case "array":
      return `${typeKey(type.elem)}[]`
    case "struct":
      return `#${type.id}`
    case "interface":
      return `@${type.id}`
    case "union":
      return type.members.map(typeKey).join("|")
    case "func":
      return `(${type.params.map(typeKey).join(",")})=>${typeKey(type.result)}`
    default:
      return typeToString(type)
  }
}

/** Whether values of a type are references that can be null without a tag. */
export function isReference(type: Type): boolean {
  return type.kind === "struct" || type.kind === "array" || type.kind === "interface" || type.kind === "string"
}

/**
 * How a union is represented at run time:
 * - `nullable`: one reference type and `null`, as the reference or null;
 * - `tagged`: a tag selecting one of `slots`, with the value of that slot.
 *   `null` has a slot without a value.
 */
export type UnionRepr = { k: "nullable"; base: Type } | { k: "tagged"; slots: readonly Type[] }

export function unionRepr(u: UnionType): UnionRepr {
  const others = u.members.filter((m) => m.kind !== "null")
  if (others.length === 1 && others.length < u.members.length && isReference(others[0]!)) return { k: "nullable", base: others[0]! }
  return { k: "tagged", slots: u.members }
}

/** The members of a type: those of a union, or the type itself. */
export function membersOf(type: Type): readonly Type[] {
  return type.kind === "union" ? type.members : [type]
}