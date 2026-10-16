// Matmul: multiplies two n×n matrices of f64 stored in flat arrays with the
// naive triple loop. The entries are multiples of 1/8, so every sum is exact
// and the checksums do not depend on the order of the additions.

const n = process.argv.length > 2 ? Number.parseInt(process.argv[2]) : 800

const a: number[] = []
const b: number[] = []
const c: number[] = []
for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
        a.push((((i * j) % 17) - 3) / 8)
        b.push((((i + j) % 13) - 4) / 4)
        c.push(0)
    }
}

for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
        let sum = 0.0
        for (let k = 0; k < n; k++) sum += a[i * n + k] * b[k * n + j]
        c[i * n + j] = sum
    }
}

let total = 0.0
let weighted = 0.0
for (let i = 0; i < n * n; i++) {
    total += c[i]
    weighted += c[i] * ((i % 7) + 1)
}
console.log(total.toFixed(6), weighted.toFixed(6))
