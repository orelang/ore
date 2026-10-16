// Random regular expressions and subjects: ASCII, and in one case of three
// Unicode, with the flags u or v, properties (\p{...}, also of strings) and
// letters of every case. Writes the cases, one JSON object a line ({ p, f,
// s }), to the file in argv[2], and prints what JavaScript finds for each (as
// tests/fuzz/regexp/check.ore prints it): every match of exec, in a loop for
// the g and y flags, with its index (in UTF-8 bytes, as Ore counts) and
// groups, then replace(re, "<$&>").
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
// Few group names, so that some repeat: in different alternatives (ES2025) or, rejected by both, not.
// Never the name of an enclosing group, which V8 takes in `(?<a>.(?<a>b)|c)` against the specification.
let groupName = 0
const open = []
const pick = (xs) => xs[below(xs.length)]
const atoms = ["a", "b", "c", "x", "\\d", "\\w", "\\s", "\\D", "\\W", ".", "[abc]", "[^a]", "[a-c]", "[x-z0-9]", "\\.", "-", " ", "\\b", "\\B", "^", "$"]
// Properties of characters: General_Category values, scripts, binary properties.
// Not ASCII: with v and i, V8 leaves out the characters whose case folding is
// ASCII (ſ, the Kelvin sign), against the specification.
const properties = [
    "L", "Lu", "Ll", "Lt", "LC", "Lm", "Lo", "M", "Mn", "N", "Nd", "No", "P", "Po", "Ps", "S", "Sm", "So", "Sk", "Z",
    "Zs", "C", "Cc", "Cf", "Cn", "Co", "gc=Lu", "General_Category=Punctuation", "punct", "digit", "Any",
    "Assigned", "sc=Latn", "sc=Greek", "Script=Cyrillic", "sc=Hani", "sc=Zyyy", "sc=Zinh", "sc=Armn", "sc=Cher",
    "scx=Grek", "scx=Hira", "scx=Kana", "Script_Extensions=Latin", "scx=Zyyy", "Alphabetic", "Alpha", "Lowercase",
    "Uppercase", "Cased", "Case_Ignorable", "CWCF", "CWL", "CWU", "CWT", "CWCM", "CWKCF", "Emoji", "EPres",
    "Emoji_Modifier", "Emoji_Modifier_Base", "Emoji_Component", "ExtPict", "RI", "White_Space", "ID_Start", "IDC",
    "XID_Start", "XIDC", "Dash", "Diacritic", "Extender", "Gr_Base", "Gr_Ext", "Hex_Digit", "AHex", "Math",
    "Pattern_Syntax", "Pat_WS", "Quotation_Mark", "Terminal_Punctuation", "STerm", "Ideographic", "Join_Control",
    "DI", "Variation_Selector", "Bidi_M", "Bidi_C",
]
// Properties of strings (the v flag).
const stringProperties = ["RGI_Emoji", "Basic_Emoji", "Emoji_Keycap_Sequence", "RGI_Emoji_Flag_Sequence",
    "RGI_Emoji_Modifier_Sequence", "RGI_Emoji_Tag_Sequence", "RGI_Emoji_ZWJ_Sequence"]
// Letters of several cases and scripts, written as themselves.
const letters = ["é", "É", "Σ", "σ", "ς", "ǅ", "ſ", "\u212a", "ß", "ẞ", "Ꭰ", "ꭰ", "ա", "Ա", "ა", "Ა", "😀", "\u{10400}"]
function property() {
    const name = pick(properties)
    return `\\${below(4) === 0 ? "P" : "p"}{${name}}`
}
/** An atom with the flag u or v (`sets`): an ASCII one, a letter, a property or a class of them. */
function unicodeAtom(sets) {
    switch (below(8)) {
        case 0: case 1: return pick(atoms)
        case 2: return pick(/[uv]/.test(flags) ? letters : letters.filter((l) => !/[😀{]/u.test(l)))
        case 3: case 4: return property()
        case 5: return `[${below(3) === 0 ? "^" : ""}${property()}${pick(["", "a", "\\d", "é", property()])}]`
        default:
            if (!sets) return property()
            switch (below(5)) {
                case 0: return `\\p{${pick(stringProperties)}}`
                // Strings of two characters: V8 does not fold one character of \q{...} with i ([\q{a}] takes no A).
                case 1: return `[\\p{${pick(stringProperties)}}\\q{ab|${pick(letters)}b}x]`
                case 2: return `[\\p{${pick(stringProperties)}}--${pick(["\\q{😀}", "\\q{🇫🇷|#️⃣}", "[\\p{RI}]", property()])}]`
                case 3: return `[${property()}&&${property()}]`
                default: return `[\\p{${pick(stringProperties)}}&&\\p{${pick(stringProperties)}}]`
            }
    }
}
let unicode = false
let sets = false
function term(depth) {
    let t
    switch (below(depth > 0 ? 9 : 4)) {
        case 4: t = `(${alt(depth - 1)})`; break
        case 5: t = `(?:${alt(depth - 1)})`; break
        case 6: {
            let name = `g${below(3)}`
            while (open.includes(name)) name = `g${below(3)}${groupName++}`
            open.push(name)
            t = `(?<${name}>${alt(depth - 1)})`
            open.pop()
            break
        }
        case 7: t = `(?${pick(["=", "!", "<=", "<!"])}${alt(depth - 1)})`; break
        case 8: t = `\\${1 + below(2)}`; break
        default: t = unicode ? unicodeAtom(sets) : pick(atoms)
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
// Characters and emoji sequences of Unicode subjects; without u or v, only those up to U+FFFF.
const units = [..."abcx019 .-_éÉΣσςǅǄǆſKkßẞᎠꭰաԱაᲐАж٣²Ⅻ€«»漢かカー©⌚☺\u00a0\u2028\u0378\u200d\ufe0f\u20e3",
    "😀", "👍", "👍🏽", "🇫🇷", "🇯🇵", "#️⃣", "👨‍👩‍👧", "🏴󠁧󠁢󠁳󠁣󠁴󠁿", "\u{10400}", "\u{10428}", "\u{1f3fb}", "\u{e0061}"]
function subject() {
    let s = ""
    for (let k = 0; k < below(24); k++) {
        if (!unicode) s += subjects[below(subjects.length)]
        else s += pick(units.filter((u) => /[uv]/.test(flags) || u.codePointAt(0) <= 0xffff))
    }
    return s
}
function describe(re, s) {
    const out = []
    const loop = re.global || re.sticky
    let guard = 0
    while (guard++ < 50) {
        const m = re.exec(s)
        if (m === null) { out.push("no match"); break }
        out.push(`${Buffer.byteLength(s.slice(0, m.index))}: ${m.map((g) => (g === undefined ? "null" : JSON.stringify(g))).join(" ")}`)
        if (!loop) break
        // Past a whole character, as Ore moves past one.
        if (m[0] === "") re.lastIndex += s.codePointAt(re.lastIndex) > 0xffff ? 2 : 1
    }
    re.lastIndex = 0
    out.push(`replace: ${JSON.stringify(s.replace(re, "<$&>"))}`)
    return out.join("\n")
}
const cases = []
const expected = []
let flags = ""
while (cases.length < n) {
    groupName = 0
    unicode = below(3) === 0
    const f = unicode
        ? pick(["u", "iu", "gu", "giu", "v", "iv", "gv", "giv", "yv", "i", "gi"])
        : pick(["", "", "g", "i", "gi", "m", "gm", "s", "y", "gy"])
    flags = f
    sets = f.includes("v")
    const p = alt(2)
    let re
    try { re = new RegExp(p, f) } catch { continue }
    const s = subject()
    cases.push(JSON.stringify({ p, f, s }))
    expected.push(`== /${p}/${f} ${JSON.stringify(s)}\n${describe(re, s)}`)
}
writeFileSync(file, cases.join("\n") + "\n")
process.stdout.write(expected.join("\n") + "\n")
