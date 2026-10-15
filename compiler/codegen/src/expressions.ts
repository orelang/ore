// Expressions and unions.
import * as ir from "@ore/ir"
import { isStringLike, typeofName, typeToString, types, unionRepr, type IntType, type Type, type UnionType } from "@ore/ir"
import { floatConstant, globalName, sizeOf, voidValue, type V } from "./ll"
import { STR, FN, IFACE, ARRAY, DIVIDE_BY_ZERO } from "./context"
import { typeId, memberIndex } from "./helpers"
import { FunctionEmitter } from "./functions"

export abstract class ExpressionEmitter extends FunctionEmitter {
  expr(e: ir.Expr): V {
    switch (e.k) {
      case "int":
        return this.int(e.type, e.value)
      case "float":
        return { ty: this.lt(e.type), v: floatConstant(e.value, e.type.bits) }
      case "bool":
        return { ty: "i1", v: e.value ? "true" : "false" }
      case "string":
        return this.str(e.value)
      case "local":
        return this.read(e.local)
      case "assign":
        return this.assign(e)
      case "incdec":
        return this.incdec(e)
      case "arith":
        return this.arith(e.op, this.expr(e.left), this.expr(e.right), e.type, e.right.type)
      case "compare":
        return this.compare(e.op, this.expr(e.left), this.expr(e.right), e.left.type)
      case "logical":
        return this.logical(e)
      case "unary": {
        const v = this.expr(e.operand)
        if (e.op === "~") return this.b.value(v.ty, `xor ${v.ty} ${v.v}, -1`)
        if (e.type.kind === "float") return this.b.value(v.ty, `fneg ${v.ty} ${v.v}`)
        return this.b.value(v.ty, `sub ${v.ty} 0, ${v.v}`)
      }
      case "not":
        return this.b.value("i1", `xor i1 ${this.expr(e.operand).v}, true`)
      case "convert":
        return this.convert(this.expr(e.value), e.value.type, e.type)
      case "call":
        return this.call(e)
      case "method-call": {
        const receiver = this.expr(e.receiver)
        const args = e.args.map((a) => this.expr(a))
        return this.callDirect(e.func.name, this.lt(e.type), [receiver, ...args])
      }
      case "builtin":
        return this.builtin(e)
      case "cond":
        // A condition known at compile time, such as one on `target.os`, compiles only the branch taken.
        if (e.cond.k === "bool") return this.expr(e.cond.value ? e.then : e.else)
        return this.choose(this.expr(e.cond), () => this.expr(e.then), () => this.expr(e.else), this.lt(e.type))
      case "concat":
        return this.concat(e.parts.map((p) => [this.expr(p), p.type] as const))
      case "index": {
        const target = this.expr(e.target)
        const index = this.intToI64(this.expr(e.index), e.index.type)
        if (e.target.type.kind === "string") return this.fromI64(this.rt("ore_rt_str_at", [target, index]), "i8")
        const ptr = this.rt("ore_rt_array_at", [target, index, { ty: "i64", v: sizeOf(this.mt(e.type)) }])
        return this.load(ptr.v, e.type)
      }
      case "len": {
        const v = this.expr(e.value)
        if (e.value.type.kind === "string") return this.extract(v, 1, "i64")
        return this.b.value("i64", `load i64, ptr ${this.field(v.v, ARRAY, 1)}`)
      }
      case "slice": {
        const value = this.expr(e.value)
        const start = e.start ? this.intToI64(this.expr(e.start), e.start.type) : this.i64(0)
        const end = e.end ? this.intToI64(this.expr(e.end), e.end.type) : this.i64(BigInt("9223372036854775807"))
        if (e.type.kind === "string") return this.rt("ore_rt_str_slice", [value, start, end])
        return this.rt("ore_rt_array_slice", [value, { ty: "i64", v: sizeOf(this.mt((e.type as ir.ArrayType).elem)) }, start, end])
      }
      case "array": {
        const elem = this.mt(e.type.elem)
        const values = e.elems.map((x) => this.expr(x))
        const array = this.rt("ore_rt_array_new", [{ ty: "i64", v: sizeOf(elem) }, this.i64(values.length)])
        if (values.length === 0) return array
        const data = this.b.value("ptr", `load ptr, ptr ${this.field(array.v, ARRAY, 0)}`)
        values.forEach((v, i) => this.store(v, this.b.value("ptr", `getelementptr ${elem}, ptr ${data.v}, i64 ${i}`).v, e.type.elem))
        return array
      }
      case "push": {
        // The array and all values are evaluated before appending, as in JavaScript.
        const type = (e.array.type as ir.ArrayType).elem
        const array = this.expr(e.array)
        const values = e.values.map((v) => this.expr(v))
        for (const v of values) this.store(v, this.rt("ore_rt_array_push", [array, { ty: "i64", v: sizeOf(this.mt(type)) }]).v, type)
        return this.b.value("i64", `load i64, ptr ${this.field(array.v, ARRAY, 1)}`)
      }
      case "pop":
        return this.load(this.rt("ore_rt_array_pop", [this.expr(e.array), { ty: "i64", v: sizeOf(this.mt(e.type)) }]).v, e.type)
      case "object": {
        const s = this.structType(e.type)
        const object = this.slot(e) ?? this.alloc(s).v
        for (const f of e.fields) {
          const index = e.type.fields.findIndex((x) => x.name === f.name)
          this.store(this.expr(f.value), this.field(object, s, index), e.type.fields[index]!.type)
        }
        return { ty: "ptr", v: object }
      }
      case "field": {
        const object = this.expr(e.object)
        return this.load(this.fieldPtr(object.v, e.object.type as ir.StructType, e.name), e.type)
      }
      case "alloc":
        if (this.at) return { ty: "ptr", v: "%mem" }
        return this.alloc(this.structType(e.type))
      case "to-iface": {
        const value = this.expr(e.value!)
        if (e.itab) return this.aggregate(IFACE, [value, { ty: "ptr", v: `@itab.${e.itab.id}` }])
        const indices = e.indices!
        const table = indices.length === 0 ? "null" : this.constArray("i32", indices.map(String))
        return this.rt("ore_rt_iface_project", [value, this.i64(indices.length), { ty: "ptr", v: table }])
      }
      case "iface-field": {
        const value = this.expr(e.value)
        return this.load(this.ifaceField(value, e.index), e.type)
      }
      case "iface-call": {
        // The receiver is evaluated once, before the arguments.
        const value = this.expr(e.value)
        const args = e.args.map((a) => this.expr(a))
        const itab = this.extract(value, 1, "ptr")
        const entry = this.b.value("ptr", `getelementptr ptr, ptr ${itab.v}, i64 ${e.index + 1}`)
        const fn = this.b.value("ptr", `load ptr, ptr ${entry.v}`)
        return this.callIndirect(fn.v, this.lt(e.method.result), [this.extract(value, 0, "ptr"), ...args])
      }
      case "null":
        return this.inject(e.type, e.type.members.findIndex((m) => m.kind === "null"), undefined)
      case "recast":
        return this.recast(this.expr(e.value), e.value.type, e.type)
      case "is-null": {
        const v = this.expr(e.value)
        return this.isNullValue(e.value.type as UnionType, v)
      }
      case "optional":
        return this.optional(e)
      case "coalesce": {
        const from = e.value.type as UnionType
        const v = this.expr(e.value)
        return this.choose(
          this.isNullValue(from, v),
          () => this.expr(e.fallback),
          () => this.recast(v, from, e.type),
          this.lt(e.type),
        )
      }
      case "union-field":
        return this.unionField(e)
      case "typeof": {
        const from = e.value.type
        const v = this.expr(e.value)
        if (from.kind !== "union") return this.str(typeofName(from))
        return this.b.value(STR, `call ${STR} ${this.typeofer(from)}(${v.ty} ${v.v})`)
      }
      case "is": {
        const v = this.expr(e.value)
        const id = this.i64(typeId(e.member as ir.StructType))
        if (e.value.type.kind === "interface") return this.ifaceIs(v, id)
        const u = e.value.type as UnionType
        if (!e.via) return this.slotTest(u, v, memberIndex(u, e.member))
        const i = memberIndex(u, e.via)
        return this.choose(this.slotTest(u, v, i), () => this.ifaceIs(this.payload(u, v, i), id), () => ({ ty: "i1", v: "false" }), "i1")
      }
      case "downcast": {
        const v = this.expr(e.value)
        this.check(this.ifaceIs(v, this.i64(typeId(e.type))), `value is not a ${e.type.name}`)
        return this.extract(v, 0, "ptr")
      }
      case "map":
        return this.mapOp(e)
      case "chan":
        return this.chanOp(e)
      case "func-ref":
        return this.aggregate(FN, [{ ty: "ptr", v: this.thunk(e.func) }, { ty: "ptr", v: "null" }])
      case "closure":
        return this.closure(e)
      case "call-value": {
        // The callee is evaluated before the arguments.
        const f = this.expr(e.callee)
        const args = e.args.map((a) => this.expr(a))
        return this.callClosure(f, e.callee.type as ir.FuncType, args)
      }
      case "bound-method":
        return this.bound(e)
      case "array-method":
        return this.arrayMethod(e)
      case "string-method":
        return this.stringMethod(e)
      case "seq": {
        let last: V = voidValue
        for (const x of e.exprs) last = this.expr(x)
        return last
      }
      case "bind":
        for (const b of e.locals) this.declare(b.local, this.expr(b.init))
        return this.expr(e.body)
    }
  }

  protected fieldPtr(object: string, s: ir.StructType, name: string): string {
    return this.field(object, this.structType(s), s.fields.findIndex((f) => f.name === name))
  }

  /** A pointer to a constant array of `ty` elements. */
  protected constArray(ty: string, values: string[]): string {
    const name = `@const.${this.helpers.size}.${this.defs.size}.${this.strings.size}.${this.decls.size}`
    this.helpers.set(name, `${name} = private unnamed_addr constant [${values.length} x ${ty}] [${values.map((v) => `${ty} ${v}`).join(", ")}]`)
    return name
  }

  /** Branches on a condition and joins the two values. */
  protected choose(cond: V, then: () => V, otherwise: () => V, ty: string): V {
    const a = this.b.label("cthen")
    const b = this.b.label("celse")
    const end = this.b.label("cend")
    this.b.condBr(cond, a, b)
    this.b.start(a)
    const x = then()
    const fromA = this.b.block
    const aOpen = this.b.isOpen()
    this.b.br(end)
    this.b.start(b)
    const y = otherwise()
    const fromB = this.b.block
    const bOpen = this.b.isOpen()
    this.b.br(end)
    this.b.start(end)
    if (ty === "void") return voidValue
    const incoming = [...(aOpen ? [`[ ${x.v}, %${fromA} ]`] : []), ...(bOpen ? [`[ ${y.v}, %${fromB} ]`] : [])]
    if (incoming.length === 0) {
      this.b.terminate("unreachable")
      return { ty, v: "undef" }
    }
    return this.b.value(ty, `phi ${ty} ${incoming.join(", ")}`)
  }

  /** Panics with a message unless a condition holds. */
  protected check(ok: V, message: string) {
    const fine = this.b.label("ok")
    const bad = this.b.label("fail")
    this.b.condBr(ok, fine, bad)
    this.b.start(bad)
    this.panic(message)
    this.b.start(fine)
  }

  protected logical(e: ir.Logical): V {
    const left = this.expr(e.left)
    const isAnd = e.op === "&&"
    return this.choose(left, () => (isAnd ? this.expr(e.right) : { ty: "i1", v: "true" }), () => (isAnd ? { ty: "i1", v: "false" } : this.expr(e.right)), "i1")
  }

  protected assign(e: ir.Assign): V {
    const target = e.target
    if (target.k === "local") {
      const value = this.expr(e.value)
      this.store(value, this.place(target.local), target.local.type)
      return value
    }
    // The parts of the place and the value are evaluated before the place's
    // address is taken, since evaluating the value may grow an array.
    const parts = this.placeParts(target)
    const value = this.expr(e.value)
    const ptr = this.placePointer(target, parts, e.type)
    if (!e.op) {
      this.store(value, ptr, e.type)
      return value
    }
    const current = this.load(ptr, e.type)
    const combined = e.type.kind === "string" ? this.concat([[current, types.string], [value, types.string]]) : this.arith(e.op, current, value, e.type as ir.IntType | ir.FloatType, e.value.type)
    this.store(combined, ptr, e.type)
    return combined
  }

  protected placeParts(target: Exclude<ir.LValue, { k: "local" }>): V[] {
    if (target.k === "field") return [this.expr(target.object)]
    if (target.k === "iface-field" || target.k === "union-field") return [this.expr(target.value)]
    return [this.expr(target.array), this.intToI64(this.expr(target.index), target.index.type)]
  }

  protected placePointer(target: Exclude<ir.LValue, { k: "local" }>, parts: V[], type: Type): string {
    if (target.k === "field") return this.fieldPtr(parts[0]!.v, target.object.type as ir.StructType, target.name)
    if (target.k === "iface-field") return this.ifaceField(parts[0]!, target.index)
    if (target.k === "union-field") return this.unionFieldPtr(parts[0]!, target.value.type as UnionType, target.name)
    return this.rt("ore_rt_array_at", [parts[0]!, parts[1]!, { ty: "i64", v: sizeOf(this.mt(type)) }]).v
  }

  protected incdec(e: ir.IncDec): V {
    const ptr = e.target.k === "local" ? this.place(e.target.local) : this.placePointer(e.target, this.placeParts(e.target), e.type)
    const old = this.load(ptr, e.type)
    const one: V = e.type.kind === "float" ? { ty: old.ty, v: floatConstant(1, e.type.bits) } : { ty: old.ty, v: "1" }
    const next =
      e.type.kind === "float" ? this.b.value(old.ty, `${e.op === "++" ? "fadd" : "fsub"} ${old.ty} ${old.v}, ${one.v}`) : this.b.value(old.ty, `${e.op === "++" ? "add" : "sub"} ${old.ty} ${old.v}, ${one.v}`)
    this.store(next, ptr, e.type)
    return e.prefix ? next : old
  }

  protected arith(op: ir.ArithOp, l: V, r: V, type: ir.IntType | ir.FloatType, rightType: Type): V {
    const ty = l.ty
    if (type.kind === "float") {
      const ins = { "+": "fadd", "-": "fsub", "*": "fmul", "/": "fdiv", "%": "frem" }[op as "+"]
      return this.b.value(ty, `${ins} ${ty} ${l.v}, ${r.v}`)
    }
    switch (op) {
      case "+":
        return this.b.value(ty, `add ${ty} ${l.v}, ${r.v}`)
      case "-":
        return this.b.value(ty, `sub ${ty} ${l.v}, ${r.v}`)
      case "*":
        return this.b.value(ty, `mul ${ty} ${l.v}, ${r.v}`)
      case "&":
        return this.b.value(ty, `and ${ty} ${l.v}, ${r.v}`)
      case "|":
        return this.b.value(ty, `or ${ty} ${l.v}, ${r.v}`)
      case "^":
        return this.b.value(ty, `xor ${ty} ${l.v}, ${r.v}`)
      case "/":
      case "%":
        return this.divide(op, l, r, type)
      default:
        return this.shift(op, l, r, type, rightType as IntType)
    }
  }

  /** Integer division and remainder: by zero panics; MIN / -1 wraps (MIN % -1 is 0). */
  protected divide(op: "/" | "%", l: V, r: V, type: IntType): V {
    const ty = l.ty
    this.check(this.b.value("i1", `icmp ne ${ty} ${r.v}, 0`), DIVIDE_BY_ZERO)
    if (!type.signed) return this.b.value(ty, `${op === "/" ? "udiv" : "urem"} ${ty} ${l.v}, ${r.v}`)
    const minusOne = this.b.value("i1", `icmp eq ${ty} ${r.v}, -1`)
    return this.choose(
      minusOne,
      () => (op === "/" ? this.b.value(ty, `sub ${ty} 0, ${l.v}`) : { ty, v: "0" }),
      () => this.b.value(ty, `${op === "/" ? "sdiv" : "srem"} ${ty} ${l.v}, ${r.v}`),
      ty,
    )
  }

  /** Shifts by a count of any integer type: a negative count panics; counts >= the width give 0 (or -1 for `>>` of a negative value). */
  protected shift(op: "<<" | ">>", l: V, r: V, type: IntType, countType: IntType): V {
    const ty = l.ty
    let count = this.toI64(r, countType.signed)
    if (countType.signed) this.check(this.b.value("i1", `icmp sge i64 ${count.v}, 0`), "negative shift amount")
    const inRange = this.b.value("i1", `icmp ult i64 ${count.v}, ${type.bits}`)
    // Clamp the count so the shift itself is always defined.
    count = this.b.value("i64", `select i1 ${inRange.v}, i64 ${count.v}, i64 0`)
    const n = this.fromI64(count, ty)
    if (op === "<<") {
      const shifted = this.b.value(ty, `shl ${ty} ${l.v}, ${n.v}`)
      return this.b.value(ty, `select i1 ${inRange.v}, ${ty} ${shifted.v}, ${ty} 0`)
    }
    const shifted = this.b.value(ty, `${type.signed ? "ashr" : "lshr"} ${ty} ${l.v}, ${n.v}`)
    let overflow: V = { ty, v: "0" }
    if (type.signed) {
      const negative = this.b.value("i1", `icmp slt ${ty} ${l.v}, 0`)
      overflow = this.b.value(ty, `select i1 ${negative.v}, ${ty} -1, ${ty} 0`)
    }
    return this.b.value(ty, `select i1 ${inRange.v}, ${ty} ${shifted.v}, ${ty} ${overflow.v}`)
  }

  protected convert(v: V, from: Type, to: Type): V {
    const target = this.lt(to)
    if (to.kind === "int" && from.kind === "float") {
      // Truncates toward zero, saturates out of range, NaN gives 0.
      const name = `@llvm.fpto${to.signed ? "s" : "u"}i.sat.${target}.${v.ty === "float" ? "f32" : "f64"}`
      this.decls.set(name, `declare ${target} ${name}(${v.ty})`)
      return this.b.value(target, `call ${target} ${name}(${v.ty} ${v.v})`)
    }
    if (to.kind === "float" && from.kind === "int") return this.b.value(target, `${from.signed ? "sitofp" : "uitofp"} ${v.ty} ${v.v} to ${target}`)
    if (to.kind === "float" && from.kind === "float") {
      if (v.ty === target) return v
      return this.b.value(target, `${to.bits > from.bits ? "fpext" : "fptrunc"} ${v.ty} ${v.v} to ${target}`)
    }
    const a = (from as IntType).bits
    const b = (to as IntType).bits
    if (a === b) return v
    if (b < a) return this.b.value(target, `trunc ${v.ty} ${v.v} to ${target}`)
    return this.b.value(target, `${(from as IntType).signed ? "sext" : "zext"} ${v.ty} ${v.v} to ${target}`)
  }

  protected compare(op: ir.CompareOp, l: V, r: V, type: Type): V {
    const negate = (v: V) => (op === "!==" ? this.b.value("i1", `xor i1 ${v.v}, true`) : v)
    if (type.kind === "string" && op !== "===" && op !== "!==") {
      const c = this.fromI64(this.rt("ore_rt_str_cmp", [l, r]), "i32")
      const pred = { "<": "slt", "<=": "sle", ">": "sgt", ">=": "sge" }[op]
      return this.b.value("i1", `icmp ${pred} i32 ${c.v}, 0`)
    }
    if (type.kind === "int" || type.kind === "bool" || this.lt(type) === "ptr") {
      const signed = type.kind === "int" && type.signed
      const pred = { "===": "eq", "!==": "ne", "<": signed ? "slt" : "ult", "<=": signed ? "sle" : "ule", ">": signed ? "sgt" : "ugt", ">=": signed ? "sge" : "uge" }[op]
      return this.b.value("i1", `icmp ${pred} ${l.ty} ${l.v}, ${r.v}`)
    }
    if (type.kind === "float") {
      const pred = { "===": "oeq", "!==": "une", "<": "olt", "<=": "ole", ">": "ogt", ">=": "oge" }[op]
      return this.b.value("i1", `fcmp ${pred} ${l.ty} ${l.v}, ${r.v}`)
    }
    return negate(this.equals(l, r, type))
  }

  /** `===` of two values of a type. */
  protected equals(a: V, b: V, type: Type): V {
    if (type.kind === "union") {
      const repr = unionRepr(type)
      if (repr.k === "tagged") return this.b.value("i1", `call i1 ${this.unionEquals(type)}(${a.ty} ${a.v}, ${b.ty} ${b.v})`)
      return this.equals(a, b, repr.k === "strings" ? types.string : repr.base)
    }
    if (isStringLike(type)) return this.rtBool("ore_rt_str_eq", [a, b])
    if (type.kind === "func") {
      const fn = this.b.value("i1", `icmp eq ptr ${this.extract(a, 0, "ptr").v}, ${this.extract(b, 0, "ptr").v}`)
      const env = this.b.value("i1", `icmp eq ptr ${this.extract(a, 1, "ptr").v}, ${this.extract(b, 1, "ptr").v}`)
      return this.b.value("i1", `and i1 ${fn.v}, ${env.v}`)
    }
    if (type.kind === "interface") return this.b.value("i1", `icmp eq ptr ${this.extract(a, 0, "ptr").v}, ${this.extract(b, 0, "ptr").v}`)
    if (type.kind === "float") return this.b.value("i1", `fcmp oeq ${a.ty} ${a.v}, ${b.v}`)
    return this.b.value("i1", `icmp eq ${a.ty} ${a.v}, ${b.v}`)
  }

  protected unionEquals(u: UnionType): string {
    const name = `@U.${u.id}.eq`
    if (this.helpers.has(name)) return name
    this.helpers.set(name, "")
    const ty = this.unionType(u)
    this.helper(name, `define internal i1 ${name}(${ty} %a, ${ty} %b)`, (e) => {
      const a: V = { ty, v: "%a" }
      const b: V = { ty, v: "%b" }
      const sameTag = e.b.value("i1", `icmp eq i32 ${e.extract(a, 0, "i32").v}, ${e.extract(b, 0, "i32").v}`)
      const yes = e.b.label("same")
      const no = e.b.label("differ")
      e.b.condBr(sameTag, yes, no)
      e.b.start(no)
      e.b.terminate("ret i1 false")
      e.b.start(yes)
      u.members.forEach((m, i) => {
        if (m.kind === "null") return
        const here = e.b.label("member")
        const next = e.b.label("nextmember")
        e.b.condBr(e.b.value("i1", `icmp eq i32 ${e.extract(a, 0, "i32").v}, ${i}`), here, next)
        e.b.start(here)
        e.b.terminate(`ret i1 ${e.equals(e.payload(u, a, i), e.payload(u, b, i), m).v}`)
        e.b.start(next)
      })
      e.b.terminate("ret i1 true")
    })
    return name
  }

  /** Whether a union value holds member `i`. */
  protected slotTest(u: UnionType, v: V, i: number): V {
    const repr = unionRepr(u)
    if (repr.k === "tagged") return this.b.value("i1", `icmp eq i32 ${this.extract(v, 0, "i32").v}, ${i}`)
    const member = u.members[i]!
    // Members that are string literals are told apart by the value.
    const literal = () => this.rtBool("ore_rt_str_eq", [v, this.str((member as ir.LiteralType).value)])
    if (repr.k === "strings") return literal()
    if (member.kind === "null") return this.isNullRef(v, repr.base)
    const present = this.b.value("i1", `xor i1 ${this.isNullRef(v, repr.base).v}, true`)
    if (member.kind !== "literal") return present
    return this.choose(present, literal, () => ({ ty: "i1", v: "false" }), "i1")
  }

  protected isNullRef(v: V, base: Type): V {
    const ptr = base.kind === "interface" || base.kind === "func" || base.kind === "string" ? this.extract(v, 0, "ptr") : v
    return this.b.value("i1", `icmp eq ptr ${ptr.v}, null`)
  }

  protected isNullValue(u: UnionType, v: V): V {
    return this.slotTest(u, v, u.members.findIndex((m) => m.kind === "null"))
  }

  /** The value of member `i` of a union value. */
  protected payload(u: UnionType, v: V, i: number): V {
    if (unionRepr(u).k !== "tagged") return v
    const slot = this.spill(v)
    const ptr = this.field(slot, this.unionType(u), 1)
    return this.load(ptr, u.members[i]!)
  }

  /** A union value holding member `i` with value `p` (none for `null`). */
  protected inject(u: UnionType, i: number, p: V | undefined): V {
    const repr = unionRepr(u)
    const isNull = u.members[i]!.kind === "null"
    if (repr.k === "strings") return p!
    if (repr.k === "nullable") return isNull ? this.zero(repr.base) : p!
    const ty = this.unionType(u)
    const slot = this.b.alloca(ty)
    this.b.emit(`store ${ty} zeroinitializer, ptr ${slot}`)
    this.b.emit(`store i32 ${i}, ptr ${this.field(slot, ty, 0)}`)
    if (!isNull) this.store(p!, this.field(slot, ty, 1), u.members[i]!)
    return this.b.value(ty, `load ${ty}, ptr ${slot}`)
  }

  /** Converts between a union and its members; narrowing panics on a member the target lacks. */
  /**
   * The address of member `index` of an interface value that is a field:
   * entry `index + 1` of its table holds the field's offset in the object.
   */
  protected ifaceField(value: V, index: number): string {
    const data = this.extract(value, 0, "ptr")
    const table = this.extract(value, 1, "ptr")
    const entry = this.b.value("ptr", `getelementptr ptr, ptr ${table.v}, i64 ${index + 1}`)
    const offset = this.b.value("i64", `load i64, ptr ${entry.v}`)
    return this.b.value("ptr", `getelementptr i8, ptr ${data.v}, i64 ${offset.v}`).v
  }

  /** Whether an interface value refers to an instance of the struct with type id `id`: entry 0 of its table. */
  protected ifaceIs(value: V, id: V): V {
    const table = this.extract(value, 1, "ptr")
    const present = this.b.value("i1", `icmp ne ptr ${table.v}, null`)
    return this.choose(present, () => this.b.value("i1", `icmp eq i64 ${this.b.value("i64", `load i64, ptr ${table.v}`).v}, ${id.v}`), () => ({ ty: "i1", v: "false" }), "i1")
  }

  recast(v: V, from: Type, to: Type): V {
    // Unions of string literals widen to `string` without a change.
    if (from.kind === "union" && unionRepr(from).k === "strings" && to.kind === "string") return v
    if (from.kind !== "union") {
      if (to.kind !== "union") return v
      return this.inject(to, memberIndex(to, from), v)
    }
    // Narrowing a nullable union or one of strings is a test of the value, kept in place.
    if (to.kind !== "union" && unionRepr(from).k !== "tagged") return this.recastInline(v, from, to)
    // Between unions held the same way without a tag (strings, or one reference
    // and null), with every member of the source in the target, the value stays.
    if (to.kind === "union" && unionRepr(from).k !== "tagged" && unionRepr(to).k !== "tagged" && this.lt(from) === this.lt(to) && from.members.every((m) => memberIndex(to, m) !== -1)) return v
    // Otherwise the conversion tests the tag, or every member of the source: a
    // function per pair of types, so that each use is a call.
    const ty = this.lt(to)
    return this.b.value(ty, `call ${ty} ${this.recaster(from, to)}(${v.ty} ${v.v})`)
  }

  /** The function converting a union to another type, as `recast` does: `@ore.recast.<from>.<to>`. */
  protected recaster(from: UnionType, to: Type): string {
    const name = globalName(`ore.recast.${from.id}.${shortKey(to)}`)
    if (this.helpers.has(name)) return name
    this.helpers.set(name, "")
    const fromTy = this.lt(from)
    const ty = this.lt(to)
    this.helper(name, `define internal ${ty} ${name}(${fromTy} %v)`, (e) => {
      const r = e.recastInline({ ty: fromTy, v: "%v" }, from, to)
      e.b.terminate(`ret ${ty} ${r.v}`)
    })
    return name
  }

  /** The function telling what `typeof` says of a value of a union: `@ore.typeof.<union>`. */
  protected typeofer(u: UnionType): string {
    const name = globalName(`ore.typeof.${u.id}`)
    if (this.helpers.has(name)) return name
    this.helpers.set(name, "")
    const uty = this.lt(u)
    this.helper(name, `define internal ${STR} ${name}(${uty} %v)`, (e) => {
      const v: V = { ty: uty, v: "%v" }
      let result = e.str("object")
      for (let i = u.members.length - 1; i >= 0; i--) {
        const test = e.slotTest(u, v, i)
        result = e.b.value(STR, `select i1 ${test.v}, ${STR} ${e.str(typeofName(u.members[i]!)).v}, ${STR} ${result.v}`)
      }
      e.b.terminate(`ret ${STR} ${result.v}`)
    })
    return name
  }

  /** Converts a union to a member or to another union, in place; narrowing panics on a member the target lacks. */
  protected recastInline(v: V, from: UnionType, to: Type): V {
    if (to.kind !== "union") {
      const i = memberIndex(from, to)
      const message = from.members.some((m) => m.kind === "null") && from.members.length === 2 ? "unexpected null" : `value is not of type ${typeToString(to)}`
      this.check(this.slotTest(from, v, i), message)
      return this.payload(from, v, i)
    }
    if (unionRepr(from).k === "tagged" && unionRepr(to).k === "tagged") return this.retag(v, from, to)
    if (unionRepr(from).k === "strings" && this.lt(to) === STR) return this.narrowStrings(v, from, to)
    // Union to union: each member of the source maps to the target.
    const ty = this.lt(to)
    const result = this.b.alloca(ty)
    const end = this.b.label("recast")
    from.members.forEach((m, i) => {
      const here = this.b.label("rmember")
      const next = this.b.label("rnext")
      this.b.condBr(this.slotTest(from, v, i), here, next)
      this.b.start(here)
      const j = memberIndex(to, m)
      if (j === -1) this.panic(`value is not of type ${typeToString(to)}`)
      else {
        const converted = this.inject(to, j, m.kind === "null" ? undefined : this.payload(from, v, i))
        this.b.emit(`store ${ty} ${converted.v}, ptr ${result}`)
        this.b.br(end)
      }
      this.b.start(next)
    })
    this.panic(`value is not of type ${typeToString(to)}`)
    this.b.start(end)
    return this.b.value(ty, `load ${ty}, ptr ${result}`)
  }

  /**
   * A tagged union as another: members keep their representation, so the tag
   * is mapped through a table and the payload words are copied.
   */
  protected retag(v: V, from: UnionType, to: UnionType): V {
    const ty = this.lt(to)
    const tags = from.members.map((m) => memberIndex(to, m))
    const tag = this.extract(v, 0, "i32")
    const table = this.constArray("i32", tags.map(String))
    const j = this.b.value("i32", `load i32, ptr ${this.b.value("ptr", `getelementptr i32, ptr ${table}, i32 ${tag.v}`).v}`)
    if (tags.includes(-1)) this.check(this.b.value("i1", `icmp ne i32 ${j.v}, -1`), `value is not of type ${typeToString(to)}`)
    const n = this.unionWords(from)
    const m = this.unionWords(to)
    let words = this.extract(v, 1, `[${n} x i64]`)
    if (m !== n) {
      let resized: V = { ty: `[${m} x i64]`, v: "zeroinitializer" }
      for (let k = 0; k < Math.min(m, n); k++) {
        const word = this.extract(words, k, "i64")
        resized = this.b.value(resized.ty, `insertvalue ${resized.ty} ${resized.v}, i64 ${word.v}, ${k}`)
      }
      words = resized
    }
    return this.aggregate(ty, [j, words])
  }

  /**
   * A union of string literals as a union held as a string too: the value
   * stays, after checking that it is a member of the target, against the
   * fewer of the members the target has and those it lacks.
   */
  protected narrowStrings(v: V, from: UnionType, to: UnionType): V {
    const present = from.members.filter((m) => memberIndex(to, m) !== -1)
    const missing = from.members.filter((m) => memberIndex(to, m) === -1)
    const tested = missing.length <= present.length ? missing : present
    let any: V = { ty: "i1", v: "false" }
    for (const m of tested) any = this.b.value("i1", `or i1 ${any.v}, ${this.rtBool("ore_rt_str_eq", [v, this.str((m as ir.LiteralType).value)]).v}`)
    const ok = tested === missing ? this.b.value("i1", `xor i1 ${any.v}, true`) : any
    this.check(ok, `value is not of type ${typeToString(to)}`)
    return v
  }

  protected optional(e: ir.Optional): V {
    // `value?.body`: null when value is null, else body with the value bound.
    const from = e.value.type as UnionType
    const v = this.expr(e.value)
    const isNull = this.isNullValue(from, v)
    if (e.type.kind !== "union") {
      this.choose(isNull, () => voidValue, () => {
        this.declare(e.binding, this.recast(v, from, e.binding.type))
        this.expr(e.body)
        return voidValue
      }, "void")
      return voidValue
    }
    const u = e.type
    return this.choose(
      isNull,
      () => this.inject(u, u.members.findIndex((m) => m.kind === "null"), undefined),
      () => {
        this.declare(e.binding, this.recast(v, from, e.binding.type))
        return this.expr(e.body)
      },
      this.lt(u),
    )
  }

  /** The address of a field that every member of a union has, with the same type. */
  protected unionFieldPtr(v: V, u: UnionType, name: string): string {
    const end = this.b.label("ufield")
    const incoming: string[] = []
    u.members.forEach((m, i) => {
      const here = this.b.label("umember")
      const next = this.b.label("unext")
      this.b.condBr(this.slotTest(u, v, i), here, next)
      this.b.start(here)
      const object = this.payload(u, v, i)
      const ptr = m.kind === "struct" ? this.fieldPtr(object.v, m, name) : this.ifaceField(object, (m as ir.InterfaceType).members.findIndex((x) => x.name === name))
      incoming.push(`[ ${ptr}, %${this.b.block} ]`)
      this.b.br(end)
      this.b.start(next)
    })
    this.b.terminate("unreachable")
    this.b.start(end)
    return this.b.value("ptr", `phi ptr ${incoming.join(", ")}`).v
  }

  protected unionField(e: ir.UnionField): V {
    const u = e.value.type as UnionType
    const v = this.expr(e.value)
    const ty = this.lt(e.type)
    // Every member a class with the field at the same place, read as the result as it is: one load.
    const index = this.sharedField(u, e.name, e.type)
    if (index !== -1) {
      const object = this.payload(u, v, 0)
      return this.load(this.field(object.v, this.structType(u.members[0] as ir.StructType), index), e.type)
    }
    return this.b.value(ty, `call ${ty} ${this.unionFielder(u, e.name, e.type)}(${v.ty} ${v.v})`)
  }

  /**
   * The index of a field that every member of a union, all classes, has at the
   * same place after fields of the same layout, with a value that is the
   * result's as it is; -1 when there is none.
   */
  protected sharedField(u: UnionType, name: string, type: Type): number {
    const first = u.members[0]
    if (first?.kind !== "struct") return -1
    const index = first.fields.findIndex((f) => f.name === name)
    if (index === -1) return -1
    for (const m of u.members) {
      if (m.kind !== "struct" || m.fields.length <= index || m.fields[index]!.name !== name) return -1
      for (let i = 0; i <= index; i++) if (this.mt(m.fields[i]!.type) !== this.mt(first.fields[i]!.type)) return -1
      const t = m.fields[index]!.type
      const same = ir.sameType(t, type) || (t.kind !== "union" && type.kind === "union" && unionRepr(type).k !== "tagged" && memberIndex(type, t) !== -1)
      if (!same || this.mt(t) !== this.mt(type)) return -1
    }
    return index
  }

  /** The function reading a field common to the members of a union: `@ore.ufield.<union>.<field>.<type>`. */
  protected unionFielder(u: UnionType, name: string, type: Type): string {
    const helper = globalName(`ore.ufield.${u.id}.${name}.${shortKey(type)}`)
    if (this.helpers.has(helper)) return helper
    this.helpers.set(helper, "")
    const uty = this.lt(u)
    const ty = this.lt(type)
    this.helper(helper, `define internal ${ty} ${helper}(${uty} %v)`, (e) => {
      const r = e.unionFieldInline(u, { ty: uty, v: "%v" }, name, type)
      e.b.terminate(`ret ${ty} ${r.v}`)
    })
    return helper
  }

  /** Reads a field common to the members of a union, testing each member in turn. */
  protected unionFieldInline(u: UnionType, v: V, name: string, resultType: Type): V {
    const ty = this.lt(resultType)
    const result = this.b.alloca(ty)
    const end = this.b.label("ufield")
    u.members.forEach((m, i) => {
      const here = this.b.label("umember")
      const next = this.b.label("unext")
      this.b.condBr(this.slotTest(u, v, i), here, next)
      this.b.start(here)
      const object = this.payload(u, v, i)
      let read: V
      let type: Type
      if (m.kind === "struct") {
        type = ir.findField(m, name)!.type
        read = this.load(this.fieldPtr(object.v, m, name), type)
      } else {
        const index = (m as ir.InterfaceType).members.findIndex((x) => x.name === name)
        type = (m as ir.InterfaceType).members[index]!.type
        read = this.load(this.ifaceField(object, index), type)
      }
      this.b.emit(`store ${ty} ${this.recast(read, type, resultType).v}, ptr ${result}`)
      this.b.br(end)
      this.b.start(next)
    })
    this.b.terminate("unreachable")
    this.b.start(end)
    return this.b.value(ty, `load ${ty}, ptr ${result}`)
  }
}

/** A short key of a type for the names of helpers: a union by its id. */
function shortKey(t: Type): string {
  return t.kind === "union" ? `u${t.id}` : ir.typeKey(t)
}
