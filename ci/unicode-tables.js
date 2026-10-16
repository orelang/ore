// Generates runtime/core/unicode-tables.ore from node's Unicode data (ICU):
//   node ci/unicode-tables.js > runtime/core/unicode-tables.ore
// Node has no canonical combining classes: their order comes from what NFD
// does to pairs of marks, and their values from python's unicodedata.
const { execFileSync } = require("child_process")
const pyccc = JSON.parse(
    execFileSync("python3", [
        "-I",
        "-c",
        "import json, unicodedata\nprint(json.dumps({cp: unicodedata.combining(chr(cp)) for cp in range(0x110000) if unicodedata.combining(chr(cp))}))",
    ]).toString(),
)

const TERM = "0123456789ABCDEFGHIJKLMNOPQRSTUV"
const CONT = "WXYZabcdefghijklmnopqrstuvwxyz+/"
function num(n) {
    if (!(n >= 0)) throw new Error("not a count: " + n)
    const groups = []
    do {
        groups.unshift(n & 31)
        n = Math.floor(n / 32)
    } while (n > 0)
    let s = ""
    for (let i = 0; i < groups.length; i++) s += i === groups.length - 1 ? TERM[groups[i]] : CONT[groups[i]]
    return s
}
const zz = (n) => (n < 0 ? -2 * n - 1 : 2 * n)

const chars = []
for (let cp = 0; cp <= 0x10ffff; cp++) if (cp < 0xd800 || cp > 0xdfff) chars.push(cp)
const str = (cp) => String.fromCodePoint(cp)
const pts = (s) => [...s].map((c) => c.codePointAt(0))

// Simple case mappings as runs: same delta, constant stride 1 or 2.
function caseTables(method) {
    const simple = []
    const special = []
    for (const cp of chars) {
        const m = pts(str(cp)[method]())
        if (m.length === 1 && m[0] === cp) continue
        if (m.length === 1) simple.push([cp, m[0] - cp])
        else special.push([cp, m])
    }
    const runs = []
    for (const [cp, d] of simple) {
        const r = runs[runs.length - 1]
        if (r && r.delta === d && (r.count === 1 ? cp - r.start <= 2 : cp === r.start + r.count * r.stride)) {
            if (r.count === 1) r.stride = cp - r.start
            r.count++
        } else runs.push({ start: cp, count: 1, stride: 1, delta: d })
    }
    let text = ""
    let prev = -1
    for (const r of runs) {
        text += num(r.start - prev - 1) + num(r.count - 1) + num(r.stride - 1) + num(zz(r.delta))
        prev = r.start + (r.count - 1) * r.stride
    }
    let stext = ""
    prev = -1
    for (const [cp, m] of special) {
        stext += num(cp - prev - 1) + num(m.length)
        let p = cp
        for (const x of m) {
            stext += num(zz(x - p))
            p = x
        }
        prev = cp
    }
    return { text, stext, runs: runs.length }
}

function ranges(re) {
    const out = []
    for (const cp of chars) {
        if (!re.test(str(cp))) continue
        const r = out[out.length - 1]
        if (r && r[1] === cp - 1) r[1] = cp
        else if (r && r[1] === 0xd7ff && cp === 0xe000) r[1] = cp
        else out.push([cp, cp])
    }
    let text = ""
    let prev = -1
    for (const [a, b] of out) {
        text += num(a - prev - 1) + num(b - a)
        prev = b
    }
    return text
}

// Canonical combining classes, from the order NFD puts marks in, checked against python's values.
const marks = []
const hangul = (cp) => cp >= 0xac00 && cp <= 0xd7a3
for (const cp of chars) {
    const c = str(cp)
    if (c.normalize("NFD") !== c) continue
    const t = "́" + c + "̖"
    if (t.normalize("NFD") !== t) marks.push(cp)
}
const before = (a, b) => (str(a) + str(b)).normalize("NFD") === str(b) + str(a) // ccc(a) > ccc(b)
marks.sort((a, b) => (before(a, b) ? 1 : before(b, a) ? -1 : 0))
const ccc = new Map()
const rankValue = new Map()
let rank = 0
for (let i = 0; i < marks.length; i++) {
    if (i === 0 || before(marks[i], marks[i - 1])) rank++
    ccc.set(marks[i], rank)
}
for (const m of marks) {
    const v = pyccc[m]
    if (!v) continue
    const r = ccc.get(m)
    if (rankValue.has(r) && rankValue.get(r) !== v) throw new Error("ccc mismatch " + m.toString(16))
    rankValue.set(r, v)
}
for (const m of marks) {
    const r = ccc.get(m)
    if (!rankValue.has(r)) throw new Error("no python value for rank of " + m.toString(16))
    ccc.set(m, rankValue.get(r))
}
let ccctext = ""
{
    const sorted = [...ccc.entries()].sort((a, b) => a[0] - b[0])
    const runs = []
    for (const [cp, v] of sorted) {
        const r = runs[runs.length - 1]
        if (r && r[1] === cp - 1 && r[2] === v) r[1] = cp
        else runs.push([cp, cp, v])
    }
    let prev = -1
    for (const [a, b, v] of runs) {
        ccctext += num(a - prev - 1) + num(b - a) + num(v)
        prev = b
    }
}

// Full decompositions, in runs where the last point grows with the character.
function decompositions(get) {
    const entries = []
    for (const cp of chars) {
        if (hangul(cp)) continue
        const d = get(cp)
        if (d) entries.push([cp, d])
    }
    const runs = []
    for (const [cp, d] of entries) {
        const r = runs[runs.length - 1]
        if (r && r.cp + r.count === cp && r.d.length === d.length) {
            const last = r.d.slice(0, -1)
            const same = last.every((x, i) => x === d[i]) && d[d.length - 1] === r.d[r.d.length - 1] + r.count
            if (same) {
                r.count++
                continue
            }
        }
        runs.push({ cp, count: 1, d })
    }
    let text = ""
    let prev = -1
    let last = []
    for (const r of runs) {
        text += num(r.cp - prev - 1) + num(r.d.length - 1) + num(r.count - 1)
        for (let i = 0; i < r.d.length; i++) {
            const p = i < last.length ? last[i] : i > 0 ? r.d[i - 1] : 0
            text += num(zz(r.d[i] - p))
        }
        last = r.d
        prev = r.cp + r.count - 1
    }
    return { text, count: entries.length, runs: runs.length }
}
const canon = decompositions((cp) => {
    const c = str(cp)
    const d = c.normalize("NFD")
    return d === c ? null : pts(d)
})
const compat = decompositions((cp) => {
    const c = str(cp)
    const k = c.normalize("NFKD")
    return k === c.normalize("NFD") ? null : pts(k)
})
// Characters with a canonical decomposition that are not primary composites.
const nocompose = ranges({
    test: (c) => {
        const cp = c.codePointAt(0)
        return !hangul(cp) && c.normalize("NFD") !== c && c.normalize("NFC") !== c
    },
})

const upper = caseTables("toUpperCase")
const lower = caseTables("toLowerCase")
const cased = ranges(/\p{Cased}/u)
const ignorable = ranges(/\p{Case_Ignorable}/u)

function wrap(name, doc, text) {
    return `\n/** ${doc} */\nexport const ${name} =\n    "${text}"\n`
}
let out = `// Unicode ${process.versions.unicode} data for String methods (string.ore), generated from node ${process.version}
// (ICU ${process.versions.icu}): what toUpperCase, toLowerCase and normalize give for each character,
// and the regular expression properties \\p{Cased} and \\p{Case_Ignorable}.
//
// Each table is a list of numbers written in base 32: a digit \`0\`-\`9\`,
// \`A\`-\`V\` ends a number, and one of \`W\`-\`Z\`, \`a\`-\`z\`, \`+\`, \`/\` is a digit
// with more to follow. A signed number n is written as 2n, or -2n-1 when
// negative. Characters are counted from the end of the previous entry: the
// first number of each entry is how many characters lie between them.
// The generator is ci/unicode-tables.js.
`
out += wrap(
    "upperRuns",
    "Simple uppercase mappings: gap, count - 1, stride - 1 and the signed distance to the uppercase, the same for every `stride`th character of the run.",
    upper.text,
)
out += wrap(
    "upperSpecial",
    "Uppercase mappings to several characters: gap, how many, and each as the signed distance from the one before (the first from the character).",
    upper.stext,
)
out += wrap("lowerRuns", "Simple lowercase mappings, as `upperRuns`.", lower.text)
out += wrap("lowerSpecial", "Lowercase mappings to several characters, as `upperSpecial`.", lower.stext)
out += wrap("casedRanges", "The ranges of `\\p{Cased}`: gap and length - 1.", cased)
out += wrap("caseIgnorableRanges", "The ranges of `\\p{Case_Ignorable}`: gap and length - 1.", ignorable)
out += wrap(
    "combiningClasses",
    "Canonical combining classes other than 0: gap, length - 1 and the class of a run.",
    ccctext,
)
out += wrap(
    "canonicalDecompositions",
    "Full canonical decompositions (NFD) of characters other than Hangul syllables: gap, how many characters - 1, run length - 1, and the characters as signed distances, the first from the first of the previous entry, the others from the one before; in a run each next character's last character is one more.",
    canon.text,
)
out += wrap(
    "compatibilityDecompositions",
    "Full compatibility decompositions (NFKD) that differ from the canonical ones, as `canonicalDecompositions`.",
    compat.text,
)
out += wrap(
    "noComposition",
    "The characters with a canonical decomposition that NFC does not compose (singletons and composition exclusions): gap and length - 1.",
    nocompose,
)
process.stdout.write(out)
console.error({ upper: upper.runs, lower: lower.runs, canon: [canon.count, canon.runs], compat: [compat.count, compat.runs], size: out.length })
