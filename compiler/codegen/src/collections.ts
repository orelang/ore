// Arrays, maps, channels and interface tables.
import * as ir from "@ore/ir"
import { isStringLike, types, unionRepr, type Type, type UnionType } from "@ore/ir"
import { floatConstant, globalName, sizeOf, voidValue, type V } from "./ll"
import { STR, FN, ARRAY, MAP } from "./context"
import { typeId } from "./helpers"
import { CallEmitter } from "./calls"

export abstract class CollectionEmitter extends CallEmitter {
  protected arrayMethod(e: ir.ArrayMethod): V {
    const T = (e.array.type as ir.ArrayType).elem
    const elem = this.mt(T)
    const array = this.expr(e.array)
    const callback = e.args[0]
    const ft = callback?.type as ir.FuncType
    const f = callback && (e.method !== "includes" && e.method !== "indexOf" && e.method !== "join") ? this.expr(callback) : undefined
    const call = (args: V[]) => this.callClosure(f!, ft, args)
    // Elements present when the call starts, as in JavaScript, while they still exist.
    const loop = (body: (at: V, i: V, exit: string) => void, exitLabel?: string) => {
      const n = this.b.value("i64", `load i64, ptr ${this.field(array.v, ARRAY, 1)}`)
      const i = this.b.alloca("i64")
      this.b.emit(`store i64 0, ptr ${i}`)
      const head = this.b.label("ahead")
      const bodyLabel = this.b.label("abody")
      const end = exitLabel ?? this.b.label("aend")
      this.b.start(head)
      const at = this.b.value("i64", `load i64, ptr ${i}`)
      const len = this.b.value("i64", `load i64, ptr ${this.field(array.v, ARRAY, 1)}`)
      const inN = this.b.value("i1", `icmp slt i64 ${at.v}, ${n.v}`)
      const inLen = this.b.value("i1", `icmp slt i64 ${at.v}, ${len.v}`)
      this.b.condBr(this.b.value("i1", `and i1 ${inN.v}, ${inLen.v}`), bodyLabel, end)
      this.b.start(bodyLabel)
      const data = this.b.value("ptr", `load ptr, ptr ${this.field(array.v, ARRAY, 0)}`)
      const value = this.load(this.b.value("ptr", `getelementptr ${elem}, ptr ${data.v}, i64 ${at.v}`).v, T)
      body(value, at, end)
      this.b.emit(`store i64 ${this.b.value("i64", `add i64 ${at.v}, 1`).v}, ptr ${i}`)
      this.b.br(head)
      if (!exitLabel) this.b.start(end)
    }
    switch (e.method) {
      case "forEach":
        loop((x, i) => void call([x, i]))
        return voidValue
      case "map": {
        const U = (e.type as ir.ArrayType).elem
        const len = this.b.value("i64", `load i64, ptr ${this.field(array.v, ARRAY, 1)}`)
        const out = this.rt("ore_rt_array_new", [{ ty: "i64", v: sizeOf(this.mt(U)) }, len])
        loop((x, i) => {
          const data = this.b.value("ptr", `load ptr, ptr ${this.field(out.v, ARRAY, 0)}`)
          this.store(call([x, i]), this.b.value("ptr", `getelementptr ${this.mt(U)}, ptr ${data.v}, i64 ${i.v}`).v, U)
        })
        return out
      }
      case "filter": {
        const out = this.rt("ore_rt_array_new", [{ ty: "i64", v: sizeOf(elem) }, this.i64(0)])
        loop((x, i) => {
          const keep = this.b.label("keep")
          const skip = this.b.label("skip")
          this.b.condBr(call([x, i]), keep, skip)
          this.b.start(keep)
          this.store(x, this.rt("ore_rt_array_push", [out, { ty: "i64", v: sizeOf(elem) }]).v, T)
          this.b.start(skip)
        })
        return out
      }
      case "find":
      case "findIndex":
      case "some":
      case "every": {
        const ty = this.lt(e.type)
        const result = this.b.alloca(ty)
        const u = e.type as UnionType
        const initial =
          e.method === "find" ? this.inject(u, u.members.findIndex((m) => m.kind === "null"), undefined) : e.method === "findIndex" ? this.i64(-1) : { ty: "i1", v: e.method === "every" ? "true" : "false" }
        this.b.emit(`store ${ty} ${initial.v}, ptr ${result}`)
        const done = this.b.label("found")
        loop((x, i, exit) => {
          const hit = this.b.label("hit")
          const miss = this.b.label("miss")
          const test = call([x, i])
          this.b.condBr(test, e.method === "every" ? miss : hit, e.method === "every" ? hit : miss)
          this.b.start(hit)
          const value = e.method === "find" ? this.recast(x, T, u) : e.method === "findIndex" ? i : { ty: "i1", v: e.method === "every" ? "false" : "true" }
          this.b.emit(`store ${ty} ${value.v}, ptr ${result}`)
          this.b.br(exit)
          this.b.start(miss)
        }, done)
        this.b.start(done)
        return this.b.value(ty, `load ${ty}, ptr ${result}`)
      }
      case "reduce": {
        const ty = this.lt(e.type)
        const acc = this.b.alloca(ty)
        this.b.emit(`store ${ty} ${this.expr(e.args[1]!).v}, ptr ${acc}`)
        loop((x, i) => {
          const current = this.b.value(ty, `load ${ty}, ptr ${acc}`)
          this.b.emit(`store ${ty} ${call([current, x, i]).v}, ptr ${acc}`)
        })
        return this.b.value(ty, `load ${ty}, ptr ${acc}`)
      }
      case "includes":
      case "indexOf": {
        // includes finds NaN (SameValueZero); indexOf does not (===).
        const target = this.expr(e.args[0]!)
        const ty = e.method === "includes" ? "i1" : "i64"
        const result = this.b.alloca(ty)
        this.b.emit(`store ${ty} ${e.method === "includes" ? "false" : "-1"}, ptr ${result}`)
        const done = this.b.label("found")
        loop((x, i, exit) => {
          const same = e.method === "includes" && T.kind === "float" ? this.rtBool("ore_rt_same_f64", [this.convert(x, T, types.f64), this.convert(target, T, types.f64)]) : this.equals(x, target, T)
          const hit = this.b.label("hit")
          const miss = this.b.label("miss")
          this.b.condBr(same, hit, miss)
          this.b.start(hit)
          this.b.emit(`store ${ty} ${e.method === "includes" ? "true" : i.v}, ptr ${result}`)
          this.b.br(exit)
          this.b.start(miss)
        }, done)
        this.b.start(done)
        return this.b.value(ty, `load ${ty}, ptr ${result}`)
      }
      case "join": {
        const sep = e.args[0] ? this.expr(e.args[0]) : this.str(",")
        const len = this.b.value("i64", `load i64, ptr ${this.field(array.v, ARRAY, 1)}`)
        const strings = this.rt("ore_rt_array_new", [{ ty: "i64", v: sizeOf(STR) }, len])
        loop((x, i) => {
          const data = this.b.value("ptr", `load ptr, ptr ${this.field(strings.v, ARRAY, 0)}`)
          this.b.emit(`store ${STR} ${this.toStr(x, T).v}, ptr ${this.b.value("ptr", `getelementptr ${STR}, ptr ${data.v}, i64 ${i.v}`).v}`)
        })
        return this.rt("ore_rt_str_join", [strings, sep])
      }
      case "reverse":
        this.rt("ore_rt_array_reverse", [array, { ty: "i64", v: sizeOf(elem) }])
        return array
      default: {
        if (!f) {
          this.rt("ore_rt_array_sort", [array, { ty: "i64", v: sizeOf(elem) }, { ty: "ptr", v: this.naturalOrder(T) }, { ty: "ptr", v: "null" }])
          return array
        }
        const ctx = this.spill(f)
        this.rt("ore_rt_array_sort", [array, { ty: "i64", v: sizeOf(elem) }, { ty: "ptr", v: this.comparator(ft) }, { ty: "ptr", v: ctx }])
        return array
      }
    }
  }

  /** A C sort comparison calling a comparator closure, whose number result gives the order. */
  protected comparator(type: ir.FuncType): string {
    const name = globalName(`cmp.${ir.typeKey(type)}`)
    if (this.helpers.has(name)) return name
    this.helpers.set(name, "")
    this.helper(name, `define internal i32 ${name}(ptr %ctx, ptr %a, ptr %b)`, (e) => {
      const T = type.params[0]!
      const f = e.b.value(FN, `load ${FN}, ptr %ctx`)
      const r = e.callClosure(f, type, [e.load("%a", T), e.load("%b", T)])
      const result = type.result
      const lt = result.kind === "float" ? e.b.value("i1", `fcmp olt ${r.ty} ${r.v}, ${floatConstant(0, (result as ir.FloatType).bits)}`) : e.b.value("i1", `icmp slt ${r.ty} ${r.v}, 0`)
      const gt = result.kind === "float" ? e.b.value("i1", `fcmp ogt ${r.ty} ${r.v}, ${floatConstant(0, (result as ir.FloatType).bits)}`) : e.b.value("i1", `icmp sgt ${r.ty} ${r.v}, 0`)
      const one = e.b.value("i32", `select i1 ${gt.v}, i32 1, i32 0`)
      e.b.terminate(`ret i32 ${e.b.value("i32", `select i1 ${lt.v}, i32 -1, i32 ${one.v}`).v}`)
    })
    return name
  }

  /** A C sort comparison in ascending order of numbers or strings. */
  protected naturalOrder(type: Type): string {
    const name = globalName(`natural.${ir.typeKey(type)}`)
    if (this.helpers.has(name)) return name
    this.helpers.set(name, "")
    this.helper(name, `define internal i32 ${name}(ptr %ctx, ptr %a, ptr %b)`, (e) => {
      const x = e.load("%a", type)
      const y = e.load("%b", type)
      if (isStringLike(type)) {
        e.b.terminate(`ret i32 ${e.fromI64(e.rt("ore_rt_str_cmp", [x, y]), "i32").v}`)
        return
      }
      const lt = e.compare("<", x, y, type)
      const gt = e.compare(">", x, y, type)
      const one = e.b.value("i32", `select i1 ${gt.v}, i32 1, i32 0`)
      e.b.terminate(`ret i32 ${e.b.value("i32", `select i1 ${lt.v}, i32 -1, i32 ${one.v}`).v}`)
    })
    return name
  }

  /**
   * The hash and equality functions of a map key type, as SameValueZero:
   * strings by contents, references by identity, NaN equal to NaN; a union
   * by its member, then as that member.
   */
  protected keyFunctions(key: Type): { hash: string; eq: string } {
    const id = ir.typeKey(key)
    const hash = globalName(`hash.${id}`)
    const eq = globalName(`eq.${id}`)
    if (this.helpers.has(hash)) return { hash, eq }
    this.helpers.set(hash, "")
    this.helpers.set(eq, "")
    // Both take an unused environment first, so that the runtime calls them as closures.
    this.helper(hash, `define internal i64 ${hash}(ptr %env, ptr %k)`, (e) => {
      const k = e.load("%k", key)
      e.b.terminate(`ret i64 ${e.keyHash(k, key).v}`)
    })
    this.helper(eq, `define internal i1 ${eq}(ptr %env, ptr %a, ptr %b)`, (e) => {
      const a = e.load("%a", key)
      const b = e.load("%b", key)
      e.b.terminate(`ret i1 ${e.keyEquals(a, b, key).v}`)
    })
    return { hash, eq }
  }

  /** The hash of a map key. */
  protected keyHash(k: V, key: Type): V {
    if (key.kind === "union") return this.unionKeyHash(k, key)
    if (key.kind === "float") return this.rt("ore_rt_hash_f64", [this.convert(k, key, types.f64)])
    if (isStringLike(key)) return this.rt("ore_rt_hash_bytes", [this.extract(k, 0, "ptr"), this.extract(k, 1, "i64")])
    if (key.kind === "interface") return this.rt("ore_rt_hash_u64", [this.b.value("i64", `ptrtoint ptr ${this.extract(k, 0, "ptr").v} to i64`)])
    if (k.ty === "ptr") return this.rt("ore_rt_hash_u64", [this.b.value("i64", `ptrtoint ptr ${k.v} to i64`)])
    return this.rt("ore_rt_hash_u64", [this.intToI64(k, key)])
  }

  /** The hash of a union key: the hash of its member's value plus the member's index. */
  protected unionKeyHash(k: V, u: UnionType): V {
    if (unionRepr(u).k === "strings") return this.keyHash(k, types.string)
    const result = this.b.alloca("i64")
    const end = this.b.label("khash")
    u.members.forEach((m, i) => {
      const here = this.b.label("kmember")
      const next = this.b.label("knext")
      this.b.condBr(this.slotTest(u, k, i), here, next)
      this.b.start(here)
      const h = m.kind === "null" ? "0" : this.keyHash(this.payload(u, k, i), m).v
      this.b.emit(`store i64 ${this.b.value("i64", `add i64 ${h}, ${i}`).v}, ptr ${result}`)
      this.b.br(end)
      this.b.start(next)
    })
    this.b.terminate("unreachable")
    this.b.start(end)
    return this.b.value("i64", `load i64, ptr ${result}`)
  }

  /** Whether two map keys are the same key. */
  protected keyEquals(a: V, b: V, key: Type): V {
    if (key.kind === "float") return this.rtBool("ore_rt_same_f64", [this.convert(a, key, types.f64), this.convert(b, key, types.f64)])
    if (key.kind !== "union" || unionRepr(key).k !== "tagged") return this.equals(a, b, key)
    // The same member, with the same value as that member's keys.
    const u = key
    const result = this.b.alloca("i1")
    this.b.emit(`store i1 false, ptr ${result}`)
    const end = this.b.label("keq")
    const sameTag = this.b.value("i1", `icmp eq i32 ${this.extract(a, 0, "i32").v}, ${this.extract(b, 0, "i32").v}`)
    const check = this.b.label("ktag")
    this.b.condBr(sameTag, check, end)
    this.b.start(check)
    u.members.forEach((m, i) => {
      const here = this.b.label("kmember")
      const next = this.b.label("knext")
      this.b.condBr(this.slotTest(u, a, i), here, next)
      this.b.start(here)
      const same = m.kind === "null" ? "true" : this.keyEquals(this.payload(u, a, i), this.payload(u, b, i), m).v
      this.b.emit(`store i1 ${same}, ptr ${result}`)
      this.b.br(end)
      this.b.start(next)
    })
    this.b.terminate("unreachable")
    this.b.start(end)
    return this.b.value("i1", `load i1, ptr ${result}`)
  }

  protected mapOp(e: ir.MapOp): V {
    const { key: K, value: V } = e.mapType
    const kt = this.mt(K)
    const vt = this.mt(V)
    switch (e.op) {
      case "new": {
        const { hash, eq } = this.keyFunctions(K)
        return this.rt("ore_rt_map_new", [{ ty: "i64", v: sizeOf(kt) }, { ty: "i64", v: sizeOf(vt) }, { ty: "ptr", v: hash }, { ty: "ptr", v: eq }])
      }
      case "size":
        return this.b.value("i64", `load i64, ptr ${this.field(this.expr(e.map!).v, MAP, 8)}`)
      case "clear":
        this.rt("ore_rt_map_clear", [this.expr(e.map!)])
        return voidValue
      case "keys":
        return this.rt("ore_rt_map_keys", [this.expr(e.map!)])
      case "values":
        return this.rt("ore_rt_map_values", [this.expr(e.map!)])
    }
    // The map and key (and value) are evaluated in order; the key needs an address.
    const m = this.expr(e.map!)
    const k = this.b.alloca(kt)
    this.store(this.expr(e.key!), k, K)
    const key: V = { ty: "ptr", v: k }
    switch (e.op) {
      case "get": {
        const result = e.type as UnionType
        const p = this.rt("ore_rt_map_get", [m, key])
        const found = this.b.value("i1", `icmp ne ptr ${p.v}, null`)
        return this.choose(found, () => this.recast(this.load(p.v, V), V, result), () => this.inject(result, result.members.findIndex((t) => t.kind === "null"), undefined), this.lt(result))
      }
      case "set": {
        const v = this.b.alloca(vt)
        this.store(this.expr(e.value!), v, V)
        this.rt("ore_rt_map_set", [m, key, { ty: "ptr", v }])
        return m
      }
      case "has":
        return this.b.value("i1", `icmp ne ptr ${this.rt("ore_rt_map_get", [m, key]).v}, null`)
      default:
        return this.rtBool("ore_rt_map_delete", [m, key])
    }
  }

  /** A set is a map whose values take no bytes. */
  protected setOp(e: ir.SetOp): V {
    const T = e.setType.elem
    const t = this.mt(T)
    switch (e.op) {
      case "new": {
        const { hash, eq } = this.keyFunctions(T)
        const s = this.rt("ore_rt_map_new", [{ ty: "i64", v: sizeOf(t) }, this.i64(0), { ty: "ptr", v: hash }, { ty: "ptr", v: eq }])
        if (e.value) this.rt("ore_rt_map_add_keys", [s, this.expr(e.value)])
        return s
      }
      case "size":
        return this.b.value("i64", `load i64, ptr ${this.field(this.expr(e.set!).v, MAP, 8)}`)
      case "clear":
        this.rt("ore_rt_map_clear", [this.expr(e.set!)])
        return voidValue
      case "values":
        return this.rt("ore_rt_map_keys", [this.expr(e.set!)])
    }
    // The set, then the value, which needs an address.
    const s = this.expr(e.set!)
    const v = this.b.alloca(t)
    this.store(this.expr(e.value!), v, T)
    const value: V = { ty: "ptr", v }
    switch (e.op) {
      case "add":
        // No bytes of value are copied: the value's address serves.
        this.rt("ore_rt_map_set", [s, value, value])
        return s
      case "has":
        return this.b.value("i1", `icmp ne ptr ${this.rt("ore_rt_map_get", [s, value]).v}, null`)
      default:
        return this.rtBool("ore_rt_map_delete", [s, value])
    }
  }

  protected chanOp(e: ir.ChanOp): V {
    const T = e.chanType.elem
    const t = this.mt(T)
    switch (e.op) {
      case "new":
        return this.rt("ore_rt_chan_new", [{ ty: "i64", v: sizeOf(t) }, this.expr(e.value!)])
      case "close":
        this.rt("ore_rt_chan_close", [this.expr(e.chan!)])
        return voidValue
      case "send": {
        // The channel is evaluated before the value, and the value needs an address.
        const c = this.expr(e.chan!)
        const v = this.b.alloca(t)
        this.store(this.expr(e.value!), v, T)
        this.rt("ore_rt_chan_send", [c, { ty: "ptr", v }])
        return voidValue
      }
      case "receive": {
        const u = e.type as UnionType
        const v = this.b.alloca(t)
        const ok = this.rtBool("ore_rt_chan_recv", [this.expr(e.chan!), { ty: "ptr", v }])
        return this.choose(ok, () => this.recast(this.load(v, T), T, u), () => this.inject(u, u.members.findIndex((m) => m.kind === "null"), undefined), this.lt(u))
      }
      case "on-receive": {
        const c = this.expr(e.chan!)
        const h = this.expr(e.handler!)
        return this.rt("ore_rt_case_recv", [c, h, { ty: "ptr", v: this.receiveDispatch(T, e.handler!.type as ir.FuncType) }])
      }
      default: {
        const c = this.expr(e.chan!)
        const v = this.b.alloca(t)
        this.store(this.expr(e.value!), v, T)
        return this.rt("ore_rt_case_send", [c, { ty: "ptr", v }, this.expr(e.handler!)])
      }
    }
  }

  /** A function calling the handler of a receive case with the value, as its `T | null` parameter. */
  protected receiveDispatch(elem: Type, handler: ir.FuncType): string {
    const param = handler.params[0] as UnionType | undefined
    const name = globalName(`dispatch.${ir.typeKey(param ?? elem)}.${handler.params.length}`)
    if (this.helpers.has(name)) return name
    this.helpers.set(name, "")
    this.helper(name, `define internal void ${name}(ptr %c)`, (e) => {
      const ok = e.b.alloca("i8")
      const p = e.rt("ore_rt_case_value", [{ ty: "ptr", v: "%c" }, { ty: "ptr", v: ok }])
      const h = e.rt("ore_rt_case_handler", [{ ty: "ptr", v: "%c" }])
      if (!param) {
        e.callClosure(h, handler, [])
      } else {
        const got = e.b.value("i1", `trunc i8 ${e.b.value("i8", `load i8, ptr ${ok}`).v} to i1`)
        const u = e.choose(got, () => e.recast(e.load(p.v, elem), elem, param), () => e.inject(param, param.members.findIndex((m) => m.kind === "null"), undefined), e.lt(param))
        e.callClosure(h, handler, [u])
      }
      e.b.terminate("ret void")
    })
    return name
  }

  protected itab(itab: ir.Itab): string {
    const s = this.structType(itab.struct)
    const entries = itab.iface.members.map((m) => {
      if (m.k === "field") return `ptr getelementptr (${s}, ptr null, i32 0, i32 ${itab.struct.fields.findIndex((f) => f.name === m.name)})`
      return `ptr ${globalName(ir.findMethod(itab.struct, m.name)!.func.name)}`
    })
    const all = [`ptr getelementptr (i8, ptr null, i64 ${typeId(itab.struct)})`, ...entries]
    return `@itab.${itab.id} = internal constant [${all.length} x ptr] [${all.join(", ")}]`
  }
}
