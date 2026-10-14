import type * as ir from "@ore/ir"

/**
 * Definite assignment: reports reads of variables that may not be assigned
 * yet. A variable declared without a value and with a type that has no zero
 * value (a class, an object or an interface) must be assigned on every path
 * before it is read. A closure that captures such a variable reads it when
 * it is created, since it may run at any time after.
 *
 * The analysis walks the structured IR of one function with the set of
 * variables certainly assigned so far. Branches meet with the intersection of
 * their sets; code after `return`, `break`, `continue` or a call that never
 * returns is unreachable (no set). A loop body may not run, and the right
 * operand of `&&`, `||` and `??` may not be evaluated, so their assignments
 * do not count after them.
 */
export function checkAssigned(body: ir.Block, tracked: ReadonlySet<ir.Local>, report: (local: ir.Local, at: ir.Expr) => void) {
  new Flow(tracked, report).block(body.body, new Set())
}

/** The variables certainly assigned at a point, or null where control cannot reach. */
type State = Set<ir.Local> | null

function join(a: State, b: State): State {
  if (a === null) return b
  if (b === null) return a
  return new Set([...a].filter((local) => b.has(local)))
}

function copy(s: State): State {
  return s === null ? null : new Set(s)
}

class Flow {
  /** Tracked variables declared in this function; others belong to enclosing functions. */
  private declared = new Set<ir.Local>()
  private reported = new Set<ir.Local>()
  /** States at the `break` and `continue` statements of each loop or switch, by id. */
  private breaks = new Map<number, State>()
  private continues = new Map<number, State>()
  /** Loops and switches around the current statement, innermost last. */
  private targets: { id: number; loop: boolean }[] = []

  constructor(
    private tracked: ReadonlySet<ir.Local>,
    private report: (local: ir.Local, at: ir.Expr) => void,
  ) {}

  block(stmts: ir.Stmt[], s: State): State {
    for (const stmt of stmts) s = this.stmt(stmt, s)
    return s
  }

  private read(local: ir.Local, at: ir.Expr, s: State) {
    if (s === null || !this.declared.has(local) || s.has(local) || this.reported.has(local)) return
    this.reported.add(local)
    this.report(local, at)
  }

  /** Runs `body` as the inside of the loop or switch `id`; returns its end state and its break states. */
  private within(id: number, loop: boolean, body: () => State): { end: State; breaks: State; continues: State } {
    this.targets.push({ id, loop })
    this.breaks.set(id, null)
    this.continues.set(id, null)
    try {
      const end = body()
      return { end, breaks: this.breaks.get(id) ?? null, continues: this.continues.get(id) ?? null }
    } finally {
      this.targets.pop()
    }
  }

  private stmt(st: ir.Stmt, s: State): State {
    if (s === null) return null
    switch (st.k) {
      case "block":
        return this.block(st.body, s)
      case "let":
        if (st.init) {
          s = this.expr(st.init, s)
          s?.add(st.local)
        } else if (this.tracked.has(st.local)) {
          // Declared again on each pass through a loop.
          this.declared.add(st.local)
          s?.delete(st.local)
        }
        return s
      case "expr":
        s = this.expr(st.expr, s)
        return st.expr.type.kind === "never" ? null : s
      case "if": {
        s = this.expr(st.cond, s)
        const then = this.stmt(st.then, copy(s))
        const otherwise = st.else ? this.stmt(st.else, copy(s)) : s
        return join(then, otherwise)
      }
      case "loop": {
        const forever = st.cond === undefined || (st.cond.k === "bool" && st.cond.value)
        if (st.condAfter) {
          // `do ... while (cond)`: the body runs at least once.
          const inner = this.within(st.id, true, () => this.stmt(st.body, s))
          const beforeCond = join(inner.end, inner.continues)
          const after = beforeCond === null ? null : this.expr(st.cond!, beforeCond)
          return join(forever ? null : after, inner.breaks)
        }
        const entry = forever || !st.cond ? s : this.expr(st.cond, s)
        const inner = this.within(st.id, true, () => this.stmt(st.body, copy(entry)))
        const beforeUpdate = join(inner.end, inner.continues)
        if (st.update && beforeUpdate !== null) this.expr(st.update, beforeUpdate)
        return join(forever ? null : entry, inner.breaks)
      }
      case "for-of": {
        s = this.expr(st.iterable, s)
        const inner = this.within(st.id, true, () => this.stmt(st.body, copy(s)))
        return join(s, inner.breaks)
      }
      case "switch": {
        s = this.expr(st.value, s)
        const selected = s
        for (const clause of st.clauses) if (clause.test) this.expr(clause.test, copy(selected))
        const inner = this.within(st.id, false, () => {
          // Each clause is entered by a match or by falling through the one before.
          let current: State = null
          for (const clause of st.clauses) current = this.block(clause.body, join(current, copy(selected)))
          return current
        })
        const unmatched = st.exhaustive || st.clauses.some((c) => !c.test) ? null : selected
        return join(join(inner.end, inner.breaks), unmatched)
      }
      case "using":
        s = this.expr(st.init, s)
        s?.add(st.local)
        s = this.block(st.body, s)
        return s === null ? null : this.stmt(st.dispose, s)
      case "break":
      case "continue": {
        const target =
          st.target !== undefined
            ? this.targets.find((t) => t.id === st.target)
            : st.k === "break"
              ? this.targets.at(-1)
              : this.targets.findLast((t) => t.loop)
        if (target) {
          const states = st.k === "break" ? this.breaks : this.continues
          states.set(target.id, join(states.get(target.id) ?? null, copy(s)))
        }
        return null
      }
      case "return":
        if (st.value) this.expr(st.value, s)
        return null
    }
  }

  /** The state after evaluating an expression, reporting reads of unassigned variables. */
  private expr(e: ir.Expr, s: State): State {
    if (s === null) return null
    switch (e.k) {
      case "local":
        this.read(e.local, e, s)
        return s
      case "assign": {
        const target = e.target
        if (target.k === "field") s = this.expr(target.object, s)
        else if (target.k === "element") s = this.expr(target.index, this.expr(target.array, s))
        else if (target.k === "iface-field") s = this.expr(target.value, s)
        s = this.expr(e.value, s)
        if (target.k === "local") s?.add(target.local)
        return s
      }
      case "incdec": {
        const target = e.target
        if (target.k === "local") this.read(target.local, e, s)
        else if (target.k === "field") s = this.expr(target.object, s)
        else if (target.k === "element") s = this.expr(target.index, this.expr(target.array, s))
        else s = this.expr(target.value, s)
        return s
      }
      case "logical": {
        s = this.expr(e.left, s)
        this.expr(e.right, copy(s))
        return s
      }
      case "coalesce":
        s = this.expr(e.value, s)
        this.expr(e.fallback, copy(s))
        return s
      case "optional":
        s = this.expr(e.value, s)
        s?.add(e.binding)
        this.expr(e.body, copy(s))
        return s
      case "cond": {
        s = this.expr(e.cond, s)
        return join(this.expr(e.then, copy(s)), this.expr(e.else, copy(s)))
      }
      case "closure":
        for (const c of e.func.captures ?? []) this.read(c, e, s)
        return s
      case "bind":
        for (const b of e.locals) {
          s = this.expr(b.init, s)
          s?.add(b.local)
        }
        return this.expr(e.body, s)
      default:
        for (const child of children(e)) s = this.expr(child, s)
        return s
    }
  }
}

/** The subexpressions of an expression in evaluation order, for those without a rule of their own. */
function children(e: ir.Expr): ir.Expr[] {
  switch (e.k) {
    case "arith":
    case "compare":
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
    case "call":
    case "builtin":
      return e.args
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
    case "map":
      return [e.map, e.key, e.value].filter((x): x is ir.Expr => x !== undefined)
    case "call-value":
      return [e.callee, ...e.args]
    case "bound-method":
      return [e.receiver]
    case "array-method":
      return [e.array, ...e.args]
    case "string-method":
      return [e.value, ...e.args]
    case "chan":
      return [e.chan, e.value, e.handler].filter((x): x is ir.Expr => x !== undefined)
    case "seq":
      return e.exprs
    default:
      return []
  }
}
