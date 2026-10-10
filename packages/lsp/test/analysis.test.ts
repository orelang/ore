import { expect, test } from "bun:test"
import { analyze } from "../src"

const text = `function add(a: i32, b: i32): i32 {
  return a + b
}

export function main() {
  const limit = 10
  let total: i32 = add(1, 2)
  println(total, limit)
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
  expect(analysis.hover(at("println", "total"))?.contents).toBe("```ore\nlet total: i32\n```")
  expect(analysis.hover(at("return a", "a"))?.contents).toBe("```ore\n(parameter) a: i32\n```")
  expect(analysis.hover(at("println", "limit"))?.contents).toBe("```ore\nconst limit: i64\n```")
})

test("hover shows function signatures, including built-ins", () => {
  const analysis = analyze("main.ore", text)
  expect(analysis.hover(at("let total", "add"))?.contents).toBe("```ore\nfunction add(a: i32, b: i32): i32\n```")
  expect(analysis.hover(at("let total", "i32"))?.contents).toBe("```ore\ntype i32 = intrinsic\n```")
  expect(analysis.hover(at("println", "println"))?.contents).toContain("function println(")
})

test("go to definition", () => {
  const analysis = analyze("main.ore", text)
  expect(analysis.definition(at("let total", "add"))).toEqual({
    path: "main.ore",
    text: undefined,
    range: { start: { line: 0, character: 9 }, end: { line: 0, character: 12 } },
  })
  const builtin = analysis.definition(at("println", "println"))
  expect(builtin?.path).toBe("std/builtin.d.ore")
  expect(builtin?.text).toContain("declare function println")
})
