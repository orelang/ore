# Functions and statements

## Functions and closures

- A function type `(a: int, b: string) => bool` describes function values.
  Function values are top-level functions used by name, methods taken
  without a call (`const f = obj.method`, bound to `obj`), arrow functions,
  function expressions and nested function declarations. `===` compares
  identity; a function type can be in a union with `null`, and `f?.(x)`
  calls it unless it is null.
- Closures capture variables by reference, as in JavaScript: changes are
  seen by the closure and by the enclosing function. Each iteration of
  `for (let ...)` has its own copy of the loop variable.
- Parameters of a function literal take their types from the context
  (`xs.map((x) => x * 2)`) or from annotations. The return type comes from
  an annotation or the context, or is inferred from the first `return`.
- Arrow functions keep `this` of the enclosing method; function expressions
  have no `this`.
- Nested function declarations are hoisted: they can be called anywhere in
  their block, call each other recursively, and use every variable of the
  block. Arrow functions can only use variables declared before them.
- A nested function declaration can be [generic](03-objects.md#generics)
  (`function id<T>(x: T): T { ... }` in a function body), and so can a
  function literal assigned to a `const` (`const id = <T>(x: T): T => x`).
  Like a top-level generic, each list of type arguments, written
  (`id<string>(s)`) or inferred from a call's arguments, makes an instance
  checked with the concrete types; unlike one, an instance is a closure: it
  uses and changes the variables of the enclosing functions like other
  nested functions do. An instance is checked at its first call, in the
  scope of the declaration as it is at that call, so it sees the variables
  declared before the call (or every variable of the block, when the call is
  in a hoisted function), and each call creates its closure. Such a function
  can only be called: using it as a value is an error (ORE6071), and so are
  generic function literals anywhere else (`xs.map(<T>(x: T) => x)`,
  ORE7038) and generic function types (`<T>(x: T) => T`, ORE2012), since a
  function value has one function type. A generic closure that calls itself
  needs a return type annotation (ORE6072).
- Top-level functions, methods and constructors can have optional
  parameters after the required ones: `b = 1` (its type may come from the
  value), or `b?: T`, which is `T | null` and `null` when missing. A default
  value is computed at each call that omits it, after the given arguments,
  and can use the parameters before it and any declaration of the module,
  such as a class declared further down (`o = new Options()`, whose type is
  the class's, or `new Box<string>(...)` with the type arguments given or
  inferred from the arguments). A last rest parameter `...xs: T[]`
  receives the extra arguments as an array, where `...array` spreads in an
  array's elements (`f(1, ...xs, 2)`; `f(...xs)` alone passes `xs` itself).
  A [tuple](02-types.md#tuples) spreads into any parameters: `f(...t)`.
  An array spreads only into a rest parameter, `push`, `console` and
  `Math.min`/`Math.max`: its length is not known.
- A top-level function may have overload signatures, declarations without a
  body before its implementation: `function parse(s: string): int`,
  `function parse(s: string[]): int[]`, then
  `function parse(s: string | string[]): int | int[] { ... }`. A call takes
  the first signature whose parameters take its arguments, and has that
  signature's result type: the implementation's result converts to it,
  checked at run time when it is narrower. The implementation must take
  every signature's arguments. Such a function cannot be used as a value;
  generic signatures and overloaded methods are not supported yet.
- Closures can have optional (`b?: T`), default (`b = 1`) and rest
  parameters, and so can function types (`(a: int, b?: int) => int`,
  `(...xs: string[]) => void`): a call of a function value passes null for
  an optional argument left out and packs the extra arguments into the rest
  array; a closure computes its default values itself, when the argument
  is null. As values, top-level functions and methods take all their
  parameters.

## Tagged templates

- `` tag`a${x}b${y}c` `` calls `tag(strings, x, y)`, as in JavaScript: the
  tag is any function value, function, method or closure, and the call is
  checked like any other, so the tag's parameters type the substitutions
  (`function tag(s: TemplateStringsArray, ...values: int[])`, or fixed
  parameters such as `(s: TemplateStringsArray, name: string, n: f64)`).
  The tag is evaluated first, then the substitutions in order.
- `strings` is a `TemplateStringsArray`: an array of the cooked strings
  (`["a", "b", "c"]`, escapes resolved), with `strings.raw`, a `string[]`
  of the text as written (`\n` stays two characters; line breaks are `\n`).
  Its elements are `string | null`: a tagged template may have an escape
  that is not valid, such as `\unicode` or `\xZ`, whose cooked string is
  `null` where JavaScript has `undefined`; its raw text keeps it. Untagged
  templates do not check their escapes yet.
- Each site has one strings object, created when the program starts, before
  the top-level code of its modules: every evaluation of the site passes the
  same object, so `===` tells sites apart. A generic function has one per
  instance.
- A `TemplateStringsArray` converts to `(string | null)[]` as it is, and has
  the array's methods, whose results are plain arrays. It converts to an
  object type with only `raw: string[]`, as `String.raw` takes. Only a
  tagged template makes one: an array literal is not one (ORE2033), and it
  has no zero value, cannot be a rest parameter's type (ORE6039) and is not
  read from JSON (ORE2049).
- `` String.raw`...` `` is the raw strings with the substitutions between
  them, which it formats as a template does (`` String.raw`\d+${n}` `` is
  `"\\d+"` and the digits of `n`). Called as a function,
  `String.raw(template, ...substitutions)` takes `{ raw: string[] }` or a
  `TemplateStringsArray` and strings: Ore does not convert other values to
  strings. Type arguments on a tag (`` tag<T>`...` ``) are not supported.

## Array methods

Arrays have the methods of JavaScript's `Array.prototype`, with its
arguments, defaults and offsets (a negative index or offset counts from the
end, and ranges are clamped as `slice` clamps them):

- Visiting the elements: `forEach`, `map`, `filter`, `find` and `findLast`
  (`T | null`), `findIndex` and `findLastIndex` (-1 when none),
  `some`, `every`, `flatMap`, `reduce` and `reduceRight`. Callbacks receive
  `(element, index, array)` (`reduce` and `reduceRight`: the accumulator
  first) and may declare fewer parameters. They visit the elements present
  when the call starts, while those still exist. `reduce` and `reduceRight`
  without an initial value start from the first (last) element and panic
  with `Reduce of empty array with no initial value` on an empty array.
  The callback of `flatMap` may return an array, whose elements are added,
  or one value. `thisArg` is not supported.
- Searching: `includes`, `indexOf` and `lastIndexOf(value, fromIndex?)`;
  `includes` finds `NaN`, the others do not. `at(index)` is `T | null`.
- New arrays: `concat(...items)` (an argument of the array's type adds its
  elements, any other is one element), `slice(start?, end?)`,
  `flat(depth = 1)` (the depth is an integer constant or `Infinity`, since
  the result's type depends on it), `toReversed()`,
  `toSorted(compare?)`, `toSpliced(start?, count?, ...items)`,
  `with(index, value)` (an index out of range panics with `Invalid index :
  i`), and `join(separator = ",")`. `entries()`, `keys()` and `values()`
  return arrays (of `[int, T]` tuples, of indices, a copy) until Ore has
  iterators.
- In place, returning the array: `reverse()`, `sort(compare?)`,
  `fill(value, start?, end?)` and `copyWithin(target, start?, end?)`;
  `push`, `pop`, `shift`, `unshift` and `splice` as in
  [Arrays](02-types.md#arrays).

`sort` and `toSorted` are stable; without a comparator they sort numbers by
value and strings by bytes (JavaScript sorts everything as strings).

`Array.from(items, mapFn?)` makes an array of the elements of an array (a
copy), the characters of a string, the values of a set or the `[key, value]`
entries of a map, passed through `mapFn(value, index)` when it is given;
`Array.from({ length: n }, (_, i) => ...)` makes `n` elements by the
function, given null and the index. `Array.of(...items)` is an array of its
arguments, typed as an array literal. `Array.isArray(x)` is known from the
type of `x`, and tested at run time for a union.

## Resources

`using x = resource` declares a resource whose type has a
`[Symbol.dispose](): void` method (the built-in interface `Disposable`).
When the rest of the block ends, also by `return`, `break` or `continue`,
`x[Symbol.dispose]()` is called; several resources are disposed in reverse
order, and a null resource is skipped. Panics do not dispose resources.
This is the `using` declaration of the TC39 Explicit Resource Management
proposal (https://github.com/tc39/proposal-explicit-resource-management), as
in TypeScript 5.2; `await using` is rejected.

## Evaluation order

Operands, arguments and the receiver of a method call are evaluated left to
right, as in TypeScript.

## Statements

- `if`, `while`, `do...while`, `for`, `for...of`, `switch`, `break`,
  `continue` and `return` work as in TypeScript. `for...in` is rejected.
- `switch` compares with `===`, evaluates case expressions in order until one
  matches, and falls through until `break`. It works on numbers, `bool`,
  strings and unions of string literals.
- Loops and switches may be labeled for `break label`, and loops for
  `continue label`; labels on other statements are rejected.
- A function with a return type must return a value on every path. A path
  ending in an infinite loop or a `process.panic(...)` call needs no return,
  and a function whose result type is `null` may end without one.

## Panics

A panic prints its message and exits with status 2. Debug builds (the default)
print the Ore call stack with source lines:

```text
panic: integer divide by zero

  div at main.ore:9
  main at main.ore:14
```

Release builds (`--release`) keep no call stack information.

Recursion that overflows the stack of a task is a panic too, `panic: stack
overflow`, with the call stack; the size of stacks is set by `ORE_STACK`
(see [concurrency](06-concurrency.md)).
