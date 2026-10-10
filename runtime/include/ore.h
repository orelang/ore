// Ore runtime interface used by generated C code.
//
// Generated code is compiled with -fwrapv: signed integer overflow wraps.
// The helpers below define the remaining operations that are undefined in C.

#ifndef ORE_H
#define ORE_H

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

// Entry point emitted by the compiler; calls the user's `main`.
void ore_entry(void);

_Noreturn void ore_rt_panic(ore_string message);
_Noreturn void ore_rt_panic_cstr(const char *message);

bool ore_rt_str_eq(ore_string a, ore_string b);

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
