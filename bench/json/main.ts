// JSON: writes an array of objects as text with JSON.stringify, reads it back
// with JSON.parse and sums its fields.

type Item = {
    id: number
    name: string
    score: number
    active: boolean
    tags: string[]
}

const n = process.argv.length > 2 ? Number.parseInt(process.argv[2]) : 300000

const items: Item[] = []
for (let i = 0; i < n; i++) {
    items.push({ id: i, name: `item ${i}`, score: (i % 100) * 0.5, active: i % 3 === 0, tags: ["a", `t${i % 10}`] })
}
const text = JSON.stringify(items)
const parsed: Item[] = JSON.parse(text)
let ids = 0
let score = 0.0
let active = 0
let tags = 0
for (const item of parsed) {
    ids += item.id
    score += item.score
    if (item.active) active++
    tags += item.tags.length + item.name.length
}
console.log(text.length, parsed.length, ids, score, active, tags)
