import type { Expr, Func, Local, LValue, Module, Stmt } from "./nodes"
import type { InterfaceType, StructType, Type } from "./types"

/**
 * The canonical text of a module: deterministic, one node per line, children
 * indented by two spaces under their parent and prefixed with their role.
 * Every node and type kind and every field is written, so that two modules
 * with the same dump are the same IR. compiler/next/src/ir/dump.ore writes
 * the same format; the checker written in Ore is checked against this one.
 *
 * ```
 * module "<file>"
 * struct Name#id [nominal] [extends B#id] a struct of `structs`, then its
 *   field name: T [readonly] [private]   fields, methods and constructor
 *   method name: <func name> [private]
 *   ctor: <func name>
 * union (A | B)%id [name="Alias"]        a union of `unions`
 * itab <id>: Name#id -> Name@id          an itab of `itabs`
 * func <name> "<source name>" line=N [file="..."] [extern] [variadic=T] [exported] [closure] : <type>
 *   attributes [noinline] [inline] [cold] [export="..."] [runtime="..."] [naked]
 *   receiver: <local>                    then `param:` and `capture:` locals
 *                                        (`closure` marks `captures`, even empty)
 *   body: block line=N                   statements: kind, fields, `line=N`
 *     let $id name: T [mut] ... line=N   (a block's statements have no role)
 *       init: int 1 : i64                expressions: kind, fields, ` : type`
 * init <name> ...                        each function of `inits`, as `func`
 * interface Name@id                      every interface the dump refers to,
 *   field name: T [readonly]             in order of first reference
 *   method name: (A) => R
 * ```
 *
 * Types are written as `typeToString` writes them, except that a struct is
 * `Name#id` (`#id` if anonymous), an interface `Name@id`, a union
 * `(A | B)%id`, and a string literal type is quoted like `quote` does. A
 * struct or interface name that is not an identifier, such as the
 * `Stack<string>` of a generic instance, is quoted too: `"Stack<string>"#20`.
 * A local is `$id name: T` with its flags; a reference to it is `$id name`.
 * Functions are referred to by `name`, or by `name#k` for the k-th (from 0)
 * of the functions sharing a name, such as two external declarations of one
 * C function with different parameters; itabs by id. Integer constants are
 * decimal (`u64` values unsigned), floats as JavaScript prints them (`-0`
 * for negative zero).
 *
 * The dump is the whole module: compiler/next/src/ir/read.ore reads it back.
 */
export function dump(module: Module): string {
  return new Dumper().module(module)
}

/** A struct or interface name as the dump writes it: as is when it is an identifier, else quoted. */
export function ident(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : quote(name)
}

/** A string in double quotes: `"` and `\` escaped, `\n`, `\r`, `\t`, other control characters as `\u00XX`. */
export function quote(s: string): string {
  let out = '"'
  for (const c of s) {
    const code = c.charCodeAt(0)
    if (c === '"') out += '\\"'
    else if (c === "\\") out += "\\\\"
    else if (c === "\n") out += "\\n"
    else if (c === "\r") out += "\\r"
    else if (c === "\t") out += "\\t"
    else if (code < 0x20) out += `\\u00${code.toString(16).padStart(2, "0")}`
    else out += c
  }
  return `${out}"`
}

class Dumper {
  lines: string[] = []
  /** Interfaces referred to so far, written at the end. */
  ifaces: InterfaceType[] = []
  /** For the functions that share their name with others: `name#k`. */
  refs = new Map<Func, string>()

  module(m: Module): string {
    const named = new Map<string, Func[]>()
    for (const f of m.functions) {
      const list = named.get(f.name)
      if (list === undefined) named.set(f.name, [f])
      else if (!list.includes(f)) list.push(f)
    }
    for (const list of named.values()) if (list.length > 1) list.forEach((f, k) => this.refs.set(f, `${f.name}#${k}`))
    this.line(0, `module ${quote(m.file)}`)
    for (const s of m.structs) this.struct(s)
    for (const u of m.unions) this.line(0, `union ${this.type(u)}${u.name !== undefined ? ` name=${quote(u.name)}` : ""}`)
    for (const t of m.itabs) this.line(0, `itab ${t.id}: ${this.type(t.struct)} -> ${this.type(t.iface)}`)
    for (const f of m.functions) this.func("func", f)
    for (const f of m.inits) this.func("init", f)
    // Interfaces found while writing interfaces are appended to the list.
    for (let i = 0; i < this.ifaces.length; i++) this.iface(this.ifaces[i]!)
    return this.lines.map((l) => `${l}\n`).join("")
  }

  line(depth: number, text: string) {
    this.lines.push(`${"  ".repeat(depth)}${text}`)
  }

  /** A reference to a function: its name, with `#k` when others share it. */
  ref(f: Func): string {
    return this.refs.get(f) ?? f.name
  }

  struct(s: StructType) {
    this.line(0, `struct ${this.type(s)}${s.nominal ? " nominal" : ""}${s.base !== undefined ? ` extends ${this.type(s.base)}` : ""}`)
    for (const f of s.fields) this.line(1, `field ${f.name}: ${this.type(f.type)}${f.readonly ? " readonly" : ""}${f.private ? " private" : ""}`)
    for (const m of s.methods) this.line(1, `method ${m.name}: ${this.ref(m.func)}${m.private ? " private" : ""}`)
    if (s.ctor !== undefined) this.line(1, `ctor: ${this.ref(s.ctor)}`)
  }

  iface(t: InterfaceType) {
    this.line(0, `interface ${this.type(t)}`)
    for (const m of t.members) {
      if (m.k === "field") this.line(1, `field ${m.name}: ${this.type(m.type)}${m.readonly ? " readonly" : ""}`)
      else this.line(1, `method ${m.name}: ${this.type(m.type)}`)
    }
  }

  func(what: string, f: Func) {
    let head = `${what} ${f.name} ${quote(f.sourceName)} line=${f.line}`
    if (f.file !== undefined) head += ` file=${quote(f.file)}`
    if (f.extern) head += " extern"
    if (f.variadic !== undefined) head += ` variadic=${this.type(f.variadic)}`
    if (f.exported) head += " exported"
    if (f.captures !== undefined) head += " closure"
    this.line(0, `${head} : ${this.type(f.type)}`)
    const a = f.attributes
    if (a !== undefined) {
      let text = "attributes"
      if (a.noinline) text += " noinline"
      if (a.inline) text += " inline"
      if (a.cold) text += " cold"
      if (a.exportName !== undefined) text += ` export=${quote(a.exportName)}`
      if (a.runtime !== undefined) text += ` runtime=${quote(a.runtime)}`
      if (a.naked) text += " naked"
      this.line(1, text)
    }
    if (f.receiver !== undefined) this.line(1, `receiver: ${this.local(f.receiver)}`)
    for (const p of f.params) this.line(1, `param: ${this.local(p)}`)
    if (f.captures !== undefined) for (const c of f.captures) this.line(1, `capture: ${this.local(c)}`)
    this.stmt(f.body, 1, "body: ")
  }

  /** A local where it is declared: `$id name: T` and its flags. */
  local(l: Local): string {
    let text = `$${l.id} ${l.name}: ${this.type(l.type)}`
    if (l.mutable) text += " mut"
    if (l.captured) text += " captured"
    if (l.assigned) text += " assigned"
    if (l.global) text += " global"
    if (l.threadLocal) text += " threadlocal"
    if (l.exportName !== undefined) text += ` export=${quote(l.exportName)}`
    return text
  }

  stmt(s: Stmt, depth: number, prefix: string) {
    const head = (text: string) => this.line(depth, `${prefix}${text}${s.line !== undefined ? ` line=${s.line}` : ""}`)
    const d = depth + 1
    switch (s.k) {
      case "block":
        head("block")
        for (const b of s.body) this.stmt(b, d, "")
        return
      case "let":
        head(`let ${this.local(s.local)}`)
        if (s.init !== undefined) this.expr(s.init, d, "init")
        return
      case "expr":
        head("expr")
        this.expr(s.expr, d, "expr")
        return
      case "if":
        head("if")
        this.expr(s.cond, d, "cond")
        this.stmt(s.then, d, "then: ")
        if (s.else !== undefined) this.stmt(s.else, d, "else: ")
        return
      case "loop":
        head(`loop #${s.id}${s.labeled ? " labeled" : ""}${s.condAfter ? " condAfter" : ""}`)
        if (s.perIteration !== undefined) for (const l of s.perIteration) this.line(d, `perIteration: ${this.local(l)}`)
        if (s.cond !== undefined) this.expr(s.cond, d, "cond")
        if (s.update !== undefined) this.expr(s.update, d, "update")
        this.stmt(s.body, d, "body: ")
        return
      case "for-of":
        head(`for-of #${s.id}${s.labeled ? " labeled" : ""}`)
        this.line(d, `local: ${this.local(s.local)}`)
        if (s.value !== undefined) this.line(d, `value: ${this.local(s.value)}`)
        this.expr(s.iterable, d, "iterable")
        this.stmt(s.body, d, "body: ")
        return
      case "switch":
        head(`switch #${s.id}${s.labeled ? " labeled" : ""}${s.exhaustive ? " exhaustive" : ""}`)
        this.line(d, `local: ${this.local(s.local)}`)
        this.expr(s.value, d, "value")
        for (const c of s.clauses) {
          this.line(d, c.test !== undefined ? "clause: case" : "clause: default")
          if (c.test !== undefined) this.expr(c.test, d + 1, "test")
          for (const b of c.body) this.stmt(b, d + 1, "body: ")
        }
        return
      case "using":
        head("using")
        this.line(d, `local: ${this.local(s.local)}`)
        this.expr(s.init, d, "init")
        this.stmt(s.dispose, d, "dispose: ")
        for (const b of s.body) this.stmt(b, d, "body: ")
        return
      case "break":
      case "continue":
        head(`${s.k}${s.target !== undefined ? ` target=#${s.target}` : ""}`)
        return
      case "return":
        head("return")
        if (s.value !== undefined) this.expr(s.value, d, "value")
        return
    }
  }

  lvalue(t: LValue, depth: number) {
    const d = depth + 1
    switch (t.k) {
      case "local":
        this.line(depth, `target: local $${t.local.id} ${t.local.name}`)
        return
      case "element":
        this.line(depth, "target: element")
        this.expr(t.array, d, "array")
        this.expr(t.index, d, "index")
        return
      case "field":
        this.line(depth, `target: field ${t.name}`)
        this.expr(t.object, d, "object")
        return
      case "iface-field":
        this.line(depth, `target: iface-field ${t.index}`)
        this.expr(t.value, d, "value")
        return
      case "union-field":
        this.line(depth, `target: union-field ${t.name}`)
        this.expr(t.value, d, "value")
        return
    }
  }

  expr(e: Expr, depth: number, role: string) {
    const head = (text: string) => this.line(depth, `${role}: ${text} : ${this.type(e.type)}`)
    const d = depth + 1
    const all = (es: readonly Expr[], r: string) => {
      for (const x of es) this.expr(x, d, r)
    }
    switch (e.k) {
      case "int":
        head(`int ${e.value}`)
        return
      case "float":
        head(`float ${Object.is(e.value, -0) ? "-0" : String(e.value)}`)
        return
      case "bool":
        head(`bool ${e.value}`)
        return
      case "string":
        head(`string ${quote(e.value)}`)
        return
      case "local":
        head(`local $${e.local.id} ${e.local.name}`)
        return
      case "assign":
        head(`assign${e.op !== undefined ? ` ${e.op}` : ""}`)
        this.lvalue(e.target, d)
        this.expr(e.value, d, "value")
        return
      case "incdec":
        head(`incdec ${e.op} ${e.prefix ? "prefix" : "postfix"}`)
        this.lvalue(e.target, d)
        return
      case "arith":
      case "compare":
      case "logical":
        head(`${e.k} ${e.op}`)
        this.expr(e.left, d, "left")
        this.expr(e.right, d, "right")
        return
      case "unary":
        head(`unary ${e.op}`)
        this.expr(e.operand, d, "operand")
        return
      case "not":
        head("not")
        this.expr(e.operand, d, "operand")
        return
      case "convert":
      case "len":
      case "recast":
      case "is-null":
      case "typeof":
      case "downcast":
        head(e.k)
        this.expr(e.value, d, "value")
        return
      case "call":
        head(`call ${this.ref(e.func)}`)
        all(e.args, "arg")
        return
      case "builtin": {
        let text = `builtin ${e.name}`
        if (e.typeArgs !== undefined) text += ` typeArgs=<${e.typeArgs.map((t) => this.type(t)).join(", ")}>`
        if (e.error !== undefined) text += ` error=${this.ref(e.error.ctor)} itab=${e.error.itab.id}`
        head(text)
        all(e.args, "arg")
        return
      }
      case "cond":
        head("cond")
        this.expr(e.cond, d, "cond")
        this.expr(e.then, d, "then")
        this.expr(e.else, d, "else")
        return
      case "concat":
        head("concat")
        all(e.parts, "part")
        return
      case "index":
        head("index")
        this.expr(e.target, d, "target")
        this.expr(e.index, d, "index")
        return
      case "slice":
        head("slice")
        this.expr(e.value, d, "value")
        if (e.start !== undefined) this.expr(e.start, d, "start")
        if (e.end !== undefined) this.expr(e.end, d, "end")
        return
      case "array":
        head("array")
        all(e.elems, "elem")
        return
      case "push":
        head("push")
        this.expr(e.array, d, "array")
        all(e.values, "value")
        return
      case "pop":
        head("pop")
        this.expr(e.array, d, "array")
        return
      case "object":
        head("object")
        for (const f of e.fields) this.expr(f.value, d, `field ${f.name}`)
        return
      case "field":
        head(`field ${e.name}`)
        this.expr(e.object, d, "object")
        return
      case "alloc":
        head("alloc")
        return
      case "method-call":
        head(`method-call ${this.ref(e.func)}${e.virtual ? " virtual" : ""}`)
        this.expr(e.receiver, d, "receiver")
        all(e.args, "arg")
        return
      case "to-iface": {
        let text = "to-iface"
        if (e.itab !== undefined) text += ` itab=${e.itab.id}`
        if (e.indices !== undefined) text += ` indices=[${e.indices.join(", ")}]`
        head(text)
        this.expr(e.value, d, "value")
        return
      }
      case "iface-field":
        head(`iface-field ${e.index}`)
        this.expr(e.value, d, "value")
        return
      case "iface-call":
        head(`iface-call ${e.index} method=${this.type(e.method)}`)
        this.expr(e.value, d, "value")
        all(e.args, "arg")
        return
      case "null":
        head("null")
        return
      case "optional":
        head("optional")
        this.expr(e.value, d, "value")
        this.line(d, `binding: ${this.local(e.binding)}`)
        this.expr(e.body, d, "body")
        return
      case "coalesce":
        head("coalesce")
        this.expr(e.value, d, "value")
        this.expr(e.fallback, d, "fallback")
        return
      case "union-field":
        head(`union-field ${e.name}`)
        this.expr(e.value, d, "value")
        return
      case "is":
        head(`is member=${this.type(e.member)}${e.via !== undefined ? ` via=${this.type(e.via)}` : ""}`)
        this.expr(e.value, d, "value")
        return
      case "map":
        head(`map ${e.op} mapType=${this.type(e.mapType)}`)
        if (e.map !== undefined) this.expr(e.map, d, "map")
        if (e.key !== undefined) this.expr(e.key, d, "key")
        if (e.value !== undefined) this.expr(e.value, d, "value")
        return
      case "set":
        head(`set ${e.op} setType=${this.type(e.setType)}`)
        if (e.set !== undefined) this.expr(e.set, d, "set")
        if (e.value !== undefined) this.expr(e.value, d, "value")
        return
      case "func-ref":
      case "closure":
        head(`${e.k} ${this.ref(e.func)}`)
        return
      case "call-value":
        head("call-value")
        this.expr(e.callee, d, "callee")
        all(e.args, "arg")
        return
      case "bound-method":
        head(`bound-method${e.func !== undefined ? ` func=${this.ref(e.func)}` : ""}${e.index !== undefined ? ` index=${e.index}` : ""}${e.virtual ? " virtual" : ""}`)
        this.expr(e.receiver, d, "receiver")
        return
      case "array-method":
        head(`array-method ${e.method}${e.arity !== undefined ? ` arity=${e.arity}` : ""}`)
        this.expr(e.array, d, "array")
        all(e.args, "arg")
        return
      case "string-method":
        head(`string-method ${e.method}`)
        this.expr(e.value, d, "value")
        all(e.args, "arg")
        return
      case "chan":
        head(`chan ${e.op} chanType=${this.type(e.chanType)}${e.arity !== undefined ? ` arity=${e.arity}` : ""}`)
        if (e.chan !== undefined) this.expr(e.chan, d, "chan")
        if (e.value !== undefined) this.expr(e.value, d, "value")
        if (e.handler !== undefined) this.expr(e.handler, d, "handler")
        return
      case "bind":
        head("bind")
        for (const b of e.locals) {
          this.line(d, `local: ${this.local(b.local)}`)
          this.expr(b.init, d + 1, "init")
        }
        this.expr(e.body, d, "body")
        return
      case "seq":
        head("seq")
        all(e.exprs, "expr")
        return
    }
  }

  /** A type in a line; see `dump`. */
  type(t: Type): string {
    switch (t.kind) {
      case "int":
      case "float":
        return t.name
      case "func":
        return `(${t.params.map((p) => this.type(p)).join(", ")}) => ${this.type(t.result)}`
      case "array":
        return t.elem.kind === "func" ? `(${this.type(t.elem)})[]` : `${this.type(t.elem)}[]`
      case "struct":
        return `${t.name === undefined ? "" : ident(t.name)}#${t.id}`
      case "interface":
        if (!this.ifaces.includes(t)) this.ifaces.push(t)
        return `${ident(t.name)}@${t.id}`
      case "union":
        return `(${t.members.map((m) => (m.kind === "func" ? `(${this.type(m)})` : this.type(m))).join(" | ")})%${t.id}`
      case "literal":
        return quote(t.value)
      case "map":
        return `Map<${this.type(t.key)}, ${this.type(t.value)}>`
      case "set":
        return `Set<${this.type(t.elem)}>`
      case "chan":
        return `Chan<${this.type(t.elem)}>`
      case "select-case":
        return "SelectCase"
      default:
        return t.kind
    }
  }
}
