// File I/O: writes n lines of comma-separated numbers to a file in a new
// temporary directory, reads the file back, parses the second number of each
// line and sums them, then removes the directory. The file is written and
// read whole, as in the Ore version. The one import is the file system,
// which Bun and Node have only as a module.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"

const n = process.argv.length > 2 ? Number.parseInt(process.argv[2]) : 3000000

const dir = mkdtempSync(`${process.env.TMPDIR ?? "/tmp"}/ts-bench-fileio-`)
const path = `${dir}/numbers.csv`

let out = ""
for (let i = 0; i < n; i++) out += `${i},${(i * 7919) % 1000003}\n`
writeFileSync(path, out)

const text = readFileSync(path, "utf8")
let lines = 0
let sum = 0
for (const line of text.split("\n")) {
    if (line.length === 0) continue
    lines++
    sum += Number.parseInt(line.slice(line.indexOf(",") + 1))
}
rmSync(dir, { recursive: true })
console.log(lines, text.length, sum)
