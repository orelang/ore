// Matmul: multiplies two n×n matrices of f64 stored in flat arrays with the
// naive triple loop. The entries are multiples of 1/8, so every sum is exact
// and the checksums do not depend on the order of the additions.
package main

import (
	"fmt"
	"os"
	"strconv"
)

func main() {
	n := 800
	if len(os.Args) > 1 {
		if x, err := strconv.Atoi(os.Args[1]); err == nil {
			n = x
		}
	}

	a := []float64{}
	b := []float64{}
	c := []float64{}
	for i := 0; i < n; i++ {
		for j := 0; j < n; j++ {
			a = append(a, float64((i*j)%17-3)/8)
			b = append(b, float64((i+j)%13-4)/4)
			c = append(c, 0)
		}
	}

	for i := 0; i < n; i++ {
		for j := 0; j < n; j++ {
			sum := 0.0
			for k := 0; k < n; k++ {
				sum += a[i*n+k] * b[k*n+j]
			}
			c[i*n+j] = sum
		}
	}

	total := 0.0
	weighted := 0.0
	for i := 0; i < n*n; i++ {
		total += c[i]
		weighted += c[i] * float64(i%7+1)
	}
	fmt.Printf("%.6f %.6f\n", total, weighted)
}
