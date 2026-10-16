// Small value objects: particles under gravity bouncing on the floor, moved
// with a 3D vector struct passed and returned by value. The time step and
// the factors are powers of two, so that every product is exact and the sums
// are the same in every language.
#include <math.h>
#include <stdio.h>
#include <stdlib.h>

typedef struct {
    double x, y, z;
} vec3;

static vec3 add(vec3 a, vec3 b) { return (vec3){a.x + b.x, a.y + b.y, a.z + b.z}; }
static vec3 scale(vec3 v, double k) { return (vec3){v.x * k, v.y * k, v.z * k}; }

typedef struct {
    vec3 pos, vel;
} particle;

int main(int argc, char **argv) {
    long n = argc > 1 ? atol(argv[1]) : 20000;

    const double dt = 1.0 / 64;
    const vec3 gravity = {0, -9.75, 0};
    static particle particles[1000];
    for (int i = 0; i < 1000; i++) {
        particles[i].pos = (vec3){i % 10, 50 + i % 7, i % 13};
        particles[i].vel = (vec3){i % 5 - 2, i % 3, i % 3 - 1};
    }

    for (long step = 0; step < n; step++) {
        for (int i = 0; i < 1000; i++) {
            particle *p = &particles[i];
            p->vel = add(p->vel, scale(gravity, dt));
            p->pos = add(p->pos, scale(p->vel, dt));
            if (p->pos.y < 0) {
                p->pos = (vec3){p->pos.x, -p->pos.y, p->pos.z};
                p->vel = (vec3){p->vel.x, -p->vel.y * 0.5, p->vel.z};
            }
        }
    }

    double sum = 0.0;
    for (int i = 0; i < 1000; i++) sum += particles[i].pos.x + particles[i].pos.y + particles[i].pos.z;
    printf("%lld\n", (long long)floor(sum * 1024));
    return 0;
}
