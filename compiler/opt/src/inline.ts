import * as ir from "@ore/ir"
import { isCtor } from "./escape"

/**
 * Inlining: replaces calls of small functions whose body is a single
 * `return value` (or a single expression, for `void`) with that value, the
 * parameters bound to the arguments. Besides saving the call, this lets
 * escape analysis keep objects created by the callee, such as the result of
 * `a.plus(b)`, in the caller's frame.
 *
 * Arguments that are constants or locals never assigned are substituted
 * directly; others are evaluated once, in order, into fresh locals.
 */
export function inlineCalls(module: ir.Module) {
  const funcs = module.functions.filter((f) => !f.extern)
  let nextId = 0
  const see = (local: ir.Local) => (nextId = Math.max(nextId, local.id + 1))
  for (const func of funcs) {
    for (const p of [...func.params, ...(func.receiver ? [func.receiver] : [])]) see(p)
    walk(func.body, see)
  }
  const inliner = new Inliner(() => nextId++)
  for (const func of funcs) inliner.rewrite(func.body, 0)
}

/** Callees larger than this, in IR nodes, are not inlined. */
const maxSize = 40
/** How many inlined calls may nest in one call site. */
const maxDepth = 3

/** Keys of IR nodes that refer to shared things rather than own subtrees. */
const shared = new Set(["type", "func", "itab", "error", "member", "via", "mapType", "chanType", "method", "indices", "captures", "typeArgs"])

/** Keys of IR nodes that hold locals. */
const localKeys = new Set(["local", "binding"])

/** The value of a function that consists of one `return value` or one expression, if inlinable. */
function inlinable(func: ir.Func): ir.Expr | undefined {
  if (func.extern || func.captures || func.attributes?.noinline || isCtor(func) || func.body.body.length !== 1) return
  const stmt = func.body.body[0]!
  const value = stmt.k === "return" ? stmt.value : stmt.k === "expr" && func.type.result.kind === "void" ? stmt.expr : undefined
  if (!value) return
  let size = 0
  let ok = true
  walk(value, undefined, (node) => {
    size++
    // A closure refers to the callee's locals through its captures; a call of itself would never end.
    if (node.k === "closure" || (node.k === "call" && node.func === func) || (node.k === "method-call" && node.func === func)) ok = false
  })
  return ok && size <= maxSize ? value : undefined
}

class Inliner {
  private bodies = new Map<ir.Func, ir.Expr | undefined>()

  constructor(private newId: () => number) {}

  /** Inlines the calls inside a node, replacing them in their parents. */
  rewrite(node: object, depth: number) {
    for (const [key, value] of Object.entries(node)) {
      if (shared.has(key) || localKeys.has(key) || value === null || typeof value !== "object") continue
      if (Array.isArray(value)) {
        value.forEach((item, i) => {
          const replaced = this.replace(item, depth)
          if (replaced) value[i] = replaced
          else if (item && typeof item === "object") this.rewrite(item, depth)
        })
        continue
      }
      const replaced = this.replace(value, depth)
      if (replaced) (node as Record<string, unknown>)[key] = replaced
      else this.rewrite(value, depth)
    }
  }

  /** The inlined form of a call, with calls inside it inlined too, or undefined. */
  private replace(node: unknown, depth: number): ir.Expr | undefined {
    if (depth >= maxDepth || !node || typeof node !== "object" || !("k" in node)) return
    const e = node as ir.Expr
    if (e.k !== "call" && e.k !== "method-call") return
    if (!this.bodies.has(e.func)) this.bodies.set(e.func, inlinable(e.func))
    const body = this.bodies.get(e.func)
    if (!body) return
    // Arguments are inlined at the current depth; the body one level deeper.
    const params = e.k === "method-call" ? [e.func.receiver!, ...e.func.params] : e.func.params
    const args = e.k === "method-call" ? [e.receiver, ...e.args] : e.args
    const values = new Map<ir.Local, ir.Expr | ir.Local>()
    const locals: ir.Bind["locals"] = []
    params.forEach((param, i) => {
      const arg = this.inlined(args[i]!, depth)
      if (!param.assigned && pure(arg)) {
        values.set(param, arg)
      } else {
        const local = this.fresh(param)
        values.set(param, local)
        locals.push({ local, init: arg })
      }
    })
    const inlined = this.clone(body, values) as ir.Expr
    const result = locals.length === 0 ? inlined : ({ k: "bind", type: e.type, locals, body: inlined } satisfies ir.Bind)
    const holder = { result }
    this.rewrite(holder, depth + 1)
    return holder.result
  }

  /** An argument with the calls inside it inlined. */
  private inlined(arg: ir.Expr, depth: number): ir.Expr {
    const replaced = this.replace(arg, depth)
    if (replaced) return replaced
    this.rewrite(arg, depth)
    return arg
  }

  private fresh(local: ir.Local): ir.Local {
    return { ...local, id: this.newId(), captured: false }
  }

  /** A copy of a subtree, with locals replaced by `values` and locals it declares renamed. */
  private clone(node: unknown, values: Map<ir.Local, ir.Expr | ir.Local>): unknown {
    if (Array.isArray(node)) return node.map((n) => this.clone(n, values))
    if (!node || typeof node !== "object") return node
    const obj = node as Record<string, unknown>
    // A reference to a parameter substituted by its argument.
    if (obj.k === "local" && "type" in obj) {
      const value = values.get(obj.local as ir.Local)
      // Substituted arguments are constants and locals: copies of single nodes.
      if (value && "k" in value) return { ...value }
    }
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
      if (shared.has(key)) out[key] = value
      else if (localKeys.has(key)) out[key] = this.local(value as ir.Local, values)
      else out[key] = this.clone(value, values)
    }
    return out
  }

  private local(local: ir.Local, values: Map<ir.Local, ir.Expr | ir.Local>): ir.Local {
    const value = values.get(local)
    if (value && !("k" in value)) return value
    // A global is the same variable wherever the body is inlined.
    if (local.global) return local
    // Declared inside the inlined body, such as the binding of `?.`.
    const renamed = this.fresh(local)
    values.set(local, renamed)
    return renamed
  }
}

/** Whether an expression may be evaluated any number of times, at any point, with the same result. */
function pure(e: ir.Expr): boolean {
  switch (e.k) {
    case "int":
    case "float":
    case "bool":
    case "string":
    case "null":
      return true
    case "local":
      // A global changes from zero to its value when the top-level code runs.
      return !e.local.assigned && !e.local.global
    default:
      return false
  }
}

/** Calls `onLocal` for every local and `onNode` for every node with a kind in a subtree, without entering other functions. */
function walk(node: unknown, onLocal?: (local: ir.Local) => void, onNode?: (node: ir.Expr) => void) {
  if (Array.isArray(node)) {
    for (const n of node) walk(n, onLocal, onNode)
    return
  }
  if (!node || typeof node !== "object") return
  const obj = node as Record<string, unknown>
  if (typeof obj.k === "string") onNode?.(obj as unknown as ir.Expr)
  // The value of a map entry in `for (const [key, value] of map)`.
  if (obj.k === "for-of" && obj.value) onLocal?.(obj.value as ir.Local)
  for (const [key, value] of Object.entries(obj)) {
    if (localKeys.has(key)) {
      if (value && typeof value === "object") onLocal?.(value as ir.Local)
    } else if (!shared.has(key)) {
      walk(value, onLocal, onNode)
    }
  }
}
