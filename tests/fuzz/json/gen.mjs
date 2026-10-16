// Random JSON texts of one type (see Doc in tests/fuzz/json/check.ore): any
// white space, key order, escapes and number forms, some of them damaged.
// Writes the texts, one JSON string a line, to the file in argv[2], and
// prints what JavaScript reads from each: `error` for a text JSON.parse
// rejects, `skip` for a damaged text it reads as another value, else the
// value written again by JSON.stringify with the keys of objects in the order
// of the type, as Ore writes them.
//   node tests/fuzz/json/gen.mjs texts.jsonl N SEED > expected.txt
import { writeFileSync } from "node:fs"
const file = process.argv[2]
const n = Number(process.argv[3] ?? "20000")
let seed = Number(process.argv[4] ?? "1") >>> 0 || 1
function next() {
    seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0
    return seed
}
const below = (k) => next() % k
const pick = (xs) => xs[below(xs.length)]
const space = () => pick(["", "", "", " ", "\n", "\t", "\r\n  ", "  "])
const chars = ["a", "b", "Z", " ", "é", "😀", " ", "\u0000", "\u001f", "\u007f", '"', "\\", "/", "\n", "\t", "\b", "\f", "\r"]
function str() {
    let s = ""
    for (let k = below(6); k > 0; k--) s += pick(chars)
    return s
}
// A string's JSON text, with escapes chosen at random where JSON allows them.
function strText(s) {
    let out = '"'
    for (const ch of s) {
        const code = ch.codePointAt(0)
        const units = ch.length === 2 ? [ch.charCodeAt(0), ch.charCodeAt(1)] : [code]
        const u = () => units.map((x) => "\\u" + x.toString(16).padStart(4, "0")[below(2) ? "toUpperCase" : "toLowerCase"]()).join("")
        if (ch === '"' || ch === "\\") out += below(3) ? "\\" + ch : u()
        else if (code < 0x20) out += below(2) ? JSON.stringify(ch).slice(1, -1) : u()
        else if (ch === "/") out += pick(["/", "\\/", u()])
        else out += below(4) ? ch : u()
    }
    return out + '"'
}
function int() {
    return pick([0, 1, -1, 7, 42, -300, 2147483647, -2147483648, 9007199254740991, below(1000) - 500])
}
function intText(x) {
    if (x !== 0 && x % 100 === 0 && below(3) === 0) return `${x / 100}e2`
    if (below(5) === 0 && Math.abs(x) < 1e6) return `${x}.0`
    return String(x)
}
function float() {
    return pick([0, -0, 0.5, -1.25, 1e21, 1e-7, 123.456, 5e-324, 1.7976931348623157e308, Math.PI, (below(2000) - 1000) / 8])
}
function floatText(x) {
    const s = Object.is(x, -0) ? "-0" : String(x)
    return pick([s, s, s.toUpperCase(), x.toExponential(), x === 0 ? "0e5" : s])
}
// The value, its text and its text written back in the order of the type.
function object(fields) {
    const entries = fields.map(([name, f]) => [name, f()]).filter(([, v]) => v !== undefined)
    const shown = entries.map(([name, v]) => [name, v.value])
    const order = entries.slice()
    for (let i = order.length - 1; i > 0; i--) {
        const j = below(i + 1)
        ;[order[i], order[j]] = [order[j], order[i]]
    }
    const text = "{" + order.map(([name, v]) => `${space()}${strText(name)}${space()}:${space()}${v.text}${space()}`).join(",") + "}"
    return { value: Object.fromEntries(shown), text }
}
// Whether the document has a repeated key, whose first value a damage may
// make other than an int, which Ore rejects and JavaScript drops.
let repeated = false
const leaf = (value, text) => ({ value, text })
const item = () =>
    object([
        ["id", () => { const x = int(); return leaf(x, intText(x)) }],
        ["tag", () => { const s = str(); return leaf(s, strText(s)) }],
        ["on", () => { const b = below(2) === 0; return leaf(b, String(b)) }],
    ])
function list(f, most) {
    const xs = []
    for (let k = below(most); k > 0; k--) xs.push(f())
    return { value: xs.map((x) => x.value), text: `[${space()}${xs.map((x) => x.text).join(`${space()},${space()}`)}${space()}]` }
}
function dict() {
    const keys = []
    const entries = []
    for (let k = below(4); k > 0; k--) {
        const key = pick(["a", "b", "c", "é", "", "__proto__x"])
        const x = int()
        entries.push(`${strText(key)}:${space()}${intText(x)}`)
        keys.push([key, x])
    }
    // A repeated key keeps its first place and its last value, as in JavaScript.
    const value = {}
    if (new Set(keys.map(([key]) => key)).size < keys.length) repeated = true
    for (const [key, x] of keys) value[key] = x
    return { value, text: `{${entries.join(",")}}` }
}
const doc = () =>
    object([
        ["name", () => { const s = str(); return leaf(s, strText(s)) }],
        ["count", () => { const x = int(); return leaf(x, intText(x)) }],
        ["ratio", () => { const x = float(); return leaf(x, floatText(x)) }],
        ["note", () => (below(3) === 0 ? undefined : below(2) ? leaf(null, "null") : (() => { const s = str(); return leaf(s, strText(s)) })())],
        ["items", () => list(item, 4)],
        ["scores", () => list(() => { const x = float(); return leaf(x, floatText(x)) }, 4)],
        ["extra", () => dict()],
        ["kind", () => { const k = pick(["one", "two"]); return leaf(k, strText(k)) }],
    ])
// Damage: a cut, a character put in or taken out.
function damage(t) {
    const at = below(t.length + 1)
    switch (below(3)) {
        case 0: return t.slice(0, at)
        case 1: return t.slice(0, at) + pick([",", "}", "]", '"', "\\", "x", "01", "-", ".", "e", "\u0001", "nul", "tru"]) + t.slice(at)
        default: return t.slice(0, at) + t.slice(at + 1)
    }
}
// `note` is the only optional field; Ore writes a missing one as null.
const shown = (v) => JSON.stringify({ name: v.name, count: v.count, ratio: v.ratio, note: v.note ?? null, items: v.items, scores: v.scores, extra: v.extra, kind: v.kind })
const texts = []
const expected = []
for (let k = 0; k < n; k++) {
    repeated = false
    const d = doc()
    const damaged = below(5) === 0
    const text = space() + (damaged ? damage(d.text) : d.text) + space()
    texts.push(JSON.stringify(text))
    let out
    try {
        JSON.parse(text)
        // A damaged text JavaScript reads as another value may not be of the type.
        out = !damaged || !repeated && JSON.stringify(JSON.parse(text)) === JSON.stringify(JSON.parse(d.text)) ? shown(d.value) : "skip"
    } catch {
        out = "error"
    }
    expected.push(out)
}
writeFileSync(file, texts.join("\n") + "\n")
process.stdout.write(expected.join("\n") + "\n")
