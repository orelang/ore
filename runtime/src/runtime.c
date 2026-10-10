#include "ore.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// Boehm GC, linked from runtime/third_party/bdwgc. Declared here so that the
// runtime builds without the GC headers.
void GC_init(void);
void *GC_malloc(size_t size);
void *GC_malloc_atomic(size_t size);

int main(int argc, char **argv) {
  (void)argc;
  (void)argv;
  GC_init();
  static char buffer[1 << 16];
  setvbuf(stdout, buffer, _IOFBF, sizeof buffer);
  ore_entry();
  fflush(stdout);
  return 0;
}

// ---------------------------------------------------------------------------
// Panics

_Thread_local ore_frame *ore_rt_top = NULL;

_Noreturn void ore_rt_panic(ore_string message) {
  fflush(stdout);
  fprintf(stderr, "panic: %.*s\n\n", (int)message.len, (const char *)message.ptr);
  if (ore_rt_top) {
    for (ore_frame *f = ore_rt_top; f; f = f->prev) fprintf(stderr, "  %s at %s:%d\n", f->func, f->file, f->line);
  } else {
    // Release builds keep no shadow stack, and native symbols of static
    // functions are unreliable, so no trace is better than a wrong one.
    fputs("  (no stack trace in release builds; rebuild without --release)\n", stderr);
  }
  exit(2);
}

_Noreturn void ore_rt_panic_cstr(const char *message) {
  ore_rt_panic((ore_string){(const u8 *)message, (i64)strlen(message)});
}

_Noreturn void ore_rt_panic_index(i64 index, i64 length) {
  char buf[96];
  snprintf(buf, sizeof buf, "index out of range [%lld] with length %lld", (long long)index, (long long)length);
  ore_rt_panic_cstr(buf);
}

// ---------------------------------------------------------------------------
// Memory

void *ore_rt_alloc(i64 size) {
  void *p = GC_malloc(size > 0 ? (size_t)size : 1);
  if (!p) ore_rt_panic_cstr("out of memory");
  return p;
}

/** Memory that never holds pointers, so the GC does not scan it. Not zeroed. */
static void *alloc_atomic(i64 size) {
  void *p = GC_malloc_atomic(size > 0 ? (size_t)size : 1);
  if (!p) ore_rt_panic_cstr("out of memory");
  return p;
}

// ---------------------------------------------------------------------------
// Strings

bool ore_rt_str_eq(ore_string a, ore_string b) {
  return a.len == b.len && (a.ptr == b.ptr || memcmp(a.ptr, b.ptr, (size_t)a.len) == 0);
}

i32 ore_rt_str_cmp(ore_string a, ore_string b) {
  i64 n = a.len < b.len ? a.len : b.len;
  int c = n > 0 ? memcmp(a.ptr, b.ptr, (size_t)n) : 0;
  if (c != 0) return c;
  return a.len < b.len ? -1 : a.len > b.len;
}

ore_string ore_rt_str_concat(i64 count, const ore_string *parts) {
  i64 len = 0;
  for (i64 i = 0; i < count; i++) len += parts[i].len;
  u8 *p = alloc_atomic(len);
  i64 at = 0;
  for (i64 i = 0; i < count; i++) {
    if (parts[i].len > 0) memcpy(p + at, parts[i].ptr, (size_t)parts[i].len);
    at += parts[i].len;
  }
  return (ore_string){p, len};
}

// Resolves a JavaScript `slice` offset against a length.
static i64 slice_offset(i64 offset, i64 len) {
  if (offset < 0) offset += len;
  if (offset < 0) return 0;
  return offset > len ? len : offset;
}

ore_string ore_rt_str_slice(ore_string s, i64 start, i64 end) {
  start = slice_offset(start, s.len);
  end = slice_offset(end, s.len);
  if (end < start) end = start;
  return (ore_string){s.ptr + start, end - start};
}

i32 ore_rt_str_decode(ore_string s, i64 *pos) {
  const u8 *p = s.ptr + *pos;
  i64 left = s.len - *pos;
  u8 b = p[0];
  i32 rune;
  int n;
  if (b < 0x80) return (*pos)++, b;
  if ((b & 0xE0) == 0xC0) rune = b & 0x1F, n = 2;
  else if ((b & 0xF0) == 0xE0) rune = b & 0x0F, n = 3;
  else if ((b & 0xF8) == 0xF0) rune = b & 0x07, n = 4;
  else return (*pos)++, 0xFFFD;
  if (left < n) return (*pos)++, 0xFFFD;
  for (int i = 1; i < n; i++) {
    if ((p[i] & 0xC0) != 0x80) return (*pos)++, 0xFFFD;
    rune = (rune << 6) | (p[i] & 0x3F);
  }
  static const i32 min[] = {0, 0, 0x80, 0x800, 0x10000};
  if (rune < min[n] || rune > 0x10FFFF || (rune >= 0xD800 && rune <= 0xDFFF)) return (*pos)++, 0xFFFD;
  *pos += n;
  return rune;
}

static ore_string str_copy(const char *s, size_t n) {
  u8 *p = alloc_atomic((i64)n);
  memcpy(p, s, n);
  return (ore_string){p, (i64)n};
}

ore_string ore_rt_str_from_i64(i64 v) {
  char buf[32];
  return str_copy(buf, (size_t)snprintf(buf, sizeof buf, "%lld", (long long)v));
}

ore_string ore_rt_str_from_u64(u64 v) {
  char buf[32];
  return str_copy(buf, (size_t)snprintf(buf, sizeof buf, "%llu", (unsigned long long)v));
}

ore_string ore_rt_str_from_bool(bool v) { return v ? ORE_STR("true") : ORE_STR("false"); }

// ---------------------------------------------------------------------------
// Interfaces

ore_iface ore_rt_iface_project(ore_iface v, i64 count, const i32 *indices) {
  void **itab = ore_rt_alloc(count * (i64)sizeof(void *));
  for (i64 k = 0; k < count; k++) itab[k] = v.itab[indices[k]];
  return (ore_iface){v.data, (void *const *)itab};
}

// ---------------------------------------------------------------------------
// Arrays

ore_array *ore_rt_array_new(i64 elem_size, i64 len) {
  ore_array *a = ore_rt_alloc(sizeof(ore_array));
  a->data = ore_rt_alloc(elem_size * len);
  a->len = len;
  a->cap = len;
  return a;
}

void *ore_rt_array_push(ore_array *a, i64 elem_size) {
  if (a->len == a->cap) {
    i64 cap = a->cap < 4 ? 4 : a->cap * 2;
    void *data = ore_rt_alloc(elem_size * cap);
    if (a->len > 0) memcpy(data, a->data, (size_t)(elem_size * a->len));
    a->data = data;
    a->cap = cap;
  }
  return (u8 *)a->data + elem_size * a->len++;
}

void *ore_rt_array_pop(ore_array *a, i64 elem_size) {
  if (a->len == 0) ore_rt_panic_cstr("pop from an empty array");
  return (u8 *)a->data + elem_size * --a->len;
}

ore_array *ore_rt_array_slice(ore_array *a, i64 elem_size, i64 start, i64 end) {
  start = slice_offset(start, a->len);
  end = slice_offset(end, a->len);
  if (end < start) end = start;
  ore_array *r = ore_rt_array_new(elem_size, end - start);
  if (end > start) memcpy(r->data, (u8 *)a->data + elem_size * start, (size_t)(elem_size * (end - start)));
  return r;
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

// Formats the shortest decimal representation that round-trips, like JavaScript.
static void format_float(char buf[64], f64 v, int max_precision, bool single) {
  if (isnan(v)) return (void)strcpy(buf, "NaN");
  if (isinf(v)) return (void)strcpy(buf, v > 0 ? "Infinity" : "-Infinity");
  if (v == 0) return (void)strcpy(buf, "0");
  for (int precision = 1; precision <= max_precision; precision++) {
    snprintf(buf, 64, "%.*g", precision, v);
    if (single ? strtof(buf, NULL) == (f32)v : strtod(buf, NULL) == v) break;
  }
  // %g switches to exponent notation earlier than JavaScript does for integers.
  f64 magnitude = fabs(v);
  if (magnitude >= 1 && magnitude < 1e21 && strchr(buf, 'e') && v == floor(v)) {
    snprintf(buf, 64, "%.0f", v);
  }
  normalize_exponent(buf);
}

void ore_rt_print_f64(f64 v) {
  char buf[64];
  format_float(buf, v, 17, false);
  fputs(buf, stdout);
}

void ore_rt_print_f32(f32 v) {
  char buf[64];
  format_float(buf, v, 9, true);
  fputs(buf, stdout);
}

ore_string ore_rt_str_from_f64(f64 v) {
  char buf[64];
  format_float(buf, v, 17, false);
  return str_copy(buf, strlen(buf));
}

ore_string ore_rt_str_from_f32(f32 v) {
  char buf[64];
  format_float(buf, v, 9, true);
  return str_copy(buf, strlen(buf));
}
