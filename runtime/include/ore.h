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

#endif
