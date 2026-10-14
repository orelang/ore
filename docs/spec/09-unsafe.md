# Unsafe code and directives

## The `unsafe` namespace

The built-in namespace `unsafe` gives unchecked access to memory and the
machine, like Go's `unsafe`, for the runtime and the standard library. Nothing
in it is bounds-, type- or null-checked.

| Function | Meaning |
| --- | --- |
| `sizeOf<T>()`, `alignOf<T>()` | size and alignment of a value of `T` in bytes (8 for a reference) |
| `add(p, bytes)`, `diff(a, b)` | pointer arithmetic in bytes |
| `toInt(p)`, `fromInt(n)` | a pointer as a `uint` and back; `fromInt(0)` is null |
| `bitcast<T>(x)` | the bits of a number as another numeric type of the same size (`f64` and `u64`, `f32` and `i32`, …) |
| `load<T>(p)`, `store<T>(p, value)` | read or write a value of `T` at `p` (`T` of `store` may come from the value) |
| `alloc(size)`, `allocBytes(size)` | zeroed garbage-collected memory; the second is never scanned for references |
| `copy(dst, src, size)`, `fill(dst, byte, size)`, `compare(a, b, size)` | memmove, memset, memcmp |
| `addressOf(value)`, `fromAddress<T>(p)` | the address of an object, array or map, and back |
| `stringData(s)`, `makeString(p, length)` | the bytes of a string, and a string over bytes without copying |
| `atomicLoad<T>`, `atomicStore`, `atomicAdd`, `atomicSub`, `atomicAnd`, `atomicOr`, `atomicXor`, `atomicExchange`, `atomicCompareExchange`, `fence()` | sequentially consistent atomics on integers and `ptr` |
| `asm<T>(template, constraints, ...operands)` | inline assembly in LLVM's syntax: `$0`, `$1` in the template, constraints such as `"=r,r,~{memory}"` |

`ptr` values are invisible to the garbage collector: memory reachable only
through a `ptr` may be freed.

## Directives

A comment `//ore:name` right before a top-level declaration is a directive;
another comment may follow it on the same line. Unknown directives are
errors.

| Directive | Applies to | Effect |
| --- | --- | --- |
| `//ore:noinline` | function | never inlined |
| `//ore:inline` | function | always inlined by LLVM |
| `//ore:cold` | function | rarely called: optimized for size, placed apart |
| `//ore:export name` | function | visible to C as `name`, with the C calling convention; numbers, `bool` and `ptr` only |
| `//ore:internal` | the module, before its first statement | allows the namespace `internal` and `//ore:runtime`, otherwise only for the standard library |
| `//ore:runtime name` | function in the standard library | implements the runtime function `name` (see `runtime/core`) |
| `//ore:threadlocal` | `let name: T` | a separate value in each OS thread, starting at zero; `T` is a number, `bool` or `ptr`, and there is no initializer |

Tasks move between OS threads when they wait, so a thread-local variable is
for code that knows which thread it runs on, such as the scheduler.

## The target

`target.os` (`"darwin"` or `"linux"`) and `target.arch` (`"arm64"` or
`"x86_64"`) name the platform the program is compiled for. A comparison of
string constants is evaluated at compile time, and an `if` whose condition is
a constant compiles only the branch taken, so the other branch may hold
assembly or system constants of another platform:

```ts
function stackPointer(): uint {
    if (target.arch === "arm64") return unsafe.asm<uint>("mov $0, sp", "=r")
    else return unsafe.asm<uint>("movq %rsp, $0", "=r")
}
```
