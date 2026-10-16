// Random strings and the methods of String.prototype on them. Writes the
// cases, one JSON object a line ({ s, t, p, i, j, n }), to the file in
// argv[2], and prints what JavaScript gives for each (as
// tests/fuzz/strings/check.ore prints it). Positions in JavaScript count
// UTF-16 units and in Ore bytes, so the methods that take or give positions
// get ASCII strings; the others (case, trim, normalize, search and split by
// a string) get any.
//   node tests/fuzz/strings/gen.mjs cases.jsonl N SEED > expected.txt
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
const ascii = ["a", "b", "c", "A", "B", " ", "\t", "\n", "-", "$", "&", "'", "`", "0"]
const wide = [...ascii, "é", "É", "ß", "ẞ", "Σ", "σ", "ς", "İ", "ı", "ǅ", "ﬁ", " ", " ", "﻿", "　",
    "é", "́", "Å", "Å", "한", "가", "😀", "ℌ", "①", "½", "ᾳ", "Ꭰ", "ꭰ"]
function text(chars, most) {
    let s = ""
    for (let k = below(most); k > 0; k--) s += pick(chars)
    return s
}
const at = () => below(17) - 8
const show = (v) => (v === undefined || Number.isNaN(v) ? "null" : JSON.stringify(v))
function describe({ s, t, p, i, j, n }, plain) {
    const out = []
    const op = (name, f) => out.push(`${name}: ${show(f())}`)
    op("upper", () => s.toUpperCase())
    op("lower", () => s.toLowerCase())
    op("trim", () => [s.trim(), s.trimStart(), s.trimEnd()])
    for (const form of ["NFC", "NFD", "NFKC", "NFKD"]) op(form, () => s.normalize(form))
    op("includes", () => s.includes(t))
    op("starts", () => [s.startsWith(t), s.endsWith(t)])
    op("split", () => s.split(t))
    op("replaceAll", () => s.replaceAll(t, p))
    op("replace", () => s.replace(t, p))
    op("concat", () => s.concat(t, p))
    op("wellFormed", () => s.isWellFormed())
    if (!plain) return out.join("\n")
    op("slice", () => [s.slice(i), s.slice(i, j)])
    op("substring", () => [s.substring(i), s.substring(i, j)])
    op("substr", () => [s.substr(i), s.substr(i, j)])
    op("at", () => [s.at(i), s.charAt(i)])
    op("charCodeAt", () => s.charCodeAt(i))
    op("codePointAt", () => s.codePointAt(i))
    op("indexOf", () => [s.indexOf(t), s.indexOf(t, i), s.lastIndexOf(t), s.lastIndexOf(t, i)])
    op("includesFrom", () => [s.includes(t, i), s.startsWith(t, i), s.endsWith(t, j)])
    op("pad", () => [s.padStart(n), s.padEnd(n), s.padStart(n, t), s.padEnd(n, t)])
    op("repeat", () => s.repeat(n % 4))
    op("splitLimit", () => [s.split(t, n % 4), s.split(t, -1)])
    op("replaceFn", () => s.replaceAll(t, (m, at) => `<${m}@${at}>`))
    op("compare", () => [s === t, s < t, s > t])
    return out.join("\n")
}
const cases = []
const expected = []
for (let k = 0; k < n; k++) {
    const plain = below(2) === 0
    const chars = plain ? ascii : wide
    const s = text(chars, 14)
    // The needle is often a piece of the subject, so that it is found: whole
    // characters, and not empty when there are other than ASCII, as JavaScript
    // splits by UTF-16 units where Ore splits by characters.
    const cs = [...s]
    let t = below(2) === 0 && cs.length > 0 ? cs.slice(below(cs.length), below(cs.length + 1) + 1).join("") : text(chars, 3)
    if (!plain && t === "") t = pick(wide)
    const c = { s, t, p: text(ascii, 4), i: at(), j: at(), n: below(20) }
    cases.push(JSON.stringify({ ...c, plain }))
    expected.push(`== ${k}\n${describe(c, plain)}`)
}
writeFileSync(file, cases.join("\n") + "\n")
process.stdout.write(expected.join("\n") + "\n")
