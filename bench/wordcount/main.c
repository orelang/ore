// Word count: generates a text of made-up words, splits it into lines and
// words, counts them in a hash table and prints the ten most frequent.
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
    const char *word;
    size_t len;
    long count;
} entry;

// An open-addressing hash table of words, kept at most half full.
static entry *table;
static size_t capacity, used;

static uint64_t hash(const char *s, size_t len) {
    uint64_t h = 14695981039346656037u;
    for (size_t i = 0; i < len; i++) h = (h ^ (unsigned char)s[i]) * 1099511628211u;
    return h;
}

static void grow(void) {
    entry *old = table;
    size_t oldCapacity = capacity;
    capacity = capacity ? 2 * capacity : 64;
    table = calloc(capacity, sizeof(entry));
    for (size_t j = 0; j < oldCapacity; j++) {
        if (!old[j].word) continue;
        size_t i = hash(old[j].word, old[j].len) & (capacity - 1);
        while (table[i].word) i = (i + 1) & (capacity - 1);
        table[i] = old[j];
    }
    free(old);
}

// Counts one word, given by its start and length in the text.
static void count(const char *word, size_t len) {
    if (2 * (used + 1) > capacity) grow();
    size_t i = hash(word, len) & (capacity - 1);
    while (table[i].word) {
        if (table[i].len == len && memcmp(table[i].word, word, len) == 0) {
            table[i].count++;
            return;
        }
        i = (i + 1) & (capacity - 1);
    }
    table[i] = (entry){word, len, 1};
    used++;
}

static int compare(const void *x, const void *y) {
    const entry *a = x, *b = y;
    if (a->count != b->count) return a->count > b->count ? -1 : 1;
    size_t len = a->len < b->len ? a->len : b->len;
    int c = memcmp(a->word, b->word, len);
    if (c != 0) return c;
    return a->len < b->len ? -1 : a->len > b->len;
}

int main(int argc, char **argv) {
    long n = argc > 1 ? atol(argv[1]) : 2000000;

    // Words of one to three syllables, picked by a Lehmer generator.
    static const char *syllables[] = {"ka", "lo", "mi", "ne", "ru", "so", "ti", "va"};
    int64_t seed = 42;
    char *text = malloc(7 * (size_t)n + 1);
    size_t length = 0;
    for (long i = 0; i < n; i++) {
        seed = (seed * 48271) % 2147483647;
        if (i > 0) text[length++] = i % 10 == 0 ? '\n' : ' ';
        memcpy(text + length, syllables[(seed >> 2) % 8], 2);
        length += 2;
        if (seed % 3 > 0) {
            memcpy(text + length, syllables[(seed >> 5) % 8], 2);
            length += 2;
        }
        if (seed % 3 > 1) {
            memcpy(text + length, syllables[(seed >> 8) % 8], 2);
            length += 2;
        }
    }
    text[length] = 0;

    // Lines, then words, cut in place.
    char *line = text;
    while (line) {
        char *end = strchr(line, '\n');
        if (end) *end = 0;
        char *word = line;
        for (;;) {
            char *space = strchr(word, ' ');
            if (!space) {
                count(word, strlen(word));
                break;
            }
            count(word, (size_t)(space - word));
            word = space + 1;
        }
        line = end ? end + 1 : NULL;
    }

    // The most frequent first, ties in alphabetical order.
    entry *entries = malloc(used * sizeof(entry));
    size_t k = 0;
    for (size_t i = 0; i < capacity; i++)
        if (table[i].word) entries[k++] = table[i];
    qsort(entries, used, sizeof(entry), compare);
    printf("%ld %zu", n, used);
    for (size_t i = 0; i < 10 && i < used; i++)
        printf(" %.*s:%ld", (int)entries[i].len, entries[i].word, entries[i].count);
    printf("\n");
    return 0;
}
