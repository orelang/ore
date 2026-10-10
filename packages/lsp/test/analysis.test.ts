import { expect, test } from "bun:test"
import { analyze } from "../src"

const text = `function add(a: i32, b: i32): i32 {
  return a + b
}

export function main() {
  const limit = 10
  let total: i32 = add(1, 2)
  console.log(total, limit)
}
`

// Zero-based position of the first occurrence of `needle` on a line containing `line`.
function at(line: string, needle: string) {
  const lines = text.split("\n")
  const index = lines.findIndex((l) => l.includes(line))
  return { line: index, character: lines[index]!.indexOf(needle) + 1 }
}

test("diagnostics carry ranges", () => {
  const analysis = analyze("main.ore", "export function main() {\n  let x: u8 = 300\n}\n")
  expect(analysis.diagnostics.map((d) => d.message)).toEqual(["Constant 300 overflows 'u8' (range 0..255)."])
  const d = analysis.diagnostics[0]!
  expect(analysis.range(d.source, d.start, d.start + d.length)).toEqual({
    start: { line: 1, character: 14 },
    end: { line: 1, character: 17 },
  })
})

test("hover shows variable, parameter and constant types", () => {
  const analysis = analyze("main.ore", text)
  expect(analysis.hover(at("console.log", "total"))?.contents).toBe("```ore\nlet total: i32\n```")
  expect(analysis.hover(at("return a", "a"))?.contents).toBe("```ore\n(parameter) a: i32\n```")
  expect(analysis.hover(at("console.log", "limit"))?.contents).toBe("```ore\nconst limit: i64\n```")
})

test("hover shows function signatures, including built-ins", () => {
  const analysis = analyze("main.ore", text)
  expect(analysis.hover(at("let total", "add"))?.contents).toBe("```ore\nfunction add(a: i32, b: i32): i32\n```")
  expect(analysis.hover(at("let total", "i32"))?.contents).toBe("```ore\ntype i32 = intrinsic\n```")
  expect(analysis.hover(at("console.log", "log"))?.contents).toContain("function log(")
})

test("go to definition", () => {
  const analysis = analyze("main.ore", text)
  expect(analysis.definition(at("let total", "add"))).toEqual({
    path: require("node:path").resolve("main.ore"),
    text: undefined,
    range: { start: { line: 0, character: 9 }, end: { line: 0, character: 12 } },
  })
  const builtin = analysis.definition(at("console.log", "log"))
  expect(builtin?.path).toBe("std/builtin.d.ore")
  expect(builtin?.text).toContain("declare namespace console")
})

const classes = `interface Shape {
  area(): f64
}

class Circle {
  private cache = 0.0
  constructor(public r: f64) {}

  area(): f64 {
    return this.r
  }
}

export function main() {
  const c = new Circle(1)
  const s: Shape = c
  console.log(c.area(), s.area(), c.r)
}
`

function pos(text: string, line: string, needle: string, after = false) {
  const lines = text.split("\n")
  const index = lines.findIndex((l) => l.includes(line))
  return { line: index, character: lines[index]!.indexOf(needle) + (after ? needle.length : 1) }
}

test("completion lists public members after a dot", () => {
  const text = classes.replace("  console.log(c.area(), s.area(), c.r)", "  c.")
  const analysis = analyze("main.ore", text)
  expect(analysis.diagnostics.length).toBeGreaterThan(0)
  const ofCircle = analysis.completions(pos(text, "  c.", "c.", true))
  expect(ofCircle.map((c) => `${c.kind} ${c.label}: ${c.detail}`)).toEqual(["field r: f64", "method area: () => f64"])
  const shape = classes.replace("  console.log(c.area(), s.area(), c.r)", "  s.")
  const ofShape = analyze("main.ore", shape).completions(pos(shape, "  s.", "s.", true))
  expect(ofShape.map((c) => c.label)).toEqual(["area"])
})

test("completion inside a class includes private members", () => {
  const analysis = analyze("main.ore", classes)
  const labels = analysis.completions(pos(classes, "return this.r", "this.", true)).map((c) => c.label)
  expect(labels).toEqual(["cache", "r", "area"])
})

test("completion for arrays and strings", () => {
  const text = `export function main() {\n  const xs = [1]\n  xs.length\n}\n`
  const labels = analyze("main.ore", text).completions(pos(text, "xs.length", "xs.", true)).map((c) => c.label)
  expect(labels.slice(0, 6)).toEqual(["length", "push", "pop", "slice", "forEach", "map"])
})

test("hover on classes, methods and properties", () => {
  const analysis = analyze("main.ore", classes)
  expect(analysis.hover(pos(classes, "new Circle", "Circle"))?.contents).toBe("```ore\nclass Circle\n```")
  expect(analysis.hover(pos(classes, "console.log", "area"))?.contents).toBe("```ore\n(method) Circle.area(): f64\n```")
  expect(analysis.hover(pos(classes, "console.log", "c.r", true))?.contents).toBe("```ore\n(property) Circle.r: f64\n```")
  expect(analysis.hover(pos(classes, "const s: Shape", "Shape"))?.contents).toBe("```ore\ninterface Shape {\n  area(): f64\n}\n```")
})

test("completion lists functions of built-in namespaces", () => {
  const text = `export function main() {\n  console.\n}\n`
  const items = analyze("main.ore", text).completions(pos(text, "  console.", "console.", true))
  expect(items.map((c) => c.label)).toEqual(["log", "write", "error"])
  expect(items[0]!.detail).toBe("log(...values: (numeric | bool | string)[]): void")
})

test("completion for maps", () => {
  const text = `export function main() {\n  const m = new Map<string, int>()\n  m.size\n}\n`
  const items = analyze("main.ore", text).completions(pos(text, "m.size", "m.", true))
  expect(items.map((c) => c.label)).toEqual(["size", "get", "set", "has", "delete", "clear", "keys", "values"])
  expect(items[1]!.detail).toBe("(key: string) => i64 | null")
})

test("analysis follows imports from the disk and reports only the document's errors", () => {
  const { mkdtempSync, writeFileSync } = require("node:fs") as typeof import("node:fs")
  const { join } = require("node:path") as typeof import("node:path")
  const dir = mkdtempSync(join(require("node:os").tmpdir(), "ore-lsp-"))
  writeFileSync(join(dir, "lib.ore"), "export function twice(x: int): int {\n  return x * 2\n}\nconst broken: int = \"no\"\n")
  const text = 'import { twice } from "./lib"\n\nconst x: string = twice(1)\n'
  const analysis = analyze(join(dir, "main.ore"), text)
  expect(analysis.diagnostics.map((d) => d.message)).toEqual(["Type 'i64' is not assignable to type 'string'."])
  const def = analysis.definition(pos(text, "const x", "twice"))
  expect(def?.path).toBe(join(dir, "lib.ore"))
  expect(def?.text).toBeUndefined()
  expect(analysis.hover(pos(text, "const x", "twice"))?.contents).toBe("```ore\nfunction twice(x: int): int\n```")
})

test("references cover uses, the declaration and imports in other modules", () => {
  const { mkdtempSync, writeFileSync } = require("node:fs") as typeof import("node:fs")
  const { join } = require("node:path") as typeof import("node:path")
  const dir = mkdtempSync(join(require("node:os").tmpdir(), "ore-lsp-"))
  const lib = "export function twice(x: int): int {\n  return x * 2\n}\n"
  writeFileSync(join(dir, "lib.ore"), lib)
  const text = 'import { twice } from "./lib"\n\nconsole.log(twice(1), twice(2))\n'
  const analysis = analyze(join(dir, "main.ore"), text)
  const symbol = analysis.symbolAt(pos(text, "console", "twice"))!
  expect(symbol.name).toBe("twice")
  expect(symbol.builtin).toBe(false)
  const refs = analysis.references(symbol.key).map((r) => `${r.path === join(dir, "lib.ore") ? "lib" : "main"}:${r.range.start.line}:${r.range.start.character}${r.declaration ? " decl" : ""}`)
  expect(refs.sort()).toEqual(["lib:0:16 decl", "main:0:9", "main:2:12", "main:2:22"])
  expect(analysis.symbolAt(pos(text, "console", "console"))?.builtin).toBe(true)
})

test("renaming one side of a shorthand keeps the other", () => {
  const text = "type P = { x: int }\nconst x = 1\nconst p: P = { x }\nconst { x: y } = p\nconsole.log(y)\n"
  const analysis = analyze("main.ore", text)
  const local = analysis.symbolAt(pos(text, "const x", "x"))!
  const edits = analysis.references(local.key).map((r) => `${r.range.start.line}:${r.prefix}*${r.suffix}`)
  expect(edits.sort()).toEqual(["1:*", "2:x: *"])
})
