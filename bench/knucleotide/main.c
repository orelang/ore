// K-nucleotide from the Computer Language Benchmarks Game: generates a DNA
// sequence of n nucleotides with the fasta generator, counts its k-mers in
// hash tables keyed by the k bytes, and prints the counts of the 1- and
// 2-mers, most frequent first, and those of the five sequences the game asks
// for. C has no map, so the table is a small open-addressing one.
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static char *sequence;
static long length;

typedef struct {
    const char *key; // k bytes in the sequence, or NULL for an empty slot
    long count;
} Entry;

typedef struct {
    Entry *entries;
    long capacity; // a power of two
    long size;
    long k;
} Table;

static uint32_t hash(const char *key, long k) {
    uint32_t h = 2166136261u;
    for (long i = 0; i < k; i++) h = (h ^ (uint8_t)key[i]) * 16777619u;
    return h;
}

static Entry *find(Table *t, const char *key) {
    long mask = t->capacity - 1;
    for (long i = hash(key, t->k) & mask;; i = (i + 1) & mask) {
        Entry *e = &t->entries[i];
        if (e->key == NULL || memcmp(e->key, key, t->k) == 0) return e;
    }
}

static void grow(Table *t) {
    Entry *old = t->entries;
    long capacity = t->capacity;
    t->capacity *= 2;
    t->entries = calloc(t->capacity, sizeof *t->entries);
    for (long i = 0; i < capacity; i++) {
        if (old[i].key != NULL) *find(t, old[i].key) = old[i];
    }
    free(old);
}

static Table count(long k) {
    Table t = {calloc(64, sizeof(Entry)), 64, 0, k};
    for (long i = 0; i + k <= length; i++) {
        Entry *e = find(&t, sequence + i);
        if (e->key == NULL) {
            e->key = sequence + i;
            t.size++;
            if (t.size * 2 > t.capacity) {
                grow(&t);
                e = find(&t, sequence + i);
            }
        }
        e->count++;
    }
    return t;
}

static long sort_k;

static int compare(const void *a, const void *b) {
    const Entry *x = a, *y = b;
    if (x->count != y->count) return x->count > y->count ? -1 : 1;
    return memcmp(x->key, y->key, sort_k);
}

static void frequencies(long k) {
    Table t = count(k);
    Entry *entries = malloc(t.size * sizeof *entries);
    long size = 0;
    for (long i = 0; i < t.capacity; i++) {
        if (t.entries[i].key != NULL) entries[size++] = t.entries[i];
    }
    sort_k = k;
    qsort(entries, size, sizeof *entries, compare);
    for (long i = 0; i < size; i++) printf("%.*s:%ld ", (int)k, entries[i].key, entries[i].count);
}

int main(int argc, char **argv) {
    long n = argc > 1 ? atol(argv[1]) : 2000000;

    // The generator of fasta, choosing a nucleotide by integer weights out of 139968.
    long seed = 42;
    sequence = malloc(n + 1);
    for (long i = 0; i < n; i++) {
        seed = (seed * 3877 + 29573) % 139968;
        sequence[i] = seed < 42398 ? 'A' : seed < 70391 ? 'C' : seed < 98384 ? 'G' : 'T';
    }
    sequence[n] = 0;
    length = n;

    frequencies(1);
    frequencies(2);
    const char *keys[] = {"GGT", "GGTA", "GGTATT", "GGTATTTTAATT", "GGTATTTTAATTTATAGT"};
    for (int i = 0; i < 5; i++) {
        long k = (long)strlen(keys[i]);
        Table t = count(k);
        Entry *e = find(&t, keys[i]);
        printf("%s:%ld%s", keys[i], e->key == NULL ? 0 : e->count, i < 4 ? " " : "\n");
    }
    return 0;
}
