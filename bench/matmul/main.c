// Matmul: multiplies two n×n matrices of f64 stored in flat arrays with the
// naive triple loop. The entries are multiples of 1/8, so every sum is exact
// and the checksums do not depend on the order of the additions.
#include <stdio.h>
#include <stdlib.h>

int main(int argc, char **argv) {
    long n = argc > 1 ? atol(argv[1]) : 800;

    double *a = malloc(n * n * sizeof *a);
    double *b = malloc(n * n * sizeof *b);
    double *c = malloc(n * n * sizeof *c);
    for (long i = 0; i < n; i++) {
        for (long j = 0; j < n; j++) {
            a[i * n + j] = (double)((i * j) % 17 - 3) / 8;
            b[i * n + j] = (double)((i + j) % 13 - 4) / 4;
            c[i * n + j] = 0;
        }
    }

    for (long i = 0; i < n; i++) {
        for (long j = 0; j < n; j++) {
            double sum = 0.0;
            for (long k = 0; k < n; k++) sum += a[i * n + k] * b[k * n + j];
            c[i * n + j] = sum;
        }
    }

    double total = 0.0, weighted = 0.0;
    for (long i = 0; i < n * n; i++) {
        total += c[i];
        weighted += c[i] * (double)(i % 7 + 1);
    }
    printf("%.6f %.6f\n", total, weighted);
    return 0;
}
