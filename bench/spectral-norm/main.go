// The spectral norm of an infinite matrix, from the Computer Language
// Benchmarks Game: floating-point loops over arrays.
package main

import (
	"fmt"
	"math"
	"os"
	"strconv"
)

func a(i, j int) float64 {
	return 1.0 / float64((i+j)*(i+j+1)/2+i+1)
}

func multiplyAv(n int, v, av []float64) {
	for i := 0; i < n; i++ {
		sum := 0.0
		for j := 0; j < n; j++ {
			sum += a(i, j) * v[j]
		}
		av[i] = sum
	}
}

func multiplyAtv(n int, v, atv []float64) {
	for i := 0; i < n; i++ {
		sum := 0.0
		for j := 0; j < n; j++ {
			sum += a(j, i) * v[j]
		}
		atv[i] = sum
	}
}

func multiplyAtAv(n int, v, out, tmp []float64) {
	multiplyAv(n, v, tmp)
	multiplyAtv(n, tmp, out)
}

func main() {
	n := 4000
	if len(os.Args) > 1 {
		if x, err := strconv.Atoi(os.Args[1]); err == nil {
			n = x
		}
	}
	u := make([]float64, n)
	v := make([]float64, n)
	tmp := make([]float64, n)
	for i := range u {
		u[i] = 1
	}
	for i := 0; i < 10; i++ {
		multiplyAtAv(n, u, v, tmp)
		multiplyAtAv(n, v, u, tmp)
	}
	vBv, vv := 0.0, 0.0
	for i := 0; i < n; i++ {
		vBv += u[i] * v[i]
		vv += v[i] * v[i]
	}
	fmt.Printf("%.9f\n", math.Sqrt(vBv/vv))
}
