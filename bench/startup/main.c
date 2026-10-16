// Startup: hello world, printed n times. With the default of one line, the
// time is that of starting the process and the runtime and exiting.
#include <stdio.h>
#include <stdlib.h>

int main(int argc, char **argv) {
    long n = argc > 1 ? atol(argv[1]) : 1;

    for (long i = 0; i < n; i++) puts("hello, world");
    return 0;
}
