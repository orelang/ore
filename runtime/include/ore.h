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

/** JavaScript parseInt: true and the value if there are digits. */
bool ore_rt_parse_int(ore_string s, i64 radix, i64 *out);
/** JavaScript parseFloat: true and the value if a number starts the string. */
bool ore_rt_parse_float(ore_string s, f64 *out);
/** x with `digits` digits after the point. */
ore_string ore_rt_str_fixed(f64 x, i64 digits);
/** Reads a whole file; on failure, false and the error message in `out`. */
bool ore_rt_read_file(ore_string path, ore_string *out);
/** Writes a whole file; on failure, false and the error message in `err`. */
bool ore_rt_write_file(ore_string path, ore_string data, ore_string *err);
bool ore_rt_file_exists(ore_string path);
/** Milliseconds since the Unix epoch. */
i64 ore_rt_now(void);

/** Math.round: half up, toward +Infinity, as in JavaScript. */
f64 ore_rt_round(f64 x);
/** A pseudo-random number in [0, 1). */
f64 ore_rt_random(void);

/** A new heap box holding a copy of the `size` bytes at `p`; used for per-iteration loop variables. */
void *ore_rt_box_copy(void *p, i64 size);

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

_Noreturn void ore_rt_panic(ore_string message);
_Noreturn void ore_rt_panic_cstr(const char *message);
_Noreturn void ore_rt_panic_index(i64 index, i64 length);

/** Allocates zeroed, garbage-collected memory. */
void *ore_rt_alloc(i64 size);

// Strings

bool ore_rt_str_eq(ore_string a, ore_string b);
/** Byte-wise comparison: negative, zero or positive. */
i32 ore_rt_str_cmp(ore_string a, ore_string b);
ore_string ore_rt_str_concat(i64 count, const ore_string *parts);
/** JavaScript `slice` on byte offsets: negative offsets count from the end, out-of-range offsets are clamped. */
ore_string ore_rt_str_slice(ore_string s, i64 start, i64 end);
/** Decodes the UTF-8 rune at `*pos` and advances it. Invalid bytes decode to U+FFFD one at a time. */
i32 ore_rt_str_decode(ore_string s, i64 *pos);
// String methods, with JavaScript semantics on byte offsets.
i64 ore_rt_str_index_of(ore_string s, ore_string sub, i64 from);
i64 ore_rt_str_last_index_of(ore_string s, ore_string sub);
bool ore_rt_str_starts_with(ore_string s, ore_string prefix);
bool ore_rt_str_ends_with(ore_string s, ore_string suffix);
/** Trims ASCII whitespace: from the start (1), the end (2), or both (3). */
ore_string ore_rt_str_trim(ore_string s, int sides);
/** ASCII letters to upper case (upper) or lower case. */
ore_string ore_rt_str_case(ore_string s, bool upper);
/** Replaces the first occurrence of `from` (all of them with `all`). */
ore_string ore_rt_str_replace(ore_string s, ore_string from, ore_string to, bool all);
ore_string ore_rt_str_repeat(ore_string s, i64 count);
/** Pads to `length` bytes with repetitions of `pad`, at the start or the end. */
ore_string ore_rt_str_pad(ore_string s, i64 length, ore_string pad, bool start);
/** JavaScript substring: clamped offsets, swapped if start > end. */
ore_string ore_rt_str_substring(ore_string s, i64 start, i64 end);

ore_string ore_rt_str_from_i64(i64 v);
ore_string ore_rt_str_from_u64(u64 v);
ore_string ore_rt_str_from_f64(f64 v);
ore_string ore_rt_str_from_f32(f32 v);
ore_string ore_rt_str_from_bool(bool v);

static inline u8 ore_rt_str_at(ore_string s, i64 i) {
  if ((u64)i >= (u64)s.len) ore_rt_panic_index(i, s.len);
  return s.ptr[i];
}

// Arrays are references to a growable buffer of elements of one type.

typedef struct {
  void *data;
  i64 len;
  i64 cap;
} ore_array;

/** A new array of `len` zeroed elements. */
ore_array *ore_rt_array_new(i64 elem_size, i64 len);
/** Appends one zeroed element and returns a pointer to it. */
void *ore_rt_array_push(ore_array *a, i64 elem_size);
/** Removes the last element and returns a pointer to it; panics if empty. */
void *ore_rt_array_pop(ore_array *a, i64 elem_size);
/** A copy of the elements in [start, end), with JavaScript `slice` offsets. */
ore_array *ore_rt_array_slice(ore_array *a, i64 elem_size, i64 start, i64 end);

static inline i64 ore_rt_check_index(i64 i, i64 len) {
  if ((u64)i >= (u64)len) ore_rt_panic_index(i, len);
  return i;
}

/** Compares two elements for sorting: negative, zero or positive. */
typedef int (*ore_cmp_fn)(void *ctx, const void *a, const void *b);

/** Sorts an array in place, stably (merge sort). */
void ore_rt_array_sort(ore_array *a, i64 elem_size, ore_cmp_fn cmp, void *ctx);
void ore_rt_array_reverse(ore_array *a, i64 elem_size);
/** Splits around `sep`; an empty `sep` splits into UTF-8 characters. Returns an array of strings. */
ore_array *ore_rt_str_split(ore_string s, ore_string sep);
/** Joins an array of strings with a separator. */
ore_string ore_rt_str_join(ore_array *strings, ore_string sep);

/** Pointer to element `i`, bounds-checked. */
static inline void *ore_rt_array_at(ore_array *a, i64 i, i64 elem_size) {
  return (u8 *)a->data + elem_size * ore_rt_check_index(i, a->len);
}

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

// Maps: hash tables that keep insertion order, like JavaScript's Map. Entries
// are stored densely in insertion order; deleted entries stay as holes until
// the table is rebuilt. An open-addressing index maps hashes to entries.

typedef u64 (*ore_hash_fn)(const void *key);
typedef bool (*ore_eq_fn)(const void *a, const void *b);

typedef struct {
  i64 key_size, value_size, entry_size;
  ore_hash_fn hash;
  ore_eq_fn eq;
  /** Entries in insertion order, each a header {i64 live; u64 hash}, key, value. */
  u8 *entries;
  i64 count, cap, size;
  /** Entry index + 1 per slot; 0 for an empty slot. Power-of-two capacity. */
  i64 *index;
  i64 index_cap;
} ore_map;

ore_map *ore_rt_map_new(i64 key_size, i64 value_size, ore_hash_fn hash, ore_eq_fn eq);
/** Pointer to the value of `key`, or NULL. */
void *ore_rt_map_get(ore_map *m, const void *key);
void ore_rt_map_set(ore_map *m, const void *key, const void *value);
bool ore_rt_map_delete(ore_map *m, const void *key);
void ore_rt_map_clear(ore_map *m);
ore_array *ore_rt_map_keys(ore_map *m);
ore_array *ore_rt_map_values(ore_map *m);

static inline u8 *ore_rt_map_entry(ore_map *m, i64 i) { return m->entries + i * m->entry_size; }
static inline bool ore_rt_map_live(ore_map *m, i64 i) { return *(i64 *)ore_rt_map_entry(m, i) != 0; }
static inline void *ore_rt_map_key(ore_map *m, i64 i) { return ore_rt_map_entry(m, i) + 16; }
static inline void *ore_rt_map_value(ore_map *m, i64 i) {
  return ore_rt_map_entry(m, i) + 16 + ((m->key_size + 7) & ~7);
}

u64 ore_rt_hash_u64(u64 x);
u64 ore_rt_hash_bytes(const u8 *p, i64 n);
u64 ore_rt_hash_f64(f64 x);
/** SameValueZero for floats: NaN equals NaN, and -0 equals 0. */
static inline bool ore_rt_same_f64(f64 a, f64 b) { return a == b || (a != a && b != b); }

/** Sentinel for an omitted `end` argument of `slice`. */
#define ORE_SLICE_END INT64_MAX

/**
 * Runs a test body (a closure taking no arguments), catching a panic in it.
 * At exit, prints a summary and exits with status 1 if a test failed.
 */
void ore_rt_run_test(ore_string name, ore_closure body);

/** A NUL-terminated copy of a string, for C. */
const char *ore_rt_cstring(ore_string s);
/** A copy of a NUL-terminated C string; empty for NULL. */
ore_string ore_rt_from_cstring(const char *p);

/** The command-line arguments after the program name, as an array of strings. */
ore_array *ore_rt_args(void);
/** An environment variable; a string without a pointer when unset. */
ore_string ore_rt_getenv(ore_string name);

/** Directs printing to stdout (1) or stderr (2). */
void ore_rt_print_to(int fd);
_Noreturn void ore_rt_exit(i32 code);

void ore_rt_print_i64(i64 v);
void ore_rt_print_u64(u64 v);
void ore_rt_print_f64(f64 v);
void ore_rt_print_f32(f32 v);
void ore_rt_print_bool(bool v);
void ore_rt_print_string(ore_string v);
void ore_rt_print_space(void);
void ore_rt_print_newline(void);

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

// Green threads (tasks), scheduled cooperatively on one OS thread.

/** Runs `entry` as the main task and schedules tasks until it returns. */
void ore_rt_run_main(void (*entry)(void));
/** Starts a task running a closure without arguments. */
void ore_rt_spawn(ore_closure body);
/** Lets other runnable tasks run first. */
void ore_rt_yield(void);
/** Suspends the current task for `ms` milliseconds. */
void ore_rt_sleep(i64 ms);
/** The current task. */
void *ore_rt_task_current(void);
/**
 * Brackets a call that may block its OS thread, such as file I/O, so that
 * another worker runs the other tasks meanwhile.
 */
void ore_rt_blocking_enter(void);
void ore_rt_blocking_exit(void);

// Channels, as in Go: a buffer of `cap` values (none for a rendezvous) and
// queues of tasks waiting to send or receive.

typedef struct ore_waiter ore_waiter;

typedef struct {
  i64 elem_size, cap, len, head;
  u8 *buf;
  bool closed;
  ore_waiter *receivers, *senders;
  /** A pthread mutex guarding the channel. */
  void *lock;
} ore_chan;

ore_chan *ore_rt_chan_new(i64 elem_size, i64 cap);
/** Sends the value at `value`, blocking until there is room or a receiver; panics if closed. */
void ore_rt_chan_send(ore_chan *c, const void *value);
/** Receives into `out`, blocking until there is a value; false (and zeroes) once closed and empty. */
bool ore_rt_chan_recv(ore_chan *c, void *out);
/** Closes a channel: waiting receivers get nothing, waiting senders panic. */
void ore_rt_chan_close(ore_chan *c);

/** A case of a select: a receive, a send, or a timeout, with its handler. */
typedef struct ore_select_case ore_select_case;

ore_select_case *ore_rt_case_recv(ore_chan *c, ore_closure handler, void (*dispatch)(ore_select_case *));
ore_select_case *ore_rt_case_send(ore_chan *c, const void *value, ore_closure handler);
ore_select_case *ore_rt_case_after(i64 ms, ore_closure handler);
/** The received value of a receive case, and whether there was one, for its dispatch function. */
void *ore_rt_case_value(ore_select_case *c, bool *ok);
/** The handler of a case. */
ore_closure ore_rt_case_handler(ore_select_case *c);
/**
 * Runs the handler of one case that can proceed, waiting for one unless
 * `otherwise` (a closure, or one without code) runs instead.
 */
void ore_rt_select(ore_array *cases, ore_closure otherwise);

// -----------------------------------------------------------------------------
// String builder

/** A growing byte buffer for building strings. Zero-initialize to start. */
typedef struct {
  u8 *data;
  i64 len;
  i64 cap;
} ore_sb;

void ore_sb_put(ore_sb *b, const void *bytes, i64 n);
static inline void ore_sb_putc(ore_sb *b, char c) { ore_sb_put(b, &c, 1); }
/** The bytes written so far, as a string. */
ore_string ore_sb_string(ore_sb *b);

// -----------------------------------------------------------------------------
// JSON

/** Writes `s` as a JSON string literal. */
void ore_rt_json_str(ore_sb *b, ore_string s);
void ore_rt_json_i64(ore_sb *b, i64 v);
void ore_rt_json_u64(ore_sb *b, u64 v);
/** Writes a number; NaN and infinities become `null`, as in JavaScript. */
void ore_rt_json_f64(ore_sb *b, f64 v);
void ore_rt_json_f32(ore_sb *b, f32 v);
/** With `indent` > 0: a line break and `indent * depth` spaces. */
void ore_rt_json_newline(ore_sb *b, i64 indent, i64 depth);

enum { ORE_JSON_NULL, ORE_JSON_BOOL, ORE_JSON_NUMBER, ORE_JSON_STRING, ORE_JSON_ARRAY, ORE_JSON_OBJECT };

/** A parsed JSON value. Numbers keep their source text in `str`. */
typedef struct ore_json ore_json;
struct ore_json {
  i32 kind;
  bool b;
  f64 num;
  ore_string str;
  /** Elements of an array, or values of an object with their `keys`. */
  i64 len;
  ore_json **items;
  ore_string *keys;
};

/** Parses a JSON text, or returns NULL and an error message. */
ore_json *ore_rt_json_parse(ore_string text, ore_string *error);
/** The value of a key of an object (the last one if repeated), or NULL. */
ore_json *ore_rt_json_field(ore_json *object, const char *key, i64 len);

/** The state of decoding a JSON value into a type: the first error and where it happened. */
typedef struct {
  bool failed;
  ore_string message;
  ore_string path;
} ore_json_ctx;

/** Fails with "expected <what>, got <the kind of v>". */
void ore_rt_json_expected(ore_json_ctx *c, const char *what, ore_json *v);
void ore_rt_json_missing(ore_json_ctx *c, const char *field);
/** Prefixes the path of a failure with a field (".name") or an index ("[3]"). */
void ore_rt_json_at_field(ore_json_ctx *c, const char *field);
void ore_rt_json_at_index(ore_json_ctx *c, i64 index);
/** Reads an integer in [min, max]. */
bool ore_rt_json_int(ore_json_ctx *c, ore_json *v, i64 min, i64 max, i64 *out);
bool ore_rt_json_uint(ore_json_ctx *c, ore_json *v, u64 max, u64 *out);
/** The message of a failed decoding, with its path. */
ore_string ore_rt_json_error(ore_json_ctx *c);

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
