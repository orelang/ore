// Regular expressions: generates a log of n lines, then counts the lines
// that match a few patterns, collects every match of a global one and
// rewrites the dates of the whole text with groups.
//
// This uses POSIX extended regular expressions from <regex.h>, which have no
// \d, \w or \s: they are written as the ASCII classes [0-9], [A-Za-z0-9_] and
// [[:space:]], which is what they mean in the other versions (Go's are ASCII
// only, and the text is ASCII). POSIX matches leftmost-longest rather than
// leftmost-first, which finds the same matches for these patterns. Searching
// from an offset of the long text uses REG_STARTEND where the C library has it
// (glibc, musl, macOS and the BSDs), so that regexec does not measure the rest
// of the text on each call. Matching all, replacing and splitting are written
// here as loops over regexec.
#define _DEFAULT_SOURCE
#include <regex.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static regex_t compile(const char *pattern) {
    regex_t re;
    int error = regcomp(&re, pattern, REG_EXTENDED);
    if (error != 0) {
        char message[256];
        regerror(error, &re, message, sizeof message);
        fprintf(stderr, "bad pattern %s: %s\n", pattern, message);
        exit(1);
    }
    return re;
}

// Searches text[start:length] for the first match, filling groups (offsets
// from text) and returning whether there is one.
static bool search(const regex_t *re, const char *text, size_t start, size_t length, regmatch_t *groups,
                   size_t count) {
    int flags = start > 0 ? REG_NOTBOL : 0;
#ifdef REG_STARTEND
    groups[0].rm_so = (regoff_t)start;
    groups[0].rm_eo = (regoff_t)length;
    return regexec(re, text, count, groups, flags | REG_STARTEND) == 0;
#else
    (void)length;
    if (regexec(re, text + start, count, groups, flags) != 0) return false;
    for (size_t i = 0; i < count; i++) {
        if (groups[i].rm_so >= 0) {
            groups[i].rm_so += (regoff_t)start;
            groups[i].rm_eo += (regoff_t)start;
        }
    }
    return true;
#endif
}

// Calls found(match, data) for each match of re in text, left to right, and
// returns how many there were. An empty match moves the search one byte on.
static long eachMatch(const regex_t *re, const char *text, size_t length, regmatch_t *groups, size_t count,
                      void (*found)(const char *text, const regmatch_t *groups, void *data), void *data) {
    long matches = 0;
    size_t start = 0;
    while (start <= length && search(re, text, start, length, groups, count)) {
        matches++;
        if (found != NULL) found(text, groups, data);
        start = groups[0].rm_eo > groups[0].rm_so ? (size_t)groups[0].rm_eo : (size_t)groups[0].rm_eo + 1;
    }
    return matches;
}

typedef struct {
    char *data;
    size_t length, capacity;
} Buffer;

static void append(Buffer *b, const char *s, size_t n) {
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
    Buffer out;
    const char *template;
    size_t copied;
} Replacement;

// Copies the text before a match, then the template with $1..$9 replaced by
// the groups of the match.
static void replaceOne(const char *text, const regmatch_t *groups, void *data) {
    Replacement *r = data;
    append(&r->out, text + r->copied, (size_t)groups[0].rm_so - r->copied);
    for (const char *t = r->template; *t; t++) {
        if (t[0] == '$' && t[1] >= '1' && t[1] <= '9') {
            const regmatch_t *group = &groups[t[1] - '0'];
            if (group->rm_so >= 0) append(&r->out, text + group->rm_so, (size_t)(group->rm_eo - group->rm_so));
            t++;
        } else {
            append(&r->out, t, 1);
        }
    }
    r->copied = (size_t)groups[0].rm_eo;
}

// Replaces every match of re in text by the template, into a new string.
static Buffer replaceAll(const regex_t *re, const char *text, size_t length, const char *template) {
    Replacement r = {{0}, template, 0};
    regmatch_t groups[10];
    eachMatch(re, text, length, groups, 10, replaceOne, &r);
    append(&r.out, text + r.copied, length - r.copied);
    return r.out;
}

int main(int argc, char **argv) {
    long n = argc > 1 ? atol(argv[1]) : 100000;

    char **lines = malloc(n * sizeof(char *));
    Buffer text = {0};
    for (long i = 0; i < n; i++) {
        char line[128];
        int length = snprintf(line, sizeof line, "user%ld@host%ld.example.com GET /page/%ld 2024-%02ld-%02ld status %ld",
                              i, i % 97, i % 1000, i % 12 + 1, i % 28 + 1, 200 + (i * 7) % 4 * 100);
        lines[i] = malloc((size_t)length + 1);
        memcpy(lines[i], line, (size_t)length + 1);
        if (i > 0) append(&text, "\n", 1);
        append(&text, line, (size_t)length);
    }

    // Per line: a test, an anchored pattern with alternation, a match with groups.
    regex_t errors = compile("status 5[0-9][0-9]$");
    regex_t pages = compile("^user[0-9]*7@host(1|2|3)[0-9]?\\.");
    regex_t page = compile("GET /page/([0-9]+)");
    long failed = 0, chosen = 0, total = 0;
    regmatch_t groups[2];
    for (long i = 0; i < n; i++) {
        if (regexec(&errors, lines[i], 0, NULL, 0) == 0) failed++;
        if (regexec(&pages, lines[i], 0, NULL, 0) == 0) chosen++;
        if (regexec(&page, lines[i], 2, groups, 0) == 0) total += strtol(lines[i] + groups[1].rm_so, NULL, 10);
    }

    // Over the whole text: every address, and the dates rewritten.
    regex_t address = compile("[A-Za-z0-9_]+@[A-Za-z0-9_]+\\.example\\.com");
    regex_t date = compile("([0-9]{4})-([0-9][0-9])-([0-9][0-9])");
    regex_t space = compile("[[:space:]]+");
    regmatch_t whole[1];
    long addresses = eachMatch(&address, text.data, text.length, whole, 1, NULL, NULL);
    Buffer rewritten = replaceAll(&date, text.data, text.length, "$3.$2.$1");
    // Splitting at n separators makes n + 1 parts.
    long words = eachMatch(&space, text.data, text.length, whole, 1, NULL, NULL) + 1;
    printf("%ld %ld %ld %ld %zu %ld %s\n", failed, chosen, total, addresses, rewritten.length, words,
           rewritten.data + rewritten.length - 40);

    regfree(&errors);
    regfree(&pages);
    regfree(&page);
    regfree(&address);
    regfree(&date);
    regfree(&space);
    for (long i = 0; i < n; i++) free(lines[i]);
    free(lines);
    free(text.data);
    free(rewritten.data);
    return 0;
}
