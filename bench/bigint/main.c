// BigInt: the factorial of n by multiplication and the Fibonacci number of
// 10n by addition, printing the number of digits and the sum of the digits
// of the factorial, and the number of digits and the last twelve digits of
// the Fibonacci number. C has no big integers, so this is a minimal one:
// non-negative numbers in base 10^9, least significant limb first.
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define BASE 1000000000u

typedef struct {
    uint32_t *limbs;
    size_t len;
} bignum;

static bignum fromSmall(uint32_t x) {
    bignum b = {malloc(sizeof(uint32_t)), 1};
    b.limbs[0] = x;
    return b;
}

// Multiplies b by a number below 2^32, in place.
static void mulSmall(bignum *b, uint32_t m) {
    uint64_t carry = 0;
    for (size_t i = 0; i < b->len; i++) {
        uint64_t t = (uint64_t)b->limbs[i] * m + carry;
        b->limbs[i] = (uint32_t)(t % BASE);
        carry = t / BASE;
    }
    while (carry) {
        b->limbs = realloc(b->limbs, (b->len + 1) * sizeof(uint32_t));
        b->limbs[b->len++] = (uint32_t)(carry % BASE);
        carry /= BASE;
    }
}

// a + b as a new number.
static bignum add(bignum a, bignum b) {
    if (a.len < b.len) {
        bignum t = a;
        a = b;
        b = t;
    }
    bignum r = {malloc((a.len + 1) * sizeof(uint32_t)), a.len};
    uint32_t carry = 0;
    for (size_t i = 0; i < a.len; i++) {
        uint32_t t = a.limbs[i] + (i < b.len ? b.limbs[i] : 0) + carry;
        carry = t >= BASE;
        r.limbs[i] = carry ? t - BASE : t;
    }
    if (carry) r.limbs[r.len++] = carry;
    return r;
}

// The decimal digits of b.
static char *toString(bignum b) {
    char *s = malloc(b.len * 9 + 1);
    size_t at = (size_t)sprintf(s, "%u", b.limbs[b.len - 1]);
    for (size_t i = b.len - 1; i-- > 0;) at += (size_t)sprintf(s + at, "%09u", b.limbs[i]);
    return s;
}

int main(int argc, char **argv) {
    long n = argc > 1 ? atol(argv[1]) : 20000;

    bignum factorial = fromSmall(1);
    for (long i = 2; i <= n; i++) mulSmall(&factorial, (uint32_t)i);
    char *text = toString(factorial);
    size_t length = strlen(text);
    long digitSum = 0;
    for (size_t i = 0; i < length; i++) digitSum += text[i] - 48;

    bignum a = fromSmall(0), b = fromSmall(1);
    for (long i = 0; i < 10 * n; i++) {
        bignum c = add(a, b);
        free(a.limbs);
        a = b;
        b = c;
    }

    char *fib = toString(a);
    uint64_t last = a.limbs[0] + (a.len > 1 ? (uint64_t)(a.limbs[1] % 1000) * BASE : 0);
    printf("%zu %ld %zu %llu\n", length, digitSum, strlen(fib), (unsigned long long)last);
    return 0;
}
