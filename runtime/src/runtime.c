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
  ore_array *a = ore_rt_array_new(sizeof(ore_string), 0);
  for (int i = 1; i < arg_count; i++) {
    *(ore_string *)ore_rt_array_push(a, sizeof(ore_string)) = str_copy(arg_values[i], strlen(arg_values[i]));
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

bool ore_rt_str_eq(ore_string a, ore_string b) {
  // A null string (from `string | null`) has no pointer; real strings always have one.
  if (!a.ptr || !b.ptr) return a.ptr == b.ptr;
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

i64 ore_rt_str_index_of(ore_string s, ore_string sub, i64 from) {
  if (from < 0) from = 0;
  for (i64 i = from; i + sub.len <= s.len; i++) {
    if (sub.len == 0 || memcmp(s.ptr + i, sub.ptr, (size_t)sub.len) == 0) return i;
  }
  return -1;
}

i64 ore_rt_str_last_index_of(ore_string s, ore_string sub) {
  for (i64 i = s.len - sub.len; i >= 0; i--) {
    if (sub.len == 0 || memcmp(s.ptr + i, sub.ptr, (size_t)sub.len) == 0) return i;
  }
  return -1;
}

bool ore_rt_str_starts_with(ore_string s, ore_string prefix) {
  return prefix.len <= s.len && (prefix.len == 0 || memcmp(s.ptr, prefix.ptr, (size_t)prefix.len) == 0);
}

bool ore_rt_str_ends_with(ore_string s, ore_string suffix) {
  return suffix.len <= s.len && (suffix.len == 0 || memcmp(s.ptr + s.len - suffix.len, suffix.ptr, (size_t)suffix.len) == 0);
}

ore_array *ore_rt_str_split(ore_string s, ore_string sep) {
  ore_array *parts = ore_rt_array_new(sizeof(ore_string), 0);
  if (sep.len == 0) {
    for (i64 pos = 0; pos < s.len;) {
      i64 start = pos;
      ore_rt_str_decode(s, &pos);
      *(ore_string *)ore_rt_array_push(parts, sizeof(ore_string)) = (ore_string){s.ptr + start, pos - start};
    }
    return parts;
  }
  i64 start = 0;
  for (i64 at; (at = ore_rt_str_index_of(s, sep, start)) != -1; start = at + sep.len) {
    *(ore_string *)ore_rt_array_push(parts, sizeof(ore_string)) = (ore_string){s.ptr + start, at - start};
  }
  *(ore_string *)ore_rt_array_push(parts, sizeof(ore_string)) = (ore_string){s.ptr + start, s.len - start};
  return parts;
}

static bool is_space(u8 c) { return c == ' ' || (c >= '\t' && c <= '\r'); }

ore_string ore_rt_str_trim(ore_string s, int sides) {
  i64 start = 0, end = s.len;
  if (sides & 1) while (start < end && is_space(s.ptr[start])) start++;
  if (sides & 2) while (end > start && is_space(s.ptr[end - 1])) end--;
  return (ore_string){s.ptr + start, end - start};
}

ore_string ore_rt_str_case(ore_string s, bool upper) {
  u8 *p = alloc_atomic(s.len);
  for (i64 i = 0; i < s.len; i++) {
    u8 c = s.ptr[i];
    p[i] = upper ? (c >= 'a' && c <= 'z' ? c - 32 : c) : (c >= 'A' && c <= 'Z' ? c + 32 : c);
  }
  return (ore_string){p, s.len};
}

ore_string ore_rt_str_replace(ore_string s, ore_string from, ore_string to, bool all) {
  ore_array *parts = ore_rt_array_new(sizeof(ore_string), 0);
  i64 start = 0;
  for (i64 at; (at = ore_rt_str_index_of(s, from, start)) != -1;) {
    *(ore_string *)ore_rt_array_push(parts, sizeof(ore_string)) = (ore_string){s.ptr + start, at - start};
    *(ore_string *)ore_rt_array_push(parts, sizeof(ore_string)) = to;
    start = at + from.len;
    // An empty pattern matches between characters; step over one to progress.
    if (from.len == 0) {
      if (at >= s.len || !all) break;
      *(ore_string *)ore_rt_array_push(parts, sizeof(ore_string)) = (ore_string){s.ptr + at, 1};
      start = at + 1;
    }
    if (!all) break;
  }
  *(ore_string *)ore_rt_array_push(parts, sizeof(ore_string)) = (ore_string){s.ptr + start, s.len - start};
  return ore_rt_str_concat(parts->len, parts->data);
}

ore_string ore_rt_str_repeat(ore_string s, i64 count) {
  if (count < 0) ore_rt_panic_cstr("invalid repeat count");
  u8 *p = alloc_atomic(s.len * count);
  for (i64 i = 0; i < count; i++) memcpy(p + i * s.len, s.ptr, (size_t)s.len);
  return (ore_string){p, s.len * count};
}

ore_string ore_rt_str_pad(ore_string s, i64 length, ore_string pad, bool start) {
  if (length <= s.len || pad.len == 0) return s;
  i64 fill = length - s.len;
  u8 *p = alloc_atomic(length);
  u8 *f = start ? p : p + s.len;
  for (i64 i = 0; i < fill; i++) f[i] = pad.ptr[i % pad.len];
  memcpy(start ? p + fill : p, s.ptr, (size_t)s.len);
  return (ore_string){p, length};
}

ore_string ore_rt_str_substring(ore_string s, i64 start, i64 end) {
  start = start < 0 ? 0 : start > s.len ? s.len : start;
  end = end < 0 ? 0 : end > s.len ? s.len : end;
  if (start > end) {
    i64 t = start;
    start = end;
    end = t;
  }
  return (ore_string){s.ptr + start, end - start};
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
  ore_array *a = ore_rt_array_new(m->key_size, 0);
  for (i64 i = 0; i < m->count; i++) {
    if (ore_rt_map_live(m, i)) memcpy(ore_rt_array_push(a, m->key_size), ore_rt_map_key(m, i), (size_t)m->key_size);
  }
  return a;
}

ore_array *ore_rt_map_values(ore_map *m) {
  ore_array *a = ore_rt_array_new(m->value_size, 0);
  for (i64 i = 0; i < m->count; i++) {
    if (ore_rt_map_live(m, i)) memcpy(ore_rt_array_push(a, m->value_size), ore_rt_map_value(m, i), (size_t)m->value_size);
  }
  return a;
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

void ore_rt_array_sort(ore_array *a, i64 elem_size, ore_cmp_fn cmp, void *ctx) {
  i64 n = a->len;
  if (n < 2) return;
  u8 *src = a->data;
  u8 *buf = ore_rt_alloc(n * elem_size);
  // Bottom-up merge sort: stable, as JavaScript requires.
  for (i64 width = 1; width < n; width *= 2) {
    for (i64 lo = 0; lo < n; lo += 2 * width) {
      i64 mid = lo + width < n ? lo + width : n;
      i64 hi = lo + 2 * width < n ? lo + 2 * width : n;
      i64 i = lo, j = mid, k = lo;
      while (i < mid && j < hi) {
        bool right = cmp(ctx, src + j * elem_size, src + i * elem_size) < 0;
        memcpy(buf + k++ * elem_size, src + (right ? j++ : i++) * elem_size, (size_t)elem_size);
      }
      while (i < mid) memcpy(buf + k++ * elem_size, src + i++ * elem_size, (size_t)elem_size);
      while (j < hi) memcpy(buf + k++ * elem_size, src + j++ * elem_size, (size_t)elem_size);
    }
    u8 *t = src;
    src = buf;
    buf = t;
  }
  if (src != a->data) memcpy(a->data, src, (size_t)(n * elem_size));
}

void ore_rt_array_reverse(ore_array *a, i64 elem_size) {
  u8 tmp[64];
  u8 *big = elem_size > (i64)sizeof tmp ? ore_rt_alloc(elem_size) : tmp;
  for (i64 i = 0, j = a->len - 1; i < j; i++, j--) {
    u8 *x = (u8 *)a->data + i * elem_size, *y = (u8 *)a->data + j * elem_size;
    memcpy(big, x, (size_t)elem_size);
    memcpy(x, y, (size_t)elem_size);
    memcpy(y, big, (size_t)elem_size);
  }
}

ore_string ore_rt_str_join(ore_array *strings, ore_string sep) {
  i64 n = strings->len;
  if (n == 0) return ORE_STR("");
  ore_string *parts = ore_rt_alloc((2 * n - 1) * (i64)sizeof(ore_string));
  for (i64 i = 0; i < n; i++) {
    if (i > 0) parts[2 * i - 1] = sep;
    parts[2 * i] = ((ore_string *)strings->data)[i];
  }
  return ore_rt_str_concat(2 * n - 1, parts);
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
