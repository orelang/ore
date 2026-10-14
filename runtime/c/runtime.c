// POSIX and GNU declarations of glibc (clock_gettime, mmap flags, ...), hidden by -std=c11.
#define _GNU_SOURCE

#include "ore.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <errno.h>
#include <setjmp.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

// Boehm GC, linked from runtime/third_party/bdwgc. Declared here so that the
// runtime builds without the GC headers.
void GC_init(void);
void *GC_malloc(size_t size);
void *GC_malloc_atomic(size_t size);

// Helpers defined below.
static void *alloc_atomic(i64 size);
static ore_string str_copy(const char *s, size_t n);
static ore_array *array_new(i64 elem_size, i64 len);
static void *array_push(ore_array *a, i64 elem_size);
static bool is_space(u8 c);

static int arg_count;
static char **arg_values;

int main(int argc, char **argv) {
  arg_count = argc;
  arg_values = argv;
  GC_init();
  static char buffer[1 << 16];
  setvbuf(stdout, buffer, _IOFBF, sizeof buffer);
  ore_rt_run_main(ore_entry);
  return 0;
}

// ---------------------------------------------------------------------------
// Panics

_Thread_local ore_frame *ore_rt_top = NULL;

// While a test runs, a panic in its task returns to the test runner instead of exiting.
static jmp_buf *test_catch;
static void *test_task;
static ore_string test_failure;

_Noreturn void ore_rt_panic(ore_string message) {
  if (test_catch && ore_rt_task_current() == test_task) {
    test_failure = message;
    longjmp(*test_catch, 1);
  }
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

void *ore_rt_alloc_bytes(i64 size) {
  void *p = alloc_atomic(size);
  memset(p, 0, size > 0 ? (size_t)size : 1);
  return p;
}

/** A NUL-terminated copy of a string, for C APIs. */
static char *c_string(ore_string s) {
  char *p = alloc_atomic(s.len + 1);
  memcpy(p, s.ptr, (size_t)s.len);
  p[s.len] = 0;
  return p;
}

static int tests_passed, tests_failed;

static void test_summary(void) {
  printf("\n%d passed, %d failed\n", tests_passed, tests_failed);
  fflush(stdout);
  if (tests_failed > 0) _exit(1);
}

void ore_rt_run_test(ore_string name, ore_closure body) {
  if (tests_passed + tests_failed == 0) atexit(test_summary);
  jmp_buf here;
  ore_frame *top = ore_rt_top;
  test_catch = &here;
  test_task = ore_rt_task_current();
  if (setjmp(here) == 0) {
    ((void (*)(void *))body.fn)(body.env);
    test_catch = NULL;
    tests_passed++;
    printf("  \u2713 %.*s\n", (int)name.len, (const char *)name.ptr);
  } else {
    test_catch = NULL;
    ore_rt_top = top;
    tests_failed++;
    printf("  \u2717 %.*s\n      %.*s\n", (int)name.len, (const char *)name.ptr, (int)test_failure.len, (const char *)test_failure.ptr);
  }
  fflush(stdout);
}

const char *ore_rt_cstring(ore_string s) { return c_string(s); }

ore_string ore_rt_from_cstring(const char *p) { return p ? str_copy(p, strlen(p)) : ORE_STR(""); }

ore_array *ore_rt_args(void) {
  ore_array *a = array_new(sizeof(ore_string), 0);
  for (int i = 1; i < arg_count; i++) {
    *(ore_string *)array_push(a, sizeof(ore_string)) = str_copy(arg_values[i], strlen(arg_values[i]));
  }
  return a;
}

ore_string ore_rt_getenv(ore_string name) {
  const char *v = getenv(c_string(name));
  return v ? str_copy(v, strlen(v)) : (ore_string){0};
}

bool ore_rt_parse_int(ore_string s, i64 radix, i64 *out) {
  i64 i = 0;
  while (i < s.len && is_space(s.ptr[i])) i++;
  bool negative = false;
  if (i < s.len && (s.ptr[i] == '+' || s.ptr[i] == '-')) negative = s.ptr[i++] == '-';
  if ((radix == 0 || radix == 16) && i + 1 < s.len && s.ptr[i] == '0' && (s.ptr[i + 1] == 'x' || s.ptr[i + 1] == 'X')) {
    radix = 16;
    i += 2;
  }
  if (radix == 0) radix = 10;
  if (radix < 2 || radix > 36) return false;
  u64 value = 0;
  i64 start = i;
  for (; i < s.len; i++) {
    u8 c = s.ptr[i];
    int d = c >= '0' && c <= '9' ? c - '0' : c >= 'a' && c <= 'z' ? c - 'a' + 10 : c >= 'A' && c <= 'Z' ? c - 'A' + 10 : 99;
    if (d >= radix) break;
    value = value * (u64)radix + (u64)d;
  }
  if (i == start) return false;
  *out = negative ? -(i64)value : (i64)value;
  return true;
}

bool ore_rt_parse_float(ore_string s, f64 *out) {
  char *text = c_string(s);
  char *end;
  f64 v = strtod(text, &end);
  // strtod also reads "nan", "inf" and hex floats, which parseFloat does not.
  const char *p = text;
  while (is_space((u8)*p)) p++;
  if (*p == '+' || *p == '-') p++;
  if (end == text || !(*p == '.' || (*p >= '0' && *p <= '9') || strncmp(p, "Infinity", 8) == 0)) return false;
  if (strncmp(p, "Infinity", 8) == 0) v = text[p - text - 1] == '-' ? -INFINITY : INFINITY;
  *out = v;
  return true;
}

ore_string ore_rt_str_fixed(f64 x, i64 digits) {
  if (digits < 0 || digits > 100) ore_rt_panic_cstr("toFixed() digits out of range");
  char buf[512];
  int n = snprintf(buf, sizeof buf, "%.*f", (int)digits, x);
  return str_copy(buf, (size_t)n);
}

static ore_string error_message(const char *what, ore_string path) {
  char buf[512];
  int n = snprintf(buf, sizeof buf, "%s %.*s: %s", what, (int)path.len, (const char *)path.ptr, strerror(errno));
  return str_copy(buf, (size_t)n);
}

static bool read_file(ore_string path, ore_string *out);

bool ore_rt_read_file(ore_string path, ore_string *out) {
  ore_rt_blocking_enter();
  bool ok = read_file(path, out);
  ore_rt_blocking_exit();
  return ok;
}

static bool read_file(ore_string path, ore_string *out) {
  FILE *f = fopen(c_string(path), "rb");
  if (!f) return *out = error_message("cannot open", path), false;
  i64 cap = 4096, len = 0;
  u8 *p = alloc_atomic(cap);
  for (size_t n; (n = fread(p + len, 1, (size_t)(cap - len), f)) > 0;) {
    len += (i64)n;
    if (len == cap) {
      u8 *bigger = alloc_atomic(cap * 2);
      memcpy(bigger, p, (size_t)len);
      p = bigger;
      cap *= 2;
    }
  }
  bool failed = ferror(f);
  fclose(f);
  if (failed) return *out = error_message("cannot read", path), false;
  *out = (ore_string){p, len};
  return true;
}

static bool write_file(ore_string path, ore_string data, ore_string *err);

bool ore_rt_write_file(ore_string path, ore_string data, ore_string *err) {
  ore_rt_blocking_enter();
  bool ok = write_file(path, data, err);
  ore_rt_blocking_exit();
  return ok;
}

static bool write_file(ore_string path, ore_string data, ore_string *err) {
  FILE *f = fopen(c_string(path), "wb");
  if (!f) return *err = error_message("cannot open", path), false;
  bool ok = fwrite(data.ptr, 1, (size_t)data.len, f) == (size_t)data.len;
  ok = fclose(f) == 0 && ok;
  if (!ok) *err = error_message("cannot write", path);
  return ok;
}

bool ore_rt_file_exists(ore_string path) { return access(c_string(path), F_OK) == 0; }

i64 ore_rt_now(void) {
  struct timespec ts;
  clock_gettime(CLOCK_REALTIME, &ts);
  return (i64)ts.tv_sec * 1000 + ts.tv_nsec / 1000000;
}

f64 ore_rt_round(f64 x) {
  f64 r = floor(x);
  return x - r >= 0.5 ? r + 1 : r;
}

// xorshift64*, per OS thread, seeded from the time and the thread.
static _Thread_local u64 random_state;

f64 ore_rt_random(void) {
  if (random_state == 0) random_state = ((u64)time(NULL) ^ (u64)(uintptr_t)&random_state) * 0x9e3779b97f4a7c15ull | 1;
  random_state ^= random_state >> 12;
  random_state ^= random_state << 25;
  random_state ^= random_state >> 27;
  return (f64)((random_state * 0x2545f4914f6cdd1dull) >> 11) / 9007199254740992.0;
}

void *ore_rt_box_copy(void *p, i64 size) {
  void *box = ore_rt_alloc(size);
  memcpy(box, p, (size_t)size);
  return box;
}

/** Memory that never holds pointers, so the GC does not scan it. Not zeroed. */
static void *alloc_atomic(i64 size) {
  void *p = GC_malloc_atomic(size > 0 ? (size_t)size : 1);
  if (!p) ore_rt_panic_cstr("out of memory");
  return p;
}

// ---------------------------------------------------------------------------
// Strings

static bool is_space(u8 c) { return c == ' ' || (c >= '\t' && c <= '\r'); }

/**
 * A copy of `n` bytes as a string, followed by a NUL that is not part of it:
 * C functions such as strtod may read the copy, and must stop at its end
 * rather than in whatever memory follows.
 */
static ore_string str_copy(const char *s, size_t n) {
  u8 *p = alloc_atomic((i64)n + 1);
  memcpy(p, s, n);
  p[n] = 0;
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
  void **itab = ore_rt_alloc((count + 1) * (i64)sizeof(void *));
  itab[0] = v.itab[0];
  for (i64 k = 0; k < count; k++) itab[k + 1] = v.itab[indices[k] + 1];
  return (ore_iface){v.data, (void *const *)itab};
}

// ---------------------------------------------------------------------------
// Hashing

u64 ore_rt_hash_u64(u64 x) {
  // splitmix64 finalizer
  x += 0x9e3779b97f4a7c15ull;
  x = (x ^ (x >> 30)) * 0xbf58476d1ce4e5b9ull;
  x = (x ^ (x >> 27)) * 0x94d049bb133111ebull;
  return x ^ (x >> 31);
}

u64 ore_rt_hash_bytes(const u8 *p, i64 n) {
  // FNV-1a, then mixed
  u64 h = 0xcbf29ce484222325ull;
  for (i64 i = 0; i < n; i++) h = (h ^ p[i]) * 0x100000001b3ull;
  return ore_rt_hash_u64(h);
}

u64 ore_rt_hash_f64(f64 x) {
  if (x != x) return 0x7ff8000000000000ull;
  if (x == 0) x = 0;
  u64 bits;
  memcpy(&bits, &x, sizeof bits);
  return ore_rt_hash_u64(bits);
}

// ---------------------------------------------------------------------------
// Maps

static i64 round8(i64 n) { return (n + 7) & ~7; }

ore_map *ore_rt_map_new(i64 key_size, i64 value_size, ore_hash_fn hash, ore_eq_fn eq) {
  ore_map *m = ore_rt_alloc(sizeof(ore_map));
  m->key_size = key_size;
  m->value_size = value_size;
  m->entry_size = 16 + round8(key_size) + round8(value_size);
  m->hash = hash;
  m->eq = eq;
  return m;
}

/** The slot of `key` in the index, or the empty slot where it would go. */
static i64 map_slot(ore_map *m, const void *key, u64 hash) {
  i64 mask = m->index_cap - 1;
  for (i64 slot = (i64)(hash & (u64)mask);; slot = (slot + 1) & mask) {
    i64 e = m->index[slot];
    if (e == 0) return slot;
    u8 *entry = ore_rt_map_entry(m, e - 1);
    // Deleted entries keep their slot so that probing continues past them.
    if (*(i64 *)entry && *(u64 *)(entry + 8) == hash && m->eq(entry + 16, key)) return slot;
  }
}

/** Rebuilds the entries without holes and the index with room for `cap` entries. */
static void map_rebuild(ore_map *m, i64 cap) {
  u8 *entries = ore_rt_alloc(cap * m->entry_size);
  i64 count = 0;
  for (i64 i = 0; i < m->count; i++) {
    if (!ore_rt_map_live(m, i)) continue;
    memcpy(entries + count * m->entry_size, ore_rt_map_entry(m, i), (size_t)m->entry_size);
    count++;
  }
  m->entries = entries;
  m->count = count;
  m->cap = cap;
  m->index_cap = 8;
  while (m->index_cap < cap * 2) m->index_cap *= 2;
  m->index = ore_rt_alloc(m->index_cap * (i64)sizeof(i64));
  i64 mask = m->index_cap - 1;
  for (i64 i = 0; i < count; i++) {
    u64 hash = *(u64 *)(ore_rt_map_entry(m, i) + 8);
    i64 slot = (i64)(hash & (u64)mask);
    while (m->index[slot] != 0) slot = (slot + 1) & mask;
    m->index[slot] = i + 1;
  }
}

void *ore_rt_map_get(ore_map *m, const void *key) {
  if (m->size == 0) return NULL;
  i64 e = m->index[map_slot(m, key, m->hash(key))];
  return e == 0 ? NULL : ore_rt_map_value(m, e - 1);
}

void ore_rt_map_set(ore_map *m, const void *key, const void *value) {
  u64 hash = m->hash(key);
  if (m->index) {
    i64 e = m->index[map_slot(m, key, hash)];
    if (e != 0) {
      memcpy(ore_rt_map_value(m, e - 1), value, (size_t)m->value_size);
      return;
    }
  }
  if (m->count == m->cap) {
    // Full: drop the holes of deleted entries if they are many, else grow.
    bool compact = m->cap > 0 && m->size < m->cap / 2;
    map_rebuild(m, compact ? m->cap : m->cap < 8 ? 8 : m->cap * 2);
  }
  i64 i = m->count++;
  u8 *entry = ore_rt_map_entry(m, i);
  *(i64 *)entry = 1;
  *(u64 *)(entry + 8) = hash;
  memcpy(entry + 16, key, (size_t)m->key_size);
  memcpy(ore_rt_map_value(m, i), value, (size_t)m->value_size);
  m->index[map_slot(m, key, hash)] = i + 1;
  m->size++;
}

bool ore_rt_map_delete(ore_map *m, const void *key) {
  if (m->size == 0) return false;
  i64 e = m->index[map_slot(m, key, m->hash(key))];
  if (e == 0) return false;
  *(i64 *)ore_rt_map_entry(m, e - 1) = 0;
  m->size--;
  return true;
}

void ore_rt_map_clear(ore_map *m) {
  m->entries = NULL;
  m->index = NULL;
  m->count = m->cap = m->size = m->index_cap = 0;
}

ore_array *ore_rt_map_keys(ore_map *m) {
  ore_array *a = array_new(m->key_size, 0);
  for (i64 i = 0; i < m->count; i++) {
    if (ore_rt_map_live(m, i)) memcpy(array_push(a, m->key_size), ore_rt_map_key(m, i), (size_t)m->key_size);
  }
  return a;
}

ore_array *ore_rt_map_values(ore_map *m) {
  ore_array *a = array_new(m->value_size, 0);
  for (i64 i = 0; i < m->count; i++) {
    if (ore_rt_map_live(m, i)) memcpy(array_push(a, m->value_size), ore_rt_map_value(m, i), (size_t)m->value_size);
  }
  return a;
}

// ---------------------------------------------------------------------------
// Arrays

// Arrays for the C code; generated code uses runtime/core/array.ore.
static ore_array *array_new(i64 elem_size, i64 len) {
  ore_array *a = ore_rt_alloc(sizeof(ore_array));
  a->data = ore_rt_alloc(elem_size * len);
  a->len = len;
  a->cap = len;
  return a;
}

static void *array_push(ore_array *a, i64 elem_size) {
  if (a->len == a->cap) {
    i64 cap = a->cap < 4 ? 4 : a->cap * 2;
    void *data = ore_rt_alloc(elem_size * cap);
    if (a->len > 0) memcpy(data, a->data, (size_t)(elem_size * a->len));
    a->data = data;
    a->cap = cap;
  }
  return (u8 *)a->data + elem_size * a->len++;
}

// ---------------------------------------------------------------------------
// Printing

// Where printing goes, per OS thread; stdout unless set by ore_rt_print_to.
static _Thread_local FILE *out;

static FILE *stream(void) { return out ? out : stdout; }

void ore_rt_print_to(int fd) {
  // Keep the order of output to both streams.
  fflush(stream());
  out = fd == 2 ? stderr : stdout;
}

_Noreturn void ore_rt_exit(i32 code) {
  fflush(stdout);
  exit(code);
}

void ore_rt_print_i64(i64 v) { fprintf(stream(), "%lld", (long long)v); }

void ore_rt_print_u64(u64 v) { fprintf(stream(), "%llu", (unsigned long long)v); }

void ore_rt_print_bool(bool v) { fputs(v ? "true" : "false", stream()); }

void ore_rt_print_string(ore_string v) { fwrite(v.ptr, 1, (size_t)v.len, stream()); }

void ore_rt_print_space(void) { fputc(' ', stream()); }

void ore_rt_print_newline(void) { fputc('\n', stream()); }

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
  fputs(buf, stream());
}

void ore_rt_print_f32(f32 v) {
  char buf[64];
  format_float(buf, v, 9, true);
  fputs(buf, stream());
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

f64 ore_rt_cbrt(f64 x) {
  if (x == 0 || !isfinite(x)) return cbrt(x);
  f64 y = cbrt(x);
  // One Newton step corrects the last bit.
  return y - (y * y * y - x) / (3 * y * y);
}

// -----------------------------------------------------------------------------
// String builder

void ore_sb_put(ore_sb *b, const void *bytes, i64 n) {
  if (b->len + n > b->cap) {
    i64 cap = b->cap < 64 ? 64 : b->cap * 2;
    while (cap < b->len + n) cap *= 2;
    u8 *data = ore_rt_alloc(cap);
    if (b->len > 0) memcpy(data, b->data, (size_t)b->len);
    b->data = data;
    b->cap = cap;
  }
  memcpy(b->data + b->len, bytes, (size_t)n);
  b->len += n;
}

ore_string ore_sb_string(ore_sb *b) { return (ore_string){b->data, b->len}; }

static void sb_puts(ore_sb *b, const char *s) { ore_sb_put(b, s, (i64)strlen(s)); }

// -----------------------------------------------------------------------------
// JSON output

void ore_rt_json_str(ore_sb *b, ore_string s) {
  static const char hex[] = "0123456789abcdef";
  ore_sb_putc(b, '"');
  i64 start = 0;
  for (i64 i = 0; i < s.len; i++) {
    u8 c = s.ptr[i];
    if (c >= 0x20 && c != '"' && c != '\\') continue;
    ore_sb_put(b, s.ptr + start, i - start);
    start = i + 1;
    switch (c) {
      case '"': sb_puts(b, "\\\""); break;
      case '\\': sb_puts(b, "\\\\"); break;
      case '\n': sb_puts(b, "\\n"); break;
      case '\r': sb_puts(b, "\\r"); break;
      case '\t': sb_puts(b, "\\t"); break;
      case '\b': sb_puts(b, "\\b"); break;
      case '\f': sb_puts(b, "\\f"); break;
      default: {
        char u[7] = {'\\', 'u', '0', '0', hex[c >> 4], hex[c & 15], 0};
        sb_puts(b, u);
      }
    }
  }
  ore_sb_put(b, s.ptr + start, s.len - start);
  ore_sb_putc(b, '"');
}

void ore_rt_json_i64(ore_sb *b, i64 v) {
  char buf[32];
  ore_sb_put(b, buf, snprintf(buf, sizeof buf, "%lld", (long long)v));
}

void ore_rt_json_u64(ore_sb *b, u64 v) {
  char buf[32];
  ore_sb_put(b, buf, snprintf(buf, sizeof buf, "%llu", (unsigned long long)v));
}

void ore_rt_json_f64(ore_sb *b, f64 v) {
  if (!isfinite(v)) return sb_puts(b, "null");
  char buf[64];
  format_float(buf, v, 17, false);
  sb_puts(b, buf);
}

void ore_rt_json_f32(ore_sb *b, f32 v) {
  if (!isfinite(v)) return sb_puts(b, "null");
  char buf[64];
  format_float(buf, v, 9, true);
  sb_puts(b, buf);
}

void ore_rt_json_newline(ore_sb *b, i64 indent, i64 depth) {
  if (indent <= 0) return;
  ore_sb_putc(b, '\n');
  for (i64 i = 0; i < indent * depth; i++) ore_sb_putc(b, ' ');
}

// -----------------------------------------------------------------------------
// JSON parsing

typedef struct {
  const u8 *p;
  const u8 *start;
  const u8 *end;
  int depth;
  const char *error;
} json_parser;

static ore_json *json_value(json_parser *ps);

static void json_space(json_parser *ps) {
  while (ps->p < ps->end && (*ps->p == ' ' || *ps->p == '\t' || *ps->p == '\n' || *ps->p == '\r')) ps->p++;
}

static ore_json *json_fail(json_parser *ps, const char *error) {
  if (!ps->error) ps->error = error;
  return NULL;
}

static ore_json *json_new(i32 kind) {
  ore_json *v = ore_rt_alloc(sizeof(ore_json));
  v->kind = kind;
  return v;
}

static bool json_literal(json_parser *ps, const char *word) {
  size_t n = strlen(word);
  if ((size_t)(ps->end - ps->p) < n || memcmp(ps->p, word, n) != 0) return false;
  ps->p += n;
  return true;
}

static int json_hex4(json_parser *ps) {
  if (ps->end - ps->p < 4) return -1;
  int v = 0;
  for (int i = 0; i < 4; i++) {
    u8 c = ps->p[i];
    v <<= 4;
    if (c >= '0' && c <= '9') v |= c - '0';
    else if (c >= 'a' && c <= 'f') v |= c - 'a' + 10;
    else if (c >= 'A' && c <= 'F') v |= c - 'A' + 10;
    else return -1;
  }
  ps->p += 4;
  return v;
}

static void sb_utf8(ore_sb *b, u32 cp) {
  char out[4];
  int n;
  if (cp < 0x80) out[0] = (char)cp, n = 1;
  else if (cp < 0x800) out[0] = (char)(0xC0 | cp >> 6), out[1] = (char)(0x80 | (cp & 0x3F)), n = 2;
  else if (cp < 0x10000) out[0] = (char)(0xE0 | cp >> 12), out[1] = (char)(0x80 | ((cp >> 6) & 0x3F)), out[2] = (char)(0x80 | (cp & 0x3F)), n = 3;
  else out[0] = (char)(0xF0 | cp >> 18), out[1] = (char)(0x80 | ((cp >> 12) & 0x3F)), out[2] = (char)(0x80 | ((cp >> 6) & 0x3F)), out[3] = (char)(0x80 | (cp & 0x3F)), n = 4;
  ore_sb_put(b, out, n);
}

static bool json_string(json_parser *ps, ore_string *out) {
  ps->p++;  // the opening quote
  ore_sb b = {0};
  const u8 *run = ps->p;
  while (ps->p < ps->end && *ps->p != '"') {
    u8 c = *ps->p;
    if (c < 0x20) return json_fail(ps, "control character in string"), false;
    if (c != '\\') {
      ps->p++;
      continue;
    }
    ore_sb_put(&b, run, ps->p - run);
    ps->p++;
    if (ps->p >= ps->end) break;
    c = *ps->p++;
    switch (c) {
      case '"': ore_sb_putc(&b, '"'); break;
      case '\\': ore_sb_putc(&b, '\\'); break;
      case '/': ore_sb_putc(&b, '/'); break;
      case 'b': ore_sb_putc(&b, '\b'); break;
      case 'f': ore_sb_putc(&b, '\f'); break;
      case 'n': ore_sb_putc(&b, '\n'); break;
      case 'r': ore_sb_putc(&b, '\r'); break;
      case 't': ore_sb_putc(&b, '\t'); break;
      case 'u': {
        int cp = json_hex4(ps);
        if (cp < 0) return json_fail(ps, "invalid \\u escape"), false;
        // A surrogate pair encodes a code point above U+FFFF.
        if (cp >= 0xD800 && cp < 0xDC00 && ps->end - ps->p >= 6 && ps->p[0] == '\\' && ps->p[1] == 'u') {
          const u8 *save = ps->p;
          ps->p += 2;
          int low = json_hex4(ps);
          if (low >= 0xDC00 && low < 0xE000) cp = 0x10000 + ((cp - 0xD800) << 10) + (low - 0xDC00);
          else ps->p = save;
        }
        if (cp >= 0xD800 && cp < 0xE000) cp = 0xFFFD;
        sb_utf8(&b, (u32)cp);
        break;
      }
      default:
        return json_fail(ps, "invalid escape in string"), false;
    }
    run = ps->p;
  }
  if (ps->p >= ps->end) return json_fail(ps, "unterminated string"), false;
  ore_sb_put(&b, run, ps->p - run);
  ps->p++;  // the closing quote
  *out = ore_sb_string(&b);
  return true;
}

static ore_json *json_number(json_parser *ps) {
  const u8 *s = ps->p;
  if (ps->p < ps->end && *ps->p == '-') ps->p++;
  if (ps->p >= ps->end || *ps->p < '0' || *ps->p > '9') return json_fail(ps, "invalid number");
  if (*ps->p == '0') ps->p++;
  else
    while (ps->p < ps->end && *ps->p >= '0' && *ps->p <= '9') ps->p++;
  if (ps->p < ps->end && *ps->p == '.') {
    ps->p++;
    if (ps->p >= ps->end || *ps->p < '0' || *ps->p > '9') return json_fail(ps, "invalid number");
    while (ps->p < ps->end && *ps->p >= '0' && *ps->p <= '9') ps->p++;
  }
  if (ps->p < ps->end && (*ps->p == 'e' || *ps->p == 'E')) {
    ps->p++;
    if (ps->p < ps->end && (*ps->p == '+' || *ps->p == '-')) ps->p++;
    if (ps->p >= ps->end || *ps->p < '0' || *ps->p > '9') return json_fail(ps, "invalid number");
    while (ps->p < ps->end && *ps->p >= '0' && *ps->p <= '9') ps->p++;
  }
  ore_json *v = json_new(ORE_JSON_NUMBER);
  v->str = str_copy((const char *)s, (size_t)(ps->p - s));
  v->num = strtod((const char *)v->str.ptr, NULL);
  return v;
}

/** Appends to a growing array of values (and keys). */
static void json_append(ore_json *v, i64 *cap, ore_json *item, ore_string *key) {
  if (v->len == *cap) {
    i64 n = *cap == 0 ? 4 : *cap * 2;
    ore_json **items = ore_rt_alloc(n * (i64)sizeof(ore_json *));
    if (v->len) memcpy(items, v->items, (size_t)v->len * sizeof(ore_json *));
    v->items = items;
    if (key) {
      ore_string *keys = ore_rt_alloc(n * (i64)sizeof(ore_string));
      if (v->len) memcpy(keys, v->keys, (size_t)v->len * sizeof(ore_string));
      v->keys = keys;
    }
    *cap = n;
  }
  if (key) v->keys[v->len] = *key;
  v->items[v->len++] = item;
}

static ore_json *json_value(json_parser *ps) {
  json_space(ps);
  if (ps->p >= ps->end) return json_fail(ps, "unexpected end of input");
  if (++ps->depth > 512) return json_fail(ps, "nested too deeply");
  ore_json *result = NULL;
  switch (*ps->p) {
    case 'n':
      if (json_literal(ps, "null")) result = json_new(ORE_JSON_NULL);
      break;
    case 't':
    case 'f': {
      bool t = *ps->p == 't';
      if (json_literal(ps, t ? "true" : "false")) result = json_new(ORE_JSON_BOOL), result->b = t;
      break;
    }
    case '"': {
      ore_string s;
      if (!json_string(ps, &s)) return NULL;
      result = json_new(ORE_JSON_STRING);
      result->str = s;
      break;
    }
    case '[': {
      ps->p++;
      result = json_new(ORE_JSON_ARRAY);
      i64 cap = 0;
      json_space(ps);
      if (ps->p < ps->end && *ps->p == ']') {
        ps->p++;
        break;
      }
      for (;;) {
        ore_json *item = json_value(ps);
        if (!item) return NULL;
        json_append(result, &cap, item, NULL);
        json_space(ps);
        if (ps->p < ps->end && *ps->p == ',') {
          ps->p++;
          continue;
        }
        if (ps->p < ps->end && *ps->p == ']') {
          ps->p++;
          break;
        }
        return json_fail(ps, "expected ',' or ']'");
      }
      break;
    }
    case '{': {
      ps->p++;
      result = json_new(ORE_JSON_OBJECT);
      i64 cap = 0;
      json_space(ps);
      if (ps->p < ps->end && *ps->p == '}') {
        ps->p++;
        break;
      }
      for (;;) {
        json_space(ps);
        if (ps->p >= ps->end || *ps->p != '"') return json_fail(ps, "expected a string key");
        ore_string key;
        if (!json_string(ps, &key)) return NULL;
        json_space(ps);
        if (ps->p >= ps->end || *ps->p != ':') return json_fail(ps, "expected ':'");
        ps->p++;
        ore_json *item = json_value(ps);
        if (!item) return NULL;
        json_append(result, &cap, item, &key);
        json_space(ps);
        if (ps->p < ps->end && *ps->p == ',') {
          ps->p++;
          continue;
        }
        if (ps->p < ps->end && *ps->p == '}') {
          ps->p++;
          break;
        }
        return json_fail(ps, "expected ',' or '}'");
      }
      break;
    }
    default:
      result = json_number(ps);
  }
  ps->depth--;
  return result ? result : json_fail(ps, "unexpected character");
}

ore_json *ore_rt_json_parse(ore_string text, ore_string *error) {
  json_parser ps = {text.ptr, text.ptr, text.ptr + text.len, 0, NULL};
  ore_json *v = json_value(&ps);
  if (v) {
    json_space(&ps);
    if (ps.p < ps.end) v = json_fail(&ps, "unexpected text after the value");
  }
  if (v) return v;
  char buf[128];
  snprintf(buf, sizeof buf, "JSON: %s at offset %lld", ps.error, (long long)(ps.p - ps.start));
  *error = str_copy(buf, strlen(buf));
  return NULL;
}

ore_json *ore_rt_json_field(ore_json *object, const char *key, i64 len) {
  for (i64 i = object->len - 1; i >= 0; i--) {
    ore_string k = object->keys[i];
    if (k.len == len && memcmp(k.ptr, key, (size_t)len) == 0) return object->items[i];
  }
  return NULL;
}

// -----------------------------------------------------------------------------
// JSON decoding

static const char *json_kind_name(ore_json *v) {
  static const char *names[] = {"null", "a boolean", "a number", "a string", "an array", "an object"};
  return names[v->kind];
}

static void json_set_error(ore_json_ctx *c, const char *message) {
  if (c->failed) return;
  c->failed = true;
  c->message = str_copy(message, strlen(message));
  c->path = ORE_STR("");
}

void ore_rt_json_expected(ore_json_ctx *c, const char *what, ore_json *v) {
  char buf[256];
  snprintf(buf, sizeof buf, "expected %s, got %s", what, json_kind_name(v));
  json_set_error(c, buf);
}

void ore_rt_json_missing(ore_json_ctx *c, const char *field) {
  char buf[256];
  snprintf(buf, sizeof buf, "missing field '%s'", field);
  json_set_error(c, buf);
}

static void json_prefix(ore_json_ctx *c, const char *segment) {
  ore_sb b = {0};
  sb_puts(&b, segment);
  ore_sb_put(&b, c->path.ptr, c->path.len);
  c->path = ore_sb_string(&b);
}

void ore_rt_json_at_field(ore_json_ctx *c, const char *field) {
  char buf[256];
  snprintf(buf, sizeof buf, ".%s", field);
  json_prefix(c, buf);
}

void ore_rt_json_at_index(ore_json_ctx *c, i64 index) {
  char buf[32];
  snprintf(buf, sizeof buf, "[%lld]", (long long)index);
  json_prefix(c, buf);
}

/** Whether the source text of a number has a fraction or an exponent. */
static bool json_is_float(ore_json *v) {
  for (i64 i = 0; i < v->str.len; i++)
    if (v->str.ptr[i] == '.' || v->str.ptr[i] == 'e' || v->str.ptr[i] == 'E') return true;
  return false;
}

bool ore_rt_json_int(ore_json_ctx *c, ore_json *v, i64 min, i64 max, i64 *out) {
  if (v->kind != ORE_JSON_NUMBER) return ore_rt_json_expected(c, "an integer", v), false;
  i64 n;
  if (json_is_float(v)) {
    if (v->num != trunc(v->num) || v->num < -9223372036854775808.0 || v->num >= 9223372036854775808.0) goto range;
    n = (i64)v->num;
  } else {
    errno = 0;
    n = strtoll((const char *)v->str.ptr, NULL, 10);
    if (errno == ERANGE) goto range;
  }
  if (n < min || n > max) goto range;
  *out = n;
  return true;
range:;
  char buf[160];
  snprintf(buf, sizeof buf, "number %.*s is not an integer in [%lld, %lld]", (int)v->str.len, v->str.ptr, (long long)min, (long long)max);
  json_set_error(c, buf);
  return false;
}

bool ore_rt_json_uint(ore_json_ctx *c, ore_json *v, u64 max, u64 *out) {
  if (v->kind != ORE_JSON_NUMBER) return ore_rt_json_expected(c, "an integer", v), false;
  u64 n;
  if (v->str.len > 0 && v->str.ptr[0] == '-') goto range;
  if (json_is_float(v)) {
    if (v->num != trunc(v->num) || v->num >= 18446744073709551616.0) goto range;
    n = (u64)v->num;
  } else {
    errno = 0;
    n = strtoull((const char *)v->str.ptr, NULL, 10);
    if (errno == ERANGE) goto range;
  }
  if (n > max) goto range;
  *out = n;
  return true;
range:;
  char buf[160];
  snprintf(buf, sizeof buf, "number %.*s is not an integer in [0, %llu]", (int)v->str.len, v->str.ptr, (unsigned long long)max);
  json_set_error(c, buf);
  return false;
}

ore_string ore_rt_json_error(ore_json_ctx *c) {
  ore_sb b = {0};
  sb_puts(&b, "JSON: ");
  ore_sb_put(&b, c->message.ptr, c->message.len);
  if (c->path.len > 0) {
    sb_puts(&b, " at ");
    ore_sb_put(&b, c->path.ptr, c->path.len);
  }
  return ore_sb_string(&b);
}
