// Mandelbrot from the Computer Language Benchmarks Game: computes the n×n
// bitmap of the set, one bit per pixel, and prints its FNV-1a hash instead of
// the PBM file.
package main

import (
	"fmt"
	"os"
	"strconv"
)

func main() {
	n := 4000
	if len(os.Args) > 1 {
		if x, err := strconv.Atoi(os.Args[1]); err == nil {
			n = x
		}
	}

	bitmap := []byte{}
	for y := 0; y < n; y++ {
		ci := 2.0*float64(y)/float64(n) - 1.0
		bits := 0
		for x := 0; x < n; x++ {
			cr := 2.0*float64(x)/float64(n) - 1.5
			zr, zi, tr, ti := 0.0, 0.0, 0.0, 0.0
			for i := 0; i < 50 && tr+ti <= 4.0; i++ {
				// The conversion keeps Go from fusing the multiply and the
				// add, which would round differently from the other languages.
				zi = float64(2.0*zr*zi) + ci
				zr = tr - ti + cr
				tr = zr * zr
				ti = zi * zi
			}
			bits <<= 1
			if tr+ti <= 4.0 {
				bits |= 1
			}
			if x%8 == 7 {
				bitmap = append(bitmap, byte(bits))
				bits = 0
			}
		}
		if n%8 != 0 {
			bitmap = append(bitmap, byte(bits<<(8-n%8)))
		}
	}

	var hash uint32 = 2166136261
	for _, b := range bitmap {
		hash = (hash ^ uint32(b)) * 16777619
	}
	fmt.Println(n, len(bitmap), hash)
}
