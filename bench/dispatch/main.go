// Dynamic dispatch: sums the areas and perimeters of an array of shapes of
// four types behind one interface, over and over.
package main

import (
	"fmt"
	"math"
	"os"
	"strconv"
)

type Shape interface {
	Area() float64
	Perimeter() float64
}

type Circle struct{ r float64 }

func (c *Circle) Area() float64      { return math.Pi * c.r * c.r }
func (c *Circle) Perimeter() float64 { return 2 * math.Pi * c.r }

type Rect struct{ w, h float64 }

func (r *Rect) Area() float64      { return r.w * r.h }
func (r *Rect) Perimeter() float64 { return 2 * (r.w + r.h) }

type Square struct{ side float64 }

func (s *Square) Area() float64      { return s.side * s.side }
func (s *Square) Perimeter() float64 { return 4 * s.side }

type Triangle struct{ a, b float64 }

func (t *Triangle) Area() float64 { return 0.5 * t.a * t.b }
func (t *Triangle) Perimeter() float64 {
	return t.a + t.b + math.Sqrt(t.a*t.a+t.b*t.b)
}

func main() {
	n := 200000
	if len(os.Args) > 1 {
		if x, err := strconv.Atoi(os.Args[1]); err == nil {
			n = x
		}
	}

	// A thousand shapes of sizes 1 to 10, picked by a Lehmer generator.
	seed := 42
	next := func() float64 {
		seed = (seed * 48271) % 2147483647
		return float64(1 + seed%10)
	}
	shapes := []Shape{}
	for i := 0; i < 1000; i++ {
		switch i % 4 {
		case 0:
			shapes = append(shapes, &Circle{next()})
		case 1:
			w := next()
			shapes = append(shapes, &Rect{w, next()})
		case 2:
			shapes = append(shapes, &Square{next()})
		default:
			a := next()
			shapes = append(shapes, &Triangle{a, next()})
		}
	}
	// Shuffled, so that the calls do not repeat in a pattern.
	for i := len(shapes) - 1; i > 0; i-- {
		seed = (seed * 48271) % 2147483647
		j := seed % (i + 1)
		shapes[i], shapes[j] = shapes[j], shapes[i]
	}

	total := 0.0
	for pass := 0; pass < n; pass++ {
		for _, s := range shapes {
			total += s.Area() + s.Perimeter()
		}
	}
	fmt.Println(int64(math.Floor(total)))
}
