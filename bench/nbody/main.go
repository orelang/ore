// N-body from the Computer Language Benchmarks Game: a simulation of the
// Jovian planets in floating point, printing the energy before and after.
package main

import (
	"fmt"
	"math"
	"os"
	"strconv"
)

const (
	solarMass   = 4 * math.Pi * math.Pi
	daysPerYear = 365.24
)

type Body struct {
	x, y, z, vx, vy, vz, mass float64
}

func newBody(x, y, z, vx, vy, vz, mass float64) *Body {
	return &Body{x, y, z, vx * daysPerYear, vy * daysPerYear, vz * daysPerYear, mass * solarMass}
}

func offsetMomentum(bodies []*Body) {
	var px, py, pz float64
	for _, b := range bodies {
		px += b.vx * b.mass
		py += b.vy * b.mass
		pz += b.vz * b.mass
	}
	bodies[0].vx = -px / solarMass
	bodies[0].vy = -py / solarMass
	bodies[0].vz = -pz / solarMass
}

func advance(bodies []*Body, dt float64) {
	count := len(bodies)
	for i := 0; i < count; i++ {
		a := bodies[i]
		for j := i + 1; j < count; j++ {
			b := bodies[j]
			dx := a.x - b.x
			dy := a.y - b.y
			dz := a.z - b.z
			d2 := dx*dx + dy*dy + dz*dz
			mag := dt / (d2 * math.Sqrt(d2))
			a.vx -= dx * b.mass * mag
			a.vy -= dy * b.mass * mag
			a.vz -= dz * b.mass * mag
			b.vx += dx * a.mass * mag
			b.vy += dy * a.mass * mag
			b.vz += dz * a.mass * mag
		}
	}
	for _, b := range bodies {
		b.x += dt * b.vx
		b.y += dt * b.vy
		b.z += dt * b.vz
	}
}

func energy(bodies []*Body) float64 {
	e := 0.0
	count := len(bodies)
	for i := 0; i < count; i++ {
		a := bodies[i]
		e += 0.5 * a.mass * (a.vx*a.vx + a.vy*a.vy + a.vz*a.vz)
		for j := i + 1; j < count; j++ {
			b := bodies[j]
			dx := a.x - b.x
			dy := a.y - b.y
			dz := a.z - b.z
			e -= (a.mass * b.mass) / math.Sqrt(dx*dx+dy*dy+dz*dz)
		}
	}
	return e
}

func main() {
	n := 5000000
	if len(os.Args) > 1 {
		n, _ = strconv.Atoi(os.Args[1])
	}
	bodies := []*Body{
		newBody(0, 0, 0, 0, 0, 0, 1),
		newBody(4.84143144246472090e+00, -1.16032004402742839e+00, -1.03622044471123109e-01,
			1.66007664274403694e-03, 7.69901118419740425e-03, -6.90460016972063023e-05,
			9.54791938424326609e-04),
		newBody(8.34336671824457987e+00, 4.12479856412430479e+00, -4.03523417114321381e-01,
			-2.76742510726862411e-03, 4.99852801234917238e-03, 2.30417297573763929e-05,
			2.85885980666130812e-04),
		newBody(1.28943695621391310e+01, -1.51111514016986312e+01, -2.23307578892655734e-01,
			2.96460137564761618e-03, 2.37847173959480950e-03, -2.96589568540237556e-05,
			4.36624404335156298e-05),
		newBody(1.53796971148509165e+01, -2.59193146099879641e+01, 1.79258772950371181e-01,
			2.68067772490389322e-03, 1.62824170038242295e-03, -9.51592254519715870e-05,
			5.15138902046611451e-05),
	}
	offsetMomentum(bodies)
	fmt.Printf("%.9f\n", energy(bodies))
	for i := 0; i < n; i++ {
		advance(bodies, 0.01)
	}
	fmt.Printf("%.9f\n", energy(bodies))
}
