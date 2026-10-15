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
- Top-level functions, methods and constructors can have optional
  parameters after the required ones: `b = 1` (its type may come from the
  value), or `b?: T`, which is `T | null` and `null` when missing. A default
  value is computed at each call that omits it, after the given arguments,
  and can use the parameters before it and any declaration of the module,
  such as a class declared further down (`o = new Options()`, whose type is
  the class's, or `new Box<string>(...)` with the type arguments given or
  inferred from the arguments). A last rest parameter `...xs: T[]`
  receives the extra arguments as an array; `f(...array)` passes an array as
  all of them. As values, such functions take all their parameters, and
  closures cannot have optional or rest parameters.

## Array methods

`forEach`, `map`, `filter`, `reduce` (with an initial value), `find`
(`T | null`), `findIndex`, `some`, `every`, `includes`, `indexOf`,
`join(separator = ",")`, `reverse` and `sort(compare?)` work as in
JavaScript. Callbacks receive `(element, index)` (`reduce`: accumulator
first) and may declare fewer parameters. `sort` is stable; without a
comparator it sorts numbers by value and strings by bytes (JavaScript sorts
everything as strings). `includes` finds `NaN`, `indexOf` does not.

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
  ending in an infinite loop or a `process.panic(...)` call needs no return.

## Panics

A panic prints its message and exits with status 2. Debug builds (the default)
print the Ore call stack with source lines:

```
panic: integer divide by zero

  div at main.ore:9
  main at main.ore:14
```

Release builds (`--release`) keep no call stack information.
