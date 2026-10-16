// Sort: sorts pseudo-random integers and then a fifth as many strings with
// the library's sort, and prints checksums of the sorted orders.
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// A 32-bit xorshift generator, the same in every language.
static uint32_t state = 2463534242u;

static long long next(void) {
    state ^= state << 13;
    state ^= state >> 17;
    state ^= state << 5;
    return (long long)(state >> 1);
}

static int compare_numbers(const void *a, const void *b) {
    long long x = *(const long long *)a, y = *(const long long *)b;
    return (x > y) - (x < y);
}

static int compare_words(const void *a, const void *b) {
    return strcmp(*(char *const *)a, *(char *const *)b);
}

int main(int argc, char **argv) {
    long long n = argc > 1 ? atoll(argv[1]) : 5000000;

    long long *numbers = malloc(n * sizeof *numbers);
    for (long long i = 0; i < n; i++) numbers[i] = next();
    qsort(numbers, n, sizeof *numbers, compare_numbers);
    long long sum = 0;
    for (long long i = 0; i < n; i++) sum = (sum * 31 + numbers[i]) % 1000000007;

    long long count = n / 5;
    char **words = malloc(count * sizeof *words);
    for (long long i = 0; i < count; i++) {
        char buffer[32];
        int length = snprintf(buffer, sizeof buffer, "w%lld", next());
        words[i] = malloc(length + 1);
        memcpy(words[i], buffer, length + 1);
    }
    qsort(words, count, sizeof *words, compare_words);
    long long hash = 0;
    for (long long i = 0; i < count; i++) {
        long long length = (long long)strlen(words[i]);
        hash = (hash * 31 + length * 256 + (unsigned char)words[i][length - 1]) % 1000000007;
    }

    printf("%lld %lld %s %s\n", sum, hash, words[0], words[count - 1]);
    return 0;
}
