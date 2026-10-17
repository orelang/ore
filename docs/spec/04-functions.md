# Functions and statements

## Functions and closures

- A function type `(a: int, b: string) => bool` describes function values.
  Function values are top-level functions used by name, methods taken
  without a call (`const f = obj.method`, bound to `obj`), arrow functions,
  function expressions and nested function declarations. `===` compares
  identity; a function type can be in a union with `null`, and `f?.(x)`
  calls it unless it is null.
- A function value converts to a function type it does not have exactly,
  as in TypeScript, when that type's arguments convert to its parameters
  and its result converts to that type's result (or that result is
  `void`): it may declare fewer parameters (`(): void` where `(event:
  Event) => void` is expected, or `xs.map(double)` with `double(n: int)`,
  where `map` passes the index and the array too), wider ones (`(v: int |
  string) => void` for `(v: int) => void`, a base class for a subclass,
  `unknown` for any value), and return a narrower result (`(k: string, v:
  unknown) => string` for `=> unknown`, boxed, or `=> int` for `=> int |
  null`). The value is wrapped in a function of the expected type, which
  receives the arguments, evaluated in order by the caller, drops those
  past the function's parameters, converts the others and the result. A
  top-level function converts to the same function each time, so
  conversions to one type are `===`; other values (function literals kept
  in variables, methods taken without a call) to a new function at each
  conversion, so that `removeEventListener` needs the converted value kept
  (`const onX: (e: Event) => void = handler`). Optional parameters (`b?:
  T`) are given only by a function type with as many parameters.
- Closures capture variables by reference, as in JavaScript: changes are
  seen by the closure and by the enclosing function. Each iteration of
  `for (let ...)` has its own copy of the loop variable.
- Parameters of a function literal take their types from the context
  (`xs.map((x) => x * 2)`) or from annotations. The return type comes from
  an annotation or the context, or is inferred from the first `return`;
  an async one's is `Promise<T>` of all its returns (see [Async functions
  and promises](06-concurrency.md#async-functions-and-promises)).
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
  inferred from the arguments), or a module variable or constant declared
  further down (`sep = separator`, whose type is the variable's: its
  annotation's, or its value's, typed ahead of the declaration, which needs
  an annotation when the value has a function in it or calls a function
  declared after the parameter's, ORE6086). A last rest parameter `...xs: T[]`
  receives the extra arguments as an array, where `...array` spreads in an
  array's elements (`f(1, ...xs, 2)`; `f(...xs)` alone passes `xs` itself).
  A [tuple](02-types.md#tuples) spreads into any parameters: `f(...t)`.
  A rest parameter of a tuple type, `...p: [string, int?]`, takes as many
  arguments as the tuple has elements (those of optional elements may be
  left out), and in a function type it is its elements: `(...args: [int,
  string]) => void` is `(a: int, b: string) => void`. Typed by a type
  parameter, `...args: A` with `A extends unknown[]`, it binds `A` to the
  tuple of its arguments' types, or of the parameters of a callback
  `f: (...args: A) => void` passed with it, as `setTimeout(f, ms, ...args)`
  does: `call((s: string, n: int) => ..., "x", 1)`.
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
  generic signatures are not supported yet. Methods have overload
  signatures the same way (see [Classes](03-objects.md#classes)), abstract
  methods and the methods of interfaces too (see
  [Interfaces](03-objects.md#interfaces)).
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
  i`), and `join(separator = ",")`.
- Iterators: `values()`, `keys()` and `entries()` (`[int, T]` tuples)
  return lazy iterators, as in JavaScript (see
  [Generators and iteration](#generators-and-iteration)).
- In place, returning the array: `reverse()`, `sort(compare?)`,
  `fill(value, start?, end?)` and `copyWithin(target, start?, end?)`;
  `push`, `pop`, `shift`, `unshift` and `splice` as in
  [Arrays](02-types.md#arrays).

`sort` and `toSorted` are stable; without a comparator they sort numbers by
value and strings by bytes (JavaScript sorts everything as strings).

`Array.from(items, mapFn?)` makes an array of the elements of an array (a
copy), the characters of a string, the values of a set, the `[key, value]`
entries of a map or the values of any other iterable, passed through `mapFn(value, index)` when it is given;
`Array.from({ length: n }, (_, i) => ...)` makes `n` elements by the
function, given null and the index. `Array.of(...items)` is an array of its
arguments, typed as an array literal. `Array.isArray(x)` is known from the
type of `x`, and tested at run time for a union; as a condition it narrows
`x`, as in TypeScript: to the array members of its union when true, to the
others when false.

## Generators and iteration

The iteration protocol is JavaScript's. A value is iterable when it has a
`[Symbol.iterator]()` method that returns an iterator, an object whose
`next()` returns an `IteratorResult<T, TReturn>`:
`{ value: T; done: false } | { value: TReturn; done: true }`, a
discriminated union narrowed by `done` (`if (!r.done) use(r.value)`).
`Symbol.iterator`, like `Symbol.dispose`, is a well-known symbol usable
as a computed method name of classes and interfaces, and in
`x[Symbol.iterator]()`; there are no other symbols. `x[Symbol.iterator]()`
of a string, an array, a map or a set is the iterator `for...of` would
use, with the iterator helpers (a string's gives its characters as
strings, see [Strings](02-types.md#strings)).

- The global interfaces `Iterator<T, TReturn = void, TNext = null>`
  (`next()`), `Iterable<T>` (`[Symbol.iterator](): Iterator<T>`) and
  `IterableIterator<T, TReturn = void, TNext = null>` (both, its
  `[Symbol.iterator]()` returning an `IterableIterator`) describe them.
  Interfaces are matched exactly (see [Interfaces](03-objects.md#interfaces)):
  a class is an `Iterable<T>` when its `[Symbol.iterator]()` is declared to
  return `Iterator<T>`. Ore writes `null` where TypeScript has `undefined`,
  so `TNext` defaults to `null`, and a void `TReturn` is `null` at run
  time.
- `for (const x of iterable)`, `[...iterable]`, `Array.from(iterable)`,
  `new Set(iterable)`, `new Map(iterable)` (of `[key, value]` tuples) and
  `yield* iterable` take any iterable: arrays, strings (`[...s]` and
  `Array.from(s)` give the characters as strings, while `for...of` over a
  string gives runes, see [Strings](02-types.md#strings)), maps (their
  entries), sets, generators and objects with `[Symbol.iterator]()`.
  `for...of` calls `next()` until it is done; when the loop is left early
  (`break`, `return`, a labeled `continue`), it calls the iterator's
  `return()` if it has one without required arguments, as JavaScript does.
- `array.values()`, `keys()` and `entries()`, `map.keys()`, `values()`
  and `entries()`, and `set.values()`, `keys()` and `entries()` return
  lazy iterators, which are iterable too: an array iterator reads the
  length at each step, a map or set iterator visits the entries in
  insertion order as it reaches them, those added meanwhile included, and
  a finished iterator stays done.
- Iterator helpers (ES2025): generators, the iterators of `values()`,
  `keys()` and `entries()` and the helpers' results extend the global
  abstract class `IteratorObject<T, TReturn = void, TNext = null>`
  (TypeScript's name for JavaScript's `Iterator.prototype`), which has
  `map`, `filter`, `take`, `drop`, `flatMap`, `reduce`, `toArray`,
  `forEach`, `some`, `every` and `find` (`T | null`). Callbacks receive
  `(value, index)`, the index counting the values passed to the callback
  before, and may declare fewer parameters; predicates return `bool`.
  `map`, `filter`, `take`, `drop` and `flatMap` return lazy iterators
  (`[object Iterator Helper]`), iterable too, that step their source only
  as far as each of their own steps needs: `g().map(f).take(2)` runs `g`
  to its second `yield` when the second value is asked for, and the step
  after it ends `g`. A helper that ends before its source (`take` at its
  limit, or its `return()`, which `for...of` calls when it leaves early)
  closes the source, a generator by its `return()`; `some`, `every` and
  `find` close the iterator when they stop early, as `for...of` over an
  `IteratorObject` does. `take(n)` and `drop(n)` take an `int` (not
  `Infinity`) and panic with `RangeError: n must be positive` for a
  negative one. The callback of `flatMap` returns what `Iterator.from`
  takes but a string: an array, a set, a map (its entries), an iterator
  with the helpers, another iterable, or an object with only `next()`;
  each is stepped in turn through the iterator `Iterator.from` gives for
  it, without a generator in between, and the helper's `return()` closes
  the current one (an object's own `return()`, if it has one). Strings are
  rejected, as in JavaScript. `reduce(f)` without an initial value starts from the first
  value, and panics with `TypeError: Reduce of a done iterator with no
  initial value` when there is none. A class may extend `IteratorObject<T>`
  with a `next()` of its own, as a JavaScript class extends `Iterator`, and
  override `close()` (which does nothing by default) to be ended early.
- `Iterator.from(x)` is an `IteratorObject` of the values of `x`, as in
  JavaScript: for a string, an array, a set or a map, the iterator its
  `[Symbol.iterator]()` makes; an iterator that has the helpers already (a
  generator, an iterator of the runtime or of a class extending
  `IteratorObject`) is returned as it is (`Iterator.from(g) === g`);
  otherwise the iterator of `x[Symbol.iterator]()`, or `x` itself when it
  has only `next()`, is wrapped in an iterator with the helpers
  (`[object Iterator]`) whose `next()` is its own and whose `return()`
  calls its `return()`, when it has one without parameters.
- A generator function `function* f(): Generator<T, TReturn, TNext>`, a
  generator method `*m()` (also `*[Symbol.iterator]()`) or a generator
  function expression returns a `Generator<T, TReturn = void, TNext = null>`
  without running its body; the declared result type may also be
  `Iterator<T, TReturn>` or `IterableIterator<T, TReturn>`. Without one
  (or a context that gives one, for a function expression), the body gives
  it, as in TypeScript: `Generator<T, TReturn, null>`, where T is the union
  of the types of the values yielded (untyped constants taking their default
  type, `null` without any) and TReturn the type of the first `return`
  (`void` without a value). The body of such a function or method is
  checked at its first use, so that its type is known there. A generator
  used in its own body, a nested generator function declaration (hoisted,
  it can be called before the variables its body uses are declared) and a
  generator method of an object literal that uses `this` need an
  annotation ([ORE6079](../errors/ORE6079.md)).
  `next()` runs the body
  until its next `yield value` (`{ value, done: false }`) or its end
  (`{ value: returned, done: true }`); `next(value)` makes `value` the result
  of the `yield` the body waits at (the value of the first `next` is
  ignored, and a `yield` resumed by a `next()` without a value is `null`,
  which panics when `TNext` does not include it). `return(value)` ends the
  generator as if its body returned `value` at that `yield`, without
  running the rest of it. A generator ended early without a value (by
  `for...of` or an iterator helper) is then done with the value null, as
  JavaScript's `undefined`; when `TReturn` does not include null, its
  `next()` panics with `TypeError: Generator ended early without a return
  value`. `yield* other` yields the values of another
  iterable; of a generator, it passes on the values sent with `next` and
  its value is the generator's return value. Calling `next` of a generator
  from its own body panics with `TypeError: Generator is already running`.
  A generator is iterable once: its `[Symbol.iterator]()` returns itself.
- Ore has no exceptions, so generators have no `throw()` (async generators
  neither), and a panic in the body ends the program.
- A generator runs its body on a fiber of its own, as async functions do
  (see [concurrency](06-concurrency.md)): `next` switches to it and `yield`
  switches back, a step costing two task switches. A generator that is not
  run to its end keeps its fiber (a parked stack) until it finishes or
  `return()` ends it; `for...of` ends it on an early exit, and spread and
  `Array.from` run it to the end.

### Async iteration

The async iteration protocol is JavaScript's too. A value is async
iterable when it has a `[Symbol.asyncIterator]()` method (the well-known
symbol `Symbol.asyncIterator`) that returns an async iterator, whose
`next()` returns a `Promise<IteratorResult<T, TReturn>>`. The global
interfaces `AsyncIterator<T, TReturn = void, TNext = null>`,
`AsyncIterable<T>` and `AsyncIterableIterator<T, TReturn = void, TNext =
null>` describe them, matched exactly as `Iterator` and its kin are.

- `for await (const x of iterable)`, in an async function (an async
  generator too) or in the top-level code of a module
  ([ORE7047](../errors/ORE7047.md)), awaits the promise of each `next()`
  until it is done. It also takes anything `for...of` takes but channels
  (strings, as their characters, arrays, maps, sets, generators, objects
  with `[Symbol.iterator]()`): it awaits each value, the value of a promise for
  an iterable of promises, with the ticks of JavaScript's async-from-sync
  iterator (two ticks a step after the value is there).
  Anything else is [ORE7048](../errors/ORE7048.md). When the loop is left
  early, it calls the iterator's `return()` if it has one without required
  arguments (an async generator's `close()`) and awaits it; of an iterable
  that is not async, it calls its `return()` (a generator's `close()`) and
  waits as JavaScript does.
- An async generator function `async function* f(): AsyncGenerator<T,
  TReturn, TNext>`, an async generator method `async *m()` (also `async
  *[Symbol.asyncIterator]()`, and in object literals) or an async generator
  function expression returns an `AsyncGenerator<T, TReturn = void, TNext
  = null>` without running its body; the declared result type may also be
  `AsyncIterator<T, TReturn>` or `AsyncIterableIterator<T, TReturn>`
  ([ORE6084](../errors/ORE6084.md)). Without one, the body gives it, as for
  a generator: `AsyncGenerator<T, TReturn, null>` of the values awaited.
  The body runs on a fiber of its own and may `await`; `yield value` and
  `return value` await the value first (a `Promise<T>` yields or returns
  its `T`), as in JavaScript.
- `next()`, `next(value)` and `return(value)` return promises of
  `{ value, done }`. Each call is a request that waits in a queue: the
  first `next()` starts the body, which answers one request at each `yield`
  and goes on at once when the next request is already queued; the body's
  end answers one with `done: true`, and the requests after it are done
  one after the other, as JavaScript's AsyncGeneratorQueue does, so the
  promises settle in its order and with its ticks. `return(value)` ends a
  generator waiting at a `yield` there (after awaiting the value) and
  answers `{ value, done: true }`; one that has not started never runs.
  After the end, `next()` answers `{ value: null, done: true }` when
  `TReturn` includes null (JavaScript's `undefined`), else the value
  returned. `return` takes a value of `TReturn`, not a promise of one.
- `yield* other` in an async generator of another async generator yields
  its values, passes on the values sent with `next` and gives its return
  value; of anything else that `for await` takes, it yields the values
  awaited ([ORE6085](../errors/ORE6085.md) when T does not include them). A
  `return` of the generator while `yield*` waits ends the other one first.
- `Array.fromAsync(iterable)` is a promise of the values that `for await`
  takes from `iterable`, in an array (without JavaScript's `mapFn`).

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
