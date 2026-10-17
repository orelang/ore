# The faster sort and bigint, against main

The sort and bigint of `perf(runtime): faster stable sort and bigint
arithmetic` (the sort inlined into a function of its own per comparison)
against main at cdebcde, its parent. A first version, which inlined the sort
into each caller, was reverted because the compiler built with it took 54%
more memory to build the compiler.

- Date: 2026-10-17
- Machine: the farm's root@155.212.133.197, 24 threads, Linux, beside other jobs
- Method: in one job, each tree's compiler was built by the farm's base
  compiler (stage 1), built the compiler (stage 2) and the programs below;
  the runs alternate between the two, with `ORE_CACHE=off`, and are timed by
  `/usr/bin/time -f '%M %e %U'`. The outputs of the benchmarks are the same.

## Building the compiler

`ore build compiler/src/main.ore -o x --release` with stage 2, three runs
each.

| | peak memory (median) | wall time (median) | user time (median) |
|---|---:|---:|---:|
| main | 974,160 KB | 79.3 s | 83.0 s |
| sort and bigint | 975,120 KB (+0.1%) | 74.0 s | 77.1 s |

The runs of main took 1,199,192, 974,160 and 974,068 KB; those of the change
975,120, 973,212 and 979,548 KB.

## Benchmarks

The best of five runs.

| benchmark | wall, main | wall, change | user, main | user, change | peak memory, main | peak memory, change |
|---|---:|---:|---:|---:|---:|---:|
| sort | 2.54 s | 1.73 s (-32%) | 2.38 s | 1.59 s (-33%) | 222 MB | 143 MB (-36%) |
| bigint | 2.01 s | 1.75 s (-13%) | 0.87 s | 0.69 s (-21%) | 12.3 MB | 12.2 MB |
| nbody (control) | 0.34 s | 0.34 s | 0.34 s | 0.33 s | 2.6 MB | 2.6 MB |

## Binaries

| | main | change |
|---|---:|---:|
| the compiler (stage 2) | 6,022,224 bytes | 6,045,928 bytes (+0.4%) |
| hello world, `--release` | 122,600 bytes | 122,600 bytes |
