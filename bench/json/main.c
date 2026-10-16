// JSON: writes an array of objects as text, reads it back into structs and
// sums their fields.
//
// The C standard library has no JSON, so the writer and the reader are written
// by hand for this one shape (an array of objects with an integer, a string, a
// number, a boolean and an array of strings), as a C program without a
// library would do it. The reader still skips whitespace, takes the keys in
// any order and decodes string escapes, so it reads any JSON of this shape,
// not only the text the writer made.
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
    long id;
    char *name;
    double score;
    bool active;
    char **tags;
    long tagCount;
} Item;

// A growable byte buffer.
typedef struct {
    char *data;
    size_t length, capacity;
} Buffer;

static void reserve(Buffer *b, size_t extra) {
    if (b->length + extra <= b->capacity) return;
    size_t capacity = b->capacity == 0 ? 64 : b->capacity;
    while (capacity < b->length + extra) capacity *= 2;
    b->data = realloc(b->data, capacity);
    b->capacity = capacity;
}

static void append(Buffer *b, const char *s, size_t n) {
    reserve(b, n);
    memcpy(b->data + b->length, s, n);
    b->length += n;
}

static void appendString(Buffer *b, const char *s) {
    append(b, s, strlen(s));
}

static void appendQuoted(Buffer *b, const char *s) {
    appendString(b, "\"");
    for (const char *p = s; *p; p++) {
        unsigned char c = (unsigned char)*p;
        if (c == '"' || c == '\\') {
            char escaped[2] = {'\\', (char)c};
            append(b, escaped, 2);
        } else if (c < 0x20) {
            char escaped[8];
            snprintf(escaped, sizeof escaped, "\\u%04x", c);
            appendString(b, escaped);
        } else {
            append(b, p, 1);
        }
    }
    appendString(b, "\"");
}

// Writes the shortest decimal that reads back as the same double, without an
// exponent, as JSON.stringify and Go's FormatFloat(x, 'f', -1, 64) do for
// numbers of this size.
static void formatNumber(char *out, size_t size, double x) {
    for (int precision = 0; precision <= 17; precision++) {
        snprintf(out, size, "%.*f", precision, x);
        if (strtod(out, NULL) == x) return;
    }
}

static void appendNumber(Buffer *b, double x) {
    char text[64];
    formatNumber(text, sizeof text, x);
    appendString(b, text);
}

static void appendInteger(Buffer *b, long x) {
    char text[24];
    snprintf(text, sizeof text, "%ld", x);
    appendString(b, text);
}

static void stringify(Buffer *b, const Item *items, long count) {
    appendString(b, "[");
    for (long i = 0; i < count; i++) {
        const Item *item = &items[i];
        if (i > 0) appendString(b, ",");
        appendString(b, "{\"id\":");
        appendInteger(b, item->id);
        appendString(b, ",\"name\":");
        appendQuoted(b, item->name);
        appendString(b, ",\"score\":");
        appendNumber(b, item->score);
        appendString(b, item->active ? ",\"active\":true" : ",\"active\":false");
        appendString(b, ",\"tags\":[");
        for (long t = 0; t < item->tagCount; t++) {
            if (t > 0) appendString(b, ",");
            appendQuoted(b, item->tags[t]);
        }
        appendString(b, "]}");
    }
    appendString(b, "]");
}

// The reader: a cursor over the text that stops the program on bad input.
typedef struct {
    const char *at;
} Reader;

static void fail(const char *what) {
    fprintf(stderr, "bad JSON: %s\n", what);
    exit(1);
}

static void skipSpace(Reader *r) {
    while (*r->at == ' ' || *r->at == '\t' || *r->at == '\n' || *r->at == '\r') r->at++;
}

static void expect(Reader *r, char c) {
    skipSpace(r);
    if (*r->at != c) fail("unexpected character");
    r->at++;
}

// Reads the next character if it is c.
static bool accept(Reader *r, char c) {
    skipSpace(r);
    if (*r->at != c) return false;
    r->at++;
    return true;
}

static void appendUtf8(Buffer *b, unsigned code) {
    char bytes[4];
    size_t n;
    if (code < 0x80) {
        bytes[0] = (char)code;
        n = 1;
    } else if (code < 0x800) {
        bytes[0] = (char)(0xC0 | code >> 6);
        bytes[1] = (char)(0x80 | (code & 0x3F));
        n = 2;
    } else if (code < 0x10000) {
        bytes[0] = (char)(0xE0 | code >> 12);
        bytes[1] = (char)(0x80 | (code >> 6 & 0x3F));
        bytes[2] = (char)(0x80 | (code & 0x3F));
        n = 3;
    } else {
        bytes[0] = (char)(0xF0 | code >> 18);
        bytes[1] = (char)(0x80 | (code >> 12 & 0x3F));
        bytes[2] = (char)(0x80 | (code >> 6 & 0x3F));
        bytes[3] = (char)(0x80 | (code & 0x3F));
        n = 4;
    }
    append(b, bytes, n);
}

static unsigned readHex4(Reader *r) {
    char digits[5] = {0};
    for (int i = 0; i < 4; i++) {
        if (r->at[i] == '\0') fail("short escape");
        digits[i] = r->at[i];
    }
    r->at += 4;
    return (unsigned)strtoul(digits, NULL, 16);
}

// Reads a string into a new NUL-terminated copy.
static char *readString(Reader *r) {
    expect(r, '"');
    const char *start = r->at;
    while (*r->at != '"' && *r->at != '\\') {
        if (*r->at == '\0') fail("unterminated string");
        r->at++;
    }
    if (*r->at == '"') {
        // No escapes: copy the bytes as they are.
        size_t n = (size_t)(r->at - start);
        char *s = malloc(n + 1);
        memcpy(s, start, n);
        s[n] = '\0';
        r->at++;
        return s;
    }
    Buffer b = {0};
    append(&b, start, (size_t)(r->at - start));
    while (*r->at != '"') {
        char c = *r->at++;
        if (c == '\0') fail("unterminated string");
        if (c != '\\') {
            append(&b, &c, 1);
            continue;
        }
        c = *r->at++;
        switch (c) {
        case '"': case '\\': case '/': append(&b, &c, 1); break;
        case 'b': append(&b, "\b", 1); break;
        case 'f': append(&b, "\f", 1); break;
        case 'n': append(&b, "\n", 1); break;
        case 'r': append(&b, "\r", 1); break;
        case 't': append(&b, "\t", 1); break;
        case 'u': {
            unsigned code = readHex4(r);
            if (code >= 0xD800 && code < 0xDC00 && r->at[0] == '\\' && r->at[1] == 'u') {
                r->at += 2;
                unsigned low = readHex4(r);
                code = 0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00);
            }
            appendUtf8(&b, code);
            break;
        }
        default: fail("bad escape");
        }
    }
    r->at++;
    append(&b, "", 1);
    return b.data;
}

static double readNumber(Reader *r) {
    skipSpace(r);
    char *end;
    double x = strtod(r->at, &end);
    if (end == r->at) fail("expected a number");
    r->at = end;
    return x;
}

static bool readBool(Reader *r) {
    skipSpace(r);
    if (strncmp(r->at, "true", 4) == 0) {
        r->at += 4;
        return true;
    }
    if (strncmp(r->at, "false", 5) == 0) {
        r->at += 5;
        return false;
    }
    fail("expected a boolean");
    return false;
}

static void readItem(Reader *r, Item *item) {
    *item = (Item){0};
    expect(r, '{');
    if (accept(r, '}')) return;
    do {
        char *key = readString(r);
        expect(r, ':');
        if (strcmp(key, "id") == 0) {
            item->id = (long)readNumber(r);
        } else if (strcmp(key, "name") == 0) {
            item->name = readString(r);
        } else if (strcmp(key, "score") == 0) {
            item->score = readNumber(r);
        } else if (strcmp(key, "active") == 0) {
            item->active = readBool(r);
        } else if (strcmp(key, "tags") == 0) {
            expect(r, '[');
            long capacity = 0;
            if (!accept(r, ']')) {
                do {
                    if (item->tagCount == capacity) {
                        capacity = capacity == 0 ? 2 : capacity * 2;
                        item->tags = realloc(item->tags, capacity * sizeof(char *));
                    }
                    item->tags[item->tagCount++] = readString(r);
                } while (accept(r, ','));
                expect(r, ']');
            }
        } else {
            fail("unknown key");
        }
        free(key);
    } while (accept(r, ','));
    expect(r, '}');
}

static Item *parse(const char *text, long *count) {
    Reader r = {text};
    long capacity = 0;
    Item *items = NULL;
    *count = 0;
    expect(&r, '[');
    if (!accept(&r, ']')) {
        do {
            if (*count == capacity) {
                capacity = capacity == 0 ? 16 : capacity * 2;
                items = realloc(items, capacity * sizeof(Item));
            }
            readItem(&r, &items[(*count)++]);
        } while (accept(&r, ','));
        expect(&r, ']');
    }
    skipSpace(&r);
    if (*r.at != '\0') fail("text after the value");
    return items;
}

static char *format(const char *pattern, long x) {
    int n = snprintf(NULL, 0, pattern, x);
    char *s = malloc((size_t)n + 1);
    snprintf(s, (size_t)n + 1, pattern, x);
    return s;
}

static char *copy(const char *s) {
    size_t n = strlen(s) + 1;
    return memcpy(malloc(n), s, n);
}

static void freeItems(Item *items, long count) {
    for (long i = 0; i < count; i++) {
        free(items[i].name);
        for (long t = 0; t < items[i].tagCount; t++) free(items[i].tags[t]);
        free(items[i].tags);
    }
    free(items);
}

int main(int argc, char **argv) {
    long n = argc > 1 ? atol(argv[1]) : 300000;

    Item *items = malloc(n * sizeof(Item));
    for (long i = 0; i < n; i++) {
        char **tags = malloc(2 * sizeof(char *));
        tags[0] = copy("a");
        tags[1] = format("t%ld", i % 10);
        items[i] = (Item){i, format("item %ld", i), (double)(i % 100) * 0.5, i % 3 == 0, tags, 2};
    }
    Buffer text = {0};
    stringify(&text, items, n);
    append(&text, "", 1);
    size_t length = text.length - 1;

    long count;
    Item *parsed = parse(text.data, &count);
    long ids = 0, active = 0, tags = 0;
    double score = 0.0;
    for (long i = 0; i < count; i++) {
        ids += parsed[i].id;
        score += parsed[i].score;
        if (parsed[i].active) active++;
        tags += parsed[i].tagCount + (long)strlen(parsed[i].name);
    }
    char scoreText[64];
    formatNumber(scoreText, sizeof scoreText, score);
    printf("%zu %ld %ld %s %ld %ld\n", length, count, ids, scoreText, active, tags);

    freeItems(items, n);
    freeItems(parsed, count);
    free(text.data);
    return 0;
}
