import * as ir from "@ore/ir"
import type { Type } from "@ore/ir"

/**
 * Escape analysis: finds allocations that never outlive the call of the
 * function creating them, so that they can live in its stack frame instead of
 * the garbage-collected heap.
 *
 * An allocation is an object literal, a constructor call, a closure with an
 * environment, or the box of a local that closures capture and assign. A
 * value escapes when it may be reachable after its function returns: it is
 * returned, stored in a field, an array, a map or a channel, captured by a
 * closure, converted to an interface, passed to a parameter that escapes, or
 * used in any other way not known to be safe. Safe uses are reading a field,
 * comparing, calling a method or function whose parameter does not escape,
 * and calling a closure.
 *
 * Every stack allocation gets one slot for the whole function call. A slot is
 * reused when its allocation runs again in a loop, which is sound because the
 * previous object is unreachable by then: it is bound only to locals of the
 * previous iteration, to objects created after it, or to arguments of calls
 * that have returned. Field assignments therefore always make the assigned
 * value escape, so an older object never refers to a newer one.
 */
export interface StackPlan {
  /** Allocations and boxed locals placed on the stack, by the function owning their slot. */
  slots: Map<ir.Func, (ir.Expr | ir.Local)[]>
  /** Constructors called with a slot to initialize instead of allocating. */
  ctorsAt: Set<ir.Func>
}

/** Largest object placed on the stack, and the most stack slots one call may use, in bytes (estimated). */
const maxObject = 256
const maxFrame = 1024

/** Which parameters of a function escape; `self` is `this` of a method or the instance of a constructor. */
interface Summary {
  params: boolean[]
  self: boolean
}

type Node = ir.Expr | ir.Local

export function planStack(module: ir.Module): StackPlan {
  const funcs = module.functions.filter((f) => !f.extern)
  const summaries = new Map<ir.Func, Summary>()
  for (const func of funcs) summaries.set(func, { params: func.params.map(() => false), self: false })
  // Start from "nothing escapes" and grow until stable: the least solution, so recursion is precise.
  for (let changed = true; changed; ) {
    changed = false
    for (const func of funcs) {
      const summary = new FuncAnalysis(func, summaries).summary()
      const old = summaries.get(func)
      if (old!.self !== summary.self || old!.params.some((p, i) => p !== summary.params[i])) {
        summaries.set(func, summary)
        changed = true
      }
    }
  }

  const slots = new Map<ir.Func, (ir.Expr | ir.Local)[]>()
  const ctorsAt = new Set<ir.Func>()
  const stackClosures = new Set<ir.Closure>()
  const closuresOf = new Map<ir.Local, ir.Closure[]>()
  const boxes = new Map<ir.Func, ir.Local[]>()
  for (const func of funcs) {
    const analysis = new FuncAnalysis(func, summaries)
    analysis.summary()
    let frame = 0
    const placed: ir.Expr[] = []
    for (const site of analysis.sites) {
      if (analysis.leaked(site)) continue
      const size = siteSize(site)
      if (size > maxObject || frame + size > maxFrame) continue
      frame += size
      placed.push(site)
      if (site.k === "closure") stackClosures.add(site)
      if (site.k === "call") ctorsAt.add(site.func)
    }
    slots.set(func, placed)
    for (const site of analysis.closures) for (const c of site.func.captures ?? []) closuresOf.set(c, [...(closuresOf.get(c) ?? []), site])
    boxes.set(func, analysis.boxed)
  }
  // A box can live in the frame of its function when every closure capturing it does not escape.
  for (const [func, locals] of boxes) {
    for (const local of locals) {
      if ((closuresOf.get(local) ?? []).every((c) => stackClosures.has(c))) slots.get(func)!.push(local)
    }
  }
  return { slots, ctorsAt }
}

/** Whether a function is the constructor of the class it returns. */
export function isCtor(func: ir.Func): boolean {
  const result = func.type.result
  return result.kind === "struct" && result.ctor === func
}

/** Whether a call creates an instance with a constructor. */
function isCtorCall(e: ir.Expr): e is ir.Call {
  return e.k === "call" && isCtor(e.func)
}

/** Expressions that allocate an object the analysis may place on the stack. */
function isSite(e: ir.Expr): boolean {
  return e.k === "object" || isCtorCall(e) || (e.k === "closure" && (e.func.captures?.length ?? 0) > 0)
}

function siteSize(site: ir.Expr): number {
  if (site.k === "closure") return 16 * site.func.captures!.length
  return 16 * Math.max(1, (site.type as ir.StructType).fields.length)
}

/** Types whose values may refer to an allocation: field reads of these carry the object's contents. */
function isReference(type: Type): boolean {
  switch (type.kind) {
    case "struct":
    case "func":
    case "interface":
      return true
    case "union":
      return type.members.some(isReference)
    default:
      return false
  }
}

class FuncAnalysis {
  private parent = new Map<Node, Node>()
  private leakedRoots = new Set<Node>()
  /** Allocation sites in this function, in source order. */
  readonly sites: ir.Expr[] = []
  /** Closures with an environment created in this function. */
  readonly closures: ir.Closure[] = []
  /** Locals declared in this function that live in boxes. */
  readonly boxed: ir.Local[] = []
  private self: ir.Local | undefined
  private ctor: boolean

  constructor(
    private func: ir.Func,
    private summaries: Map<ir.Func, Summary>,
  ) {
    this.ctor = isCtor(func)
    const first = func.body.body[0]
    if (this.ctor && first?.k === "let" && first.init?.k === "alloc") this.self = first.local
    else this.self = func.receiver
  }

  summary(): Summary {
    this.block(this.func.body.body)
    return { params: this.func.params.map((p) => this.leaked(p)), self: this.self ? this.leaked(this.self) : true }
  }

  leaked(node: Node): boolean {
    return this.leakedRoots.has(this.find(node))
  }

  private find(node: Node): Node {
    let root = node
    while (this.parent.has(root)) root = this.parent.get(root)!
    if (root !== node) this.parent.set(node, root)
    return root
  }

  private union(a: Node, b: Node) {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra === rb) return
    this.parent.set(ra, rb)
    if (this.leakedRoots.delete(ra)) this.leakedRoots.add(rb)
  }

  private leak(node: Node) {
    this.leakedRoots.add(this.find(node))
  }

  /** Whether a local is ever bound to something other than its initializer. */
  private rebound(local: ir.Local): boolean {
    return local.assigned === true || local.captured === true
  }

  private declared(local: ir.Local) {
    if (local.captured && local.assigned && !this.func.params.includes(local)) this.boxed.push(local)
  }

  private block(stmts: ir.Stmt[]) {
    for (const s of stmts) this.stmt(s)
  }

  private stmt(s: ir.Stmt): void {
    switch (s.k) {
      case "block":
        return this.block(s.body)
      case "let":
        this.declared(s.local)
        if (!s.init || s.init.k === "alloc") return
        if (isSite(s.init) && !this.rebound(s.local)) {
          this.union(s.local, s.init)
          this.expr(s.init, true)
        } else {
          this.expr(s.init, false)
        }
        return
      case "expr":
        return this.expr(s.expr, true)
      case "if":
        this.expr(s.cond, true)
        this.stmt(s.then)
        if (s.else) this.stmt(s.else)
        return
      case "loop":
        if (s.cond) this.expr(s.cond, true)
        if (s.update) this.expr(s.update, true)
        return this.stmt(s.body)
      case "for-of":
        this.declared(s.local)
        if (s.value) this.declared(s.value)
        this.expr(s.iterable, false)
        return this.stmt(s.body)
      case "switch":
        this.declared(s.local)
        this.expr(s.value, false)
        for (const c of s.clauses) {
          if (c.test) this.expr(c.test, true)
          this.block(c.body)
        }
        return
      case "using":
        this.declared(s.local)
        this.expr(s.init, false)
        this.stmt(s.dispose)
        return this.block(s.body)
      case "break":
      case "continue":
        return
      case "return":
        if (!s.value) return
        // A constructor returns its instance to the caller, who decided where it lives.
        if (this.ctor && s.value.k === "local" && s.value.local === this.self) return
        return this.expr(s.value, false)
    }
  }

  /** Visits an expression whose value is used safely (`safe`) or may escape. */
  private expr(e: ir.Expr, safe: boolean): void {
    if (isSite(e)) {
      this.sites.push(e)
      if (!safe) this.leak(e)
    }
    switch (e.k) {
      case "local":
        if (!safe) this.leak(e.local)
        return
      case "field":
        this.expr(e.object, true)
        // The value read may be another object stored in this one.
        if (!safe && isReference(e.type)) this.leakRoot(e.object)
        return
      case "assign":
      case "incdec":
        this.target(e.target)
        if (e.k === "assign") this.expr(e.value, false)
        return
      case "compare":
        this.expr(e.left, true)
        this.expr(e.right, true)
        return
      case "is-null":
      case "is":
      case "typeof":
        return this.expr(e.value, true)
      case "cond":
        this.expr(e.cond, true)
        this.expr(e.then, safe)
        this.expr(e.else, safe)
        return
      case "coalesce":
        this.expr(e.value, safe)
        this.expr(e.fallback, safe)
        return
      case "call": {
        const summary = e.func.extern ? undefined : this.summaries.get(e.func)
        if (isCtor(e.func) && summary?.self !== false) this.leak(e)
        e.args.forEach((a, i) => this.expr(a, summary !== undefined && !summary.params[i]))
        return
      }
      case "method-call": {
        const summary = this.summaries.get(e.func)
        this.expr(e.receiver, summary !== undefined && !summary.self)
        e.args.forEach((a, i) => this.expr(a, summary !== undefined && !summary.params[i]))
        return
      }
      case "call-value":
        this.expr(e.callee, true)
        for (const a of e.args) this.expr(a, false)
        return
      case "array-method":
        // The runtime keeps neither the callbacks nor the values searched for; the initial value of reduce is returned.
        this.expr(e.array, true)
        e.args.forEach((a, i) => this.expr(a, !(e.method === "reduce" && i === 1)))
        return
      case "object":
        for (const f of e.fields) {
          // Objects stored in a new object share its fate.
          if (f.value.k === "local") this.union(e, f.value.local)
          else if (isSite(f.value)) this.union(e, f.value)
          this.expr(f.value, f.value.k === "local" || isSite(f.value))
        }
        return
      case "closure":
        if (e.func.captures?.length) this.closures.push(e)
        // Captured values are copied into the environment, which may outlive them.
        for (const c of e.func.captures ?? []) this.leak(c)
        return
      default:
        for (const child of children(e)) this.expr(child, false)
    }
  }

  private target(t: ir.LValue): void {
    switch (t.k) {
      case "local":
        return
      case "element":
        this.expr(t.array, true)
        return this.expr(t.index, true)
      case "field":
        return this.expr(t.object, true)
      case "iface-field":
        return this.expr(t.value, false)
    }
  }

  /** Marks the local at the root of a chain of field reads as escaping. */
  private leakRoot(e: ir.Expr) {
    while (e.k === "field") e = e.object
    if (e.k === "local") this.leak(e.local)
    else if (isSite(e)) this.leak(e)
  }
}

/** The subexpressions of an expression, for uses with no special rule. */
function children(e: ir.Expr): ir.Expr[] {
  switch (e.k) {
    case "int":
    case "float":
    case "bool":
    case "string":
    case "local":
    case "null":
    case "alloc":
    case "func-ref":
    case "closure":
      return []
    case "arith":
    case "compare":
    case "logical":
      return [e.left, e.right]
    case "unary":
    case "not":
      return [e.operand]
    case "convert":
    case "len":
    case "recast":
    case "is-null":
    case "union-field":
    case "typeof":
    case "is":
    case "downcast":
    case "to-iface":
    case "iface-field":
      return e.value ? [e.value] : []
    case "assign":
    case "incdec":
      return []
    case "call":
    case "builtin":
      return e.args
    case "cond":
      return [e.cond, e.then, e.else]
    case "concat":
      return e.parts
    case "index":
      return [e.target, e.index]
    case "slice":
      return [e.value, ...(e.start ? [e.start] : []), ...(e.end ? [e.end] : [])]
    case "array":
      return e.elems
    case "push":
      return [e.array, ...e.values]
    case "pop":
      return [e.array]
    case "object":
      return e.fields.map((f) => f.value)
    case "field":
      return [e.object]
    case "method-call":
      return [e.receiver, ...e.args]
    case "iface-call":
      return [e.value, ...e.args]
    case "optional":
      return [e.value, e.body]
    case "coalesce":
      return [e.value, e.fallback]
    case "map":
      return [e.map, e.key, e.value].filter((x) => x !== undefined)
    case "call-value":
      return [e.callee, ...e.args]
    case "bound-method":
      return [e.receiver]
    case "array-method":
      return [e.array, ...e.args]
    case "string-method":
      return [e.value, ...e.args]
    case "chan":
      return [e.chan, e.value, e.handler].filter((x) => x !== undefined)
  }
}
