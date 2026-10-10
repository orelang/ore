// Native code compiled into the program, listed in package.json "ore.sources".
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
  int64_t count;
} counter;

void *counter_new(void) { return calloc(1, sizeof(counter)); }

int64_t counter_add(void *c, int64_t n) { return ((counter *)c)->count += n; }

void counter_free(void *c) { free(c); }

const char *greeting(const char *name) {
  static char buf[64];
  strcpy(buf, "hello from C, ");
  strncat(buf, name, sizeof buf - strlen(buf) - 1);
  return buf;
}
