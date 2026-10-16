// Closures: chains of map, filter and reduce over an array of a million
// integers, with callbacks that capture variables, repeated.

const n = process.argv.length > 2 ? Number.parseInt(process.argv[2]) : 30

const xs: number[] = []
for (let i = 0; i < 1000000; i++) xs.push((i * 7919) % 1000)

let total = 0
for (let round = 0; round < n; round++) {
    const k = (round % 7) + 1
    const skip = (round % 5) + 2
    total += xs
        .map((x) => x * k + round)
        .filter((x) => x % skip !== 0)
        .reduce((sum, x) => sum + (x % 1000), 0)
}
console.log(total)
