// A generator of random programs in the part of TypeScript that Ore and
// JavaScript run alike: f64 numbers, ASCII strings, arrays, Maps and Sets,
// classes with inheritance, closures, loops, switch, destructuring and
// templates. Each program prints what it computes, line by line, so that
// tests/fuzz/run.sh can compare Ore (debug and release) with Node.
//
//   node --experimental-transform-types tests/fuzz/gen.ts SEED > program.ts
//
// The same seed gives the same program. What the two languages do differently
// on purpose (undefined, integer types, UTF-16) is left out: values that may
// be missing are read through `?? fallback`, numbers are `number` (f64) only,
// strings are ASCII, and loops are bounded.

let seed = Number(process.argv[2] ?? "1") >>> 0 || 1

function next(): number {
    // xorshift32
    seed ^= seed << 13
    seed >>>= 0
    seed ^= seed >>> 17
    seed ^= seed << 5
    seed >>>= 0
    return seed
}

function below(n: number): number {
    return next() % n
}

function pick<T>(xs: T[]): T {
    return xs[below(xs.length)]
}

function chance(percent: number): boolean {
    return below(100) < percent
}

type Kind = "num" | "int" | "str" | "bool" | "nums" | "strs"

const out: string[] = []
let indent = ""
let fresh = 0

function line(text: string) {
    out.push(indent + text)
}

/** The variables in scope, by kind: names that can be read and assigned. */
class Scope {
    vars: Record<Kind, string[]> = { num: [], int: [], str: [], bool: [], nums: [], strs: [] }
    /** The number variables declared with `let`, which statements may assign. */
    mutable: string[] = []
    constructor(readonly parent: Scope | null) {}
    all(kind: Kind): string[] {
        const own = this.vars[kind]
        return this.parent ? own.concat(this.parent.all(kind)) : own.slice()
    }
    assignable(): string[] {
        return this.parent ? this.mutable.concat(this.parent.assignable()) : this.mutable.slice()
    }
}

let scope = new Scope(null)
/** Functions declared so far: name and parameter kinds, all returning numbers. */
const functions: { name: string; params: Kind[] }[] = []
/** Classes declared so far, with the method each has. */
const classes: { name: string; method: string; base: string | null }[] = []

const words = ["a", "bc", "xyz", "Ore", "node", "hello", "", "  pad ", "a,b,c", "x-y-z", "MiXeD"]

/** A number literal; whole ones end in `.0`, as an untyped integer constant would be an int in Ore. */
function numLiteral(): string {
    const text = rawNumber()
    return /^-?\d+$/.test(text) ? `${text}.0` : text
}

function rawNumber(): string {
    switch (below(6)) {
        case 0:
            return `${below(10)}`
        case 1:
            return `${below(1000)}`
        case 2:
            return `${below(100)}.${below(100)}`
        case 3:
            return `${(below(2000) - 1000) / 8}`
        case 4:
            return `${below(1 << 20) * 1024}`
        default:
            return `${below(3)}.5`
    }
}

function expr(kind: Kind, depth: number): string {
    const vars = scope.all(kind)
    if (depth <= 0 || chance(25)) {
        if (vars.length > 0 && chance(60)) return pick(vars)
        return leaf(kind)
    }
    switch (kind) {
        case "num":
            return numExpr(depth - 1)
        case "int":
            return intExpr(depth - 1)
        case "str":
            return strExpr(depth - 1)
        case "bool":
            return boolExpr(depth - 1)
        case "nums":
            return numsExpr(depth - 1)
        case "strs":
            return strsExpr(depth - 1)
    }
}

function leaf(kind: Kind): string {
    switch (kind) {
        case "num":
            return numLiteral()
        case "int":
            return `${below(20)}`
        case "str":
            return JSON.stringify(pick(words))
        case "bool":
            return pick(["true", "false"])
        case "nums":
            return `[${Array.from({ length: 1 + below(4) }, numLiteral).join(", ")}]`
        case "strs":
            return `[${Array.from({ length: 1 + below(3) }, () => JSON.stringify(pick(words))).join(", ")}]`
    }
}

function numExpr(d: number): string {
    const a = () => expr("num", d)
    switch (below(17)) {
        case 0:
            return `(${a()} + ${a()})`
        case 1:
            return `(${a()} - ${a()})`
        case 2:
            return `(${a()} * ${a()})`
        case 3:
            // Never a constant division by zero, which Ore rejects at compile time.
            return `(${a()} / (Math.abs(${a()}) + 1))`
        case 4:
            return `(${a()} % (Math.abs(${a()}) + 1))`
        case 5:
            return `Math.${pick(["floor", "ceil", "round", "trunc", "abs", "sign", "sqrt"])}(${a()})`
        case 6:
            return `Math.${pick(["min", "max"])}(${a()}, ${a()})`
        case 7:
            return `(${a()} * 0.5)`
        case 8:
            return `Math.hypot(${a()}, ${a()})`
        case 9:
            return `(${expr("bool", d)} ? ${a()} : 0.25)`
        case 10:
            return `${expr("nums", d)}.reduce((s, x) => s + x, ${a()})`
        case 11:
            return `(${expr("bool", d)} ? ${a()} : ${a()})`
        case 12: {
            const fs = functions.filter((f) => f.params.length <= 3)
            if (fs.length === 0) return a()
            const f = pick(fs)
            return `${f.name}(${f.params.map((p) => expr(p, d)).join(", ")})`
        }
        case 13:
            return `(${expr("nums", d)}.at(0) ?? ${a()})`
        case 14:
            return `-${a()}`
        case 15:
            return `${expr("nums", d)}.reduce((s, x) => Math.max(s, x), ${a()})`
        default: {
            if (classes.length === 0) return a()
            const c = pick(classes)
            return `new ${c.name}(${a()}).${c.method}(${a()})`
        }
    }
}

/**
 * Integers: lengths and positions, which are int in Ore; never divided (integer
 * division in Ore), and never a negative remainder or a product with 0, which
 * JavaScript's floats make -0 where an int has no negative zero.
 */
function intExpr(d: number): string {
    const i = () => expr("int", d)
    switch (below(10)) {
        case 0:
            return `(${i()} + ${i()})`
        case 1:
            return `(${i()} - ${i()})`
        case 2:
            return `(${i()} * ${1 + below(4)})`
        case 3:
            return `${expr("str", d)}.length`
        case 4:
            return `${expr("nums", d)}.length`
        case 5:
            return `${expr("strs", d)}.indexOf(${expr("str", d)})`
        case 6:
            return `${expr("str", d)}.indexOf(${expr("str", d)})`
        case 7:
            return `Math.${pick(["min", "max"])}(${i()}, ${i()})`
        case 8:
            return `(Math.abs(${i()}) % ${1 + below(7)})`
        default:
            return `(${expr("bool", d)} ? ${i()} : ${i()})`
    }
}

function strExpr(d: number): string {
    const s = () => expr("str", d)
    switch (below(13)) {
        case 0:
            return `(${s()} + ${s()})`
        case 1:
            return `\`<\${${expr("num", d)}}|\${${s()}}>\``
        case 2:
            return `${s()}.toUpperCase()`
        case 3:
            return `${s()}.slice(${expr("int", d)}, ${expr("int", d)})`
        case 4:
            return `${expr("strs", d)}.join(${JSON.stringify(pick([",", "-", "", " | "]))})`
        case 5:
            return `${s()}.repeat(${below(3)})`
        case 6:
            return `${s()}.padStart(${below(12)}, ${JSON.stringify(pick(["*", "ab", "0"]))})`
        case 7:
            return `${s()}.trim()`
        case 8:
            return `${s()}.replaceAll(${JSON.stringify(pick(["a", ",", "-", "x"]))}, ${JSON.stringify(pick(["", "_", "AA"]))})`
        case 9:
            return `(${expr("strs", d)}.at(0) ?? ${s()})`
        case 10:
            return `${s()}.toLowerCase()`
        case 11:
            return `\`\${${expr("nums", d)}.length}\``
        default:
            return `(${expr("bool", d)} ? ${s()} : ${s()})`
    }
}

function boolExpr(d: number): string {
    const n = () => expr("num", d)
    switch (below(10)) {
        case 0:
            return `(${n()} < ${n()})`
        case 1:
            return `(${n()} === ${n()})`
        case 2:
            return `(${expr("str", d)} === ${expr("str", d)})`
        case 3:
            return `!${expr("bool", d)}`
        case 4:
            return `(${expr("bool", d)} && ${expr("bool", d)})`
        case 5:
            return `(${expr("bool", d)} || ${expr("bool", d)})`
        case 6:
            return `${expr("str", d)}.includes(${expr("str", d)})`
        case 7:
            return `${expr("nums", d)}.includes(${n()})`
        case 8:
            return `(${expr("int", d)} <= ${expr("int", d)})`
        default:
            return `${expr("str", d)}.startsWith(${expr("str", d)})`
    }
}

function numsExpr(d: number): string {
    const xs = () => expr("nums", d)
    switch (below(9)) {
        case 0:
            return `${xs()}.map((x) => x * ${expr("num", d)})`
        case 1:
            return `${xs()}.filter((x) => x > ${expr("num", d)})`
        case 2:
            return `${xs()}.slice(${below(3)})`
        case 3:
            return `${xs()}.concat(${xs()})`
        case 4:
            return `[...${xs()}].sort((a, b) => a - b)`
        case 5:
            return `${xs()}.toReversed()`
        case 6:
            return `${xs()}.map((x) => Math.floor(x))`
        case 7:
            return `[${expr("num", d)}, ${expr("num", d)}]`
        default:
            return `${xs()}.map((x) => x + 1.5)`
    }
}

function strsExpr(d: number): string {
    const ss = () => expr("strs", d)
    switch (below(6)) {
        case 0:
            return `${expr("str", d)}.split(${JSON.stringify(pick([",", "-", "", " "]))})`
        case 1:
            return `${ss()}.map((s) => s + ${expr("str", d)})`
        case 2:
            return `${ss()}.filter((s) => s.length > ${below(3)})`
        case 3:
            return `[...${ss()}].sort()`
        case 4:
            return `${expr("nums", d)}.map((x) => \`n\${x}\`)`
        default:
            return `[${expr("str", d)}]`
    }
}

const types: Record<Kind, string> = { num: "number", int: "int", str: "string", bool: "boolean", nums: "number[]", strs: "string[]" }
const kinds: Kind[] = ["num", "int", "str", "bool", "nums", "strs"]

function declare(kind: Kind, mutable: boolean): string {
    const name = `${kind[0]}${fresh++}`
    line(`${mutable ? "let" : "const"} ${name}: ${types[kind]} = ${expr(kind, 3)}`)
    scope.vars[kind].push(name)
    if (mutable && kind === "num") scope.mutable.push(name)
    return name
}

function show(kind: Kind, value: string) {
    line(`console.log(${JSON.stringify(`${fresh}:`)}, ${value})`)
}

function statement(depth: number) {
    const kind = pick(kinds)
    switch (below(depth > 0 ? 11 : 6)) {
        case 0:
        case 1:
            show(kind, declare(kind, chance(50)))
            break
        case 2: {
            const vars = scope.assignable()
            if (vars.length > 0) {
                const v = pick(vars)
                line(`${v} = ${expr("num", 2)}`)
                show("num", v)
            } else show(kind, expr(kind, 2))
            break
        }
        case 3:
            show(kind, expr(kind, 3))
            break
        case 4: {
            const m = `m${fresh++}`
            line(`const ${m} = new Map<string, number>()`)
            line(`for (const w of ${expr("strs", 2)}) ${m}.set(w, (${m}.get(w) ?? 0) + ${expr("num", 1)})`)
            line(`${m}.delete(${expr("str", 1)})`)
            line(`console.log(${m}.size, Array.from(${m}.keys()).join(";"), Array.from(${m}.values()).reduce((a, b) => a + b, 0.0))`)
            break
        }
        case 5: {
            const s = `t${fresh++}`
            line(`const ${s} = new Set<number>(${expr("nums", 2)})`)
            line(`${s}.add(${expr("num", 1)})`)
            line(`console.log(${s}.size, ${s}.has(${expr("num", 1)}), Array.from(${s}).join(","))`)
            break
        }
        case 6: {
            const i = `i${fresh++}`
            line(`for (let ${i} = 0; ${i} < ${below(6)}; ${i}++) {`)
            block(depth - 1, () => scope.vars.int.push(i))
            line(`}`)
            break
        }
        case 7: {
            line(`if (${expr("bool", 2)}) {`)
            block(depth - 1)
            line(`} else {`)
            block(depth - 1)
            line(`}`)
            break
        }
        case 8: {
            const w = `w${fresh++}`
            line(`let ${w} = 0`)
            line(`while (${w} < ${below(5)}) {`)
            block(depth - 1, () => {})
            line(`    ${w}++`)
            line(`}`)
            break
        }
        case 9: {
            line(`switch (Math.abs(Math.trunc(${expr("num", 2)})) % 4) {`)
            for (let c = 0; c < 3; c++) {
                line(`    case ${c}:`)
                indent += "    "
                block(0)
                line(`    break`)
                indent = indent.slice(4)
            }
            line(`    default:`)
            indent += "    "
            show("str", expr("str", 1))
            indent = indent.slice(4)
            line(`}`)
            break
        }
        default: {
            const counter = `k${fresh++}`
            line(`let ${counter}: number = 0.0`)
            line(`const bump${counter} = (by: number): number => {`)
            line(`    ${counter} += by`)
            line(`    return ${counter}`)
            line(`}`)
            line(`console.log(bump${counter}(${expr("num", 1)}), bump${counter}(${expr("num", 1)}), ${counter})`)
        }
    }
}

function block(depth: number, before?: () => void) {
    const saved = scope
    scope = new Scope(saved)
    indent += "    "
    if (before) before()
    const n = 1 + below(3)
    for (let k = 0; k < n; k++) statement(depth)
    indent = indent.slice(4)
    scope = saved
}

function declareFunction() {
    const name = `f${fresh++}`
    const params: Kind[] = Array.from({ length: below(3) }, () => pick(["num", "str", "nums"] as Kind[]))
    const saved = scope
    scope = new Scope(null)
    const names = params.map((p, i) => {
        const n = `a${i}`
        scope.vars[p].push(n)
        return `${n}: ${types[p]}`
    })
    line(`function ${name}(${names.join(", ")}): number {`)
    indent += "    "
    if (chance(50)) line(`if (${expr("bool", 1)}) return ${expr("num", 2)}`)
    line(`return ${expr("num", 3)}`)
    indent = indent.slice(4)
    line(`}`)
    scope = saved
    functions.push({ name, params })
}

function declareClass() {
    const base = classes.length > 0 && chance(50) ? pick(classes) : null
    const name = `C${fresh++}`
    const method = base !== null ? base.method : `m${fresh++}`
    const saved = scope
    scope = new Scope(null)
    if (base === null) {
        line(`class ${name} {`)
        line(`    constructor(readonly v: number) {}`)
    } else {
        line(`class ${name} extends ${base.name} {`)
        line(`    constructor(v: number) {`)
        line(`        super(v * 2)`)
        line(`    }`)
    }
    scope.vars.num.push("this.v", "x")
    line(`    ${base !== null ? "override " : ""}${method}(x: number): number {`)
    indent += "        "
    line(`return ${base !== null && chance(50) ? `super.${method}(x) + ` : ""}${expr("num", 2)}`)
    indent = indent.slice(8)
    line(`    }`)
    line(`}`)
    scope = saved
    classes.push({ name, method, base: base !== null ? base.name : null })
}

for (let k = 0; k < 1 + below(3); k++) declareFunction()
for (let k = 0; k < below(3); k++) declareClass()
const statements = 6 + below(10)
for (let k = 0; k < statements; k++) statement(2)

process.stdout.write(`// generated by tests/fuzz/gen.ts, seed ${process.argv[2] ?? "1"}\n${out.join("\n")}\n`)
