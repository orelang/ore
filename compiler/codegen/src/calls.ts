// Calls and closures, strings and printing, built-ins (including `unsafe` and inline assembly).
import * as ir from "@ore/ir"
import type { IntType, Type, UnionType } from "@ore/ir"
import { cString, FnBuilder, globalName, sizeOf, utf8, voidValue, type V } from "./ll"
import { STR, FN, IFACE } from "./context"
import { boxed } from "./helpers"
import { ExpressionEmitter } from "./expressions"

export abstract class CallEmitter extends ExpressionEmitter {
  protected callDirect(name: string, ret: string, args: V[]): V {
    const operands = args.map((a) => `${a.ty} ${a.v}`).join(", ")
    if (ret === "void") {
      this.b.emit(`call void ${globalName(name)}(${operands})`)
      return voidValue
    }
    return this.b.value(ret, `call ${ret} ${globalName(name)}(${operands})`)
  }

  protected callIndirect(fn: string, ret: string, args: V[]): V {
    const operands = args.map((a) => `${a.ty} ${a.v}`).join(", ")
    if (ret === "void") {
      this.b.emit(`call void ${fn}(${operands})`)
      return voidValue
    }
    return this.b.value(ret, `call ${ret} ${fn}(${operands})`)
  }

  protected call(e: ir.Call): V {
    if (e.func.extern) {
      // Strings cross into C as NUL-terminated copies, and come back copied.
      const args = e.args.map((a, i) => {
        const v = this.expr(a)
        const t = e.func.params[i]!.type
        if (t.kind === "string") return `ptr ${this.rt("ore_rt_cstring", [v]).v}`
        return `${this.externType(t, true)} ${v.v}`
      })
      const result = e.func.type.result
      const ret = this.externType(result, false)
      if (ret === "void") {
        this.b.emit(`call void @${e.func.name}(${args.join(", ")})`)
        return voidValue
      }
      const v = this.b.value(ret.split(" ").pop()!, `call ${ret} @${e.func.name}(${args.join(", ")})`)
      return result.kind === "string" ? this.rt("ore_rt_from_cstring", [v]) : v
    }
    const args = e.args.map((a) => this.expr(a))
    const slot = this.slots.get(e)
    if (slot) return this.callDirect(`${e.func.name}_at`, this.lt(e.type), [{ ty: "ptr", v: this.slot(e)! }, ...args])
    return this.callDirect(e.func.name, this.lt(e.type), args)
  }

  /** Calls a closure value with the first arguments its type takes. */
  protected callClosure(f: V, type: ir.FuncType, args: V[]): V {
    const fn = this.extract(f, 0, "ptr")
    const env = this.extract(f, 1, "ptr")
    return this.callIndirect(fn.v, this.lt(type.result), [env, ...args.slice(0, type.params.length)])
  }

  protected closure(e: ir.Closure): V {
    const captures = e.func.captures ?? []
    const fn: V = { ty: "ptr", v: globalName(e.func.name) }
    if (captures.length === 0) return this.aggregate(FN, [fn, { ty: "ptr", v: "null" }])
    const env = this.envType(e.func)
    const ptr = this.slot(e) ?? this.alloc(env).v
    captures.forEach((c, i) => {
      const field = this.field(ptr, env, i)
      if (boxed(c)) this.b.emit(`store ptr ${this.boxOf(c).v}, ptr ${field}`)
      else this.store(this.read(c), field, c.type)
    })
    return this.aggregate(FN, [fn, { ty: "ptr", v: ptr }])
  }

  /** A function taking an unused environment that calls a top-level function, for function values. */
  protected thunk(func: ir.Func): string {
    const name = globalName(`${func.name}.thunk`)
    if (this.helpers.has(name)) return name
    this.helpers.set(name, "")
    const params = func.params.map((p, i) => `${this.lt(p.type)} %a${i}`)
    const ret = this.lt(func.type.result)
    this.helper(name, `define internal ${ret} ${name}(${["ptr %env", ...params].join(", ")})`, (e) => {
      const r = e.callDirect(func.name, ret, func.params.map((p, i) => ({ ty: e.lt(p.type), v: `%a${i}` })))
      e.b.terminate(ret === "void" ? "ret void" : `ret ${ret} ${r.v}`)
    })
    return name
  }

  /** A method bound to its receiver: the environment holds the receiver, a thunk calls the method. */
  protected bound(e: ir.BoundMethod): V {
    const type = e.type
    const receiverType = this.lt(e.receiver.type)
    const name = e.func ? globalName(`${e.func.name}.bound`) : globalName(`iface.bound.${ir.typeKey(type)}.${e.index}`)
    if (!this.helpers.has(name)) {
      this.helpers.set(name, "")
      const params = type.params.map((p, i) => `${this.lt(p)} %a${i}`)
      const ret = this.lt(type.result)
      this.helper(name, `define internal ${ret} ${name}(${["ptr %env", ...params].join(", ")})`, (x) => {
        const args = type.params.map((p, i) => ({ ty: x.lt(p), v: `%a${i}` }))
        const self = x.b.value(receiverType, `load ${receiverType}, ptr %env`)
        let r: V
        if (e.func) r = x.callDirect(e.func.name, ret, [self, ...args])
        else {
          const itab = x.extract(self, 1, "ptr")
          const fn = x.b.value("ptr", `load ptr, ptr ${x.b.value("ptr", `getelementptr ptr, ptr ${itab.v}, i64 ${e.index! + 1}`).v}`)
          r = x.callIndirect(fn.v, ret, [x.extract(self, 0, "ptr"), ...args])
        }
        x.b.terminate(ret === "void" ? "ret void" : `ret ${ret} ${r.v}`)
      })
    }
    const receiver = this.expr(e.receiver)
    const env = this.alloc(receiverType)
    this.b.emit(`store ${receiverType} ${receiver.v}, ptr ${env.v}`)
    return this.aggregate(FN, [{ ty: "ptr", v: name }, env])
  }

  /** Emits a helper function with its own builder, as if it were a function of the module. */
  helper(name: string, header: string, body: (e: this) => void) {
    const saved = { b: this.b, func: this.func, at: this.at, storage: this.storage, slots: this.slots, breakables: this.breakables, disposals: this.disposals, frame: this.frame }
    this.b = new FnBuilder()
    this.func = undefined
    this.at = false
    this.storage = new Map()
    this.slots = new Map()
    this.breakables = []
    this.disposals = []
    this.frame = undefined
    try {
      body(this)
      this.helpers.set(name, this.b.finish(header, "unreachable"))
    } finally {
      Object.assign(this, saved)
    }
  }

  /** Formats values as strings, like `print` does, and concatenates them. */
  protected concat(parts: (readonly [V, Type])[]): V {
    const strings = parts.map(([v, t]) => this.toStr(v, t))
    if (strings.length === 0) return this.str("")
    if (strings.length === 1) return strings[0]!
    const array = this.b.alloca(`[${strings.length} x ${STR}]`)
    strings.forEach((s, i) => this.b.emit(`store ${STR} ${s.v}, ptr ${this.b.value("ptr", `getelementptr ${STR}, ptr ${array}, i64 ${i}`).v}`))
    return this.rt("ore_rt_str_concat", [this.i64(strings.length), { ty: "ptr", v: array }])
  }

  protected toStr(v: V, t: Type): V {
    if (t.kind === "union") {
      let result = this.str("")
      // Members are tested in order; the first that matches wins.
      const ty = STR
      const slot = this.b.alloca(ty)
      this.b.emit(`store ${ty} ${result.v}, ptr ${slot}`)
      const end = this.b.label("tostr")
      t.members.forEach((m, i) => {
        const here = this.b.label("smember")
        const next = this.b.label("snext")
        this.b.condBr(this.slotTest(t, v, i), here, next)
        this.b.start(here)
        const s = m.kind === "null" ? this.str("null") : this.toStr(this.payload(t, v, i), m)
        this.b.emit(`store ${ty} ${s.v}, ptr ${slot}`)
        this.b.br(end)
        this.b.start(next)
      })
      this.b.start(end)
      result = this.b.value(ty, `load ${ty}, ptr ${slot}`)
      return result
    }
    switch (t.kind) {
      case "string":
      case "literal":
        return v
      case "int":
        return t.signed ? this.rt("ore_rt_str_from_i64", [this.toI64(v)]) : this.rt("ore_rt_str_from_u64", [this.toI64(v, false)])
      case "float":
        return this.rt(`ore_rt_str_from_${t.name}`, [v])
      case "bool":
        return this.rt("ore_rt_str_from_bool", [v])
      default:
        throw new Error(`cannot format ${t.kind}`)
    }
  }

  protected print(v: V, t: Type) {
    if (t.kind === "union") {
      const end = this.b.label("printed")
      t.members.forEach((m, i) => {
        const here = this.b.label("pmember")
        const next = this.b.label("pnext")
        this.b.condBr(this.slotTest(t, v, i), here, next)
        this.b.start(here)
        if (m.kind === "null") this.rt("ore_rt_print_string", [this.str("null")])
        else this.print(this.payload(t, v, i), m)
        this.b.br(end)
        this.b.start(next)
      })
      this.b.start(end)
      return
    }
    switch (t.kind) {
      case "int":
        if (t.signed) this.rt("ore_rt_print_i64", [this.toI64(v)])
        else this.rt("ore_rt_print_u64", [this.toI64(v, false)])
        return
      case "float":
        this.rt("ore_rt_print_string", [this.rt(`ore_rt_str_from_${t.name}`, [v])])
        return
      case "bool":
        this.rt("ore_rt_print_bool", [v])
        return
      case "string":
      case "literal":
        this.rt("ore_rt_print_string", [v])
        return
      default:
        throw new Error(`cannot print ${t.kind}`)
    }
  }

  protected builtin(e: ir.BuiltinCall): V {
    const name = e.name
    if (name === "console.log" || name === "console.error" || name === "console.write") {
      const values = e.args.map((a) => this.expr(a))
      if (name === "console.error") this.rt("ore_rt_print_to", [this.i64(2)])
      values.forEach((v, i) => {
        if (i > 0) this.rt("ore_rt_print_space", [])
        this.print(v, e.args[i]!.type)
      })
      if (name !== "console.write") this.rt("ore_rt_print_newline", [])
      if (name === "console.error") this.rt("ore_rt_print_to", [this.i64(1)])
      return voidValue
    }
    if (name === "JSON.stringify" || name === "JSON.parse") return this.json(e)
    if (name.startsWith("unsafe.")) return this.unsafe(e)
    const a = e.args.map((x) => this.expr(x))
    const ty = this.lt(e.type)
    const libm = ["sqrt", "pow", "exp", "log", "log2", "log10", "sin", "cos", "tan", "asin", "acos", "atan", "atan2", "hypot", "floor", "ceil", "trunc"]
    if (name.startsWith("Math.") && libm.includes(name.slice(5))) {
      const f = `@${name.slice(5)}`
      this.decls.set(f, `declare double ${f}(${a.map(() => "double").join(", ")})`)
      return this.b.value("double", `call double ${f}(${a.map((x) => `double ${x.v}`).join(", ")})`)
    }
    switch (name) {
      case "process.panic":
        this.rt("ore_rt_panic", [a[0]!])
        this.b.terminate("unreachable")
        return voidValue
      case "process.exit":
        this.rt("ore_rt_exit", [a[0]!])
        this.b.terminate("unreachable")
        return voidValue
      case "Math.abs":
        if (e.type.kind === "float") {
          this.decls.set("@llvm.fabs.f64", "declare double @llvm.fabs.f64(double)")
          this.decls.set("@llvm.fabs.f32", "declare float @llvm.fabs.f32(float)")
          return this.b.value(ty, `call ${ty} @llvm.fabs.${ty === "float" ? "f32" : "f64"}(${ty} ${a[0]!.v})`)
        }
        return this.b.value(ty, `select i1 ${this.b.value("i1", `icmp slt ${ty} ${a[0]!.v}, 0`).v}, ${ty} ${this.b.value(ty, `sub ${ty} 0, ${a[0]!.v}`).v}, ${ty} ${a[0]!.v}`)
      case "Math.min":
      case "Math.max": {
        const [x, y] = a as [V, V]
        const pick = name === "Math.min" ? (e.type.kind === "float" ? "olt" : (e.type as IntType).signed ? "slt" : "ult") : e.type.kind === "float" ? "ogt" : (e.type as IntType).signed ? "sgt" : "ugt"
        // `b_ < a_ ? b_ : a_`, with NaN if either is NaN.
        const yWins = this.b.value("i1", `${e.type.kind === "float" ? "fcmp" : "icmp"} ${pick} ${ty} ${y.v}, ${x.v}`)
        let r = this.b.value(ty, `select i1 ${yWins.v}, ${ty} ${y.v}, ${ty} ${x.v}`)
        if (e.type.kind === "float") {
          const nan = this.b.value("i1", `fcmp uno ${ty} ${x.v}, ${y.v}`)
          r = this.b.value(ty, `select i1 ${nan.v}, ${ty} 0x7FF8000000000000, ${ty} ${r.v}`)
        }
        return r
      }
      case "Math.round":
        return this.rt("ore_rt_round", [a[0]!])
      case "Math.cbrt":
        return this.rt("ore_rt_cbrt", [a[0]!])
      case "Math.sign": {
        const x = a[0]!
        const pos = this.b.value("i1", `fcmp ogt double ${x.v}, 0.0`)
        const neg = this.b.value("i1", `fcmp olt double ${x.v}, 0.0`)
        const r = this.b.value("double", `select i1 ${neg.v}, double -1.0, double ${x.v}`)
        return this.b.value("double", `select i1 ${pos.v}, double 1.0, double ${r.v}`)
      }
      case "Math.random":
        return this.rt("ore_rt_random", [])
      case "Number.toFixed":
        return this.rt("ore_rt_str_fixed", [a[0]!, a[1]!])
      case "Number.parseInt":
      case "Number.parseFloat": {
        const isInt = name === "Number.parseInt"
        const out = this.b.alloca(isInt ? "i64" : "double")
        const ok = isInt ? this.rtBool("ore_rt_parse_int", [a[0]!, a[1] ?? this.i64(0), { ty: "ptr", v: out }]) : this.rtBool("ore_rt_parse_float", [a[0]!, { ty: "ptr", v: out }])
        const u = e.type as UnionType
        return this.choose(
          ok,
          () => this.inject(u, u.members.findIndex((m) => m.kind !== "null"), this.b.value(isInt ? "i64" : "double", `load ${isInt ? "i64" : "double"}, ptr ${out}`)),
          () => this.inject(u, u.members.findIndex((m) => m.kind === "null"), undefined),
          ty,
        )
      }
      case "fs.readFile":
        return this.fallible(e, (out) => this.rtBool("ore_rt_read_file", [a[0]!, out]), STR)
      case "fs.writeFile":
        return this.fallible(e, (out) => this.rtBool("ore_rt_write_file", [a[0]!, a[1]!, out]), undefined)
      case "fs.exists":
        return this.rtBool("ore_rt_file_exists", [a[0]!])
      case "Date.now":
        return this.rt("ore_rt_now", [])
      case "process.args":
        return this.rt("ore_rt_args", [])
      case "process.getenv":
        return this.rt("ore_rt_getenv", [a[0]!])
      case "internal.runTest":
        this.rt("ore_rt_run_test", [a[0]!, a[1]!])
        return voidValue
      case "internal.netListen":
        return this.fallibleValue(e, (v, m) => this.rtBool("ore_rt_net_listen", [a[0]!, a[1]!, v, m]))
      case "internal.netConnect":
        return this.fallibleValue(e, (v, m) => this.rtBool("ore_rt_net_connect", [a[0]!, a[1]!, v, m]))
      case "internal.netAccept":
        return this.fallibleValue(e, (v, m) => this.rtBool("ore_rt_net_accept", [a[0]!, v, m]))
      case "internal.netRead":
        return this.fallible(e, (out) => this.rtBool("ore_rt_net_read", [a[0]!, a[1]!, out]), STR)
      case "internal.netWrite":
        return this.fallible(e, (out) => this.rtBool("ore_rt_net_write", [a[0]!, a[1]!, out]), undefined)
      case "internal.netClose":
        this.rt("ore_rt_net_close", [a[0]!])
        return voidValue
      case "internal.netPort":
        return this.rt("ore_rt_net_port", [a[0]!])
      case "task.spawn":
        this.rt("ore_rt_spawn", [a[0]!])
        return voidValue
      case "task.sleep":
        this.rt("ore_rt_sleep", [a[0]!])
        return voidValue
      case "task.yield":
        this.rt("ore_rt_yield", [])
        return voidValue
      case "task.after":
        return this.rt("ore_rt_case_after", [a[0]!, a[1]!])
      case "task.select":
        this.rt("ore_rt_select", [a[0]!, a[1] ?? { ty: FN, v: "zeroinitializer" }])
        return voidValue
    }
    throw new Error(`no built-in ${name}`)
  }

  /** The functions of `unsafe`: plain LLVM instructions and intrinsics. */
  protected unsafe(e: ir.BuiltinCall): V {
    const name = e.name.slice("unsafe.".length)
    if (name === "asm") return this.inlineAsm(e)
    const a = e.args.map((x) => this.expr(x))
    const T = e.typeArgs?.[0]
    const mt = T ? this.mt(T) : ""
    // Atomic accesses need an explicit alignment: the natural one of integers and pointers.
    const align = T?.kind === "int" ? Math.max(1, T.bits / 8) : 8
    const intrinsic = (decl: string) => this.decls.set(decl.slice(decl.indexOf("@"), decl.indexOf("(")), decl)
    switch (name) {
      case "sizeOf":
        return { ty: "i64", v: sizeOf(mt) }
      case "alignOf":
        return { ty: "i64", v: `ptrtoint (ptr getelementptr ({ i8, ${mt} }, ptr null, i32 0, i32 1) to i64)` }
      case "add":
        return this.b.value("ptr", `getelementptr i8, ptr ${a[0]!.v}, i64 ${a[1]!.v}`)
      case "diff": {
        const x = this.b.value("i64", `ptrtoint ptr ${a[0]!.v} to i64`)
        const y = this.b.value("i64", `ptrtoint ptr ${a[1]!.v} to i64`)
        return this.b.value("i64", `sub i64 ${x.v}, ${y.v}`)
      }
      case "toInt":
        return this.b.value("i64", `ptrtoint ptr ${a[0]!.v} to i64`)
      case "fromInt":
        return this.b.value("ptr", `inttoptr i64 ${a[0]!.v} to ptr`)
      case "bitcast":
        return a[0]!.ty === mt ? { ty: mt, v: a[0]!.v } : this.b.value(mt, `bitcast ${a[0]!.ty} ${a[0]!.v} to ${mt}`)
      case "load":
        return this.load(a[0]!.v, T!)
      case "store":
        this.store(a[1]!, a[0]!.v, T!)
        return voidValue
      case "alloc":
        return this.rt("ore_rt_alloc", [a[0]!])
      case "allocBytes":
        return this.rt("ore_rt_alloc_bytes", [a[0]!])
      case "copy":
        intrinsic("declare void @llvm.memmove.p0.p0.i64(ptr, ptr, i64, i1)")
        this.b.emit(`call void @llvm.memmove.p0.p0.i64(ptr ${a[0]!.v}, ptr ${a[1]!.v}, i64 ${a[2]!.v}, i1 false)`)
        return voidValue
      case "fill":
        intrinsic("declare void @llvm.memset.p0.i64(ptr, i8, i64, i1)")
        this.b.emit(`call void @llvm.memset.p0.i64(ptr ${a[0]!.v}, i8 ${a[1]!.v}, i64 ${a[2]!.v}, i1 false)`)
        return voidValue
      case "compare": {
        intrinsic("declare i32 @memcmp(ptr, ptr, i64)")
        const r = this.b.value("i32", `call i32 @memcmp(ptr ${a[0]!.v}, ptr ${a[1]!.v}, i64 ${a[2]!.v})`)
        return this.b.value("i64", `sext i32 ${r.v} to i64`)
      }
      case "addressOf":
      case "fromAddress":
        return { ty: "ptr", v: a[0]!.v }
      case "stringData":
        return this.extract(a[0]!, 0, "ptr")
      case "makeString":
        return this.aggregate(STR, [a[0]!, a[1]!])
      case "atomicLoad":
        return this.b.value(mt, `load atomic ${mt}, ptr ${a[0]!.v} seq_cst, align ${align}`)
      case "atomicStore":
        this.b.emit(`store atomic ${mt} ${a[1]!.v}, ptr ${a[0]!.v} seq_cst, align ${align}`)
        return voidValue
      case "atomicAdd":
      case "atomicSub":
      case "atomicAnd":
      case "atomicOr":
      case "atomicXor":
      case "atomicExchange": {
        const op = name === "atomicExchange" ? "xchg" : name.slice("atomic".length).toLowerCase()
        return this.b.value(mt, `atomicrmw ${op} ptr ${a[0]!.v}, ${mt} ${a[1]!.v} seq_cst, align ${align}`)
      }
      case "atomicCompareExchange": {
        const pair = this.b.value(`{ ${mt}, i1 }`, `cmpxchg ptr ${a[0]!.v}, ${mt} ${a[1]!.v}, ${mt} ${a[2]!.v} seq_cst seq_cst, align ${align}`)
        return this.extract(pair, 1, "i1")
      }
      case "fence":
        this.b.emit("fence seq_cst")
        return voidValue
    }
    throw new Error(`no built-in ${e.name}`)
  }

  /** `unsafe.asm<T>(template, constraints, ...operands)`: an LLVM inline assembly call with side effects. */
  protected inlineAsm(e: ir.BuiltinCall): V {
    const [template, constraints] = e.args.map((x) => (x as ir.StringLit).value) as [string, string]
    const operands = e.args.slice(2).map((x) => this.expr(x))
    const ty = this.lt(e.type)
    const quoted = (text: string) => cString(utf8(text)).slice(1)
    const call = `call ${ty} asm sideeffect ${quoted(template)}, ${quoted(constraints)}(${operands.map((o) => `${o.ty} ${o.v}`).join(", ")})`
    if (ty === "void") {
      this.b.emit(call)
      return voidValue
    }
    return this.b.value(ty, call)
  }

  /** A new Error with a message, as an interface value. */
  protected error(e: ir.BuiltinCall, message: V): V {
    const { ctor, itab } = e.error!
    const object = this.callDirect(ctor.name, "ptr", [message])
    return this.aggregate(IFACE, [object, { ty: "ptr", v: `@itab.${itab.id}` }])
  }

  /** A `T | Error` (or `Error | null`) from a runtime call storing the value or the error message in its out parameter. */
  protected fallible(e: ir.BuiltinCall, call: (out: V) => V, valueType: string | undefined): V {
    const u = e.type as UnionType
    const out = this.b.alloca(STR)
    const ok = call({ ty: "ptr", v: out })
    const message = this.b.value(STR, `load ${STR}, ptr ${out}`)
    const errorIndex = u.members.findIndex((m) => m.kind === "interface")
    return this.choose(
      ok,
      () => (valueType ? this.inject(u, u.members.findIndex((m) => m.kind !== "interface"), message) : this.inject(u, u.members.findIndex((m) => m.kind === "null"), undefined)),
      () => this.inject(u, errorIndex, this.error(e, message)),
      this.lt(u),
    )
  }

  /** A `T | Error` from a runtime call storing the value or the message in two out parameters. */
  protected fallibleValue(e: ir.BuiltinCall, call: (value: V, message: V) => V): V {
    const u = e.type as UnionType
    const value = this.b.alloca("i64")
    const message = this.b.alloca(STR)
    const ok = call({ ty: "ptr", v: value }, { ty: "ptr", v: message })
    return this.choose(
      ok,
      () => this.inject(u, u.members.findIndex((m) => m.kind !== "interface"), this.b.value("i64", `load i64, ptr ${value}`)),
      () => this.inject(u, u.members.findIndex((m) => m.kind === "interface"), this.error(e, this.b.value(STR, `load ${STR}, ptr ${message}`))),
      this.lt(u),
    )
  }

  protected stringMethod(e: ir.StringMethod): V {
    const s = this.expr(e.value)
    const a = e.args.map((x) => this.expr(x))
    const space = this.str(" ")
    switch (e.method) {
      case "indexOf":
        return this.rt("ore_rt_str_index_of", [s, a[0]!, a[1] ?? this.i64(0)])
      case "lastIndexOf":
        return this.rt("ore_rt_str_last_index_of", [s, a[0]!])
      case "includes":
        return this.b.value("i1", `icmp ne i64 ${this.rt("ore_rt_str_index_of", [s, a[0]!, this.i64(0)]).v}, -1`)
      case "startsWith":
        return this.rtBool("ore_rt_str_starts_with", [s, a[0]!])
      case "endsWith":
        return this.rtBool("ore_rt_str_ends_with", [s, a[0]!])
      case "split":
        return this.rt("ore_rt_str_split", [s, a[0]!])
      case "trim":
        return this.rt("ore_rt_str_trim", [s, this.i64(3)])
      case "trimStart":
        return this.rt("ore_rt_str_trim", [s, this.i64(1)])
      case "trimEnd":
        return this.rt("ore_rt_str_trim", [s, this.i64(2)])
      case "toUpperCase":
        return this.rt("ore_rt_str_case", [s, { ty: "i1", v: "true" }])
      case "toLowerCase":
        return this.rt("ore_rt_str_case", [s, { ty: "i1", v: "false" }])
      case "replace":
        return this.rt("ore_rt_str_replace", [s, a[0]!, a[1]!, { ty: "i1", v: "false" }])
      case "replaceAll":
        return this.rt("ore_rt_str_replace", [s, a[0]!, a[1]!, { ty: "i1", v: "true" }])
      case "repeat":
        return this.rt("ore_rt_str_repeat", [s, a[0]!])
      case "padStart":
        return this.rt("ore_rt_str_pad", [s, a[0]!, a[1] ?? space, { ty: "i1", v: "true" }])
      case "padEnd":
        return this.rt("ore_rt_str_pad", [s, a[0]!, a[1] ?? space, { ty: "i1", v: "false" }])
      default:
        return this.rt("ore_rt_str_substring", [s, a[0]!, a[1] ?? this.i64(BigInt("9223372036854775807"))])
    }
  }
}
