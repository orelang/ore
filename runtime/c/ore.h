// Ore runtime interface used by generated C code.
//
// Generated code is compiled with -fwrapv: signed integer overflow wraps.
// The helpers below define the remaining operations that are undefined in C.

#ifndef ORE_H
#define ORE_H

#include <math.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef int8_t i8;
typedef int16_t i16;
typedef int32_t i32;
typedef int64_t i64;
typedef uint8_t u8;
typedef uint16_t u16;
typedef uint32_t u32;
typedef uint64_t u64;
typedef float f32;
typedef double f64;

/** Immutable UTF-8 string slice. Not NUL-terminated. */
typedef struct {
  const u8 *ptr;
  i64 len;
} ore_string;

#define ORE_STR(lit) ((ore_string){(const u8 *)(lit), (i64)(sizeof(lit) - 1)})

/**
 * A function value: code and the environment it was created in. The code
 * takes the environment as its first argument. A null function has no code.
 */
typedef struct {
  void *fn;
  void *env;
} ore_closure;

/** Reads a whole file; on failure, false and the error message in `out`. */
bool ore_rt_read_file(ore_string path, ore_string *out);
/** Writes a whole file; on failure, false and the error message in `err`. */
bool ore_rt_write_file(ore_string path, ore_string data, ore_string *err);
bool ore_rt_file_exists(ore_string path);
/** Milliseconds since the Unix epoch. */
i64 ore_rt_now(void);

/** A pseudo-random number in [0, 1). */
f64 ore_rt_random(void);


// Entry point emitted by the compiler; calls the user's `main`.
void ore_entry(void);

/**
 * A call frame on the shadow stack kept by debug builds for stack traces.
 * Each function pushes one on entry, updates `line` before each statement and
 * pops it on return.
 */
typedef struct ore_frame {
  struct ore_frame *prev;
  const char *func;
  const char *file;
  i32 line;
} ore_frame;

extern _Thread_local ore_frame *ore_rt_top;

// Panics are in runtime/core/program.ore, which exports these two for C.
_Noreturn void ore_rt_panic_cstr(const char *message);
_Noreturn void ore_rt_panic_index(i64 index, i64 length);

/** Allocates zeroed, garbage-collected memory. */
void *ore_rt_alloc(i64 size);
/** Allocates zeroed, garbage-collected memory that is never scanned for pointers. */
void *ore_rt_alloc_bytes(i64 size);

// Strings. Comparison, search and the string methods are in runtime/core/string.ore.


// Arrays are references to a growable buffer of elements of one type; their
// functions are in runtime/core/array.ore.

typedef struct {
  void *data;
  i64 len;
  i64 cap;
} ore_array;

// Interfaces: a reference to a struct and a table. Entry 0 of the table is the
// type id of the struct; entry `i + 1` is, for member `i` of the interface
// sorted by name, the field offset or the method.

typedef struct {
  void *data;
  void *const *itab;
} ore_iface;

/** Pointer to the field whose offset is in the table for member `i`. */
static inline void *ore_iface_field(ore_iface v, i64 i) { return (u8 *)v.data + (uintptr_t)v.itab[i + 1]; }

/** Whether an interface value refers to an instance of the struct with type id `id`. */
static inline bool ore_iface_is(ore_iface v, uintptr_t id) { return v.itab && (uintptr_t)v.itab[0] == id; }

/** Converts to a narrower interface: member `k` of the new table is member `indices[k]` of the old one. */
ore_iface ore_rt_iface_project(ore_iface v, i64 count, const i32 *indices);

// Maps and hashing are in runtime/core/map.ore.

/** Sentinel for an omitted `end` argument of `slice`. */
#define ORE_SLICE_END INT64_MAX

/** A NUL-terminated copy of a string, for C. */
const char *ore_rt_cstring(ore_string s);
/** A copy of a NUL-terminated C string; empty for NULL. */
ore_string ore_rt_from_cstring(const char *p);

// Printing, the program's entry and arguments, and the test runner are in
// runtime/core (io.ore and program.ore).

// Integer division and remainder: division by zero panics, MIN / -1 wraps.
#define ORE_DEF_DIV_SIGNED(T)                                                        \
  static inline T ore_div_##T(T a, T b) {                                            \
    if (b == 0) ore_rt_panic_cstr("integer divide by zero");                        \
    return b == -1 ? (T)(0 - (u64)a) : (T)(a / b);                                   \
  }                                                                                  \
  static inline T ore_rem_##T(T a, T b) {                                            \
    if (b == 0) ore_rt_panic_cstr("integer divide by zero");                        \
    return b == -1 ? 0 : (T)(a % b);                                                 \
  }
#define ORE_DEF_DIV_UNSIGNED(T)                                                      \
  static inline T ore_div_##T(T a, T b) {                                            \
    if (b == 0) ore_rt_panic_cstr("integer divide by zero");                        \
    return (T)(a / b);                                                               \
  }                                                                                  \
  static inline T ore_rem_##T(T a, T b) {                                            \
    if (b == 0) ore_rt_panic_cstr("integer divide by zero");                        \
    return (T)(a % b);                                                               \
  }

// Shifts by a count >= the bit width give 0 (or -1 for `>>` of a negative value).
#define ORE_DEF_SHIFT(T, UT, BITS, SIGNED)                                           \
  static inline T ore_shl_##T(T a, u64 n) { return n >= BITS ? 0 : (T)((UT)a << n); } \
  static inline T ore_shr_##T(T a, u64 n) {                                          \
    if (n >= BITS) return (SIGNED && a < 0) ? (T)-1 : 0;                             \
    return (T)(a >> n);                                                              \
  }

// Float to integer conversion truncates toward zero, saturates out of range, NaN gives 0.
#define ORE_DEF_FLOAT_TO_INT(T, MIN, MAX)                                            \
  static inline T ore_f2i_##T(f64 x) {                                               \
    if (x != x) return 0;                                                            \
    if (x <= (f64)(MIN)) return MIN;                                                 \
    if (x >= (f64)(MAX)) return MAX;                                                 \
    return (T)x;                                                                     \
  }

ORE_DEF_DIV_SIGNED(i8)
ORE_DEF_DIV_SIGNED(i16)
ORE_DEF_DIV_SIGNED(i32)
ORE_DEF_DIV_SIGNED(i64)
ORE_DEF_DIV_UNSIGNED(u8)
ORE_DEF_DIV_UNSIGNED(u16)
ORE_DEF_DIV_UNSIGNED(u32)
ORE_DEF_DIV_UNSIGNED(u64)

ORE_DEF_SHIFT(i8, u8, 8, 1)
ORE_DEF_SHIFT(i16, u16, 16, 1)
ORE_DEF_SHIFT(i32, u32, 32, 1)
ORE_DEF_SHIFT(i64, u64, 64, 1)
ORE_DEF_SHIFT(u8, u8, 8, 0)
ORE_DEF_SHIFT(u16, u16, 16, 0)
ORE_DEF_SHIFT(u32, u32, 32, 0)
ORE_DEF_SHIFT(u64, u64, 64, 0)

ORE_DEF_FLOAT_TO_INT(i8, INT8_MIN, INT8_MAX)
ORE_DEF_FLOAT_TO_INT(i16, INT16_MIN, INT16_MAX)
ORE_DEF_FLOAT_TO_INT(i32, INT32_MIN, INT32_MAX)
ORE_DEF_FLOAT_TO_INT(i64, INT64_MIN, INT64_MAX)
ORE_DEF_FLOAT_TO_INT(u8, 0, UINT8_MAX)
ORE_DEF_FLOAT_TO_INT(u16, 0, UINT16_MAX)
ORE_DEF_FLOAT_TO_INT(u32, 0, UINT32_MAX)
ORE_DEF_FLOAT_TO_INT(u64, 0, UINT64_MAX)

/** Converts a signed shift count; a negative count panics. */
static inline u64 ore_shift_count(i64 n) {
  if (n < 0) ore_rt_panic_cstr("negative shift amount");
  return (u64)n;
}

static inline f64 ore_fmod(f64 a, f64 b) { return __builtin_fmod(a, b); }
static inline f32 ore_fmodf(f32 a, f32 b) { return __builtin_fmodf(a, b); }

// Tasks, channels and select are in runtime/core (task.ore, chan.ore,
// poll.ore); these are the functions of theirs that the C code calls.

/** Runs `entry` as the main task and schedules tasks until it returns. */
void ore_rt_run_main(void (*entry)(void));
/** The current task. */
void *ore_rt_task_current(void);
/**
 * Brackets a call that may block its OS thread, such as file I/O, so that
 * another worker runs the other tasks meanwhile.
 */
void ore_rt_blocking_enter(void);
void ore_rt_blocking_exit(void);

// The string builder and JSON are in runtime/core/json.ore.

// -----------------------------------------------------------------------------
// Network (TCP), on non-blocking sockets

/** Parks the current task until a socket is ready for reading or writing. */
void ore_rt_net_wait(int fd, bool write);

// Each returns whether it succeeded; on failure, `err` holds the message.
bool ore_rt_net_listen(ore_string host, i64 port, i64 *fd, ore_string *err);
bool ore_rt_net_connect(ore_string host, i64 port, i64 *fd, ore_string *err);
bool ore_rt_net_accept(i64 listener, i64 *fd, ore_string *err);
/** Reads up to `max` bytes into `data` ("" at the end of the stream), or the error into it. */
bool ore_rt_net_read(i64 fd, i64 max, ore_string *data);
/** Writes all of `data`, or the error into `err`. */
bool ore_rt_net_write(i64 fd, ore_string data, ore_string *err);
void ore_rt_net_close(i64 fd);
/** The local port of a socket. */
i64 ore_rt_net_port(i64 fd);

#endif
