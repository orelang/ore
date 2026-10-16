// Closures: chains of map, filter and reduce over an array of a million
// integers, repeated. C has no closures, so the callbacks are function
// pointers that take the captured variables in a context.
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

typedef struct {
    int64_t k, round, skip;
} context;

typedef struct {
    int64_t *items;
    size_t len, cap;
} array;

static array map(array xs, int64_t (*f)(const context *, int64_t), const context *c) {
    array out = {malloc(xs.len * sizeof(int64_t)), xs.len, xs.len};
    for (size_t i = 0; i < xs.len; i++) out.items[i] = f(c, xs.items[i]);
    return out;
}

static array filter(array xs, int (*f)(const context *, int64_t), const context *c) {
    array out = {NULL, 0, 0};
    for (size_t i = 0; i < xs.len; i++) {
        if (!f(c, xs.items[i])) continue;
        if (out.len == out.cap) {
            out.cap = out.cap ? 2 * out.cap : 8;
            out.items = realloc(out.items, out.cap * sizeof(int64_t));
        }
        out.items[out.len++] = xs.items[i];
    }
    return out;
}

static int64_t reduce(array xs, int64_t (*f)(const context *, int64_t, int64_t), int64_t initial,
                      const context *c) {
    int64_t acc = initial;
    for (size_t i = 0; i < xs.len; i++) acc = f(c, acc, xs.items[i]);
    return acc;
}

static int64_t scale(const context *c, int64_t x) { return x * c->k + c->round; }
static int keep(const context *c, int64_t x) { return x % c->skip != 0; }
static int64_t add(const context *c, int64_t sum, int64_t x) {
    (void)c;
    return sum + x % 1000;
}

int main(int argc, char **argv) {
    long n = argc > 1 ? atol(argv[1]) : 30;

    array xs = {malloc(1000000 * sizeof(int64_t)), 1000000, 1000000};
    for (int64_t i = 0; i < 1000000; i++) xs.items[i] = (i * 7919) % 1000;

    int64_t total = 0;
    for (long round = 0; round < n; round++) {
        context c = {round % 7 + 1, round, round % 5 + 2};
        array mapped = map(xs, scale, &c);
        array kept = filter(mapped, keep, &c);
        total += reduce(kept, add, 0, &c);
        free(mapped.items);
        free(kept.items);
    }
    printf("%lld\n", (long long)total);
    return 0;
}
