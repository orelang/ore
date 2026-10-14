// Functions and statements.
import * as ir from "@ore/ir"
import type { Type } from "@ore/ir"
import { FnBuilder, globalName, sizeOf } from "./ll"
import { FRAME, ARRAY, MAP, type Breakable } from "./context"
import { boxed } from "./helpers"
import { EmitterBase } from "./base"

export abstract class FunctionEmitter extends EmitterBase {
  protected declareExtern(func: ir.Func) {
    const params = func.params.map((p) => this.externType(p.type, true)).join(", ")
    const result = this.externType(func.type.result, false)
    this.decls.set(`@${func.name}`, `declare ${result} @${func.name}(${params})`)
  }

  /** The C type of a value crossing into C, with the extension attributes clang uses. */
  protected externType(type: Type, param: boolean): string {
    if (type.kind === "string") return "ptr"
    // Integers narrower than 32 bits are widened to the register by whoever
    // produces them on x86-64 and on Apple's arm64, which LLVM is told with
    // zeroext and signext. AAPCS64 on Linux leaves the upper bits undefined, so
    // there the attributes would let LLVM skip the masking it needs.
    const widened = !(process.platform === "linux" && process.arch === "arm64")
    const small = type.kind === "bool" || (type.kind === "int" && type.bits < 32)
    const ext = !widened || !small ? undefined : type.kind === "int" && type.signed ? "signext" : "zeroext"
    // LLVM writes parameter attributes after the type and result attributes before it.
    if (ext) return param ? `${this.lt(type)} ${ext}` : `${ext} ${this.lt(type)}`
    return param || type.kind !== "void" ? this.lt(type) : "void"
  }

  protected signature(func: ir.Func, at: boolean): string {
    const params: string[] = []
    if (at) params.push("ptr %mem")
    if (func.captures) params.push("ptr %env")
    if (func.receiver) params.push("ptr %self")
    const attrs = func.attributes ?? {}
    const exported = attrs.exportName !== undefined && !at
    // An exported function follows C: small integers and booleans are extended.
    func.params.forEach((p, i) => params.push(`${exported ? this.externType(p.type, true) : this.lt(p.type)} %p${i}`))
    const result = exported ? this.externType(func.type.result, false) : this.lt(func.type.result)
    const flags = [attrs.noinline && "noinline", attrs.inline && "alwaysinline", attrs.cold && "cold", attrs.naked && "naked"].filter(Boolean).join(" ")
    return `define ${exported ? "" : "internal "}${result} ${globalName(func.name + (at ? "_at" : ""))}(${params.join(", ")})${flags ? ` ${flags}` : ""}`
  }

  protected function(func: ir.Func, at: boolean): string {
    this.b = new FnBuilder()
    this.func = func
    this.at = at
    this.storage = new Map()
    this.breakables = []
    this.disposals = []
    this.frame = undefined
    this.slots = new Map()
    if (func.attributes?.naked) {
      // Nothing but the assembly: no frame, no parameters in memory.
      for (const stmt of func.body.body) this.stmt(stmt)
      return this.b.finish(this.signature(func, at), "unreachable")
    }
    for (const node of this.plan.slots.get(func) ?? []) this.slots.set(node, this.b.alloca(this.slotType(node)))
    // The runtime keeps no frames, as when it was C: stack traces show the program's code.
    if (this.options.debug && !func.file?.startsWith("ore:runtime/")) {
      const frame = this.b.alloca(FRAME)
      const prev = this.b.value("ptr", `load ptr, ptr ${this.top()}`)
      this.b.emit(`store ptr ${prev.v}, ptr ${this.field(frame, FRAME, 0)}`)
      this.b.emit(`store ptr ${this.cstr(func.sourceName).v}, ptr ${this.field(frame, FRAME, 1)}`)
      this.b.emit(`store ptr ${this.cstr(func.file ?? this.file).v}, ptr ${this.field(frame, FRAME, 2)}`)
      this.b.emit(`store i32 ${func.line}, ptr ${this.field(frame, FRAME, 3)}`)
      this.b.emit(`store ptr ${frame}, ptr ${this.top()}`)
      this.frame = frame
    }
    if (func.receiver) this.declare(func.receiver, { ty: "ptr", v: "%self" })
    func.params.forEach((p, i) => this.declare(p, { ty: this.lt(p.type), v: `%p${i}` }))
    for (const stmt of func.body.body) this.stmt(stmt)
    const result = this.lt(func.type.result)
    if (result === "void") {
      this.popFrame()
      return this.b.finish(this.signature(func, at), "ret void")
    }
    return this.b.finish(this.signature(func, at), "unreachable")
  }

  protected popFrame() {
    if (!this.frame) return
    const prev = this.b.value("ptr", `load ptr, ptr ${this.field(this.frame, FRAME, 0)}`)
    this.b.emit(`store ptr ${prev.v}, ptr ${this.top()}`)
  }

  /**
   * The address of this thread's `ore_rt_top`, computed anew: a task may have
   * moved to another OS thread since the function started.
   */
  protected top(): string {
    return this.b.value("ptr", "call ptr @llvm.threadlocal.address.p0(ptr @ore_rt_top)").v
  }

  protected slotType(node: ir.Expr | ir.Local): string {
    if ("id" in node) return this.mt(node.type)
    if (node.k === "closure") return this.envType(node.func)
    return this.structType(node.type as ir.StructType)
  }

  /** A zeroed stack slot for an allocation, or undefined when it goes to the heap. */
  protected slot(node: ir.Expr | ir.Local): string | undefined {
    const slot = this.slots.get(node)
    if (slot) this.b.emit(`store ${this.slotType(node)} zeroinitializer, ptr ${slot}`)
    return slot
  }

  protected body(stmt: ir.Stmt) {
    if (stmt.k === "block") for (const s of stmt.body) this.stmt(s)
    else this.stmt(stmt)
  }

  protected line(stmt: ir.Stmt) {
    if (this.frame && stmt.line !== undefined && this.b.isOpen()) this.b.emit(`store i32 ${stmt.line}, ptr ${this.field(this.frame, FRAME, 3)}`)
  }

  protected within<T>(breakable: Breakable, body: () => T): T {
    this.breakables.push(breakable)
    try {
      return body()
    } finally {
      this.breakables.pop()
    }
  }

  /** Disposes the `using` resources declared inside breakable `index` (all of them for -1), innermost first. */
  protected disposeFrom(index: number) {
    const pending = this.disposals.filter((d) => d.depth > index).reverse()
    // Disposing runs code that may itself leave; it must not dispose itself again.
    const saved = this.disposals
    for (const d of pending) {
      this.disposals = saved.filter((x) => x.depth <= index || saved.indexOf(x) < saved.indexOf(d))
      this.stmt(d.stmt)
    }
    this.disposals = saved
  }

  protected stmt(stmt: ir.Stmt) {
    this.line(stmt)
    switch (stmt.k) {
      case "block":
        for (const s of stmt.body) this.stmt(s)
        return
      case "let":
        this.declare(stmt.local, stmt.init ? this.expr(stmt.init) : undefined)
        return
      case "expr": {
        const v = this.expr(stmt.expr)
        if (stmt.expr.type.kind === "never") this.b.terminate("unreachable")
        void v
        return
      }
      case "if": {
        // A condition known at compile time, such as one on `target.arch`, compiles only the branch taken.
        if (stmt.cond.k === "bool") {
          const taken = stmt.cond.value ? stmt.then : stmt.else
          if (taken) this.body(taken)
          return
        }
        const cond = this.expr(stmt.cond)
        const then = this.b.label("then")
        const otherwise = this.b.label("else")
        const end = this.b.label("endif")
        this.b.condBr(cond, then, stmt.else ? otherwise : end)
        this.b.start(then)
        this.body(stmt.then)
        this.b.br(end)
        if (stmt.else) {
          this.b.start(otherwise)
          this.body(stmt.else)
          this.b.br(end)
        }
        this.b.start(end)
        return
      }
      case "loop":
        return this.loop(stmt)
      case "for-of":
        return this.forOf(stmt)
      case "switch":
        return this.switchStmt(stmt)
      case "break":
      case "continue": {
        const index =
          stmt.target !== undefined
            ? this.breakables.findIndex((b) => b.id === stmt.target)
            : stmt.k === "break"
              ? this.breakables.length - 1
              : this.breakables.findLastIndex((b) => !b.isSwitch)
        const target = this.breakables[index]!
        this.disposeFrom(index)
        this.b.br(stmt.k === "break" ? target.breakLabel : target.continueLabel)
        return
      }
      case "return": {
        // The value is computed before resources are disposed and the frame is popped.
        const value = stmt.value ? this.expr(stmt.value) : undefined
        this.disposeFrom(-1)
        this.popFrame()
        if (!value || value.ty === "void" || this.lt(this.func!.type.result) === "void") this.b.terminate("ret void")
        else this.b.terminate(`ret ${value.ty} ${value.v}`)
        return
      }
      case "using": {
        this.declare(stmt.local, this.expr(stmt.init))
        this.disposals.push({ stmt: stmt.dispose, depth: this.breakables.length })
        try {
          for (const s of stmt.body) this.stmt(s)
        } finally {
          this.disposals.pop()
        }
        this.stmt(stmt.dispose)
        return
      }
    }
  }

  protected loop(stmt: ir.LoopStmt) {
    const head = this.b.label("loop")
    const body = this.b.label("body")
    const next = this.b.label("next")
    const end = this.b.label("endloop")
    const breakable = { id: stmt.id, isSwitch: false, breakLabel: end, continueLabel: next }
    if (stmt.condAfter) {
      this.b.start(body)
      this.within(breakable, () => this.body(stmt.body))
      this.b.start(next)
      this.b.condBr(this.expr(stmt.cond!), body, end)
      this.b.start(end)
      return
    }
    this.b.start(head)
    if (stmt.cond) this.b.condBr(this.expr(stmt.cond), body, end)
    this.b.start(body)
    this.within(breakable, () => this.body(stmt.body))
    this.b.start(next)
    // Captured `for (let ...)` variables get a fresh copy for each iteration,
    // before the update; a box on the stack is shared, no closure of an earlier
    // iteration being alive.
    for (const l of stmt.perIteration ?? []) {
      if (!boxed(l) || this.slots.has(l)) continue
      const holder = (this.storage.get(l) as { holder: string }).holder
      const box = this.b.value("ptr", `load ptr, ptr ${holder}`)
      const copy = this.rt("ore_rt_box_copy", [box, { ty: "i64", v: sizeOf(this.mt(l.type)) }])
      this.b.emit(`store ptr ${copy.v}, ptr ${holder}`)
    }
    if (stmt.update) this.expr(stmt.update)
    this.b.br(head)
    this.b.start(end)
  }

  protected forOf(stmt: ir.ForOfStmt) {
    const iterable = this.expr(stmt.iterable)
    const kind = stmt.iterable.type.kind
    const head = this.b.label("each")
    const body = this.b.label("eachbody")
    const next = this.b.label("eachnext")
    const end = this.b.label("endeach")
    const i = this.b.alloca("i64")
    this.b.emit(`store i64 0, ptr ${i}`)
    const breakable = { id: stmt.id, isSwitch: false, breakLabel: end, continueLabel: next }
    this.b.start(head)
    if (kind === "string") {
      const len = this.extract(iterable, 1, "i64")
      const at = this.b.value("i64", `load i64, ptr ${i}`)
      this.b.condBr(this.b.value("i1", `icmp slt i64 ${at.v}, ${len.v}`), body, end)
      this.b.start(body)
      const rune = this.rt("ore_rt_str_decode", [iterable, { ty: "ptr", v: i }])
      this.declare(stmt.local, this.fromI64(rune, "i32"))
    } else if (kind === "chan") {
      const slot = this.b.alloca(this.mt(stmt.local.type))
      this.b.condBr(this.rtBool("ore_rt_chan_recv", [iterable, { ty: "ptr", v: slot }]), body, end)
      this.b.start(body)
      this.declare(stmt.local, this.load(slot, stmt.local.type))
    } else if (kind === "map") {
      const count = this.b.value("i64", `load i64, ptr ${this.field(iterable.v, MAP, 6)}`)
      const at = this.b.value("i64", `load i64, ptr ${i}`)
      this.b.condBr(this.b.value("i1", `icmp slt i64 ${at.v}, ${count.v}`), body, end)
      this.b.start(body)
      // Entries in insertion order, skipping deleted ones.
      const live = this.rtBool("ore_rt_map_live", [iterable, at])
      const use = this.b.label("live")
      this.b.condBr(live, use, next)
      this.b.start(use)
      const key = this.rt("ore_rt_map_key", [iterable, at])
      const value = this.rt("ore_rt_map_value", [iterable, at])
      this.declare(stmt.local, this.load(key.v, stmt.local.type))
      this.declare(stmt.value!, this.load(value.v, stmt.value!.type))
    } else {
      // The array length is read again on every iteration.
      const len = this.b.value("i64", `load i64, ptr ${this.field(iterable.v, ARRAY, 1)}`)
      const at = this.b.value("i64", `load i64, ptr ${i}`)
      this.b.condBr(this.b.value("i1", `icmp slt i64 ${at.v}, ${len.v}`), body, end)
      this.b.start(body)
      const data = this.b.value("ptr", `load ptr, ptr ${this.field(iterable.v, ARRAY, 0)}`)
      const ptr = this.b.value("ptr", `getelementptr ${this.mt(stmt.local.type)}, ptr ${data.v}, i64 ${at.v}`)
      this.declare(stmt.local, this.load(ptr.v, stmt.local.type))
    }
    this.within(breakable, () => this.body(stmt.body))
    this.b.start(next)
    if (kind !== "string" && kind !== "chan") {
      const at = this.b.value("i64", `load i64, ptr ${i}`)
      this.b.emit(`store i64 ${this.b.value("i64", `add i64 ${at.v}, 1`).v}, ptr ${i}`)
    }
    this.b.br(head)
    this.b.start(end)
  }

  protected switchStmt(stmt: ir.SwitchStmt) {
    // The tests run in order until one is true; execution enters its clause
    // and falls through the following ones, as in C.
    this.declare(stmt.local, this.expr(stmt.value))
    const index = this.b.alloca("i32")
    const dispatch = this.b.label("dispatch")
    const end = this.b.label("endswitch")
    stmt.clauses.forEach((c, i) => {
      if (!c.test) return
      const hit = this.b.label("case")
      const miss = this.b.label("nextcase")
      this.b.condBr(this.expr(c.test), hit, miss)
      this.b.start(hit)
      this.b.emit(`store i32 ${i}, ptr ${index}`)
      this.b.br(dispatch)
      this.b.start(miss)
    })
    this.b.emit(`store i32 ${stmt.clauses.findIndex((c) => !c.test)}, ptr ${index}`)
    this.b.start(dispatch)
    const labels = stmt.clauses.map(() => this.b.label("clause"))
    const chosen = this.b.value("i32", `load i32, ptr ${index}`)
    this.b.terminate(`switch i32 ${chosen.v}, label %${end} [ ${labels.map((l, i) => `i32 ${i}, label %${l}`).join(" ")} ]`)
    this.within({ id: stmt.id, isSwitch: true, breakLabel: end, continueLabel: "" }, () => {
      stmt.clauses.forEach((c, i) => {
        this.b.start(labels[i]!)
        for (const s of c.body) this.stmt(s)
      })
    })
    this.b.start(end)
  }
}
