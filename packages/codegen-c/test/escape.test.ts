import { check } from "@ore/checker"
import type * as ir from "@ore/ir"
import { parse } from "@ore/syntax"
import { expect, test } from "bun:test"
import { planStack } from "../src/escape"

const vec = `
class Vec {
    constructor(readonly x: int, readonly y: int) {}
    len(): int { return this.x + this.y }
    me(): Vec { return this }
}
function sum(v: Vec): int { return v.x + v.y }
function keep(v: Vec): Vec { return v }
`

/** What `main` places on the stack: "Vec" for instances, "object" for literals, "closure", or the name of a boxed local. */
function stack(body: string): string[] {
  const { source } = parse("test.ore", `${vec}\nexport function main() {\n${body}\n}\n`)
  const { module, diagnostics } = check(source)
  expect(diagnostics).toEqual([])
  const main = module!.functions.find((f) => f.sourceName === "main")!
  return (planStack(module!).slots.get(main) ?? []).map((n: ir.Expr | ir.Local) => ("id" in n ? n.name : n.k === "call" ? n.func.type.result.kind === "struct" ? n.func.type.result.name! : "call" : n.k))
}

test("objects used in place live on the stack", () => {
  expect(stack("const v = new Vec(1, 2); console.log(v.x + sum(v) + v.len())")).toEqual(["Vec"])
  expect(stack("const v = new Vec(1, 2); const o = { v, n: 1 }; console.log(o.v.x)")).toEqual(["Vec", "object"])
  expect(stack("console.log(sum(new Vec(1, 2)))")).toEqual(["Vec"])
})

test("objects that may outlive the call stay on the heap", () => {
  expect(stack("const v = new Vec(1, 2); const a = [v]")).toEqual([])
  expect(stack("const v = new Vec(1, 2); keep(v)")).toEqual([])
  expect(stack("const v = new Vec(1, 2); v.me()")).toEqual([])
  expect(stack("const v = new Vec(1, 2); const o = { v }; keep(o.v)")).toEqual([])
  expect(stack("const o = { v: new Vec(1, 2) }; const w = new Vec(3, 4); o.v = w")).toEqual(["object", "Vec"])
  expect(stack("let v = new Vec(1, 2); v = new Vec(3, 4); console.log(v.x)")).toEqual([])
  expect(stack("const v = new Vec(1, 2); const f = () => v.x; console.log(f())")).toEqual(["closure"])
})

test("closures called in place keep captured locals on the stack", () => {
  expect(stack("let n = 0; [1, 2].forEach((x) => (n += x)); console.log(n)")).toEqual(["closure", "n"])
  expect(stack("let n = 0; const f = () => n++; f(); console.log(n)")).toEqual(["closure", "n"])
  expect(stack("let n = 0; task.spawn(() => n++)")).toEqual([])
  expect(stack("let n = 0; const fs = [() => n++]")).toEqual([])
})
