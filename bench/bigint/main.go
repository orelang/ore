// BigInt: the factorial of n by multiplication and the Fibonacci number of
// 10n by addition, printing the number of digits and the sum of the digits
// of the factorial, and the number of digits and the last twelve digits of
// the Fibonacci number.
package main

import (
	"fmt"
	"math/big"
	"os"
	"strconv"
)

func main() {
	n := 20000
	if len(os.Args) > 1 {
		if x, err := strconv.Atoi(os.Args[1]); err == nil {
			n = x
		}
	}

	factorial := big.NewInt(1)
	for i := 2; i <= n; i++ {
		factorial.Mul(factorial, big.NewInt(int64(i)))
	}
	text := factorial.String()
	digitSum := 0
	for i := 0; i < len(text); i++ {
		digitSum += int(text[i]) - 48
	}

	a := big.NewInt(0)
	b := big.NewInt(1)
	for i := 0; i < 10*n; i++ {
		c := new(big.Int).Add(a, b)
		a = b
		b = c
	}

	last := new(big.Int).Mod(a, new(big.Int).Exp(big.NewInt(10), big.NewInt(12), nil))
	fmt.Println(len(text), digitSum, len(a.String()), last)
}
