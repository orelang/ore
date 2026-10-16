// Sort: sorts pseudo-random integers and then a fifth as many strings with
// the built-in sort, and prints checksums of the sorted orders.

const n = process.argv.length > 2 ? Number.parseInt(process.argv[2]) : 5000000

// A 32-bit xorshift generator, the same in every language.
let state = 2463534242
function next(): number {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    return state >>> 1
}

const numbers: number[] = []
for (let i = 0; i < n; i++) numbers.push(next())
numbers.sort((a, b) => a - b)
let sum = 0
for (const x of numbers) sum = (sum * 31 + x) % 1000000007

const words: string[] = []
for (let i = 0; i < Math.trunc(n / 5); i++) words.push(`w${next()}`)
words.sort()
let hash = 0
for (const w of words) hash = (hash * 31 + w.length * 256 + w.charCodeAt(w.length - 1)) % 1000000007

console.log(sum, hash, words[0], words[words.length - 1])
