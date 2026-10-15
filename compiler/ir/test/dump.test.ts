import { expect, test } from "bun:test"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { Block, Expr, Func, Local, Module, Stmt } from "../src"
import { arrayOf, dump, quote, types, type FuncType, type InterfaceType, type StructType, type Type, type UnionType } from "../src"

/**
 * A module with every node and type kind and every field, built by hand.
 * compiler/next/test/ir-dump.test.ore builds the same module in Ore; both
 * dumps must equal compiler/next/test/ir-dump.txt.
 */
function sample(): Module {
  const { i64, u64, f64, bool, string, void: voidType } = types
  const fn = (params: Type[], result: Type): FuncType => ({ kind: "func", params, result })
  const block = (body: Stmt[], line?: number): Block => (line === undefined ? { k: "block", body } : { k: "block", body, line })
  const int = (value: bigint, type = i64): Expr => ({ k: "int", type, value })
  const ref = (local: Local): Expr => ({ k: "local", type: local.type, local })

  const other: InterfaceType = { kind: "interface", id: 6, name: "Other<i64>", members: [] }
  const shape: InterfaceType = {
    kind: "interface",
    id: 3,
    name: "Shape",
    members: [
      { k: "field", name: "area", type: f64, readonly: true },
      { k: "method", name: "scale", type: fn([f64], other) },
    ],
  }
  const point: StructType = { kind: "struct", id: 1, name: "Point", nominal: true, fields: [], methods: [] }
  const anon: StructType = { kind: "struct", id: 2, name: undefined, nominal: false, fields: [{ name: "a", type: string, readonly: false }], methods: [] }
  const pair: StructType = { kind: "struct", id: 9, name: "Pair<i64, string>", nominal: false, fields: [{ name: "a", type: i64, readonly: true }, { name: "b", type: string, readonly: false }], methods: [] }
  const maybe: UnionType = { kind: "union", id: 7, members: [i64, types.null], name: "MaybeInt" }
  const mixed: UnionType = {
    kind: "union",
    id: 8,
    members: [{ kind: "literal", value: 'a"b' }, fn([i64], voidType), point, types.null],
  }
  const map = { kind: "map", key: string, value: i64 } as const
  const chan = { kind: "chan", elem: i64 } as const

  const self: Local = { id: 0, name: "this", type: point, mutable: false }
  const norm: Func = {
    name: "Point_norm",
    sourceName: "norm",
    line: 3,
    type: fn([], f64),
    params: [],
    receiver: self,
    body: block([{ k: "return", value: { k: "field", type: f64, object: ref(self), name: "x" } }]),
    exported: false,
  }
  const ctor: Func = {
    name: "Point_new",
    sourceName: "constructor",
    line: 2,
    type: fn([f64], point),
    params: [{ id: 1, name: "x", type: f64, mutable: false }],
    body: block([{ k: "return", value: { k: "alloc", type: point } }]),
    exported: false,
  }
  point.fields = [
    { name: "x", type: f64, readonly: true },
    { name: "secret", type: i64, readonly: false, private: true },
  ]
  point.methods = [{ name: "norm", func: norm, private: false }, { name: "hidden", func: norm, private: true }]
  point.ctor = ctor
  const point3: StructType = { kind: "struct", id: 10, name: "Point3", nominal: true, fields: point.fields, methods: point.methods, base: point }
  const itab = { id: 0, struct: point, iface: shape }

  const puts: Func = {
    name: "puts",
    sourceName: "puts",
    line: 1,
    file: "c.ore",
    extern: true,
    variadic: types.ptr,
    type: fn([string], types.i32),
    params: [{ id: 2, name: "s", type: string, mutable: false }],
    body: block([]),
    exported: false,
  }
  // Another declaration of the C function, as another module may make: references say which one.
  const putsPtr: Func = {
    name: "puts",
    sourceName: "puts",
    line: 2,
    file: "d.ore",
    extern: true,
    type: fn([types.ptr], types.i32),
    params: [{ id: 3, name: "p", type: types.ptr, mutable: false }],
    body: block([]),
    exported: false,
  }

  const n: Local = { id: 10, name: "n", type: i64, mutable: true, assigned: true, captured: true }
  const xs: Local = { id: 11, name: "xs", type: arrayOf(i64), mutable: false }
  const p: Local = { id: 12, name: "p", type: point, mutable: false }
  const s: Local = { id: 13, name: "s", type: shape, mutable: false }
  const m: Local = { id: 14, name: "m", type: maybe, mutable: false }
  const g: Local = { id: 15, name: "g", type: i64, mutable: true, global: true, threadLocal: true, exportName: "g_c" }
  const k: Local = { id: 16, name: "k", type: string, mutable: false }
  const v: Local = { id: 17, name: "v", type: i64, mutable: false }
  const b: Local = { id: 18, name: "b", type: point, mutable: false }
  const c: Local = { id: 19, name: "c", type: chan, mutable: false }
  const f: Local = { id: 20, name: "f", type: fn([i64], voidType), mutable: false }

  const closure: Func = {
    name: "main_lambda_1",
    sourceName: "",
    line: 9,
    type: fn([i64], voidType),
    params: [{ id: 21, name: "y", type: i64, mutable: false }],
    captures: [n],
    body: block([{ k: "expr", expr: { k: "assign", type: i64, target: { k: "local", local: n }, value: ref({ id: 21, name: "y", type: i64, mutable: false }) } }]),
    exported: false,
  }

  const exprs: Expr[] = [
    int(-5n),
    { k: "int", type: u64, value: 18446744073709551615n },
    { k: "float", type: f64, value: 1.5 },
    { k: "float", type: f64, value: -0 },
    { k: "float", type: types.f32, value: 1e21 },
    { k: "bool", type: bool, value: true },
    { k: "string", type: string, value: "tab\tquote\"back\\slash\nnul\u0001é" },
    { k: "string", type: { kind: "literal", value: "lit" }, value: "lit" },
    { k: "assign", type: i64, target: { k: "local", local: n }, op: "+", value: int(1n) },
    { k: "assign", type: i64, target: { k: "element", array: ref(xs), index: int(0n) }, value: int(2n) },
    { k: "assign", type: f64, target: { k: "field", object: ref(p), name: "x" }, value: { k: "float", type: f64, value: 2 } },
    { k: "assign", type: f64, target: { k: "iface-field", value: ref(s), index: 0 }, value: { k: "float", type: f64, value: 3 } },
    { k: "incdec", type: i64, target: { k: "local", local: n }, op: "++", prefix: true },
    { k: "incdec", type: i64, target: { k: "local", local: n }, op: "--", prefix: false },
    { k: "arith", type: i64, op: "<<", left: ref(n), right: int(1n) },
    { k: "compare", type: bool, op: "!==", left: ref(n), right: int(0n) },
    { k: "logical", type: bool, op: "&&", left: { k: "bool", type: bool, value: true }, right: { k: "not", type: bool, operand: { k: "bool", type: bool, value: false } } },
    { k: "unary", type: i64, op: "~", operand: ref(n) },
    { k: "convert", type: f64, value: ref(n) },
    { k: "call", type: types.i32, func: puts, args: [{ k: "string", type: string, value: "hi" }] },
    { k: "call", type: types.i32, func: putsPtr, args: [] },
    { k: "builtin", type: voidType, name: "console.log", args: [ref(n)] },
    { k: "builtin", type: i64, name: "JSON.parse", args: [{ k: "string", type: string, value: "1" }], error: { ctor, itab }, typeArgs: [i64, maybe] },
    { k: "cond", type: i64, cond: { k: "bool", type: bool, value: true }, then: int(1n), else: int(2n) },
    { k: "concat", type: string, parts: [{ k: "string", type: string, value: "n=" }, ref(n)] },
    { k: "index", type: i64, target: ref(xs), index: int(0n) },
    { k: "len", type: i64, value: ref(xs) },
    { k: "slice", type: arrayOf(i64), value: ref(xs) },
    { k: "slice", type: arrayOf(i64), value: ref(xs), start: int(1n), end: int(2n) },
    { k: "array", type: arrayOf(fn([], voidType)), elems: [] },
    { k: "push", type: i64, array: ref(xs), values: [int(1n), int(2n)] },
    { k: "pop", type: i64, array: ref(xs) },
    { k: "object", type: anon, fields: [{ name: "a", value: { k: "string", type: string, value: "x" } }] },
    { k: "method-call", type: f64, func: norm, receiver: ref(p), args: [] },
    { k: "method-call", type: f64, func: norm, receiver: ref(p), args: [], virtual: true },
    { k: "to-iface", type: shape, value: ref(p), itab },
    { k: "to-iface", type: shape, value: ref(s), indices: [1, 0] },
    { k: "iface-field", type: f64, value: ref(s), index: 0 },
    { k: "iface-call", type: other, value: ref(s), index: 1, method: fn([f64], other), args: [{ k: "float", type: f64, value: 2 }] },
    { k: "null", type: maybe },
    { k: "recast", type: i64, value: ref(m) },
    { k: "is-null", type: bool, value: ref(m) },
    { k: "optional", type: maybe, value: ref(m), binding: { id: 22, name: "o", type: i64, mutable: false }, body: int(1n) },
    { k: "coalesce", type: i64, value: ref(m), fallback: int(0n) },
    { k: "union-field", type: f64, value: ref(m), name: "x" },
    { k: "typeof", type: string, value: ref(m) },
    { k: "is", type: bool, value: ref(m), member: i64 },
    { k: "is", type: bool, value: ref(m), member: point, via: shape },
    { k: "downcast", type: point, value: ref(s) },
    { k: "map", op: "new", type: map, mapType: map },
    { k: "map", op: "set", type: map, mapType: map, map: ref(k), key: ref(k), value: int(1n) },
    { k: "func-ref", type: fn([string], types.i32), func: puts },
    { k: "closure", type: fn([i64], voidType), func: closure },
    { k: "call-value", type: voidType, callee: ref(f), args: [int(1n)] },
    { k: "bound-method", type: fn([], f64), receiver: ref(p), func: norm },
    { k: "bound-method", type: fn([], f64), receiver: ref(p), func: norm, virtual: true },
    { k: "bound-method", type: fn([f64], other), receiver: ref(s), index: 1 },
    { k: "array-method", method: "map", type: arrayOf(i64), array: ref(xs), args: [ref(f)], arity: 1 },
    { k: "array-method", method: "join", type: string, array: ref(xs), args: [] },
    { k: "string-method", method: "indexOf", type: i64, value: ref(k), args: [ref(k)] },
    { k: "chan", op: "new", type: chan, chanType: chan, value: int(4n) },
    { k: "chan", op: "on-send", type: types.SelectCase, chanType: chan, chan: ref(c), value: int(1n), handler: ref(f), arity: 0 },
    { k: "bind", type: i64, locals: [{ local: v, init: int(7n) }], body: ref(v) },
    { k: "seq", type: i64, exprs: [int(1n), int(2n)] },
  ]

  const body: Stmt[] = [
    { k: "let", local: n, init: int(0n), line: 5 },
    { k: "let", local: b },
    {
      k: "if",
      cond: { k: "bool", type: bool, value: true },
      then: block([{ k: "break" }]),
      else: { k: "return", line: 6 },
      line: 6,
    },
    { k: "if", cond: { k: "bool", type: bool, value: false }, then: block([], 7) },
    {
      k: "loop",
      id: 1,
      labeled: true,
      perIteration: [v],
      cond: { k: "compare", type: bool, op: "<", left: ref(v), right: int(3n) },
      condAfter: false,
      update: { k: "incdec", type: i64, target: { k: "local", local: v }, op: "++", prefix: false },
      body: block([{ k: "continue", target: 1 }, { k: "break", target: 1 }, { k: "continue" }]),
    },
    { k: "loop", id: 2, labeled: false, condAfter: true, body: block([]) },
    { k: "for-of", id: 3, labeled: false, local: v, iterable: ref(xs), body: block([]) },
    { k: "for-of", id: 4, labeled: true, local: k, value: v, iterable: ref(k), body: block([]) },
    {
      k: "switch",
      id: 5,
      labeled: false,
      exhaustive: true,
      local: k,
      value: { k: "string", type: string, value: "a" },
      clauses: [{ test: { k: "string", type: string, value: "a" }, body: [{ k: "break" }] }, { body: [] }],
    },
    {
      k: "using",
      local: s,
      init: ref(s),
      dispose: { k: "expr", expr: { k: "call", type: voidType, func: norm, args: [] } },
      body: [{ k: "return", value: int(1n) }],
    },
    ...exprs.map((expr): Stmt => ({ k: "expr", expr })),
  ]

  const main: Func = {
    name: "main",
    sourceName: "main",
    line: 4,
    type: fn([arrayOf(i64), point, shape, maybe, chan, fn([i64], voidType)], voidType),
    params: [xs, p, s, m, c, f],
    body: block(body, 4),
    exported: true,
    attributes: { noinline: true, inline: true, cold: true, exportName: "ore_main", runtime: "main", naked: true },
  }
  const init: Func = {
    name: "init_test",
    sourceName: "<init>",
    line: 1,
    type: fn([], voidType),
    params: [],
    body: block([{ k: "let", local: g, init: int(1n), line: 1 }]),
    exported: false,
    attributes: {},
  }
  return {
    file: "test.ore",
    functions: [norm, ctor, puts, putsPtr, closure, main],
    inits: [init],
    structs: [point, anon, pair, point3],
    itabs: [itab],
    unions: [maybe, mixed],
  }
}

test("the dump of a module equals compiler/next/test/ir-dump.txt", () => {
  const path = join(import.meta.dir, "../../next/test/ir-dump.txt")
  // UPDATE=1 bun test compiler/ir rewrites the expected dump after a change of the format.
  if (process.env.UPDATE) writeFileSync(path, dump(sample()))
  expect(dump(sample())).toBe(readFileSync(path, "utf8"))
})

test("quote escapes quotes, backslashes and control characters", () => {
  expect(quote('a"b\\c\n\r\t\u0001é')).toBe('"a\\"b\\\\c\\n\\r\\t\\u0001é"')
})
