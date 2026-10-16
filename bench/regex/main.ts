// Regular expressions: generates a log of n lines, then counts the lines
// that match a few patterns, collects every match of a global one and
// rewrites the dates of the whole text with groups.

const n = process.argv.length > 2 ? Number.parseInt(process.argv[2]) : 100000

const lines: string[] = []
for (let i = 0; i < n; i++) {
    const month = `${(i % 12) + 1}`.padStart(2, "0")
    const day = `${(i % 28) + 1}`.padStart(2, "0")
    lines.push(`user${i}@host${i % 97}.example.com GET /page/${i % 1000} 2024-${month}-${day} status ${200 + ((i * 7) % 4) * 100}`)
}
const text = lines.join("\n")

// Per line: a test, an anchored pattern with alternation, a match with groups.
const errors = /status 5\d\d$/
const pages = /^user\d*7@host(1|2|3)\d?\./
const page = /GET \/page\/(\d+)/
let failed = 0
let chosen = 0
let total = 0
for (const line of lines) {
    if (errors.test(line)) failed++
    if (pages.test(line)) chosen++
    const m = page.exec(line)
    if (m !== null) total += Number.parseInt(m[1])
}

// Over the whole text: every address, and the dates rewritten.
const addresses = text.match(/\w+@\w+\.example\.com/g)?.length ?? 0
const rewritten = text.replace(/(\d{4})-(\d\d)-(\d\d)/g, "$3.$2.$1")
const words = text.split(/\s+/).length
console.log(failed, chosen, total, addresses, rewritten.length, words, rewritten.slice(rewritten.length - 40))
