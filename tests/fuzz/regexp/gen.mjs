// Random regular expressions and ASCII subjects. Writes the cases, one JSON
// object a line ({ p, f, s }), to the file in argv[2], and prints what
// JavaScript finds for each (as tests/fuzz/regexp/check.ore prints it): every
// match of exec, in a loop for the g and y flags, with its index and groups,
// then replace(re, "<$&>").
//   node tests/fuzz/regexp/gen.mjs cases.jsonl N SEED > expected.txt
import { writeFileSync } from "node:fs"
const file = process.argv[2]
const n = Number(process.argv[3] ?? "2000")
let seed = Number(process.argv[4] ?? "1") >>> 0 || 1
function next() {
    seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0
    return seed
}
const below = (k) => next() % k
// Group names are unique in a pattern: Ore does not take the same name in two alternatives yet (ES2025).
let groupName = 0
const pick = (xs) => xs[below(xs.length)]
const atoms = ["a", "b", "c", "x", "\\d", "\\w", "\\s", "\\D", "\\W", ".", "[abc]", "[^a]", "[a-c]", "[x-z0-9]", "\\.", "-", " ", "\\b", "\\B", "^", "$"]
function term(depth) {
    let t
    switch (below(depth > 0 ? 9 : 4)) {
        case 4: t = `(${alt(depth - 1)})`; break
        case 5: t = `(?:${alt(depth - 1)})`; break
        case 6: t = `(?<g${groupName++}>${alt(depth - 1)})`; break
        case 7: t = `(?${pick(["=", "!", "<=", "<!"])}${alt(depth - 1)})`; break
        case 8: t = `\\${1 + below(2)}`; break
        default: t = pick(atoms)
    }
    if (below(3) === 0) t += pick(["*", "+", "?", "{2}", "{1,3}", "{0,}", "*?", "+?", "??", "{1,2}?"])
    return t
}
function seq(depth) {
    let s = ""
    for (let k = 0; k < 1 + below(4); k++) s += term(depth)
    return s
}
function alt(depth) {
    return below(4) === 0 ? `${seq(depth)}|${seq(depth)}` : seq(depth)
}
const subjects = "abcx019 .-_"
function subject() {
    let s = ""
    for (let k = 0; k < below(24); k++) s += subjects[below(subjects.length)]
    return s
}
function describe(re, s) {
    const out = []
    const loop = re.global || re.sticky
    let guard = 0
    while (guard++ < 50) {
        const m = re.exec(s)
        if (m === null) { out.push("no match"); break }
        out.push(`${m.index}: ${m.map((g) => (g === undefined ? "null" : JSON.stringify(g))).join(" ")}`)
        if (!loop) break
        if (m[0] === "") re.lastIndex++
    }
    re.lastIndex = 0
    out.push(`replace: ${JSON.stringify(s.replace(re, "<$&>"))}`)
    return out.join("\n")
}
const cases = []
const expected = []
while (cases.length < n) {
    groupName = 0
    const p = alt(2)
    const f = pick(["", "", "g", "i", "gi", "m", "gm", "s", "y", "gy"])
    let re
    try { re = new RegExp(p, f) } catch { continue }
    const s = subject()
    cases.push(JSON.stringify({ p, f, s }))
    expected.push(`== /${p}/${f} ${JSON.stringify(s)}\n${describe(re, s)}`)
}
writeFileSync(file, cases.join("\n") + "\n")
process.stdout.write(expected.join("\n") + "\n")
