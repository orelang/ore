import { expect, test } from "bun:test"
import { formatOre } from "../src/fmt"

test("formats in the one Ore style: 4 spaces, no semicolons", async () => {
  const text = 'export function main(){ const xs=[1,2];for(const x of xs){console.log( x*2 );} }\n'
  expect(await formatOre(text)).toBe(
    ["export function main() {", "    const xs = [1, 2]", "    for (const x of xs) {", "        console.log(x * 2)", "    }", "}", ""].join("\n"),
  )
})

test("keeps Ore-specific code such as using and declare", async () => {
  const text = "declare function strlen(s: string): u64\nusing r = open()\n"
  expect(await formatOre(text)).toBe(text)
})
