// K-nucleotide from the Computer Language Benchmarks Game: generates a DNA
// sequence of n nucleotides with the fasta generator, counts its k-mers in
// maps keyed by strings, and prints the counts of the 1- and 2-mers, most
// frequent first, and those of the five sequences the game asks for.

const n = process.argv.length > 2 ? Number.parseInt(process.argv[2]) : 2000000

// The generator of fasta, choosing a nucleotide by integer weights out of 139968.
let seed = 42
let sequence = ""
const chunk: string[] = []
for (let i = 0; i < n; i++) {
    seed = (seed * 3877 + 29573) % 139968
    if (seed < 42398) chunk.push("A")
    else if (seed < 70391) chunk.push("C")
    else if (seed < 98384) chunk.push("G")
    else chunk.push("T")
}
sequence = chunk.join("")

function count(k: number): Map<string, number> {
    const counts = new Map<string, number>()
    for (let i = 0; i + k <= sequence.length; i++) {
        const key = sequence.slice(i, i + k)
        counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return counts
}

function frequencies(k: number): string {
    const counts = count(k)
    const keys: string[] = []
    for (const [key, _] of counts) keys.push(key)
    keys.sort((a, b) => {
        const difference = (counts.get(b) ?? 0) - (counts.get(a) ?? 0)
        if (difference !== 0) return difference
        return a < b ? -1 : 1
    })
    const parts: string[] = []
    for (const key of keys) parts.push(`${key}:${counts.get(key) ?? 0}`)
    return parts.join(" ")
}

const parts: string[] = [frequencies(1), frequencies(2)]
for (const key of ["GGT", "GGTA", "GGTATT", "GGTATTTTAATT", "GGTATTTTAATTTATAGT"]) {
    parts.push(`${key}:${count(key.length).get(key) ?? 0}`)
}
console.log(parts.join(" "))
