// The state of the emitter, LLVM types, constants, runtime calls, memory and locals: what every layer uses.
import * as ir from "@ore/ir"
import { unionRepr, type IntType, type Type, type UnionType } from "@ore/ir"
import type { StackPlan } from "@ore/opt"
import { cString, FnBuilder, globalName, intConstant, sizeOf, utf8, voidValue, type V } from "./ll"
import { type EmitOptions, STR, FN, IFACE, type Breakable, type Storage } from "./context"
import { boxed } from "./helpers"

export abstract class EmitterBase {
  protected abstract arrayMethod(e: ir.ArrayMethod): V
  protected abstract bound(e: ir.BoundMethod): V
  protected abstract builtin(e: ir.BuiltinCall): V
  protected abstract call(e: ir.Call): V
  protected abstract callClosure(f: V, type: ir.FuncType, args: V[]): V
  protected abstract callDirect(name: string, ret: string, args: V[]): V
  protected abstract callIndirect(fn: string, ret: string, args: V[]): V
  protected abstract chanOp(e: ir.ChanOp): V
  protected abstract closure(e: ir.Closure): V
  protected abstract concat(parts: (readonly [V, Type])[]): V
  protected abstract expr(e: ir.Expr): V
  protected abstract helper(name: string, header: string, body: (e: this) => void): void
  protected abstract json(e: ir.BuiltinCall): V
  protected abstract mapOp(e: ir.MapOp): V
  protected abstract stringMethod(e: ir.StringMethod): V
  protected abstract thunk(func: ir.Func): string

  protected out: string[] = []

  protected defs = new Map<string, string>()

  protected decls = new Map<string, string>()

  protected strings = new Map<string, string>()

  protected helpers = new Map<string, string>()

  protected globals = new Set<ir.Local>()

  protected plan: StackPlan = { slots: new Map(), ctorsAt: new Set() }

  protected file = ""

  /** Runtime functions written in Ore, by the name of the C function they replace. */
  protected runtime = new Map<string, ir.Func>()

  // The function being emitted.
  protected b = new FnBuilder()

  protected func: ir.Func | undefined

  protected at = false

  protected storage = new Map<ir.Local, Storage>()

  protected slots = new Map<ir.Expr | ir.Local, string>()

  protected breakables: Breakable[] = []

  protected disposals: { stmt: ir.Stmt; depth: number }[] = []

  protected frame: string | undefined

  constructor(
    protected module: ir.Module,
    protected options: EmitOptions,
  ) {}

  /** The LLVM type of values of an Ore type in registers. */
  lt(type: Type): string {
    switch (type.kind) {
      case "int":
        return `i${type.bits}`
      case "float":
        return type.bits === 32 ? "float" : "double"
      case "bool":
        return "i1"
      case "string":
      case "literal":
        return STR
      case "void":
      case "never":
        return "void"
      case "interface":
        return IFACE
      case "func":
        return FN
      case "union": {
        const repr = unionRepr(type)
        if (repr.k === "strings") return STR
        if (repr.k === "nullable") return this.lt(repr.base)
        return this.unionType(type)
      }
      default:
        return "ptr"
    }
  }

  /** The LLVM type of values of an Ore type in memory: booleans take a byte. */
  mt(type: Type): string {
    return type.kind === "bool" ? "i8" : this.lt(type)
  }

  protected structType(s: ir.StructType): string {
    const name = `%S.${s.id}`
    if (!this.defs.has(name)) {
      this.defs.set(name, "")
      const fields = s.fields.length === 0 ? ["i8"] : s.fields.map((f) => this.mt(f.type))
      this.defs.set(name, `${name} = type { ${fields.join(", ")} }`)
    }
    return name
  }

  protected unionType(u: UnionType): string {
    const name = `%U.${u.id}`
    if (!this.defs.has(name)) this.defs.set(name, `${name} = type { i32, [${this.unionWords(u)} x i64] }`)
    return name
  }

  /** The number of 64-bit words of the payload of a tagged union: two for strings, functions and interfaces. */
  protected unionWords(u: UnionType): number {
    return Math.max(1, ...u.members.map((m) => (this.lt(m) === STR || this.lt(m) === FN || this.lt(m) === IFACE ? 2 : 1)))
  }

  protected envType(func: ir.Func): string {
    const name = `%E.${func.name}`
    if (!this.defs.has(name)) {
      const fields = func.captures!.map((c) => (boxed(c) ? "ptr" : this.mt(c.type)))
      this.defs.set(name, `${name} = type { ${fields.length ? fields.join(", ") : "i8"} }`)
    }
    return name
  }

  /** A string value constant. */
  protected str(value: string): V {
    const bytes = utf8(value)
    return { ty: STR, v: `{ ptr ${this.bytes(bytes)}, i64 ${bytes.length} }` }
  }

  /** A NUL-terminated C string constant. */
  protected cstr(value: string): V {
    const bytes = utf8(value)
    const withNul = new Uint8Array(bytes.length + 1)
    withNul.set(bytes)
    return { ty: "ptr", v: this.bytes(withNul) }
  }

  protected bytes(bytes: Uint8Array): string {
    const key = Array.from(bytes).join(",")
    let name = this.strings.get(key)
    if (!name) {
      const id = `@str.${this.strings.size}`
      this.strings.set(key, `${id} = private unnamed_addr constant [${bytes.length} x i8] ${cString(bytes)}`)
      name = id
    }
    return name.split(" ")[0]!
  }

  protected int(type: IntType | "i64" | "i32", value: bigint | number): V {
    const bits = typeof type === "string" ? Number(type.slice(1)) : type.bits
    return { ty: `i${bits}`, v: intConstant(BigInt(value), bits) }
  }

  protected i64(value: number | bigint): V {
    return this.int("i64", value)
  }

  /**
   * Calls runtime function `name`, written in Ore (`//ore:runtime name` in
   * runtime/core). Integers and booleans come back as i64.
   */
  protected rt(name: string, args: V[]): V {
    const own = this.runtime.get(name)
    if (!own) throw new Error(`no runtime function ${name}`)
    return this.rtOre(own, args)
  }

  /**
   * Calls a runtime function written in Ore, with the conventions of `rt`
   * for its callers: integers and booleans come back as i64.
   */
  protected rtOre(func: ir.Func, args: V[]): V {
    const operands = func.params.map((p, i) => {
      const arg = args[i]!
      const ty = this.lt(p.type)
      if (arg.ty === ty) return `${ty} ${arg.v}`
      if (ty === "i1") return `i1 ${this.b.value("i1", `icmp ne ${arg.ty} ${arg.v}, 0`).v}`
      if (p.type.kind === "int") {
        const from = Number(arg.ty.slice(1))
        const op = from > p.type.bits ? "trunc" : arg.ty === "i1" || !p.type.signed ? "zext" : "sext"
        return `${ty} ${this.b.value(ty, `${op} ${arg.ty} ${arg.v} to ${ty}`).v}`
      }
      return `${ty} ${arg.v}`
    })
    const result = func.type.result
    const ty = this.lt(result)
    const call = `call ${ty} ${globalName(func.name)}(${operands.join(", ")})`
    if (ty === "void") {
      this.b.emit(call)
      return voidValue
    }
    const r = this.b.value(ty, call)
    if (result.kind === "bool") return this.b.value("i64", `zext i1 ${r.v} to i64`)
    if (result.kind === "int" && result.bits < 64) return this.b.value("i64", `${result.signed ? "sext" : "zext"} ${ty} ${r.v} to i64`)
    return r
  }

  /** A runtime call returning a C bool, as i1. */
  protected rtBool(name: string, args: V[]): V {
    return this.b.value("i1", `icmp ne i64 ${this.rt(name, args).v}, 0`)
  }

  protected panic(message: string) {
    this.rt("ore_rt_panic_cstr", [this.cstr(message)])
    this.b.terminate("unreachable")
  }

  protected alloc(ty: string): V {
    return this.rt("ore_rt_alloc", [{ ty: "i64", v: sizeOf(ty) }])
  }

  /** Stores a value in a new stack slot and returns the slot. */
  protected spill(v: V): string {
    const slot = this.b.alloca(v.ty)
    this.b.emit(`store ${v.ty} ${v.v}, ptr ${slot}`)
    return slot
  }

  protected toI64(v: V, signed = true): V {
    if (v.ty === "i64") return v
    if (v.ty === "i1") return this.b.value("i64", `zext i1 ${v.v} to i64`)
    return this.b.value("i64", `${signed ? "sext" : "zext"} ${v.ty} ${v.v} to i64`)
  }

  /** Converts an integer of a type to i64 by its signedness. */
  protected intToI64(v: V, type: Type): V {
    return this.toI64(v, type.kind !== "int" || type.signed)
  }

  protected fromI64(v: V, ty: string): V {
    if (ty === "i64") return v
    if (ty === "i1") return this.b.value("i1", `icmp ne i64 ${v.v}, 0`)
    return this.b.value(ty, `trunc i64 ${v.v} to ${ty}`)
  }

  protected load(ptr: string, type: Type): V {
    const mt = this.mt(type)
    const v = this.b.value(mt, `load ${mt}, ptr ${ptr}`)
    return type.kind === "bool" ? this.b.value("i1", `trunc i8 ${v.v} to i1`) : v
  }

  protected store(v: V, ptr: string, type: Type) {
    if (type.kind === "bool") {
      const byte = this.b.value("i8", `zext i1 ${v.v} to i8`)
      this.b.emit(`store i8 ${byte.v}, ptr ${ptr}`)
    } else {
      this.b.emit(`store ${this.mt(type)} ${v.v}, ptr ${ptr}`)
    }
  }

  protected field(ptr: string, structTy: string, index: number): string {
    return this.b.value("ptr", `getelementptr ${structTy}, ptr ${ptr}, i32 0, i32 ${index}`).v
  }

  protected extract(v: V, index: number, ty: string): V {
    return this.b.value(ty, `extractvalue ${v.ty} ${v.v}, ${index}`)
  }

  protected aggregate(ty: string, fields: V[]): V {
    let acc: V = { ty, v: "undef" }
    fields.forEach((f, i) => {
      acc = this.b.value(ty, `insertvalue ${ty} ${acc.v}, ${f.ty} ${f.v}, ${i}`)
    })
    return acc
  }

  protected zero(type: Type): V {
    const ty = this.lt(type)
    if (ty === "i1") return { ty, v: "false" }
    if (ty.startsWith("i")) return { ty, v: "0" }
    if (ty === "double" || ty === "float") return { ty, v: "0.0" }
    if (ty === "ptr") return { ty, v: "null" }
    return { ty, v: "zeroinitializer" }
  }

  protected globalOf(local: ir.Local): string {
    return local.exportName ? `@${local.exportName}` : globalName(`G.${local.name}.${local.id}`)
  }

  /**
   * The address of a global; a thread-local one is looked up on each access,
   * since tasks move between threads. LLVM may still reuse the address within
   * a function, across calls: the runtime reads its thread-locals only in
   * small functions that never park, and `top()` goes through a helper.
   */
  protected globalPlace(local: ir.Local): string {
    if (!local.threadLocal) return this.globalOf(local)
    return this.b.value("ptr", `call ptr @llvm.threadlocal.address.p0(ptr ${this.globalOf(local)})`).v
  }

  /** A pointer to where a local's value is, from the function being emitted. */
  protected place(local: ir.Local): string {
    if (local.global && this.globals.has(local)) return this.globalPlace(local)
    const captures = this.func?.captures
    const index = captures ? captures.indexOf(local) : -1
    if (index !== -1) {
      const env = this.envType(this.func!)
      const ptr = this.field("%env", env, index)
      return boxed(local) ? this.b.value("ptr", `load ptr, ptr ${ptr}`).v : ptr
    }
    const s = this.storage.get(local)
    if (!s) throw new Error(`local ${local.name}#${local.id} has no storage in ${this.func?.name}`)
    if (s.k === "direct") return s.ptr
    return this.b.value("ptr", `load ptr, ptr ${s.holder}`).v
  }

  /** The box of a captured, assigned local, from the function being emitted. */
  protected boxOf(local: ir.Local): V {
    const captures = this.func?.captures
    const index = captures ? captures.indexOf(local) : -1
    if (index !== -1) return this.b.value("ptr", `load ptr, ptr ${this.field("%env", this.envType(this.func!), index)}`)
    const s = this.storage.get(local)!
    return this.b.value("ptr", `load ptr, ptr ${(s as { holder: string }).holder}`)
  }

  protected read(local: ir.Local): V {
    return this.load(this.place(local), local.type)
  }

  /** Declares a local with a value (zero without one): a slot, or a box when closures capture and assign it. */
  protected declare(local: ir.Local, init: V | undefined) {
    if (local.global && this.globals.has(local)) {
      // A global without a value is zero from the start, and may already have been set by functions.
      if (init) this.store(init, this.globalPlace(local), local.type)
      return
    }
    const mt = this.mt(local.type)
    if (boxed(local)) {
      let holder = this.storage.get(local)
      if (!holder) {
        holder = { k: "boxed", holder: this.b.alloca("ptr") }
        this.storage.set(local, holder)
      }
      // The box exists before the value is computed, so a closure in it can capture itself.
      const slot = this.slots.get(local)
      let box: string
      if (slot) {
        this.b.emit(`store ${mt} zeroinitializer, ptr ${slot}`)
        box = slot
      } else {
        box = this.alloc(mt).v
      }
      this.b.emit(`store ptr ${box}, ptr ${(holder as { holder: string }).holder}`)
      if (init) this.store(init, box, local.type)
      return
    }
    let s = this.storage.get(local)
    if (!s) {
      s = { k: "direct", ptr: this.b.alloca(mt) }
      this.storage.set(local, s)
    }
    this.store(init ?? this.zero(local.type), (s as { ptr: string }).ptr, local.type)
  }
}
