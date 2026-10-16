// Writes N random doubles as 16 hex digits of their bits, then Node's
// String(x) of each, for tests/fuzz/numbers/check.ore to compare with Ore's.
//   node tests/fuzz/numbers/gen.mjs N SEED > numbers.txt
const n = Number(process.argv[2] ?? "100000")
let seed = BigInt(process.argv[3] ?? "1")
function next() {
    seed ^= (seed << 13n) & 0xffffffffffffffffn
    seed ^= seed >> 7n
    seed ^= (seed << 17n) & 0xffffffffffffffffn
    return seed & 0xffffffffffffffffn
}
const view = new DataView(new ArrayBuffer(8))
const lines = []
for (let i = 0; i < n; i++) {
    let bits = next()
    // A third of them small integers, decimals and their neighbours, which matter most.
    const kind = i % 3
    if (kind === 1) {
        view.setFloat64(0, Number((bits % 2000000n) - 1000000n) / [1, 10, 100, 1000, 3, 7][i % 6])
        bits = view.getBigUint64(0)
    } else if (kind === 2) {
        view.setFloat64(0, Number(bits % 100000n) * 10 ** (Number(bits % 40n) - 20))
        bits = view.getBigUint64(0) + BigInt(i % 3) - 1n
    }
    view.setBigUint64(0, bits & 0xffffffffffffffffn)
    const x = view.getFloat64(0)
    lines.push(`${view.getBigUint64(0).toString(16).padStart(16, "0")} ${String(x)} ${JSON.stringify(x)} ${x.toFixed(3)}`)
}
process.stdout.write(lines.join("\n") + "\n")
