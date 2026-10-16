// Dynamic dispatch: sums the areas and perimeters of an array of shapes of
// four classes behind one interface, over and over.

const n = process.argv.length > 2 ? Number.parseInt(process.argv[2]) : 200000

interface Shape {
    area(): number
    perimeter(): number
}

class Circle implements Shape {
    r: number
    constructor(r: number) {
        this.r = r
    }
    area(): number {
        return Math.PI * this.r * this.r
    }
    perimeter(): number {
        return 2 * Math.PI * this.r
    }
}

class Rect implements Shape {
    w: number
    h: number
    constructor(w: number, h: number) {
        this.w = w
        this.h = h
    }
    area(): number {
        return this.w * this.h
    }
    perimeter(): number {
        return 2 * (this.w + this.h)
    }
}

class Square implements Shape {
    side: number
    constructor(side: number) {
        this.side = side
    }
    area(): number {
        return this.side * this.side
    }
    perimeter(): number {
        return 4 * this.side
    }
}

class Triangle implements Shape {
    a: number
    b: number
    constructor(a: number, b: number) {
        this.a = a
        this.b = b
    }
    area(): number {
        return 0.5 * this.a * this.b
    }
    perimeter(): number {
        return this.a + this.b + Math.sqrt(this.a * this.a + this.b * this.b)
    }
}

// A thousand shapes of sizes 1 to 10, picked by a Lehmer generator.
let seed = 42
function next(): number {
    seed = (seed * 48271) % 2147483647
    return 1 + (seed % 10)
}
const shapes: Shape[] = []
for (let i = 0; i < 1000; i++) {
    switch (i % 4) {
        case 0:
            shapes.push(new Circle(next()))
            break
        case 1:
            shapes.push(new Rect(next(), next()))
            break
        case 2:
            shapes.push(new Square(next()))
            break
        default:
            shapes.push(new Triangle(next(), next()))
    }
}
// Shuffled, so that the calls do not repeat in a pattern.
for (let i = shapes.length - 1; i > 0; i--) {
    seed = (seed * 48271) % 2147483647
    const j = seed % (i + 1)
    const t = shapes[i]
    shapes[i] = shapes[j]
    shapes[j] = t
}

let total = 0.0
for (let pass = 0; pass < n; pass++) {
    for (const s of shapes) total += s.area() + s.perimeter()
}
console.log(Math.floor(total))
