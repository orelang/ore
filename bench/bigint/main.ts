// BigInt: the factorial of n by multiplication and the Fibonacci number of
// 10n by addition, printing the number of digits and the sum of the digits
// of the factorial, and the number of digits and the last twelve digits of
// the Fibonacci number.

const n = process.argv.length > 2 ? Number.parseInt(process.argv[2]) : 20000

let factorial = 1n
for (let i = 2; i <= n; i++) factorial *= BigInt(i)
const text = factorial.toString()
let digitSum = 0
for (let i = 0; i < text.length; i++) digitSum += (text.codePointAt(i) ?? 0) - 48

let a = 0n
let b = 1n
for (let i = 0; i < 10 * n; i++) {
    const c = a + b
    a = b
    b = c
}

console.log(text.length, digitSum, a.toString().length, (a % 10n ** 12n).toString())
