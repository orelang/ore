// Naive recursive Fibonacci: function calls and integer arithmetic.
function fib(n: number): number {
    if (n < 2) return n
    return fib(n - 1) + fib(n - 2)
}

const n = Number.parseInt(process.argv[2] ?? "40")
console.log(`fib(${n}) = ${fib(n)}`)
