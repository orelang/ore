// Word count: generates a text of made-up words, splits it into lines and
// words, counts them in a map and prints the ten most frequent.

const n = process.argv.length > 2 ? Number.parseInt(process.argv[2]) : 2000000

// Words of one to three syllables, picked by a Lehmer generator.
const syllables = ["ka", "lo", "mi", "ne", "ru", "so", "ti", "va"]
let seed = 42
let text = ""
for (let i = 0; i < n; i++) {
    seed = (seed * 48271) % 2147483647
    let word = syllables[(seed >> 2) % 8]
    if (seed % 3 > 0) word += syllables[(seed >> 5) % 8]
    if (seed % 3 > 1) word += syllables[(seed >> 8) % 8]
    if (i > 0) text += i % 10 === 0 ? "\n" : " "
    text += word
}

const counts = new Map<string, number>()
for (const line of text.split("\n")) {
    for (const word of line.split(" ")) counts.set(word, (counts.get(word) ?? 0) + 1)
}

// The most frequent first, ties in alphabetical order.
const entries: [string, number][] = []
for (const [word, count] of counts) entries.push([word, count])
entries.sort((a, b) => {
    if (a[1] !== b[1]) return b[1] - a[1]
    return a[0] < b[0] ? -1 : 1
})
const top: string[] = []
for (let i = 0; i < 10 && i < entries.length; i++) top.push(`${entries[i][0]}:${entries[i][1]}`)
console.log(n, counts.size, top.join(" "))
