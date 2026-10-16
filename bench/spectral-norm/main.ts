// The spectral norm of an infinite matrix, from the Computer Language
// Benchmarks Game: floating-point loops over arrays.

function a(i: number, j: number): number {
    return 1.0 / ((((i + j) * (i + j + 1)) >>> 1) + i + 1)
}

function multiplyAv(n: number, v: Float64Array, av: Float64Array) {
    for (let i = 0; i < n; i++) {
        let sum = 0.0
        for (let j = 0; j < n; j++) sum += a(i, j) * v[j]
        av[i] = sum
    }
}

function multiplyAtv(n: number, v: Float64Array, atv: Float64Array) {
    for (let i = 0; i < n; i++) {
        let sum = 0.0
        for (let j = 0; j < n; j++) sum += a(j, i) * v[j]
        atv[i] = sum
    }
}

function multiplyAtAv(n: number, v: Float64Array, out: Float64Array, tmp: Float64Array) {
    multiplyAv(n, v, tmp)
    multiplyAtv(n, tmp, out)
}

const n = process.argv.length > 2 ? Number.parseInt(process.argv[2]) : 4000
const u = new Float64Array(n).fill(1)
const v = new Float64Array(n)
const tmp = new Float64Array(n)
for (let i = 0; i < 10; i++) {
    multiplyAtAv(n, u, v, tmp)
    multiplyAtAv(n, v, u, tmp)
}
let vBv = 0.0
let vv = 0.0
for (let i = 0; i < n; i++) {
    vBv += u[i] * v[i]
    vv += v[i] * v[i]
}
console.log(Math.sqrt(vBv / vv).toFixed(9))
