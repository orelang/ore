// Closures: chains of map, filter and reduce over a slice of a million
// integers, with callbacks that capture variables, repeated. Go has no such
// methods on slices, so they are small generic functions.
package main

import (
	"fmt"
	"os"
	"strconv"
)

func Map[T, U any](xs []T, f func(T) U) []U {
	out := make([]U, len(xs))
	for i, x := range xs {
		out[i] = f(x)
	}
	return out
}

func Filter[T any](xs []T, f func(T) bool) []T {
	out := []T{}
	for _, x := range xs {
		if f(x) {
			out = append(out, x)
		}
	}
	return out
}

func Reduce[T, A any](xs []T, f func(A, T) A, initial A) A {
	acc := initial
	for _, x := range xs {
		acc = f(acc, x)
	}
	return acc
}

func main() {
	n := 30
	if len(os.Args) > 1 {
		if x, err := strconv.Atoi(os.Args[1]); err == nil {
			n = x
		}
	}

	xs := []int{}
	for i := 0; i < 1000000; i++ {
		xs = append(xs, (i*7919)%1000)
	}

	total := 0
	for round := 0; round < n; round++ {
		k := round%7 + 1
		skip := round%5 + 2
		mapped := Map(xs, func(x int) int { return x*k + round })
		kept := Filter(mapped, func(x int) bool { return x%skip != 0 })
		total += Reduce(kept, func(sum int, x int) int { return sum + x%1000 }, 0)
	}
	fmt.Println(total)
}
