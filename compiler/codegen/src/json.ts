// JSON: an encoder and a decoder generated per type.
import * as ir from "@ore/ir"
import { typeToString, unionRepr, type Type, type UnionType } from "@ore/ir"
import { globalName, sizeOf, utf8, type V } from "./ll"
import { STR, ARRAY, MAP, SB, JSON_VALUE, JSON_CTX, JSON_NULL, JSON_BOOL, JSON_NUMBER, JSON_STRING, JSON_ARRAY, JSON_OBJECT } from "./context"
import { CollectionEmitter } from "./collections"

export abstract class JsonEmitter extends CollectionEmitter {
  protected json(e: ir.BuiltinCall): V {
    this.defs.set(SB, `${SB} = type { ptr, i64, i64 }`)
    this.defs.set(JSON_VALUE, `${JSON_VALUE} = type { i32, i8, double, ${STR}, i64, ptr, ptr }`)
    this.defs.set(JSON_CTX, `${JSON_CTX} = type { i8, ${STR}, ${STR} }`)
    if (e.name === "JSON.stringify") {
      const value = this.expr(e.args[0]!)
      const indent = e.args[1] ? this.expr(e.args[1]) : this.i64(0)
      const b = this.b.alloca(SB)
      this.b.emit(`store ${SB} zeroinitializer, ptr ${b}`)
      this.b.emit(`call void ${this.jsonEncoder(e.args[0]!.type)}(ptr ${b}, ${value.ty} ${value.v}, i64 ${indent.v}, i64 0)`)
      return this.rt("ore_sb_string", [{ ty: "ptr", v: b }])
    }
    // JSON.parse<T>(text): parses, then reads a T, or makes an Error from the first problem.
    const u = e.type as UnionType
    const target = e.typeArgs![0]!
    const text = this.expr(e.args[0]!)
    const message = this.b.alloca(STR)
    const parsed = this.rt("ore_rt_json_parse", [text, { ty: "ptr", v: message }])
    const errorIndex = u.members.findIndex((m) => m.kind === "interface")
    const fail = (m: V) => this.inject(u, errorIndex, this.error(e, m))
    return this.choose(
      this.b.value("i1", `icmp eq ptr ${parsed.v}, null`),
      () => fail(this.b.value(STR, `load ${STR}, ptr ${message}`)),
      () => {
        const c = this.b.alloca(JSON_CTX)
        this.b.emit(`store ${JSON_CTX} zeroinitializer, ptr ${c}`)
        const ty = this.lt(target)
        const r = this.b.value(ty, `call ${ty} ${this.jsonDecoder(target)}(ptr ${parsed.v}, ptr ${c})`)
        return this.choose(this.jsonFailed(c), () => fail(this.rt("ore_rt_json_error", [{ ty: "ptr", v: c }])), () => this.recast(r, target, u), this.lt(u))
      },
      this.lt(u),
    )
  }

  protected jsonFailed(c: string): V {
    return this.b.value("i1", `trunc i8 ${this.b.value("i8", `load i8, ptr ${this.field(c, JSON_CTX, 0)}`).v} to i1`)
  }

  /** Puts literal bytes into the string builder `b`. */
  protected put(b: V, text: string) {
    this.rt("ore_sb_put", [b, this.cstr(text), this.i64(utf8(text).length)])
  }

  protected putc(b: V, c: string) {
    this.rt("ore_sb_putc", [b, this.i64(c.charCodeAt(0))])
  }

  /** A helper writing a value of a type as JSON: `(ptr b, T v, i64 indent, i64 depth)`. */
  protected jsonEncoder(type: Type): string {
    const name = globalName(`json.enc.${ir.typeKey(type)}`)
    if (this.helpers.has(name)) return name
    this.helpers.set(name, "")
    const ty = this.lt(type)
    this.helper(name, `define internal void ${name}(ptr %b, ${ty} %v, i64 %indent, i64 %depth)`, (e) => {
      e.encodeJson(type, { ty: "ptr", v: "%b" }, { ty, v: "%v" })
      e.b.terminate("ret void")
    })
    return name
  }

  protected encodeJson(type: Type, b: V, v: V) {
    const indent: V = { ty: "i64", v: "%indent" }
    const depth: V = { ty: "i64", v: "%depth" }
    const deeper = this.b.value("i64", `add i64 %depth, 1`)
    const encode = (t: Type, x: V) => this.b.emit(`call void ${this.jsonEncoder(t)}(ptr ${b.v}, ${x.ty} ${x.v}, i64 %indent, i64 ${deeper.v})`)
    const newline = (d: V) => this.rt("ore_rt_json_newline", [b, indent, d])
    const spaceIfIndented = () => {
      const yes = this.b.label("space")
      const no = this.b.label("nospace")
      this.b.condBr(this.b.value("i1", `icmp sgt i64 %indent, 0`), yes, no)
      this.b.start(yes)
      this.putc(b, " ")
      this.b.start(no)
    }
    switch (type.kind) {
      case "int":
        if (type.signed) this.rt("ore_rt_json_i64", [b, this.toI64(v)])
        else this.rt("ore_rt_json_u64", [b, this.toI64(v, false)])
        return
      case "float":
        this.rt(type.bits === 32 ? "ore_rt_json_f32" : "ore_rt_json_f64", [b, v])
        return
      case "bool": {
        const t = this.b.label("true")
        const f = this.b.label("false")
        const end = this.b.label("bool")
        this.b.condBr(v, t, f)
        this.b.start(t)
        this.put(b, "true")
        this.b.br(end)
        this.b.start(f)
        this.put(b, "false")
        this.b.start(end)
        return
      }
      case "string":
      case "literal":
        this.rt("ore_rt_json_str", [b, v])
        return
      case "union": {
        if (unionRepr(type).k === "strings") {
          this.rt("ore_rt_json_str", [b, v])
          return
        }
        const end = this.b.label("encoded")
        type.members.forEach((m, i) => {
          const here = this.b.label("jmember")
          const next = this.b.label("jnext")
          this.b.condBr(this.slotTest(type, v, i), here, next)
          this.b.start(here)
          if (m.kind === "null") this.put(b, "null")
          else this.b.emit(`call void ${this.jsonEncoder(m)}(ptr ${b.v}, ${this.lt(m)} ${this.payload(type, v, i).v}, i64 %indent, i64 %depth)`)
          this.b.br(end)
          this.b.start(next)
        })
        this.b.start(end)
        return
      }
      case "array": {
        const elem = this.mt(type.elem)
        this.putc(b, "[")
        const len = this.b.value("i64", `load i64, ptr ${this.field(v.v, ARRAY, 1)}`)
        this.counted(len, (i) => {
          this.commaAfterFirst(b, i)
          newline(deeper)
          const data = this.b.value("ptr", `load ptr, ptr ${this.field(v.v, ARRAY, 0)}`)
          encode(type.elem, this.load(this.b.value("ptr", `getelementptr ${elem}, ptr ${data.v}, i64 ${i.v}`).v, type.elem))
        })
        this.ifNonZero(len, () => newline(depth))
        this.putc(b, "]")
        return
      }
      case "map": {
        this.putc(b, "{")
        const n = this.b.alloca("i64")
        this.b.emit(`store i64 0, ptr ${n}`)
        const count = this.b.value("i64", `load i64, ptr ${this.field(v.v, MAP, 6)}`)
        this.counted(count, (i) => {
          const live = this.b.label("live")
          const dead = this.b.label("dead")
          this.b.condBr(this.rtBool("ore_rt_map_live", [v, i]), live, dead)
          this.b.start(live)
          const written = this.b.value("i64", `load i64, ptr ${n}`)
          this.commaAfterFirst(b, written)
          this.b.emit(`store i64 ${this.b.value("i64", `add i64 ${written.v}, 1`).v}, ptr ${n}`)
          newline(deeper)
          this.rt("ore_rt_json_str", [b, this.load(this.rt("ore_rt_map_key", [v, i]).v, type.key)])
          this.putc(b, ":")
          spaceIfIndented()
          encode(type.value, this.load(this.rt("ore_rt_map_value", [v, i]).v, type.value))
          this.b.start(dead)
        })
        this.ifNonZero(this.b.value("i64", `load i64, ptr ${n}`), () => newline(depth))
        this.putc(b, "}")
        return
      }
      case "struct": {
        this.putc(b, "{")
        type.fields.forEach((f, i) => {
          if (i > 0) this.putc(b, ",")
          newline(deeper)
          this.put(b, `${JSON.stringify(f.name)}:`)
          spaceIfIndented()
          encode(f.type, this.load(this.fieldPtr(v.v, type, f.name), f.type))
        })
        if (type.fields.length > 0) newline(depth)
        this.putc(b, "}")
        return
      }
      default:
        this.put(b, "null")
    }
  }

  /** Runs `body` for i from 0 to n - 1. */
  protected counted(n: V, body: (i: V) => void) {
    const i = this.b.alloca("i64")
    this.b.emit(`store i64 0, ptr ${i}`)
    const head = this.b.label("chead")
    const loop = this.b.label("cbody")
    const end = this.b.label("cend")
    this.b.start(head)
    const at = this.b.value("i64", `load i64, ptr ${i}`)
    this.b.condBr(this.b.value("i1", `icmp slt i64 ${at.v}, ${n.v}`), loop, end)
    this.b.start(loop)
    body(at)
    this.b.emit(`store i64 ${this.b.value("i64", `add i64 ${at.v}, 1`).v}, ptr ${i}`)
    this.b.br(head)
    this.b.start(end)
  }

  protected ifNonZero(n: V, body: () => void) {
    const yes = this.b.label("nonzero")
    const end = this.b.label("zero")
    this.b.condBr(this.b.value("i1", `icmp ne i64 ${n.v}, 0`), yes, end)
    this.b.start(yes)
    body()
    this.b.start(end)
  }

  protected commaAfterFirst(b: V, i: V) {
    this.ifNonZero(i, () => this.putc(b, ","))
  }

  /** A helper reading a value of a type from a parsed JSON value: `T (ptr v, ptr c)`. */
  protected jsonDecoder(type: Type): string {
    const name = globalName(`json.dec.${ir.typeKey(type)}`)
    if (this.helpers.has(name)) return name
    this.helpers.set(name, "")
    const ty = this.lt(type)
    this.helper(name, `define internal ${ty} ${name}(ptr %v, ptr %c)`, (e) => e.decodeJson(type))
    return name
  }

  protected decodeJson(type: Type) {
    const ty = this.lt(type)
    const v: V = { ty: "ptr", v: "%v" }
    const c: V = { ty: "ptr", v: "%c" }
    const fail = () => this.b.terminate(ty === "void" ? "ret void" : `ret ${ty} ${this.zero(type).v}`)
    const kind = () => this.b.value("i32", `load i32, ptr ${this.field("%v", JSON_VALUE, 0)}`)
    /** Fails unless the JSON value has a kind, with "expected <what>". */
    const expect = (k: number, what: string) => {
      const ok = this.b.label("kind")
      const bad = this.b.label("badkind")
      this.b.condBr(this.b.value("i1", `icmp eq i32 ${kind().v}, ${k}`), ok, bad)
      this.b.start(bad)
      this.rt("ore_rt_json_expected", [c, this.cstr(what), v])
      fail()
      this.b.start(ok)
    }
    const failedHere = (onFail: () => void) => {
      const bad = this.b.label("failed")
      const ok = this.b.label("fine")
      this.b.condBr(this.jsonFailed("%c"), bad, ok)
      this.b.start(bad)
      onFail()
      fail()
      this.b.start(ok)
    }
    const ret = (x: V) => this.b.terminate(`ret ${ty} ${x.v}`)
    switch (type.kind) {
      case "int": {
        const out = this.b.alloca("i64")
        const min = type.signed ? -(1n << BigInt(type.bits - 1)) : 0n
        const max = type.signed ? (1n << BigInt(type.bits - 1)) - 1n : (1n << BigInt(type.bits)) - 1n
        const ok = type.signed
          ? this.rtBool("ore_rt_json_int", [c, v, this.i64(min), this.i64(max), { ty: "ptr", v: out }])
          : this.rtBool("ore_rt_json_uint", [c, v, this.i64(max), { ty: "ptr", v: out }])
        const good = this.b.label("int")
        const bad = this.b.label("badint")
        this.b.condBr(ok, good, bad)
        this.b.start(bad)
        fail()
        this.b.start(good)
        ret(this.fromI64(this.b.value("i64", `load i64, ptr ${out}`), ty))
        return
      }
      case "float": {
        expect(JSON_NUMBER, "a number")
        const num = this.b.value("double", `load double, ptr ${this.field("%v", JSON_VALUE, 2)}`)
        ret(type.bits === 32 ? this.b.value("float", `fptrunc double ${num.v} to float`) : num)
        return
      }
      case "bool":
        expect(JSON_BOOL, "a boolean")
        ret(this.b.value("i1", `trunc i8 ${this.b.value("i8", `load i8, ptr ${this.field("%v", JSON_VALUE, 1)}`).v} to i1`))
        return
      case "string":
        expect(JSON_STRING, "a string")
        ret(this.b.value(STR, `load ${STR}, ptr ${this.field("%v", JSON_VALUE, 3)}`))
        return
      case "literal": {
        const what = JSON.stringify(type.value)
        expect(JSON_STRING, what)
        const s = this.b.value(STR, `load ${STR}, ptr ${this.field("%v", JSON_VALUE, 3)}`)
        this.checkOr(this.rtBool("ore_rt_str_eq", [s, this.str(type.value)]), () => this.rt("ore_rt_json_expected", [c, this.cstr(what), v]), fail)
        ret(s)
        return
      }
      case "union": {
        if (unionRepr(type).k === "strings") {
          if (type.members.some((m) => m.kind === "string")) {
            expect(JSON_STRING, "a string")
            ret(this.b.value(STR, `load ${STR}, ptr ${this.field("%v", JSON_VALUE, 3)}`))
            return
          }
          const literals = type.members.map((m) => (m as ir.LiteralType).value)
          const what = literals.map((l) => JSON.stringify(l)).join(" or ")
          const isString = this.b.value("i1", `icmp eq i32 ${kind().v}, ${JSON_STRING}`)
          this.checkOr(isString, () => this.rt("ore_rt_json_expected", [c, this.cstr(what), v]), fail)
          const s = this.b.value(STR, `load ${STR}, ptr ${this.field("%v", JSON_VALUE, 3)}`)
          let any: V = { ty: "i1", v: "false" }
          for (const l of literals) any = this.b.value("i1", `or i1 ${any.v}, ${this.rtBool("ore_rt_str_eq", [s, this.str(l)]).v}`)
          this.checkOr(any, () => this.rt("ore_rt_json_expected", [c, this.cstr(what), v]), fail)
          ret(s)
          return
        }
        const nullIndex = type.members.findIndex((m) => m.kind === "null")
        const others = type.members.flatMap((m, i) => (m.kind === "null" ? [] : [i]))
        if (nullIndex >= 0) {
          const isNull = this.b.label("jnull")
          const notNull = this.b.label("jnotnull")
          this.b.condBr(this.b.value("i1", `icmp eq i32 ${kind().v}, ${JSON_NULL}`), isNull, notNull)
          this.b.start(isNull)
          ret(this.inject(type, nullIndex, undefined))
          this.b.start(notNull)
        }
        // One possibility reports its own error; several are tried in order.
        if (others.length === 1) {
          const i = others[0]!
          const mt = this.lt(type.members[i]!)
          const x = this.b.value(mt, `call ${mt} ${this.jsonDecoder(type.members[i]!)}(ptr %v, ptr %c)`)
          failedHere(() => {})
          ret(this.inject(type, i, x))
          return
        }
        for (const i of others) {
          const t = this.b.alloca(JSON_CTX)
          this.b.emit(`store ${JSON_CTX} zeroinitializer, ptr ${t}`)
          const mt = this.lt(type.members[i]!)
          const x = this.b.value(mt, `call ${mt} ${this.jsonDecoder(type.members[i]!)}(ptr %v, ptr ${t})`)
          const ok = this.b.label("tried")
          const next = this.b.label("trynext")
          this.b.condBr(this.jsonFailed(t), next, ok)
          this.b.start(ok)
          ret(this.inject(type, i, x))
          this.b.start(next)
        }
        this.rt("ore_rt_json_expected", [c, this.cstr(typeToString(type)), v])
        fail()
        return
      }
      case "array": {
        expect(JSON_ARRAY, "an array")
        const elem = this.mt(type.elem)
        const len = this.b.value("i64", `load i64, ptr ${this.field("%v", JSON_VALUE, 4)}`)
        const a = this.rt("ore_rt_array_new", [{ ty: "i64", v: sizeOf(elem) }, len])
        const items = this.b.value("ptr", `load ptr, ptr ${this.field("%v", JSON_VALUE, 5)}`)
        this.counted(len, (i) => {
          const item = this.b.value("ptr", `load ptr, ptr ${this.b.value("ptr", `getelementptr ptr, ptr ${items.v}, i64 ${i.v}`).v}`)
          const et = this.lt(type.elem)
          const x = this.b.value(et, `call ${et} ${this.jsonDecoder(type.elem)}(ptr ${item.v}, ptr %c)`)
          failedHere(() => this.rt("ore_rt_json_at_index", [c, i]))
          const data = this.b.value("ptr", `load ptr, ptr ${this.field(a.v, ARRAY, 0)}`)
          this.store(x, this.b.value("ptr", `getelementptr ${elem}, ptr ${data.v}, i64 ${i.v}`).v, type.elem)
        })
        ret(a)
        return
      }
      case "map": {
        expect(JSON_OBJECT, "an object")
        const { hash, eq } = this.keyFunctions(type.key)
        const kt = this.mt(type.key)
        const vt = this.mt(type.value)
        const m = this.rt("ore_rt_map_new", [{ ty: "i64", v: sizeOf(kt) }, { ty: "i64", v: sizeOf(vt) }, { ty: "ptr", v: hash }, { ty: "ptr", v: eq }])
        const len = this.b.value("i64", `load i64, ptr ${this.field("%v", JSON_VALUE, 4)}`)
        const items = this.b.value("ptr", `load ptr, ptr ${this.field("%v", JSON_VALUE, 5)}`)
        const keys = this.b.value("ptr", `load ptr, ptr ${this.field("%v", JSON_VALUE, 6)}`)
        this.counted(len, (i) => {
          // Keys are read as JSON strings, so that literal key types are checked.
          const keyText = this.b.value(STR, `load ${STR}, ptr ${this.b.value("ptr", `getelementptr ${STR}, ptr ${keys.v}, i64 ${i.v}`).v}`)
          const keyJson = this.b.alloca(JSON_VALUE)
          this.b.emit(`store ${JSON_VALUE} zeroinitializer, ptr ${keyJson}`)
          this.b.emit(`store i32 ${JSON_STRING}, ptr ${this.field(keyJson, JSON_VALUE, 0)}`)
          this.b.emit(`store ${STR} ${keyText.v}, ptr ${this.field(keyJson, JSON_VALUE, 3)}`)
          const kl = this.lt(type.key)
          const k = this.b.value(kl, `call ${kl} ${this.jsonDecoder(type.key)}(ptr ${keyJson}, ptr %c)`)
          failedHere(() => this.rt("ore_rt_json_at_field", [c, this.rt("ore_rt_cstring", [keyText])]))
          const item = this.b.value("ptr", `load ptr, ptr ${this.b.value("ptr", `getelementptr ptr, ptr ${items.v}, i64 ${i.v}`).v}`)
          const vl = this.lt(type.value)
          const x = this.b.value(vl, `call ${vl} ${this.jsonDecoder(type.value)}(ptr ${item.v}, ptr %c)`)
          failedHere(() => this.rt("ore_rt_json_at_field", [c, this.rt("ore_rt_cstring", [keyText])]))
          const kp = this.b.alloca(kt)
          this.store(k, kp, type.key)
          const xp = this.b.alloca(vt)
          this.store(x, xp, type.value)
          this.rt("ore_rt_map_set", [m, { ty: "ptr", v: kp }, { ty: "ptr", v: xp }])
        })
        ret(m)
        return
      }
      case "struct": {
        expect(JSON_OBJECT, "an object")
        const s = this.structType(type)
        const o = this.alloc(s)
        for (const f of type.fields) {
          const name = this.cstr(f.name)
          const found = this.rt("ore_rt_json_field", [v, name, this.i64(utf8(f.name).length)])
          const target = this.fieldPtr(o.v, type, f.name)
          const present = this.b.label("present")
          const missing = this.b.label("missing")
          const next = this.b.label("nextfield")
          this.b.condBr(this.b.value("i1", `icmp ne ptr ${found.v}, null`), present, missing)
          this.b.start(missing)
          const u = f.type.kind === "union" ? f.type : undefined
          const nullIndex = u ? u.members.findIndex((m) => m.kind === "null") : -1
          if (nullIndex >= 0) {
            this.store(this.inject(u!, nullIndex, undefined), target, f.type)
            this.b.br(next)
          } else {
            this.rt("ore_rt_json_missing", [c, name])
            fail()
          }
          this.b.start(present)
          const fl = this.lt(f.type)
          const x = this.b.value(fl, `call ${fl} ${this.jsonDecoder(f.type)}(ptr ${found.v}, ptr %c)`)
          failedHere(() => this.rt("ore_rt_json_at_field", [c, name]))
          this.store(x, target, f.type)
          this.b.start(next)
        }
        ret(o)
        return
      }
      default:
        this.rt("ore_rt_json_expected", [c, this.cstr("a value"), v])
        fail()
    }
  }

  /** Continues when `ok` holds; otherwise runs `report` and `fail`. */
  protected checkOr(ok: V, report: () => void, fail: () => void) {
    const good = this.b.label("good")
    const bad = this.b.label("bad")
    this.b.condBr(ok, good, bad)
    this.b.start(bad)
    report()
    fail()
    this.b.start(good)
  }
}
