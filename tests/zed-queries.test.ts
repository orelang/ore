/**
 * Compiles the Zed extension's tree-sitter queries against the TypeScript
 * grammar. An invalid query silently disables the language in Zed.
 */
import { beforeAll, describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { Language, Parser, Query } from "web-tree-sitter"

const queriesDir = join(import.meta.dir, "../editors/zed/languages/ore")
let language: Language

beforeAll(async () => {
  await Parser.init()
  language = await Language.load(join(import.meta.dir, "../node_modules/tree-sitter-typescript/tree-sitter-typescript.wasm"))
})

const sample = `/** Adds numbers. */
function add(a: i32, b: i32): i32 {
  return a + b
}

const LIMIT = 10

export function main() {
  let total: u8 = u8(add(1, 2))
  console.log("total", total, LIMIT, true)
}
`


describe("zed queries", () => {
  for (const file of readdirSync(queriesDir).filter((f) => f.endsWith(".scm"))) {
    test(`${file} compiles`, () => {
      expect(() => new Query(language, readFileSync(join(queriesDir, file), "utf8"))).not.toThrow()
    })
  }

  test("highlights Ore built-in types, conversions and functions", async () => {
    const parser = new Parser()
    parser.setLanguage(language)
    const tree = parser.parse(sample)!
    const query = new Query(language, await Bun.file(join(queriesDir, "highlights.scm")).text())
    // Later patterns win in Zed: keep the last capture for each node.
    const final = new Map<number, [string, string]>()
    for (const c of query.captures(tree.rootNode)) final.set(c.node.id, [c.node.text, c.name])
    const of = (text: string) => [...final.values()].filter(([t]) => t === text).map(([, name]) => name)

    expect(of("i32")).toEqual(["type.builtin", "type.builtin", "type.builtin"])
    expect(of("u8")).toEqual(["type.builtin", "type.builtin"])
    expect(of("add")).toEqual(["function", "function"])
    expect(of("console")).toEqual(["namespace"])
    expect(of("log")).toEqual(["function.builtin"])
    expect(of("LIMIT")).toEqual(["constant", "constant"])
    expect(of("a")).toEqual(["variable.parameter", "variable"])
    expect(of("/** Adds numbers. */")).toEqual(["comment.doc"])
    expect(of("function")).toEqual(["keyword", "keyword"])
  })

  test("outline lists functions and top-level constants", async () => {
    const parser = new Parser()
    parser.setLanguage(language)
    const tree = parser.parse(sample)!
    const query = new Query(language, await Bun.file(join(queriesDir, "outline.scm")).text())
    const names = query.captures(tree.rootNode).filter((c) => c.name === "name").map((c) => c.node.text)
    expect(names).toEqual(["add", "LIMIT", "main"])
  })
})
