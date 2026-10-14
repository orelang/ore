// POSIX and GNU declarations of glibc (clock_gettime, mmap flags, ...), hidden by -std=c11.
#define _GNU_SOURCE

#include "ore.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <setjmp.h>
#include <string.h>
#include <unistd.h>

// Boehm GC, linked from runtime/third_party/bdwgc. Declared here so that the
// runtime builds without the GC headers.
void GC_init(void);
void *GC_malloc(size_t size);
void *GC_malloc_atomic(size_t size);

// Helpers defined below.
static void *alloc(i64 size);
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
// Memory, from the GC directly: generated code allocates through
// runtime/core/sys.ore, whose functions are not callable from C.

/** Zeroed memory that the GC scans for pointers. */
static void *alloc(i64 size) {
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

ore_array *ore_rt_args(void) {
  ore_array *a = array_new(sizeof(ore_string), 0);
  for (int i = 1; i < arg_count; i++) {
    *(ore_string *)array_push(a, sizeof(ore_string)) = str_copy(arg_values[i], strlen(arg_values[i]));
  }
  return a;
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
// Arrays

// Arrays for the C code; generated code uses runtime/core/array.ore.
static ore_array *array_new(i64 elem_size, i64 len) {
  ore_array *a = alloc(sizeof(ore_array));
  a->data = alloc(elem_size * len);
  a->len = len;
  a->cap = len;
  return a;
}

static void *array_push(ore_array *a, i64 elem_size) {
  if (a->len == a->cap) {
    i64 cap = a->cap < 4 ? 4 : a->cap * 2;
    void *data = alloc(elem_size * cap);
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

