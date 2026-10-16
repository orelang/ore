// Mandelbrot from the Computer Language Benchmarks Game: computes the n×n
// bitmap of the set, one bit per pixel, and prints its FNV-1a hash instead of
// the PBM file.

const n = process.argv.length > 2 ? Number.parseInt(process.argv[2]) : 4000

const bitmap: number[] = []
for (let y = 0; y < n; y++) {
    const ci = (2.0 * y) / n - 1.0
    let bits = 0
    for (let x = 0; x < n; x++) {
        const cr = (2.0 * x) / n - 1.5
        let zr = 0.0
        let zi = 0.0
        let tr = 0.0
        let ti = 0.0
        let i = 0
        while (i < 50 && tr + ti <= 4.0) {
            zi = 2.0 * zr * zi + ci
            zr = tr - ti + cr
            tr = zr * zr
            ti = zi * zi
            i++
        }
        bits = bits << 1
        if (tr + ti <= 4.0) bits = bits | 1
        if (x % 8 === 7) {
            bitmap.push(bits & 255)
            bits = 0
        }
    }
    if (n % 8 !== 0) bitmap.push((bits << (8 - (n % 8))) & 255)
}

let hash = 2166136261
for (const b of bitmap) hash = Math.imul(hash ^ b, 16777619) >>> 0
console.log(n, bitmap.length, hash)
