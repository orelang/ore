// Small value objects: particles under gravity bouncing on the floor, moved
// with an immutable 3D vector class whose every operation makes a new one.
// The time step and the factors are powers of two, so that every product is
// exact and the sums are the same in every language.

const n = process.argv.length > 2 ? Number.parseInt(process.argv[2]) : 20000

class Vec3 {
    readonly x: number
    readonly y: number
    readonly z: number

    constructor(x: number, y: number, z: number) {
        this.x = x
        this.y = y
        this.z = z
    }

    add(o: Vec3): Vec3 {
        return new Vec3(this.x + o.x, this.y + o.y, this.z + o.z)
    }

    scale(k: number): Vec3 {
        return new Vec3(this.x * k, this.y * k, this.z * k)
    }
}

class Particle {
    pos: Vec3
    vel: Vec3

    constructor(pos: Vec3, vel: Vec3) {
        this.pos = pos
        this.vel = vel
    }
}

const dt = 1.0 / 64
const gravity = new Vec3(0, -9.75, 0)
const particles: Particle[] = []
for (let i = 0; i < 1000; i++) {
    const pos = new Vec3(i % 10, 50 + (i % 7), i % 13)
    const vel = new Vec3((i % 5) - 2, i % 3, (i % 3) - 1)
    particles.push(new Particle(pos, vel))
}

for (let step = 0; step < n; step++) {
    for (const p of particles) {
        p.vel = p.vel.add(gravity.scale(dt))
        p.pos = p.pos.add(p.vel.scale(dt))
        if (p.pos.y < 0) {
            p.pos = new Vec3(p.pos.x, -p.pos.y, p.pos.z)
            p.vel = new Vec3(p.vel.x, -p.vel.y * 0.5, p.vel.z)
        }
    }
}

let sum = 0.0
for (const p of particles) sum += p.pos.x + p.pos.y + p.pos.z
console.log(Math.floor(sum * 1024))
