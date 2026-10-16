// Fannkuch-redux from the Computer Language Benchmarks Game: flips prefixes
// of every permutation of 1..n, on small integer arrays.
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void fannkuch(int n, long *checksumOut, int *maxFlipsOut) {
    int *perm1 = malloc(n * sizeof(int));
    int *perm = malloc(n * sizeof(int));
    int *count = malloc(n * sizeof(int));
    for (int i = 0; i < n; i++) perm1[i] = i;
    int maxFlips = 0;
    long checksum = 0, permCount = 0;
    int r = n;
    for (;;) {
        while (r != 1) {
            count[r - 1] = r;
            r--;
        }
        memcpy(perm, perm1, n * sizeof(int));
        int flips = 0;
        for (int k = perm[0]; k != 0; k = perm[0]) {
            for (int i = 0, j = k; i < j; i++, j--) {
                int t = perm[i];
                perm[i] = perm[j];
                perm[j] = t;
            }
            flips++;
        }
        if (flips > maxFlips) maxFlips = flips;
        if (permCount % 2 == 0) checksum += flips;
        else checksum -= flips;
        // The next permutation, in the order the checksum depends on.
        for (;;) {
            if (r == n) {
                free(perm1);
                free(perm);
                free(count);
                *checksumOut = checksum;
                *maxFlipsOut = maxFlips;
                return;
            }
            int first = perm1[0];
            for (int i = 0; i < r; i++) perm1[i] = perm1[i + 1];
            perm1[r] = first;
            count[r]--;
            if (count[r] > 0) break;
            r++;
        }
        permCount++;
    }
}

int main(int argc, char **argv) {
    int n = argc > 1 ? atoi(argv[1]) : 11;
    long checksum;
    int maxFlips;
    fannkuch(n, &checksum, &maxFlips);
    printf("%ld Pfannkuchen(%d) = %d\n", checksum, n, maxFlips);
    return 0;
}
