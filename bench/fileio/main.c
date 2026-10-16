// File I/O: writes n lines of comma-separated numbers to a file in a new
// temporary directory, reads the file back, parses the second number of each
// line and sums them, then removes the directory. The file is written and
// read whole, as in the Ore version. mkdtemp is POSIX rather than C17.
#define _POSIX_C_SOURCE 200809L
#define _DARWIN_C_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static void fail(const char *what) {
    perror(what);
    exit(1);
}

int main(int argc, char **argv) {
    long n = argc > 1 ? atol(argv[1]) : 3000000;

    const char *tmp = getenv("TMPDIR");
    char dir[4096], path[4200];
    snprintf(dir, sizeof dir, "%s/c-bench-fileio-XXXXXX", tmp ? tmp : "/tmp");
    if (!mkdtemp(dir)) fail("mkdtemp");
    snprintf(path, sizeof path, "%s/numbers.csv", dir);

    // Every line is at most 7 + 1 + 7 + 1 characters.
    char *out = malloc(16 * (size_t)n + 1);
    size_t length = 0;
    for (long i = 0; i < n; i++) length += (size_t)sprintf(out + length, "%ld,%ld\n", i, (i * 7919) % 1000003);
    FILE *f = fopen(path, "wb");
    if (!f || fwrite(out, 1, length, f) != length || fclose(f) != 0) fail("write");
    free(out);

    f = fopen(path, "rb");
    if (!f) fail("open");
    fseek(f, 0, SEEK_END);
    long size = ftell(f);
    fseek(f, 0, SEEK_SET);
    char *text = malloc((size_t)size + 1);
    if (fread(text, 1, (size_t)size, f) != (size_t)size) fail("read");
    fclose(f);
    text[size] = 0;

    long lines = 0, sum = 0;
    for (char *line = text; *line;) {
        char *end = strchr(line, '\n');
        if (!end) end = line + strlen(line);
        if (end > line) {
            lines++;
            sum += strtol(strchr(line, ',') + 1, NULL, 10);
        }
        line = *end ? end + 1 : end;
    }
    if (remove(path) != 0 || rmdir(dir) != 0) fail("remove");
    printf("%ld %ld %ld\n", lines, size, sum);
    return 0;
}
