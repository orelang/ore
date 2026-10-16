// Naive recursive Fibonacci: function calls and integer arithmetic.
package main

import (
	"fmt"
	"os"
	"strconv"
)

func fib(n int) int {
	if n < 2 {
		return n
	}
	return fib(n-1) + fib(n-2)
}

func main() {
	n := 40
	if len(os.Args) > 1 {
		n, _ = strconv.Atoi(os.Args[1])
	}
	fmt.Printf("fib(%d) = %d\n", n, fib(n))
}
