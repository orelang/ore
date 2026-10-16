// Maps: inserts, looks up and deletes integer and string keys, then iterates
// over what is left.
//
// The C standard library has no hash table, so each map is a simple one
// written here: open addressing with linear probing, a power-of-two number of
// slots that doubles when three quarters are used, and deletion by shifting
// the following entries back (no tombstones). Integer keys are spread by a
// Fibonacci multiplication, string keys hashed with FNV-1a; the map owns a
// copy of each string key.
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static size_t spread(uint64_t hash, int shift) {
    return (size_t)((hash * 0x9E3779B97F4A7C15ull) >> shift);
}

// The map from integers to integers.

typedef struct {
    long key, value;
    bool used;
} IntSlot;

typedef struct {
    IntSlot *slots;
    size_t mask, count;
    int shift;
} IntMap;

static void intInit(IntMap *m, int bits) {
    m->slots = calloc((size_t)1 << bits, sizeof(IntSlot));
    m->mask = ((size_t)1 << bits) - 1;
    m->shift = 64 - bits;
    m->count = 0;
}

static size_t intHome(const IntMap *m, long key) {
    return spread((uint64_t)key, m->shift);
}

// The slot of key, or of the empty slot where it would go.
static size_t intFind(const IntMap *m, long key) {
    size_t i = intHome(m, key);
    while (m->slots[i].used && m->slots[i].key != key) i = (i + 1) & m->mask;
    return i;
}

static void intSet(IntMap *m, long key, long value);

static void intGrow(IntMap *m) {
    IntMap bigger;
    intInit(&bigger, 64 - m->shift + 1);
    for (size_t i = 0; i <= m->mask; i++)
        if (m->slots[i].used) intSet(&bigger, m->slots[i].key, m->slots[i].value);
    free(m->slots);
    *m = bigger;
}

static void intSet(IntMap *m, long key, long value) {
    size_t i = intFind(m, key);
    if (!m->slots[i].used) {
        if ((m->count + 1) * 4 > (m->mask + 1) * 3) {
            intGrow(m);
            i = intFind(m, key);
        }
        m->count++;
    }
    m->slots[i] = (IntSlot){key, value, true};
}

// Looks up key; returns whether it is there and its value in *value.
static bool intGet(const IntMap *m, long key, long *value) {
    size_t i = intFind(m, key);
    if (!m->slots[i].used) return false;
    *value = m->slots[i].value;
    return true;
}

// Whether the entry at slot j, whose home slot is home, may move back to the
// empty slot: when its home does not lie cyclically in (empty, j].
static bool movable(size_t home, size_t empty, size_t j) {
    return empty <= j ? (home <= empty || home > j) : (home <= empty && home > j);
}

static void intDelete(IntMap *m, long key) {
    size_t empty = intFind(m, key);
    if (!m->slots[empty].used) return;
    for (size_t j = (empty + 1) & m->mask; m->slots[j].used; j = (j + 1) & m->mask) {
        if (movable(intHome(m, m->slots[j].key), empty, j)) {
            m->slots[empty] = m->slots[j];
            empty = j;
        }
    }
    m->slots[empty].used = false;
    m->count--;
}

// The map from strings to integers.

typedef struct {
    char *key;
    size_t length;
    uint64_t hash;
    long value;
} StringSlot;

typedef struct {
    StringSlot *slots;
    size_t mask, count;
    int shift;
} StringMap;

static uint64_t hashString(const char *s, size_t n) {
    uint64_t hash = 0xcbf29ce484222325ull;
    for (size_t i = 0; i < n; i++) {
        hash ^= (unsigned char)s[i];
        hash *= 0x100000001b3ull;
    }
    return hash;
}

static void stringInit(StringMap *m, int bits) {
    m->slots = calloc((size_t)1 << bits, sizeof(StringSlot));
    m->mask = ((size_t)1 << bits) - 1;
    m->shift = 64 - bits;
    m->count = 0;
}

static size_t stringFind(const StringMap *m, const char *key, size_t length, uint64_t hash) {
    size_t i = spread(hash, m->shift);
    for (;; i = (i + 1) & m->mask) {
        const StringSlot *slot = &m->slots[i];
        if (slot->key == NULL) return i;
        if (slot->hash == hash && slot->length == length && memcmp(slot->key, key, length) == 0) return i;
    }
}

static void stringGrow(StringMap *m) {
    StringMap bigger;
    stringInit(&bigger, 64 - m->shift + 1);
    for (size_t i = 0; i <= m->mask; i++) {
        StringSlot *slot = &m->slots[i];
        if (slot->key != NULL) bigger.slots[stringFind(&bigger, slot->key, slot->length, slot->hash)] = *slot;
    }
    bigger.count = m->count;
    free(m->slots);
    *m = bigger;
}

static void stringSet(StringMap *m, const char *key, size_t length, long value) {
    uint64_t hash = hashString(key, length);
    size_t i = stringFind(m, key, length, hash);
    if (m->slots[i].key == NULL) {
        if ((m->count + 1) * 4 > (m->mask + 1) * 3) {
            stringGrow(m);
            i = stringFind(m, key, length, hash);
        }
        char *copy = malloc(length + 1);
        memcpy(copy, key, length + 1);
        m->slots[i] = (StringSlot){copy, length, hash, value};
        m->count++;
    } else {
        m->slots[i].value = value;
    }
}

static bool stringGet(const StringMap *m, const char *key, size_t length, long *value) {
    size_t i = stringFind(m, key, length, hashString(key, length));
    if (m->slots[i].key == NULL) return false;
    *value = m->slots[i].value;
    return true;
}

static void stringDelete(StringMap *m, const char *key, size_t length) {
    size_t empty = stringFind(m, key, length, hashString(key, length));
    if (m->slots[empty].key == NULL) return;
    free(m->slots[empty].key);
    for (size_t j = (empty + 1) & m->mask; m->slots[j].key != NULL; j = (j + 1) & m->mask) {
        if (movable(spread(m->slots[j].hash, m->shift), empty, j)) {
            m->slots[empty] = m->slots[j];
            empty = j;
        }
    }
    m->slots[empty].key = NULL;
    m->count--;
}

int main(int argc, char **argv) {
    long n = argc > 1 ? atol(argv[1]) : 1000000;

    // Integer keys, spread out; half of the lookups miss.
    IntMap numbers;
    intInit(&numbers, 3);
    for (long i = 0; i < n; i++) intSet(&numbers, i * 7, i);
    long hits = 0, sum = 0, value;
    for (long i = 0; i < 2 * n; i++) {
        if (intGet(&numbers, i * 7, &value)) {
            hits++;
            sum += value;
        }
    }
    for (long i = 0; i < n; i += 2) intDelete(&numbers, i * 7);
    for (size_t i = 0; i <= numbers.mask; i++)
        if (numbers.slots[i].used) sum += numbers.slots[i].key + numbers.slots[i].value;

    // String keys built from numbers; a third of them deleted.
    StringMap names;
    stringInit(&names, 3);
    char key[32];
    for (long i = 0; i < n; i++) {
        int length = snprintf(key, sizeof key, "key-%ld", i);
        stringSet(&names, key, (size_t)length, i);
    }
    for (long i = 0; i < n; i++) {
        int length = snprintf(key, sizeof key, "key-%ld", i * 3);
        if (stringGet(&names, key, (size_t)length, &value)) sum += value;
        else sum += 1;
    }
    for (long i = 0; i < n; i += 3) {
        int length = snprintf(key, sizeof key, "key-%ld", i);
        stringDelete(&names, key, (size_t)length);
    }
    for (size_t i = 0; i <= names.mask; i++)
        if (names.slots[i].key != NULL) sum += (long)names.slots[i].length + names.slots[i].value;

    printf("%ld %zu %zu %ld\n", hits, numbers.count, names.count, sum);

    for (size_t i = 0; i <= names.mask; i++) free(names.slots[i].key);
    free(names.slots);
    free(numbers.slots);
    return 0;
}
