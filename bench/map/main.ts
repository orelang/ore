// Maps: inserts, looks up and deletes integer and string keys, then iterates
// over what is left.

const n = process.argv.length > 2 ? Number.parseInt(process.argv[2]) : 1000000

// Integer keys, spread out; half of the lookups miss.
const numbers = new Map<number, number>()
for (let i = 0; i < n; i++) numbers.set(i * 7, i)
let hits = 0
let sum = 0
for (let i = 0; i < 2 * n; i++) {
    if (numbers.has(i * 7)) hits++
    sum += numbers.get(i * 7) ?? 0
}
for (let i = 0; i < n; i += 2) numbers.delete(i * 7)
for (const [k, v] of numbers) sum += k + v

// String keys made by templates; a third of them deleted.
const names = new Map<string, number>()
for (let i = 0; i < n; i++) names.set(`key-${i}`, i)
for (let i = 0; i < n; i++) sum += names.get(`key-${i * 3}`) ?? 1
for (let i = 0; i < n; i += 3) names.delete(`key-${i}`)
for (const [k, v] of names) sum += k.length + v

console.log(hits, numbers.size, names.size, sum)
