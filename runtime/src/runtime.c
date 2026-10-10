#include "ore.h"

#include <execinfo.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(int argc, char **argv) {
  (void)argc;
  (void)argv;
  static char buffer[1 << 16];
  setvbuf(stdout, buffer, _IOFBF, sizeof buffer);
  ore_entry();
  fflush(stdout);
  return 0;
}

// ---------------------------------------------------------------------------
// Panics

_Noreturn void ore_rt_panic(ore_string message) {
  fflush(stdout);
  fprintf(stderr, "panic: %.*s\n\n", (int)message.len, (const char *)message.ptr);
  void *frames[64];
  int count = backtrace(frames, 64);
  // Skip ore_rt_panic itself.
  backtrace_symbols_fd(frames + 1, count - 1, 2);
  exit(2);
}

_Noreturn void ore_rt_panic_cstr(const char *message) {
  ore_rt_panic((ore_string){(const u8 *)message, (i64)strlen(message)});
}

// ---------------------------------------------------------------------------
// Strings

bool ore_rt_str_eq(ore_string a, ore_string b) {
  return a.len == b.len && (a.ptr == b.ptr || memcmp(a.ptr, b.ptr, (size_t)a.len) == 0);
}

// ---------------------------------------------------------------------------
// Printing

void ore_rt_print_i64(i64 v) { printf("%lld", (long long)v); }

void ore_rt_print_u64(u64 v) { printf("%llu", (unsigned long long)v); }

void ore_rt_print_bool(bool v) { fputs(v ? "true" : "false", stdout); }

void ore_rt_print_string(ore_string v) { fwrite(v.ptr, 1, (size_t)v.len, stdout); }

void ore_rt_print_space(void) { putchar(' '); }

void ore_rt_print_newline(void) { putchar('\n'); }

// Rewrites a C exponent ("1e-07", "1e+21") into the JavaScript style ("1e-7", "1e+21").
static void normalize_exponent(char *s) {
  char *e = strchr(s, 'e');
  if (!e) return;
  char *digits = e + 2;
  char *p = digits;
  while (*p == '0' && p[1] != '\0') p++;
  memmove(digits, p, strlen(p) + 1);
}

// Prints the shortest decimal representation that round-trips, like JavaScript.
static void print_float(f64 v, int max_precision, bool single) {
  if (isnan(v)) return (void)fputs("NaN", stdout);
  if (isinf(v)) return (void)fputs(v > 0 ? "Infinity" : "-Infinity", stdout);
  if (v == 0) return (void)putchar('0');
  char buf[64];
  for (int precision = 1; precision <= max_precision; precision++) {
    snprintf(buf, sizeof buf, "%.*g", precision, v);
    if (single ? strtof(buf, NULL) == (f32)v : strtod(buf, NULL) == v) break;
  }
  // %g switches to exponent notation earlier than JavaScript does for integers.
  f64 magnitude = fabs(v);
  if (magnitude >= 1 && magnitude < 1e21 && strchr(buf, 'e') && v == floor(v)) {
    snprintf(buf, sizeof buf, "%.0f", v);
  }
  normalize_exponent(buf);
  fputs(buf, stdout);
}

void ore_rt_print_f64(f64 v) { print_float(v, 17, false); }

void ore_rt_print_f32(f32 v) { print_float(v, 9, true); }
