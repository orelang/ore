// Random sequences of operations on a Map<string, int>, a Set<int> and an
// int[]. Writes the cases, one JSON array of operations a line, to the file
// in argv[2], and prints what JavaScript gives (as
// tests/fuzz/collections/check.ore prints it): each operation's result, and
// at the end the entries in their order.
// pop and shift of an empty array, which panic in Ore, print "empty".
//   node tests/fuzz/collections/gen.mjs cases.jsonl N SEED > expected.txt
import { writeFileSync } from "node:fs"
const file = process.argv[2]
const n = Number(process.argv[3] ?? "5000")
let seed = Number(process.argv[4] ?? "1") >>> 0 || 1
function next() {
    seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0
    return seed
}
const below = (k) => next() % k
const pick = (xs) => xs[below(xs.length)]
// Few keys, so that they repeat; many sometimes, so that tables grow.
const key = (wide) => (wide ? `k${below(200)}` : pick(["a", "b", "c", "", "é", "a\u0000"]))
const ops = ["set", "set", "set", "get", "has", "delete", "delete", "clear",
    "add", "add", "sadd", "shas", "sdelete",
    "push", "push", "pop", "shift", "unshift", "splice", "reverse", "sort", "indexOf", "fill", "copyWithin", "flat"]
function run(steps) {
    const m = new Map()
    const s = new Set()
    let a = []
    const out = []
    const show = (v) => out.push(v === undefined ? "null" : JSON.stringify(v))
    for (const [op, x, y, z] of steps) {
        switch (op) {
            case "set": m.set(x, y); show(m.size); break
            case "get": show(m.get(x)); break
            case "has": show(m.has(x)); break
            case "delete": show(m.delete(x)); break
            case "clear": m.clear(); s.clear(); show(m.size + s.size); break
            case "sadd": s.add(y); show(s.size); break
            case "shas": show(s.has(y)); break
            case "sdelete": show(s.delete(y)); break
            case "push": show(a.push(y)); break
            case "pop": show(a.length > 0 ? a.pop() : "empty"); break
            case "shift": show(a.length > 0 ? a.shift() : "empty"); break
            case "unshift": show(a.unshift(y, z)); break
            case "splice": show(a.splice(y, z, y * z)); break
            case "reverse": a.reverse(); show(a); break
            case "sort": a.sort((p, q) => p - q); show(a); break
            case "indexOf": show([a.indexOf(y), a.lastIndexOf(y), a.includes(y)]); break
            case "fill": a.fill(z, y, y + 2); show(a); break
            case "copyWithin": a.copyWithin(y, z); show(a); break
            case "flat": a = [a.slice(0, 2), a.slice(2)].flat(); show(a.length); break
        }
    }
    show([...m])
    show([...s])
    show([...m.keys()].join())
    show(a)
    return out.join("\n")
}
const cases = []
const expected = []
for (let k = 0; k < n; k++) {
    const wide = below(4) === 0
    const steps = []
    for (let i = below(wide ? 400 : 30); i > 0; i--) {
        const op = pick(ops)
        steps.push([op === "add" ? "sadd" : op, key(wide), below(wide ? 300 : 12) - 3, below(5) - 1])
    }
    cases.push(JSON.stringify(steps))
    expected.push(`== ${k}\n${run(steps)}`)
}
writeFileSync(file, cases.join("\n") + "\n")
process.stdout.write(expected.join("\n") + "\n")
