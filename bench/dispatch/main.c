// Dynamic dispatch: sums the areas and perimeters of an array of shapes of
// four kinds through tables of function pointers, over and over.
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

typedef struct shape shape;

// The methods of a kind of shape.
typedef struct {
    double (*area)(const shape *);
    double (*perimeter)(const shape *);
} vtable;

// Each kind of shape starts with its table.
struct shape {
    const vtable *vt;
};

static const double pi = 3.141592653589793;

typedef struct {
    shape base;
    double r;
} circle;
static double circleArea(const shape *s) { return pi * ((const circle *)s)->r * ((const circle *)s)->r; }
static double circlePerimeter(const shape *s) { return 2 * pi * ((const circle *)s)->r; }
static const vtable circleTable = {circleArea, circlePerimeter};

typedef struct {
    shape base;
    double w, h;
} rect;
static double rectArea(const shape *s) { return ((const rect *)s)->w * ((const rect *)s)->h; }
static double rectPerimeter(const shape *s) { return 2 * (((const rect *)s)->w + ((const rect *)s)->h); }
static const vtable rectTable = {rectArea, rectPerimeter};

typedef struct {
    shape base;
    double side;
} square;
static double squareArea(const shape *s) { return ((const square *)s)->side * ((const square *)s)->side; }
static double squarePerimeter(const shape *s) { return 4 * ((const square *)s)->side; }
static const vtable squareTable = {squareArea, squarePerimeter};

typedef struct {
    shape base;
    double a, b;
} triangle;
static double triangleArea(const shape *s) { return 0.5 * ((const triangle *)s)->a * ((const triangle *)s)->b; }
static double trianglePerimeter(const shape *s) {
    const triangle *t = (const triangle *)s;
    return t->a + t->b + sqrt(t->a * t->a + t->b * t->b);
}
static const vtable triangleTable = {triangleArea, trianglePerimeter};

static int64_t seed = 42;
static double next(void) {
    seed = (seed * 48271) % 2147483647;
    return (double)(1 + seed % 10);
}

int main(int argc, char **argv) {
    long n = argc > 1 ? atol(argv[1]) : 200000;

    // A thousand shapes of sizes 1 to 10, picked by a Lehmer generator.
    shape *shapes[1000];
    for (int i = 0; i < 1000; i++) {
        switch (i % 4) {
        case 0: {
            circle *c = malloc(sizeof *c);
            *c = (circle){{&circleTable}, next()};
            shapes[i] = &c->base;
            break;
        }
        case 1: {
            rect *r = malloc(sizeof *r);
            double w = next();
            *r = (rect){{&rectTable}, w, next()};
            shapes[i] = &r->base;
            break;
        }
        case 2: {
            square *s = malloc(sizeof *s);
            *s = (square){{&squareTable}, next()};
            shapes[i] = &s->base;
            break;
        }
        default: {
            triangle *t = malloc(sizeof *t);
            double a = next();
            *t = (triangle){{&triangleTable}, a, next()};
            shapes[i] = &t->base;
        }
        }
    }
    // Shuffled, so that the calls do not repeat in a pattern.
    for (int i = 999; i > 0; i--) {
        seed = (seed * 48271) % 2147483647;
        int j = (int)(seed % (i + 1));
        shape *t = shapes[i];
        shapes[i] = shapes[j];
        shapes[j] = t;
    }

    double total = 0.0;
    for (long pass = 0; pass < n; pass++) {
        for (int i = 0; i < 1000; i++) {
            const shape *s = shapes[i];
            total += s->vt->area(s) + s->vt->perimeter(s);
        }
    }
    printf("%lld\n", (long long)floor(total));
    return 0;
}
