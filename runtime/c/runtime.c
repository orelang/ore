// POSIX and GNU declarations of glibc (clock_gettime, mmap flags, ...), hidden by -std=c11.
#define _GNU_SOURCE

#include "ore.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <errno.h>
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

const char *ore_rt_cstring(ore_string s) { return c_string(s); }

ore_string ore_rt_from_cstring(const char *p) { return p ? str_copy(p, strlen(p)) : ORE_STR(""); }

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

// xorshift64*, per OS thread, seeded from the time and the thread.
static _Thread_local u64 random_state;

f64 ore_rt_random(void) {
  if (random_state == 0) random_state = ((u64)time(NULL) ^ (u64)(uintptr_t)&random_state) * 0x9e3779b97f4a7c15ull | 1;
  random_state ^= random_state >> 12;
  random_state ^= random_state << 25;
  random_state ^= random_state >> 27;
  return (f64)((random_state * 0x2545f4914f6cdd1dull) >> 11) / 9007199254740992.0;
}

/** Memory that never holds pointers, so the GC does not scan it. Not zeroed. */
static void *alloc_atomic(i64 size) {
  void *p = GC_malloc_atomic(size > 0 ? (size_t)size : 1);
  if (!p) ore_rt_panic_cstr("out of memory");
  return p;
}

// ---------------------------------------------------------------------------
// Strings

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

// ---------------------------------------------------------------------------
// Interfaces

ore_iface ore_rt_iface_project(ore_iface v, i64 count, const i32 *indices) {
  void **itab = ore_rt_alloc((count + 1) * (i64)sizeof(void *));
  itab[0] = v.itab[0];
  for (i64 k = 0; k < count; k++) itab[k + 1] = v.itab[indices[k] + 1];
  return (ore_iface){v.data, (void *const *)itab};
}

