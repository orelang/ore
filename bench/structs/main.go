// Small value objects: particles under gravity bouncing on the floor, moved
// with an immutable 3D vector struct whose every operation makes a new one.
// In Go the vectors are values, copied rather than allocated. The time step
// and the factors are powers of two, so that every product is exact and the
// sums are the same in every language.
package main

import (
	"fmt"
	"math"
	"os"
	"strconv"
)

type Vec3 struct{ x, y, z float64 }

func (v Vec3) Add(o Vec3) Vec3 { return Vec3{v.x + o.x, v.y + o.y, v.z + o.z} }

func (v Vec3) Scale(k float64) Vec3 { return Vec3{v.x * k, v.y * k, v.z * k} }

type Particle struct{ pos, vel Vec3 }

func main() {
	n := 20000
	if len(os.Args) > 1 {
		if x, err := strconv.Atoi(os.Args[1]); err == nil {
			n = x
		}
	}

	dt := 1.0 / 64
	gravity := Vec3{0, -9.75, 0}
	particles := make([]Particle, 0, 1000)
	for i := 0; i < 1000; i++ {
		pos := Vec3{float64(i % 10), float64(50 + i%7), float64(i % 13)}
		vel := Vec3{float64(i%5 - 2), float64(i % 3), float64(i%3 - 1)}
		particles = append(particles, Particle{pos, vel})
	}

	for step := 0; step < n; step++ {
		for i := range particles {
			p := &particles[i]
			p.vel = p.vel.Add(gravity.Scale(dt))
			p.pos = p.pos.Add(p.vel.Scale(dt))
			if p.pos.y < 0 {
				p.pos = Vec3{p.pos.x, -p.pos.y, p.pos.z}
				p.vel = Vec3{p.vel.x, -p.vel.y * 0.5, p.vel.z}
			}
		}
	}

	sum := 0.0
	for _, p := range particles {
		sum += p.pos.x + p.pos.y + p.pos.z
	}
	fmt.Println(int64(math.Floor(sum * 1024)))
}
