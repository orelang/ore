// N-queens: counts the ways to place n queens on an n×n board, once by
// recursion over small arrays of the taken columns and diagonals, once by
// recursion over bitmasks.
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>

static long place(long row, long n, bool *columns, bool *down, bool *up) {
    if (row == n) return 1;
    long count = 0;
    for (long column = 0; column < n; column++) {
        long d = row + column;
        long u = row - column + n - 1;
        if (columns[column] || down[d] || up[u]) continue;
        columns[column] = true;
        down[d] = true;
        up[u] = true;
        count += place(row + 1, n, columns, down, up);
        columns[column] = false;
        down[d] = false;
        up[u] = false;
    }
    return count;
}

static long place_bits(long all, long columns, long left, long right) {
    if (columns == all) return 1;
    long count = 0;
    long free = all & ~(columns | left | right);
    while (free != 0) {
        long bit = free & -free;
        free ^= bit;
        count += place_bits(all, columns | bit, ((left | bit) << 1) & all, (right | bit) >> 1);
    }
    return count;
}

int main(int argc, char **argv) {
    long n = argc > 1 ? atol(argv[1]) : 13;
    bool *columns = calloc(n, sizeof *columns);
    bool *down = calloc(2 * n - 1, sizeof *down);
    bool *up = calloc(2 * n - 1, sizeof *up);
    printf("%ld %ld %ld\n", n, place(0, n, columns, down, up), place_bits((1L << n) - 1, 0, 0, 0));
    return 0;
}
