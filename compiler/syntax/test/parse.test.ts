import { expect, test } from "bun:test"
import { formatDiagnostic, parse } from "../src"

test("parses a valid file without diagnostics", () => {
  const { source, diagnostics } = parse("main.ore", "export function main() {\n  console.log(42)\n}\n")
  expect(diagnostics).toEqual([])
  expect(source.ast.statements.length).toBe(1)
})

test("reports syntax errors with positions", () => {
  const { diagnostics } = parse("bad.ore", "let x = \n")
  expect(diagnostics.length).toBe(1)
  expect(formatDiagnostic(diagnostics[0]!)).toBe(
    ["bad.ore:1:8: error: Expression expected.", "  let x = ", "         ^"].join("\n"),
  )
})
