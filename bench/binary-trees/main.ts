// Binary trees from the Computer Language Benchmarks Game: allocates many
// short-lived trees and one long-lived tree, and checks them by counting nodes.
class Node {
    left: Node | null
    right: Node | null

    constructor(left: Node | null, right: Node | null) {
        this.left = left
        this.right = right
    }
}

function create(depth: number): Node {
    if (depth === 0) return new Node(null, null)
    return new Node(create(depth - 1), create(depth - 1))
}

function check(node: Node): number {
    const left = node.left
    const right = node.right
    if (left === null || right === null) return 1
    return 1 + check(left) + check(right)
}

const n = Number.parseInt(process.argv[2] ?? "16")
const minDepth = 4
const maxDepth = n < minDepth + 2 ? minDepth + 2 : n

const stretchDepth = maxDepth + 1
console.log(`stretch tree of depth ${stretchDepth}\t check: ${check(create(stretchDepth))}`)

const longLived = create(maxDepth)
for (let depth = minDepth; depth <= maxDepth; depth += 2) {
    const iterations = 1 << (maxDepth - depth + minDepth)
    let sum = 0
    for (let i = 0; i < iterations; i++) sum += check(create(depth))
    console.log(`${iterations}\t trees of depth ${depth}\t check: ${sum}`)
}
console.log(`long lived tree of depth ${maxDepth}\t check: ${check(longLived)}`)
