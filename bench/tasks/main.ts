// Tasks: starts n async functions that each compute a little, waits for all
// of them and adds up their results.

const n = process.argv.length > 2 ? Number.parseInt(process.argv[2]) : 100000

function work(i: number): number {
    let x = i
    for (let k = 0; k < 100; k++) x = (x * 31 + k) % 1000003
    return x
}

const results: number[] = []
for (let i = 0; i < n; i++) results.push(0)
const pending: Promise<void>[] = []
for (let i = 0; i < n; i++) {
    pending.push(
        (async () => {
            results[i] = work(i)
        })(),
    )
}
await Promise.all(pending)
let sum = 0
for (const r of results) sum += r
console.log(n, sum)
