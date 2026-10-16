// Strings: builds a long string by concatenation and by joining parts, then
// splits, scans and searches it. Strings are NUL-terminated byte arrays; the
// long one grows by doubling, and splitting makes pointer and length pairs
// into the text, as a slice of a Go string would be.
#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
    char *data;
    size_t length, capacity;
} Builder;

static void builderAppend(Builder *b, const char *s, size_t n) {
    if (b->length + n + 1 > b->capacity) {
        size_t capacity = b->capacity == 0 ? 64 : b->capacity;
        while (capacity < b->length + n + 1) capacity *= 2;
        b->data = realloc(b->data, capacity);
        b->capacity = capacity;
    }
    memcpy(b->data + b->length, s, n);
    b->length += n;
    b->data[b->length] = '\0';
}

typedef struct {
    const char *start;
    size_t length;
} Slice;

// Splits text at each separator byte into a new array of slices.
static Slice *split(const char *text, size_t length, char separator, size_t *count) {
    size_t capacity = 16;
    Slice *parts = malloc(capacity * sizeof(Slice));
    *count = 0;
    const char *start = text;
    const char *end = text + length;
    for (;;) {
        const char *at = memchr(start, separator, (size_t)(end - start));
        if (*count == capacity) {
            capacity *= 2;
            parts = realloc(parts, capacity * sizeof(Slice));
        }
        if (at == NULL) {
            parts[(*count)++] = (Slice){start, (size_t)(end - start)};
            return parts;
        }
        parts[(*count)++] = (Slice){start, (size_t)(at - start)};
        start = at + 1;
    }
}

int main(int argc, char **argv) {
    long n = argc > 1 ? atol(argv[1]) : 2000000;

    // Concatenation, one small piece at a time.
    Builder text = {0};
    char piece[32];
    for (long i = 0; i < n; i++) {
        int length = snprintf(piece, sizeof piece, "%ld,", i % 1000);
        builderAppend(&text, piece, (size_t)length);
    }

    // Joining parts made by formatting and upper-casing.
    char **parts = malloc(n * sizeof(char *));
    size_t total = 0;
    for (long i = 0; i < n; i++) {
        int length = snprintf(piece, sizeof piece, "item-%ld", i);
        char *part = malloc((size_t)length + 1);
        for (int k = 0; k <= length; k++) part[k] = (char)toupper((unsigned char)piece[k]);
        parts[i] = part;
        total += (size_t)length;
    }
    if (n > 0) total += (size_t)(n - 1);
    char *joined = malloc(total + 1);
    char *at = joined;
    for (long i = 0; i < n; i++) {
        if (i > 0) *at++ = ';';
        size_t length = strlen(parts[i]);
        memcpy(at, parts[i], length);
        at += length;
    }
    *at = '\0';

    // Counting: separators by splitting, a byte by scanning, a word by searching.
    size_t fields;
    Slice *pieces = split(text.data, text.length, ',', &fields);
    long sevens = 0;
    for (size_t i = 0; i < total; i++)
        if (joined[i] == '7') sevens++;
    long items = 0;
    for (const char *found = strstr(joined, "ITEM-9"); found != NULL; found = strstr(found + 1, "ITEM-9")) items++;
    printf("%zu %zu %zu %ld %ld\n", text.length, total, fields, sevens, items);

    free(pieces);
    for (long i = 0; i < n; i++) free(parts[i]);
    free(parts);
    free(joined);
    free(text.data);
    return 0;
}
