# @ore/opt

Optimizations on the IR, run before code generation.

- `escape.ts`: escape analysis. Objects, closures and boxes that never
  outlive the call creating them get a stack slot instead of a heap
  allocation; constructors get `_at` variants that initialize a given slot.
- `inline.ts`: inlining, in release builds. Calls of small functions whose
  body is one `return value` are replaced with the value, which also lets
  escape analysis keep the callee's objects in the caller's frame.
  Functions marked `//ore:noinline` are kept.
