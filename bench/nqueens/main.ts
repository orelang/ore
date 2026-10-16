// N-queens: counts the ways to place n queens on an n×n board, once by
// recursion over small arrays of the taken columns and diagonals, once by
// recursion over bitmasks.

function place(row: number, n: number, columns: boolean[], down: boolean[], up: boolean[]): number {
    if (row === n) return 1
    let count = 0
    for (let column = 0; column < n; column++) {
        const d = row + column
        const u = row - column + n - 1
        if (columns[column] || down[d] || up[u]) continue
        columns[column] = true
        down[d] = true
        up[u] = true
        count += place(row + 1, n, columns, down, up)
        columns[column] = false
        down[d] = false
        up[u] = false
    }
    return count
}

function placeBits(all: number, columns: number, left: number, right: number): number {
    if (columns === all) return 1
    let count = 0
    let free = all & ~(columns | left | right)
    while (free !== 0) {
        const bit = free & -free
        free ^= bit
        count += placeBits(all, columns | bit, ((left | bit) << 1) & all, (right | bit) >> 1)
    }
    return count
}

const n = process.argv.length > 2 ? Number.parseInt(process.argv[2]) : 13
const columns: boolean[] = []
const down: boolean[] = []
const up: boolean[] = []
for (let i = 0; i < n; i++) columns.push(false)
for (let i = 0; i < 2 * n - 1; i++) {
    down.push(false)
    up.push(false)
}
console.log(n, place(0, n, columns, down, up), placeBits((1 << n) - 1, 0, 0, 0))
