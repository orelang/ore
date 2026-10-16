// Mandelbrot from the Computer Language Benchmarks Game: computes the n×n
// bitmap of the set, one bit per pixel, and prints its FNV-1a hash instead of
// the PBM file.
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

// Fusing a multiply and an add would round differently from the other
// languages and change pixels on the border of the set.
#pragma STDC FP_CONTRACT OFF

int main(int argc, char **argv) {
    long n = argc > 1 ? atol(argv[1]) : 4000;

    long size = 0;
    uint8_t *bitmap = malloc(n * ((n + 7) / 8));
    for (long y = 0; y < n; y++) {
        double ci = 2.0 * (double)y / (double)n - 1.0;
        int bits = 0;
        for (long x = 0; x < n; x++) {
            double cr = 2.0 * (double)x / (double)n - 1.5;
            double zr = 0.0, zi = 0.0, tr = 0.0, ti = 0.0;
            for (int i = 0; i < 50 && tr + ti <= 4.0; i++) {
                zi = 2.0 * zr * zi + ci;
                zr = tr - ti + cr;
                tr = zr * zr;
                ti = zi * zi;
            }
            bits <<= 1;
            if (tr + ti <= 4.0) bits |= 1;
            if (x % 8 == 7) {
                bitmap[size++] = (uint8_t)bits;
                bits = 0;
            }
        }
        if (n % 8 != 0) bitmap[size++] = (uint8_t)(bits << (8 - n % 8));
    }

    uint32_t hash = 2166136261u;
    for (long i = 0; i < size; i++) hash = (hash ^ bitmap[i]) * 16777619u;
    printf("%ld %ld %u\n", n, size, hash);
    return 0;
}
