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

