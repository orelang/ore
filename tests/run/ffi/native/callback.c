#include <stdbool.h>
#include <stdint.h>

// Defined in main.ore with //ore:export.
int64_t ore_square(int64_t x);
bool ore_is_small(uint8_t x);
double ore_half(double x);

int64_t sum_of_squares(int64_t n) {
  int64_t sum = 0;
  for (int64_t i = 1; i <= n; i++) sum += ore_square(i);
  return sum;
}

int32_t count_small(int32_t limit) {
  int32_t count = 0;
  for (int32_t i = 0; i < limit; i++) count += ore_is_small((uint8_t)i);
  return count;
}

double half_of(double x) { return ore_half(x); }

bool negate(bool b) { return !b; }
uint8_t next_byte(uint8_t x) { return (uint8_t)(x + 1); }
