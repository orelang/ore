// Generates the tables of `\p{...}` and of ignoring case in regular
// expressions, from the Unicode Character Database, into their part of
// runtime/core/regexp-syntax.ore (the lines between its two markers):
//   node ci/regexp-properties.js [--data DIR] [--check]
// The data files are fetched from unicode.org into DIR (a new temporary
// directory by default; one that has them already is read as it is).
// --check also compares every table with what node's RegExp does, which
// must have the same Unicode version.
const fs = require("fs")
const os = require("os")
const path = require("path")

const version = "17.0.0"
const files = {
    "UnicodeData.txt": "ucd/UnicodeData.txt",
    "PropertyAliases.txt": "ucd/PropertyAliases.txt",
    "PropertyValueAliases.txt": "ucd/PropertyValueAliases.txt",
    "Scripts.txt": "ucd/Scripts.txt",
    "ScriptExtensions.txt": "ucd/ScriptExtensions.txt",
    "PropList.txt": "ucd/PropList.txt",
    "DerivedCoreProperties.txt": "ucd/DerivedCoreProperties.txt",
    "DerivedNormalizationProps.txt": "ucd/DerivedNormalizationProps.txt",
    "DerivedBinaryProperties.txt": "ucd/extracted/DerivedBinaryProperties.txt",
    "CaseFolding.txt": "ucd/CaseFolding.txt",
    "SpecialCasing.txt": "ucd/SpecialCasing.txt",
    "emoji-data.txt": "ucd/emoji/emoji-data.txt",
    "emoji-sequences.txt": "emoji/emoji-sequences.txt",
    "emoji-zwj-sequences.txt": "emoji/emoji-zwj-sequences.txt",
}

// The binary properties that ECMAScript has (its table of binary Unicode
// properties), but `Any`, `ASCII` and `Assigned`, which regexp-syntax.ore
// knows itself.
const binaryNames = [
    "ASCII_Hex_Digit",
    "Alphabetic",
    "Bidi_Control",
    "Bidi_Mirrored",
    "Case_Ignorable",
    "Cased",
    "Changes_When_Casefolded",
    "Changes_When_Casemapped",
    "Changes_When_Lowercased",
    "Changes_When_NFKC_Casefolded",
    "Changes_When_Titlecased",
    "Changes_When_Uppercased",
    "Dash",
    "Default_Ignorable_Code_Point",
    "Deprecated",
    "Diacritic",
    "Emoji",
    "Emoji_Component",
    "Emoji_Modifier",
    "Emoji_Modifier_Base",
    "Emoji_Presentation",
    "Extended_Pictographic",
    "Extender",
    "Grapheme_Base",
    "Grapheme_Extend",
    "Hex_Digit",
    "IDS_Binary_Operator",
    "IDS_Trinary_Operator",
    "ID_Continue",
    "ID_Start",
    "Ideographic",
    "Join_Control",
    "Logical_Order_Exception",
    "Lowercase",
    "Math",
    "Noncharacter_Code_Point",
    "Pattern_Syntax",
    "Pattern_White_Space",
    "Quotation_Mark",
    "Radical",
    "Regional_Indicator",
    "Sentence_Terminal",
    "Soft_Dotted",
    "Terminal_Punctuation",
    "Unified_Ideograph",
    "Uppercase",
    "Variation_Selector",
    "White_Space",
    "XID_Continue",
    "XID_Start",
]

// The properties of strings of the `v` flag, but RGI_Emoji, all of them together.
const stringNames = [
    "Basic_Emoji",
    "Emoji_Keycap_Sequence",
    "RGI_Emoji_Modifier_Sequence",
    "RGI_Emoji_Flag_Sequence",
    "RGI_Emoji_Tag_Sequence",
    "RGI_Emoji_ZWJ_Sequence",
]

const MAX = 0x10ffff
const target = path.join(__dirname, "..", "runtime", "core", "regexp-syntax.ore")
const begin = "// The tables of Unicode properties and case folding, from here to the line"
const end = "// End of the tables."

// -----------------------------------------------------------------------------
// The data

async function fetchData(dir) {
    fs.mkdirSync(dir, { recursive: true })
    for (const [name, url] of Object.entries(files)) {
        const file = path.join(dir, name)
        if (fs.existsSync(file)) continue
        const response = await fetch(`https://www.unicode.org/Public/${version}/${url}`)
        if (!response.ok) throw new Error(`${url}: ${response.status}`)
        fs.writeFileSync(file, await response.text())
    }
}

/** The fields of each line of a data file, without comments. */
function lines(dir, name) {
    const out = []
    for (let line of fs.readFileSync(path.join(dir, name), "utf8").split("\n")) {
        line = line.replace(/#.*/, "").trim()
        if (line !== "") out.push(line.split(";").map((s) => s.trim()))
    }
    return out
}

/** The first and last character of `0041..005A` or `0041`. */
function span(text) {
    const [a, b] = text.split("..")
    return [parseInt(a, 16), parseInt(b ?? a, 16)]
}

const hex = (text) => text.split(" ").map((x) => parseInt(x, 16))

/** Sorted ranges, merged, from a set of characters (a byte per character). */
function rangesOf(set) {
    const out = []
    for (let c = 0; c <= MAX; c++) {
        if (!set[c]) continue
        const last = out[out.length - 1]
        if (last && last[1] === c - 1) last[1] = c
        else out.push([c, c])
    }
    return out
}

const newSet = () => new Uint8Array(MAX + 1)

function load(dir) {
    const data = {}
    // General_Category: Cn where UnicodeData.txt has nothing.
    const category = new Array(MAX + 1).fill("Cn")
    let first = -1
    for (const f of lines(dir, "UnicodeData.txt")) {
        const c = parseInt(f[0], 16)
        if (f[1].endsWith(", First>")) first = c
        else if (f[1].endsWith(", Last>")) for (let x = first; x <= c; x++) category[x] = f[2]
        else category[c] = f[2]
    }
    data.category = category

    // The names of properties and values.
    const aliases = new Map()
    for (const f of lines(dir, "PropertyAliases.txt")) aliases.set(f[1], f)
    data.aliases = aliases
    const values = { gc: [], sc: [] }
    for (const f of lines(dir, "PropertyValueAliases.txt")) if (f[0] in values) values[f[0]].push(f.slice(1))
    data.values = values

    // Script, with Unknown where Scripts.txt has nothing, and Script_Extensions.
    const script = new Array(MAX + 1).fill("Unknown")
    for (const [r, v] of lines(dir, "Scripts.txt")) {
        const [a, b] = span(r)
        for (let c = a; c <= b; c++) script[c] = v
    }
    data.script = script
    data.extensions = lines(dir, "ScriptExtensions.txt").map(([r, v]) => [span(r), v.split(/\s+/)])

    // Binary properties.
    const binary = new Map()
    for (const name of [
        "PropList.txt",
        "DerivedCoreProperties.txt",
        "DerivedNormalizationProps.txt",
        "DerivedBinaryProperties.txt",
        "emoji-data.txt",
    ]) {
        for (const f of lines(dir, name)) {
            if (f.length !== 2) continue
            if (!binary.has(f[1])) binary.set(f[1], newSet())
            const set = binary.get(f[1])
            const [a, b] = span(f[0])
            for (let c = a; c <= b; c++) set[c] = 1
        }
    }
    data.binary = binary

    // Properties of strings: the sequences of each, and Basic_Emoji's single characters.
    const strings = new Map(stringNames.map((n) => [n, []]))
    const basicSingles = newSet()
    for (const name of ["emoji-sequences.txt", "emoji-zwj-sequences.txt"]) {
        for (const f of lines(dir, name)) {
            const list = strings.get(f[1])
            if (list === undefined) throw new Error("unknown sequence type " + f[1])
            if (f[0].includes("..")) {
                const [a, b] = span(f[0])
                for (let c = a; c <= b; c++) {
                    if (f[1] !== "Basic_Emoji") throw new Error("range of " + f[1])
                    basicSingles[c] = 1
                }
            } else {
                const points = hex(f[0])
                if (points.length === 1) {
                    if (f[1] !== "Basic_Emoji") throw new Error("single character of " + f[1])
                    basicSingles[points[0]] = 1
                } else {
                    list.push(points)
                }
            }
        }
    }
    data.strings = strings
    data.basicSingles = basicSingles

    // Simple case folding (C and S), and the full uppercase of each character.
    const fold = new Map()
    for (const f of lines(dir, "CaseFolding.txt")) if (f[1] === "C" || f[1] === "S") fold.set(hex(f[0])[0], hex(f[2])[0])
    data.fold = fold
    const upper = new Map()
    for (const f of lines(dir, "UnicodeData.txt")) if (f[12] !== "") upper.set(parseInt(f[0], 16), [parseInt(f[12], 16)])
    // The unconditional mappings of SpecialCasing.txt replace the simple ones.
    for (const f of lines(dir, "SpecialCasing.txt")) if (f.length === 5 || f[4] === "") upper.set(hex(f[0])[0], hex(f[3]))
    data.upper = upper
    return data
}

// -----------------------------------------------------------------------------
// Encoding

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

/** Ranges as gaps and lengths - 1. */
function encodeRanges(ranges) {
    let text = ""
    let previous = -1
    for (const [a, b] of ranges) {
        text += num(a - previous - 1) + num(b - a)
        previous = b
    }
    return text
}

/** Runs of a value over all characters: length - 1 and the index of the value of each. */
function encodeRuns(values, index) {
    let text = ""
    let count = 0
    for (let c = 0; c <= MAX; ) {
        let e = c
        while (e < MAX && values[e + 1] === values[c]) e++
        const i = index.get(values[c])
        if (i === undefined) throw new Error("no index for " + values[c])
        text += num(e - c) + num(i)
        count++
        c = e + 1
    }
    return { text, count }
}

// -----------------------------------------------------------------------------
// The tables

function build(data) {
    const out = {}
    // General_Category: the leaf values in the order of their indices in the runs.
    const leaves = data.values.gc.filter((v) => v[0].length === 2 && v[0] !== "LC").map((v) => v[0])
    const groups = new Map()
    for (const v of data.values.gc) {
        if (leaves.includes(v[0])) groups.set(v[0], [v[0]])
        else groups.set(v[0], leaves.filter((l) => l[0] === v[0][0] && (v[0] !== "LC" || "ult".includes(l[1]))))
    }
    out.categoryOrder = leaves
    out.categoryNames = data.values.gc.map((v) => `${v.join(",")}:${groups.get(v[0]).join(",")}`)
    const categoryIndex = new Map(leaves.map((l, i) => [l, i]))
    out.categoryRuns = encodeRuns(data.category, categoryIndex)

    // Scripts: the names of each (long name first), by index; ECMAScript leaves out
    // Katakana_Or_Hiragana, which has no characters.
    const scripts = data.values.sc.filter((v) => v[1] !== "Katakana_Or_Hiragana").map((v) => [v[1], v[0], ...v.slice(2)])
    const scriptIndex = new Map()
    scripts.forEach((names, i) => names.forEach((n) => scriptIndex.set(n, i)))
    out.scriptNames = scripts.map((names) => [...new Set(names)].join(",")).join(";")
    out.scriptRuns = encodeRuns(data.script, scriptIndex)
    // Script_Extensions where they are not the Script: gap, length - 1, how many - 1 and the scripts.
    let ext = ""
    let previous = -1
    const sortedExt = data.extensions.slice().sort((a, b) => a[0][0] - b[0][0])
    for (const [[a, b], names] of sortedExt) {
        ext += num(a - previous - 1) + num(b - a) + num(names.length - 1)
        for (const n of names) ext += num(scriptIndex.get(n))
        previous = b
    }
    out.scriptExtensions = ext

    // Binary properties: each a table of ranges, or of the characters that differ
    // from a base (other properties or General_Category values), when shorter.
    const bases = new Map()
    for (const l of leaves) {
        const set = newSet()
        for (let c = 0; c <= MAX; c++) if (data.category[c] === l) set[c] = 1
        bases.set(l, set)
    }
    const raw = new Map()
    for (const name of binaryNames) {
        const set = data.binary.get(name)
        if (!set) throw new Error("no data for " + name)
        raw.set(name, encodeRanges(rangesOf(set)))
    }
    const order = binaryNames.slice().sort((a, b) => raw.get(a).length - raw.get(b).length)
    const done = []
    const binary = new Map()
    for (const name of order) {
        const set = data.binary.get(name)
        let best = { base: "", text: raw.get(name) }
        const tryBase = (names) => {
            const union = newSet()
            for (const n of names) {
                const b = bases.get(n) ?? data.binary.get(n)
                for (let c = 0; c <= MAX; c++) if (b[c]) union[c] = 1
            }
            const diff = newSet()
            for (let c = 0; c <= MAX; c++) diff[c] = union[c] ^ set[c]
            const text = encodeRanges(rangesOf(diff))
            const base = names.join(",")
            if (text.length + base.length < best.text.length + best.base.length) best = { base, text }
        }
        // The General_Category values that most of whose characters have the property.
        const majority = leaves.filter((l) => {
            let has = 0
            let all = 0
            const b = bases.get(l)
            for (let c = 0; c <= MAX; c++) {
                if (!b[c]) continue
                all++
                if (set[c]) has++
            }
            return has * 2 > all
        })
        if (majority.length > 0) tryBase(majority)
        for (const d of done) tryBase([d])
        for (const d of done) if (majority.length > 0) tryBase([d, ...majority])
        binary.set(name, best)
        done.push(name)
    }
    out.binary = binaryNames.map((name) => {
        const names = [name, ...data.aliases.get(name)].filter((n, i, all) => all.indexOf(n) === i)
        // The long name first.
        names.sort((a, b) => (a === name ? -1 : b === name ? 1 : 0))
        return { names, ...binary.get(name) }
    })
    out.binaryRaw = [...raw.values()].reduce((a, t) => a + t.length, 0)

    // Properties of strings: the characters of all their strings, as ranges, and
    // each string sorted, as how many characters it shares with the one before,
    // how many follow and the index of each among those characters.
    const points = new Set()
    for (const list of data.strings.values()) for (const s of list) for (const c of s) points.add(c)
    const palette = [...points].sort((a, b) => a - b)
    const paletteIndex = new Map(palette.map((c, i) => [c, i]))
    {
        const set = newSet()
        for (const c of palette) set[c] = 1
        out.stringPoints = encodeRanges(rangesOf(set))
    }
    const compare = (a, b) => {
        for (let i = 0; i < a.length && i < b.length; i++) if (a[i] !== b[i]) return a[i] - b[i]
        return a.length - b.length
    }
    out.strings = stringNames.map((name) => {
        const list = data.strings.get(name).slice().sort(compare)
        let text = ""
        let before = []
        for (const s of list) {
            let shared = 0
            while (shared < s.length && shared < before.length && s[shared] === before[shared]) shared++
            text += num(shared) + num(s.length - shared - 1)
            for (let i = shared; i < s.length; i++) text += num(paletteIndex.get(s[i]))
            before = s
        }
        const singles = name === "Basic_Emoji" ? encodeRanges(rangesOf(data.basicSingles)) : ""
        return { names: [name], singles, text, count: list.length }
    })

    // Ignoring case: the characters of the same canonical case, which the flag
    // `i` takes as one, in groups of two or more. With `u` or `v` the canonical
    // case is the simple case folding; without, the uppercase if it is one
    // character and not ASCII for a character that is not, of characters of
    // the Basic Multilingual Plane only, as JavaScript compares UTF-16 units.
    const canonicalU = (c) => data.fold.get(c) ?? c
    const canonical = (c) => {
        if (c > 0xffff) return c
        const u = data.upper.get(c)
        if (u === undefined || u.length !== 1) return c
        if (c >= 128 && u[0] < 128) return c
        return u[0]
    }
    out.foldOrbits = encodeOrbits(orbits(canonicalU))
    out.caseOrbits = encodeOrbits(orbits(canonical))
    out.orbitsU = orbits(canonicalU)
    out.orbits = orbits(canonical)
    out.leaves = leaves
    out.scripts = scripts
    out.groups = groups
    return out
}

/** The groups of two or more characters of the same canonical case, sorted by their first. */
function orbits(canonical) {
    const by = new Map()
    for (let c = 0; c <= MAX; c++) {
        const k = canonical(c)
        if (!by.has(k)) by.set(k, [])
        by.get(k).push(c)
    }
    return [...by.values()].filter((g) => g.length > 1).sort((a, b) => a[0] - b[0])
}

/**
 * Groups of characters in runs of groups of the same shape, each run as: the
 * distance from the first character of the last group before it, less one,
 * how many groups - 1, the distance between their first characters - 1, how
 * many characters in a group - 1, and each next character of a group as its
 * distance from the one before - 1.
 */
function encodeOrbits(groups) {
    const runs = []
    for (const g of groups) {
        const deltas = g.slice(1).map((c, i) => c - g[i])
        const r = runs[runs.length - 1]
        const same = r && r.deltas.length === deltas.length && r.deltas.every((d, i) => d === deltas[i])
        if (same && (r.count === 1 || g[0] === r.first + r.count * r.stride)) {
            if (r.count === 1) r.stride = g[0] - r.first
            r.count++
        } else {
            runs.push({ first: g[0], count: 1, stride: 1, deltas })
        }
    }
    let text = ""
    let previous = -1
    for (const r of runs) {
        text += num(r.first - previous - 1) + num(r.count - 1) + num(r.stride - 1) + num(r.deltas.length)
        for (const d of r.deltas) text += num(d - 1)
        previous = r.first + (r.count - 1) * r.stride
    }
    return text
}

// -----------------------------------------------------------------------------
// The Ore source

/** A string literal on one line, as the other tables of the runtime. */
function literal(text) {
    if (/["\\]/.test(text)) throw new Error("not a plain literal: " + text)
    return `"${text}"`
}

// Each table is a function that returns it, not a constant: a program that
// never reads one leaves it out, and starts without building its arrays.

/** A function that returns a string. */
function assign(name, text) {
    return `function ${name}(): string {\n    return ${literal(text)}\n}\n`
}

/** A function that returns an array of strings, or of arrays of strings, a line each (as formatted). */
function array(name, type, lines) {
    return `function ${name}(): ${type} {\n    return [\n${lines.join("")}    ]\n}\n\n`
}

/** An entry of an array of arrays of strings, on one line when it fits in 120 columns. */
function entry(items) {
    const line = `        [${items.map(literal).join(", ")}],\n`
    if (line.length <= 121) return line
    return `        [\n${items.map((t) => `            ${literal(t)},\n`).join("")}        ],\n`
}

function source(t) {
    const doc = (lines) => `/**\n${lines.map((l) => ` * ${l}`).join("\n")}\n */\n`
    let s = `${begin}\n// \`${end}\`, are written by ci/regexp-properties.js from the Unicode ${version} data.\n`
    s += "//\n"
    s += "// Each table is a list of numbers written in base 32: a digit `0`-`9`,\n"
    s += "// `A`-`V` ends a number, and one of `W`-`Z`, `a`-`z`, `+`, `/` is a digit\n"
    s += "// with more to follow. Ranges are a gap since the end of the previous one\n"
    s += "// (how many characters lie between) and their length - 1.\n\n"
    s += `/** The General_Category values with a character each, in the order of their indices in \`categoryRuns\`. */\n`
    s += `${assign("categoryOrder", t.categoryOrder.join(","))}\n`
    s += `/** Each General_Category value: its names, then after \`:\` the values of \`categoryOrder\` it is. */\n`
    s += array("categoryNames", "string[]", t.categoryNames.map((n) => `        "${n}",\n`))
    s += doc(["The General_Category of every character from U+0000, in runs: the", "length of each - 1 and the index of its value in `categoryOrder`."])
    s += `${assign("categoryRuns", t.categoryRuns.text)}\n`
    s += `/** The names of each script, the long name first, separated by \`;\`, in the order of their indices. */\n`
    s += `${assign("scriptNames", t.scriptNames)}\n`
    s += `/** The Script of every character from U+0000, in runs: the length of each - 1 and the index of its script. */\n`
    s += `${assign("scriptRuns", t.scriptRuns.text)}\n`
    s += doc([
        "The characters whose Script_Extensions are not their Script, in ranges:",
        "gap, length - 1, how many scripts - 1 and the index of each.",
    ])
    s += `${assign("scriptExtensions", t.scriptExtensions)}\n`
    s += doc([
        "The binary properties: the names of each, the long name first; the",
        "General_Category values (of `categoryOrder`) and other properties of",
        "its base, \"\" for none; and the ranges of the characters that differ",
        "from the base, which are those of the property without one.",
    ])
    s += array(
        "binaryProperties",
        "string[][]",
        t.binary.map((b) => entry([b.names.join(","), b.base, b.text])),
    )
    s += `/** The characters of the strings of the properties of strings, as ranges: \`stringProperties\` gives their indices. */\n`
    s += `${assign("stringPoints", t.stringPoints)}\n`
    s += doc([
        "The properties of strings of the `v` flag: the name of each, its",
        "characters as ranges and its strings, sorted, each as how many",
        "characters it shares with the one before, how many follow - 1, and",
        "those as indices among the characters of `stringPoints`.",
    ])
    s += array(
        "stringProperties",
        "string[][]",
        t.strings.map((p) => entry([p.names.join(","), p.singles, p.text])),
    )
    s += doc([
        "The characters that ignoring case with the flag `u` or `v` takes as one",
        "(the same simple case folding), in groups of two or more, in runs of",
        "groups of the same shape: the distance from the first character of",
        "the group before - 1, how many groups - 1, the distance between their",
        "first characters - 1, how many next characters in a group, and each",
        "as its distance from the one before - 1.",
    ])
    s += `${assign("foldOrbits", t.foldOrbits)}\n`
    s += doc([
        "The same without `u` or `v`, where the canonical case is the uppercase",
        "when it is one character (not an ASCII one for another), of the",
        "characters up to U+FFFF.",
    ])
    s += `${assign("caseOrbits", t.caseOrbits)}\n`
    s += `${end}\n`
    return s
}

// -----------------------------------------------------------------------------
// Checking against node

function check(data, t) {
    if (process.versions.unicode !== version.replace(/\.0$/, "")) {
        throw new Error(`node has Unicode ${process.versions.unicode}, not ${version}`)
    }
    let failures = 0
    const fail = (what) => {
        failures++
        if (failures <= 40) console.error("differs: " + what)
    }
    // Every character but the surrogates, which are checked one by one.
    let all = ""
    for (let c = 0; c <= MAX; c++) if (c < 0xd800 || c > 0xdfff) all += String.fromCodePoint(c)
    const setOf = (pattern, flags) => {
        const set = newSet()
        const re = new RegExp(`(?:${pattern})+`, `g${flags}`)
        for (const m of all.matchAll(re)) for (const ch of m[0]) set[ch.codePointAt(0)] = 1
        const one = new RegExp(`^(?:${pattern})$`, flags)
        for (let c = 0xd800; c <= 0xdfff; c++) if (one.test(String.fromCharCode(c))) set[c] = 1
        return set
    }
    // The characters of a property of strings, one by one: a string would take several.
    const singlesOf = (name) => {
        const set = newSet()
        const one = new RegExp(`^\\p{${name}}$`, "v")
        for (let c = 0; c <= MAX; c++) if (one.test(String.fromCodePoint(c))) set[c] = 1
        return set
    }
    const same = (name, a, b) => {
        for (let c = 0; c <= MAX; c++) {
            if (a[c] !== b[c]) {
                fail(`${name} at U+${c.toString(16)}: node ${a[c]}`)
                return
            }
        }
    }
    const accepted = (p, flags = "u") => {
        try {
            new RegExp(`\\p{${p}}`, flags)
            return true
        } catch {
            return false
        }
    }
    // General_Category.
    for (const line of t.categoryNames) {
        const [names, leaves] = line.split(":")
        const set = newSet()
        for (let c = 0; c <= MAX; c++) if (leaves.split(",").includes(data.category[c])) set[c] = 1
        for (const n of names.split(",")) {
            for (const p of [n, `gc=${n}`, `General_Category=${n}`]) if (!accepted(p)) fail(`node rejects ${p}`)
        }
        same(names, setOf(`\\p{${names.split(",")[0]}}`, "u"), set)
    }
    // Scripts and their extensions.
    if (accepted("sc=Hrkt") || accepted("Katakana_Or_Hiragana")) fail("node takes Katakana_Or_Hiragana")
    for (const [i, names] of t.scripts.entries()) {
        const set = newSet()
        for (let c = 0; c <= MAX; c++) if (data.script[c] === names[0]) set[c] = 1
        for (const n of names) for (const p of [`sc=${n}`, `Script=${n}`, `scx=${n}`]) if (!accepted(p)) fail(`node rejects ${p}`)
        same(`sc=${names[0]}`, setOf(`\\p{sc=${names[0]}}`, "u"), set)
        for (const [[a, b], list] of data.extensions) {
            const has = list.some((n) => t.scripts[i].includes(n))
            for (let c = a; c <= b; c++) set[c] = has ? 1 : 0
        }
        same(`scx=${names[0]}`, setOf(`\\p{scx=${names[0]}}`, "u"), set)
    }
    // Binary properties, and that node takes no other.
    for (const b of t.binary) {
        for (const n of b.names) if (!accepted(n)) fail(`node rejects ${n}`)
        same(b.names[0], setOf(`\\p{${b.names[0]}}`, "u"), data.binary.get(b.names[0]))
    }
    for (const [name, names] of data.aliases) {
        if (binaryNames.includes(names[1]) || !data.binary.has(names[1])) continue
        for (const n of names) if (accepted(n)) fail(`node takes ${n}`)
    }
    // Properties of strings: each string, and the single characters.
    const strings = new Set()
    for (const p of t.strings) {
        const name = p.names[0]
        const re = new RegExp(`^\\p{${name}}$`, "v")
        for (const s of data.strings.get(name)) {
            if (!re.test(String.fromCodePoint(...s))) fail(`${name} has no ${s.map((c) => c.toString(16)).join(" ")}`)
            strings.add(String.fromCodePoint(...s))
        }
        same(`${name}'s characters`, singlesOf(name), name === "Basic_Emoji" ? data.basicSingles : newSet())
    }
    const rgi = /^\p{RGI_Emoji}$/v
    for (const s of strings) if (!rgi.test(s)) fail(`RGI_Emoji has no ${s}`)
    same("RGI_Emoji's characters", singlesOf("RGI_Emoji"), data.basicSingles)
    // Ignoring case: the characters that match each character are its group.
    for (const [groups, flags] of [
        [t.orbitsU, "iu"],
        [t.orbits, "i"],
    ]) {
        const group = new Map()
        for (const g of groups) for (const c of g) group.set(c, g)
        const esc = (c) => (flags === "i" ? `\\u${c.toString(16).padStart(4, "0")}` : `\\u{${c.toString(16)}}`)
        for (let c = 0; c <= (flags === "i" ? 0xffff : MAX); c++) {
            if (c >= 0xd800 && c <= 0xdfff) continue
            const candidates = new Set(group.get(c) ?? [c])
            const s = String.fromCodePoint(c)
            for (const m of [s.toUpperCase(), s.toLowerCase(), s.toUpperCase().toLowerCase()]) {
                if ([...m].length === 1) candidates.add(m.codePointAt(0))
            }
            const re = new RegExp(`^${esc(c)}$`, flags)
            for (const x of candidates) {
                if (x >= 0xd800 && x <= 0xdfff) continue
                const want = (group.get(c) ?? [c]).includes(x)
                if (re.test(String.fromCodePoint(x)) !== want) fail(`/${esc(c)}/${flags} at U+${x.toString(16)}`)
            }
        }
    }
    if (failures > 0) throw new Error(`${failures} differences from node`)
    console.error("node agrees")
}

// -----------------------------------------------------------------------------

async function main() {
    const args = process.argv.slice(2)
    const at = args.indexOf("--data")
    const dir = at >= 0 ? args[at + 1] : fs.mkdtempSync(path.join(os.tmpdir(), "ucd-"))
    await fetchData(dir)
    const data = load(dir)
    const t = build(data)
    const text = fs.readFileSync(target, "utf8")
    const from = text.indexOf(begin)
    const to = text.indexOf(`\n${end}\n`, from)
    if (from < 0 || to < 0) throw new Error(`no markers in ${target}`)
    const generated = source(t)
    fs.writeFileSync(target, text.slice(0, from) + generated + text.slice(to + end.length + 2))
    const sizes = {
        categoryRuns: [t.categoryRuns.count, t.categoryRuns.text.length],
        scriptRuns: [t.scriptRuns.count, t.scriptRuns.text.length],
        scriptExtensions: t.scriptExtensions.length,
        binary: t.binary.reduce((a, b) => a + b.text.length + b.base.length, 0),
        binaryUnshared: t.binaryRaw,
        stringPoints: t.stringPoints.length,
        strings: t.strings.map((p) => `${p.names[0]} ${p.count} ${p.text.length} ${p.singles.length}`),
        foldOrbits: t.foldOrbits.length,
        caseOrbits: t.caseOrbits.length,
        total: generated.length,
    }
    console.error(sizes)
    if (args.includes("--check")) check(data, t)
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
