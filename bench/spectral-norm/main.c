// The spectral norm of an infinite matrix, from the Computer Language
// Benchmarks Game: floating-point loops over arrays.
#include <math.h>
#include <stdio.h>
#include <stdlib.h>

static double a(long i, long j) {
    return 1.0 / (double)((i + j) * (i + j + 1) / 2 + i + 1);
}

static void multiplyAv(long n, const double *v, double *av) {
    for (long i = 0; i < n; i++) {
        double sum = 0.0;
        for (long j = 0; j < n; j++) sum += a(i, j) * v[j];
        av[i] = sum;
    }
}

static void multiplyAtv(long n, const double *v, double *atv) {
    for (long i = 0; i < n; i++) {
        double sum = 0.0;
        for (long j = 0; j < n; j++) sum += a(j, i) * v[j];
        atv[i] = sum;
    }
}

static void multiplyAtAv(long n, const double *v, double *out, double *tmp) {
    multiplyAv(n, v, tmp);
    multiplyAtv(n, tmp, out);
}

int main(int argc, char **argv) {
    long n = argc > 1 ? atol(argv[1]) : 4000;
    double *u = malloc(n * sizeof(double));
    double *v = malloc(n * sizeof(double));
    double *tmp = malloc(n * sizeof(double));
    for (long i = 0; i < n; i++) u[i] = 1;
    for (int i = 0; i < 10; i++) {
        multiplyAtAv(n, u, v, tmp);
        multiplyAtAv(n, v, u, tmp);
    }
    double vBv = 0.0, vv = 0.0;
    for (long i = 0; i < n; i++) {
        vBv += u[i] * v[i];
        vv += v[i] * v[i];
    }
    printf("%.9f\n", sqrt(vBv / vv));
    free(u);
    free(v);
    free(tmp);
    return 0;
}
