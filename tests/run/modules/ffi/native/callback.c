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

// Defined in main.ore with //ore:export.
extern int64_t ore_counter;
int64_t read_counter(void) { return ore_counter; }
void bump_counter(void) { ore_counter++; }

// Declared //ore:blocking in main.ore: the thread is parked while it runs,
// and the Ore function it calls back, which allocates, runs unparked.
int64_t ore_label_length(int64_t i);
int64_t total_label_length(int64_t n) {
  int64_t total = 0;
  for (int64_t i = 0; i < n; i++) total += ore_label_length(i);
  return total;
}

// Declared //ore:blocking: reads the bytes of an Ore string while collections run.
int64_t sum_bytes(const uint8_t *bytes, int64_t n) {
  int64_t sum = 0;
  for (int64_t i = 0; i < n; i++) sum += bytes[i];
  return sum;
}
