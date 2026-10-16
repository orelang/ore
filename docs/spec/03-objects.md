# Objects, classes, interfaces and generics

## Object types

- An object type `{ x: f64; readonly id: int }` describes a record on the
  heap, used through references: assignment shares the object and `===`
  compares identity.
- Object types are structural: two object types with the same fields (names,
  types and `readonly`) are the same type, regardless of field order.
- A type alias can name aliases declared after it. An object type can refer
  to itself, directly or through other aliases (`type Tree = { value: int;
  children: Tree[] }`); such a recursive object type is a type of its own,
  not the same as another with the same fields. A cycle of aliases needs an
  object type in it.
- An optional property `name?: T` has the type `T | null`: an object
  literal may leave it out, and then it is null; `JSON.stringify` leaves it
  out when it is null, as JavaScript leaves out `undefined`.
- An object literal for a known object type must have exactly its fields,
  but optional ones.
  Without a context type, the literal's type is inferred from its values;
  shorthand properties (`{ name }`) are allowed.
- An object literal can have methods: `{ count: 0, add(n: int) { this.count
  += n } }`. A method is a field holding a closure whose `this` is the
  object; it can use the variables around it, as any closure. Its parameter
  and result types come from its annotations or from the type the literal is
  written for (a method that returns a value needs one or the other).
  Spreads work as in other literals.
- An object literal can have getters and setters, `{ celsius: 20.0, get
  fahrenheit(): f64 { return this.celsius * 9 / 5 + 32 } }`, with the rules
  of [class accessors](#classes): a getter needs a return type annotation, a
  setter one annotated parameter of the same type, and a property with only
  a getter is read-only. They are closures whose `this` is the object, held
  in the object and called by reads and writes of the property; the type of
  the literal has the property (printed `{ get fahrenheit(): f64 }`), and two
  literals with the same properties and accessors have the same type. As in
  classes, accessors implement interface fields.
- An intersection `A & B` of object types is the object type with the fields
  of both; with an interface among the parts, it is the interface with the
  members of all. A member in two parts must have the same type in both
  (writable in one is writable in the intersection). Classes, tuples and
  primitives cannot be parts.
- An object type with methods, `{ count: int; add(n: int): void }`, is a
  structural interface, as in TypeScript: classes with those members, and
  object literals with those fields and methods, fit it. An interface's
  method can be a field of a function type in the class or object.
- An interface or object type can declare a field with accessor
  signatures: `get x(): T` alone is `readonly x: T`, and with
  `set x(value: T)` it is a writable `x: T`. Fields and accessors of classes
  and objects implement them alike.
- `...object` in an object literal copies the fields of an object: the
  public fields of a class instance (not its methods), the fields of an
  object type or an interface. A later property replaces the value of an
  earlier one and keeps its place (`{ ...p, x: 0 }`); the values are
  evaluated once, in order.
- `p["x"]` is `p.x`, on objects, interfaces and class instances, read and
  assigned. `p[k]` with `k` of a `keyof` type (string literal types) reads
  the field that `k` names, of the union of their types (`P[K]`). It is
  assigned as TypeScript writes `P[K]`: `p[k] = v` evaluates `p`, `k` and
  `v` once and stores `v` into the field `k` names, so `v` must convert to
  the type of each field `k` can name, none of them read-only;
  `p[k] += v`, `p[k]++`, `??=`, `||=` and `&&=` need fields of one type.
  With `K extends keyof T` in a generic function, `o[k] = v` with `v: T[K]`
  stores into the field of the key's type at each call. Any other string
  does not index an object ([ORE3088](../errors/ORE3088.md)) nor is
  assigned through ([ORE3089](../errors/ORE3089.md)): use a
  [dictionary](#dictionaries).

## Classes

- A class declares a nominal type: two classes are different types even with
  the same members. A class may extend one other class (see
  [Inheritance](#inheritance)).
- Members: fields (with a type annotation, an initializer, or both), one
  constructor, and methods. Constructor parameters with `public`, `private`
  or `readonly` declare fields.
- Static members belong to the class: `C.count`, `C.make()`, also through a
  subclass. A static field is a global of the module, initialized where the
  class is declared, in order; it has a type annotation or an initializer
  (and then its type). A static method is a function, without `this`, and
  may have type parameters of its own (`static of<T>(x: T): T[]`), inferred
  from each call's arguments or written (`List.of<string>("a")`).
  `private` static members are used only inside the class declaration.
- A `static { ... }` block runs where the class is declared, in order with
  the initializers of the static fields around it. Its variables are local
  to it, and like a static method it has no `this`
  ([ORE3002](../errors/ORE3002.md)): it names the class.
- A generic class can have static fields and methods, generic methods too
  (`Box.of<U>(v)`), as in TypeScript: one field or function shared by every
  instance of the class, which cannot name the class's type parameters
  ([ORE3082](../errors/ORE3082.md)).
- Getters and setters (`get celsius(): f64`, `set celsius(v: f64)`) define a
  property read and written like a field, by calling them; a getter needs a
  return type annotation, and both must have the same type. A property with
  only a getter is read-only. `p.x op= v` and `p.x++` call the getter, then
  the setter, evaluating `p` once. Public accessors implement interface
  fields (see [Interfaces](#interfaces)).
- `new C(...)` allocates an instance, assigns parameter properties, runs
  field initializers in order, then the constructor body. Field initializers
  cannot use `this` directly, but arrow functions in them capture the
  instance, as in TypeScript: `onClick = () => this.count++` keeps `this`
  when the function is detached from the object.
- Field initializers can use any variable of their module, declared before
  or after the class (`id: int = nextId++`), as they run when an instance is
  constructed; one constructed before a variable's declaration runs reads
  its zero value, as a function does (see
  [Programs](01-programs.md)). A field without an annotation has the type
  of its initializer, known once the top-level code has declared the
  variables it uses: top-level code before that cannot use the field
  ([ORE5069](../errors/ORE5069.md)).
- Outside classes, at the top level of a module and in its arrow functions,
  `this` is `null` (JavaScript's `undefined`), of type `null`. In a function
  declaration or expression outside a class it is an error
  ([ORE3003](../errors/ORE3003.md)).
- A field without an initializer starts at its zero value (`0`, `false`,
  `""`, `[]`, a new map, or `null` for a type that includes it). A field of a
  type without a zero value (class, object or interface) must be assigned at
  the top level of the constructor.
- An optional field `x?: T` has the type `T | null` and starts as `null`
  unless it has an initializer; it needs a type annotation. An optional
  constructor parameter, also a parameter property (`public note?: string`),
  is `null` when the argument is left out. Definite assignment assertions
  (`x!: T`) are not supported.
- Members may be named with any word, reserved or not, as in TypeScript:
  `else: Stmt | null`, `readonly readonly: bool`, `x.new`. Names that declare
  bindings (parameters, parameter properties, variables, functions, classes)
  cannot be reserved words, nor the words strict mode reserves (`implements`,
  `interface`, `let`, `package`, `private`, `protected`, `public`, `static`,
  `yield`): Ore modules are always in strict mode.
- An index signature (`[key: string]: T`) makes an object type or an
  interface a [dictionary](#dictionaries), whose other members are its
  [named entries](#named-entries). It is not a member of a class, of a
  generic interface or of an interface that extends another
  ([ORE2046](../errors/ORE2046.md)).
- `private` members are accessible only inside the class that declares them,
  `protected` members inside that class and its subclasses. Inside means
  anywhere in the declaration, as in TypeScript: methods, accessors and
  constructors, static methods and `static` blocks, and the functions
  written in them, also on other instances of the class. Neither counts
  for interfaces. `readonly` fields can be assigned only by the constructor
  of the class that declares them.
- Methods are called on instances; `obj.method` without a call is a
  function value bound to `obj`.
- Methods, static ones too, may have overload signatures, as top-level
  functions do (see [Functions](04-functions.md#functions-and-closures)):
  methods without a body before the implementation, `parse(s: string): int`,
  `parse(s: string[]): int[]`, then
  `parse(s: string | string[]): int | int[] { ... }`. Callers, `this.parse`
  included, see only the signatures: a call takes the first that takes its
  arguments and has its result type. The signatures have the visibility of
  the implementation ([ORE5064](../errors/ORE5064.md)), and generic ones are
  not supported. Such a method cannot be used as a value. Each signature
  implements a method of an interface of its type: this class implements
  `{ parse(s: string): int }`. Interfaces cannot have overload signatures
  ([ORE5066](../errors/ORE5066.md)).
- `class C implements I` checks that `C` has the members of `I`; `I` may be
  an instance of a generic interface, `class C implements It<int>`.
- A `private` constructor is called with `new` only inside the class
  declaration (a static factory, a method), and the class cannot be
  extended ([ORE5063](../errors/ORE5063.md)). A `protected` constructor is
  also called with `new` only inside the class declaration, and subclasses
  call it through `super(...)` ([ORE5062](../errors/ORE5062.md)).

## Inheritance

- `class B extends A` makes `B` a subclass of the class `A` (a generic
  instance such as `A<T>` too; not an interface or object type). A class has
  at most one base class, and cannot extend itself through others.
- `B` has the fields of `A`, first and in the same order, then its own; it
  cannot declare a field, accessor or method with the name of a field of
  `A`, nor any member with the name of a private member of `A`.
- `B` inherits the methods, accessors and generic methods of `A`. A method of
  `B` with the name of a method of `A` overrides it: it must have the same
  parameter and result types, and cannot be private, nor protected if the
  method of `A` is public. The `override` modifier is optional; on a member
  that overrides nothing it is an error. Accessors and generic methods cannot
  be overridden. A method with overload signatures is overridden by one with
  the same signatures, in the same order
  ([ORE5065](../errors/ORE5065.md)); its implementation may differ.
- Methods are virtual, as in JavaScript: calling `m` on a value of type `A`
  that holds a `B` runs `B`'s `m`, also through an interface or a bound
  method value. `super.m(...)` in a method of `B` runs `A`'s `m` (or the one
  `A` inherits); `super` is only allowed in calls `super(...)` and
  `super.m(...)`.
- Subtyping: a `B` converts implicitly, without a change of representation,
  to `A` and to the base classes of `A`, to a union with one of them as a
  member, and to an interface whose members it has (inherited ones
  included). Other types built from classes are not covariant: `B[]` is not
  an `A[]`. `===` compares instances of related classes by identity.
- A union that contains a class and a subclass of it is normalized to the
  base class: `A | B` is `A`.
- Constructors: the constructor of a class with a base class must call
  `super(args)` exactly once, as a statement at the top level of its body;
  statements before it cannot use `this` or `super`. `super(args)` runs the
  initialization of `A` (its parameter properties, field initializers and
  constructor body) on the new instance, then the parameter properties and
  field initializers of `B`. A class without a constructor takes the
  parameters of its base class's constructor and passes them on; for a
  generic class without a constructor, `new` needs explicit type arguments
  (`new Leaf<string>("a")`). Fields of `B` without a zero value must be
  assigned by `B`'s constructor, as for any class.
- `abstract class A` cannot be instantiated with `new`. It may declare
  abstract methods without a body, `abstract area(): f64`, which a class
  that is not abstract must override (directly or through a base class).
  `super.m(...)` cannot call an abstract method.
- The type `this`, in the field, parameter, result and local types of the
  non-static members of a class, is the type of the receiver: inside the
  class it is the class (for a method that overrides another, the class
  that first declared the method, so that the types stay the same), and at
  a call through a receiver of static type `S`, a subclass, a result or
  parameter of the type `this` has the type `S`. Fluent methods keep the
  subclass: with `add(s: string): this` in `Builder` and `class Html extends
  Builder`, `new Html().add("a")` is an `Html`, without a conversion, the
  value being the receiver. A method whose result is `this` must therefore
  return the receiver: each `return` gives `this`, a call on it (or on
  `super`) of a method whose result is `this`, or a conditional of these;
  TypeScript also allows other values of the type `this`, such as a
  parameter of that type, which Ore rejects. Fields read through a subclass
  keep the class's type. `this` in a static member or outside a class is an
  error, as in TypeScript; in an interface it is not supported yet, since
  the methods of a class implementing it would not have the interface's
  types.
- `x instanceof B` checks the class of the instance at run time when `x` has
  type `A`, a union with a member related to `B`, or an interface type; it
  narrows `x` to `B`. On a union, `instanceof A` is also true for members
  that are subclasses of `A`: the true branch narrows to the member if there
  is one such member, else to `A` (`B | C | string` narrows to `A`), and the
  false branch removes them. A union of subclasses of `A` converts to `A`.

Representation. Every class that has a base class or a subclass in the
program starts with a pointer to its class table: the class's type id
followed by its methods in slot order, where a class keeps its base class's
slots and appends its new methods. The base class's fields follow at the
same offsets, so a `B` is passed where an `A` is expected unchanged. Classes
without a base class or subclass have no table pointer, as before. Whether a
method is overridden is decided over the whole program: a call is direct
unless the receiver's class has a subclass that overrides the method, in
which case the method is loaded from the table of the instance. Each
overload signature of a method is a method of its own in the table, which
calls the class's implementation directly. An interface
table built for `A` points, for a method that a subclass overrides, to a stub
that dispatches through the class table. `instanceof B` compares the table
pointer with the tables of `B` and of its subclasses; for an interface value,
entry 0 of the interface table names the class it was converted from, and
the class table is checked when that class is related to `B`. A tagged union
holds a `B` converted to it in the slot of its member `A`, so `instanceof B`
on that slot reads the class table.

## Interfaces

- An interface lists fields and methods. Any class or object type that has
  them, with the same types, converts implicitly to the interface: at
  assignments, arguments, returns and array elements. Private members do not
  count, and a `readonly` field cannot satisfy a writable one.
- A getter implements a field of the interface (`get size(): int` for
  `readonly size: int`); a writable field needs a getter and a setter.
  Reading the field through the interface calls the getter, writing it the
  setter (`x.size += 1` both, also through a union with interface members).
  In the interface table, the entry of a field is its offset in the object,
  or, for accessors, the address of the pair of functions offset by 2^63,
  which makes it negative. A read or write through an interface tests the
  sign only for a field whose name some class or object in the program
  implements with accessors; other fields are loaded and stored at their
  offset, as before.
- Interfaces are structural: interfaces with the same members are the same
  type. An interface converts implicitly to an interface with a subset of its
  members. `interface A extends B` includes the members of `B`; when `B` is
  a class, its public instance fields and methods, as in TypeScript (its
  private and protected members and its accessors are left out, so object
  literals and unrelated classes conform too).
- Two declarations of an interface in one scope merge, as in TypeScript:
  the members and `extends` clauses of both make one interface. A member
  declared in both must have the same type. Generic interfaces and other
  kinds of declarations (an interface and a class, two classes) do not
  merge ([ORE5050](../errors/ORE5050.md)).
- An interface value refers to the original object: fields read and written
  through the interface are the object's fields, and `===` compares the
  objects.
- An object literal for an interface may only have fields of the interface.
- An optional member `label?: T` of an interface has the type `T | null`. A
  class or object type conforms with a field `label` of that type, or
  without one: then reading `label` through the interface gives null, and
  assigning it panics.
- An optional method `start?(): T` of an interface or object type is a
  read-only member of type `(() => T) | null`: callers check it for null
  (`if (p.start !== null) p.start()`) or call it with `p.start?.()`, of
  type `T | null`. A class or object conforms without it (it reads as
  null), with a method or a field of the type `() => T`, or with a field of
  type `(() => T) | null`. Unlike TypeScript, it cannot be assigned through
  the interface, as a method of a class cannot be replaced; classes cannot
  declare optional methods ([ORE5014](../errors/ORE5014.md)).
- A method of an interface or object type can be generic,
  `map<U>(f: (x: T) => U): U[]`, and a call through the interface picks
  its type arguments as a generic function's are (written, or inferred
  from the arguments). A class conforms with a generic method of the same
  name and number of type parameters (its own names for them), an object
  literal with a generic method of its own. Generics stay
  monomorphized: the program is checked whole, so the type arguments of
  every call through the interface are known, also of calls in instances
  of other generics. Each class or object literal converted to the
  interface gets an instance of its method for each of them, which may
  make more calls and conversions, until no more are needed; each
  instance must have the type of the interface's for the same type
  arguments ([ORE5049](../errors/ORE5049.md)), as it is checked only for
  the instances it gets. The interface table's entry of the method points
  to a table of these instances, and a call loads the one for its type
  arguments. Interfaces that convert to each other share these tables'
  layout, and the instances of one are checked against the other's. Calls
  whose instances call the method through the interface with ever larger
  type arguments (`wrap<T[]>` in `wrap<T>`) have no end of instances
  ([ORE5055](../errors/ORE5055.md)). A generic method cannot be optional
  ([ORE5067](../errors/ORE5067.md)) or used as a value, and two parts of
  an intersection can have one of the same name only when it is the same
  method ([ORE5068](../errors/ORE5068.md)). An object literal's generic
  method is a closure per instance, created with the object, in a hidden
  field that printing and `Object.keys` leave out; it is called directly
  too (`o.shift("a")`), but cannot be spread into another object.
- Object types (`type P = { ... }`) and interfaces differ on purpose: an
  object type is an exact record, an interface accepts any record or class
  with the members.

## Unions and null

- `A | B` is a union type. Unions are normalized: nested unions are
  flattened, duplicates removed, `string` absorbs string literal types and
  `number` numeric literal types.
- `null` is a value only of unions that contain `null`. A variable of such a
  type without an initializer starts as `null`. There is no `undefined`.
- A string literal type such as `"circle"` has strings as values. A string
  literal expression takes the literal type its context asks for.
  So do `true` and `false`. An object literal for a union of object types
  is the member whose literal-typed fields match its string and boolean
  constants: `{ done: false, value: 1 }` for
  `{ done: false; value: T } | { done: true; value: R }`. A class with
  private or protected fields is never the member an object literal is, as
  in TypeScript: for `Secret | { [key: string]: int }` the literal is the
  dictionary.
- A value converts implicitly to a union containing its type. A class or
  object converts to a union member that is an interface it implements, if
  exactly one does.
- A field that every member of a union of classes, object types and
  interfaces (without `null`) has, public, can be read without narrowing
  (`stmt.line`); its type is the union of the members' field types. It can
  be assigned (`stmt.line = 3`, `stmt.count++`) when it is writable and has
  the same type in every member.
- A method that every member of a union of classes (without `null`) has,
  public and with the same parameter and result types, can be called
  without narrowing (`(a: Cat | Dog) => a.speak()`): the receiver and the
  arguments are evaluated once, then the method of the class the value
  holds runs (an override in a subclass too), with that class's default
  values. Methods of different types are an error
  ([ORE4093](../errors/ORE4093.md)), and spread arguments are not
  supported there ([ORE4094](../errors/ORE4094.md)).
- Representation: a reference type with `null` is a nullable reference; a
  union of string literals is a string, and one of numeric literals an
  `f64` (see [numeric literal types](02-types.md#numeric-literal-types));
  other unions are tagged values.

## Narrowing

Checks narrow the type of a variable, of `this`, or of a field path such as
`this.head.next`:

- `x !== null` and `x === null`;
- `x === "lit"` and `x === 1` for a union of literal types, and
  `x.kind === "lit"` for a union of objects whose `kind` fields have
  literal types (discriminated unions), with `x.ok === true`, or the
  test `if (x.ok)` itself, when the field has a boolean literal type
  (see [boolean literal types](02-types.md#boolean-literal-types));
- `typeof x === "string" | "number" | "boolean" | "object"`;
- `x instanceof C` for a class `C` (also on interface values, which then
  narrow to the class, and on instances of a base class of `C`) and
  `x instanceof I` for an interface member of a union;
- the same checks of an `unknown`, which unbox it (see
  [unknown](02-types.md#unknown)).
- a call of a function with a type predicate (see below).

Narrowing applies inside `if` / `else`, `while` and `for` bodies, the
operands of `&&`, `||` and `?:` (where `a || b` narrows a reference to the
union of what `a` and `b` narrow it to: `x.kind === "a" || x.kind === "b"`),
and `switch` clauses on a literal (clauses reached by falling through code
are not narrowed). An initialization or an assignment narrows to the
assigned value's type until the next assignment, while the next assignment
still takes any value of the declared type: after
`let v: int | string = 1`, `v` is an `int`, and after `v = "s"` a
`string`. A literal narrows a union of literal types to that literal, so
`const k: keyof T = "label"` is `"label"` where it is used, and `o[k] = v`
assigns that member only. A `?:` keeps the union of its branches' types
(`u = t !== null ? t : "none"` makes `u` a string). A `while` loop
without a `break` that leaves it ends with its condition false: after
`while (!r.done) r = it.next()`, `r` is narrowed to the member whose
`done` is `true`.

Narrowing follows the flow of the code: after an `if`, a reference is
narrowed to the union of its types at the ends of the branches that do not
exit (with `return`, `break`, `continue` or a call that never returns, such
as `process.exit`), and not at all if one of them leaves it unnarrowed. So
after `if (x === null) return`, `x` is not null, and after
`let x = map.get(k); if (x === null) { x = make(); map.set(k, x) }`,
neither is it. What holds at the end of a block holds after it. Loops
forget facts about variables they assign, and the body of a function
literal knows only the facts about constants where it is created: a `let`
it captures may be assigned by other code (or by the literal itself) when
it runs.

A narrowed read is checked at run time and panics if the value is not of the
narrowed type, so a check made stale by a call cannot corrupt memory.

`x?.f`, `x?.m()` and `x?.[i]` give `null` when `x` is null. `x ?? y` gives
`y` when `x` is null. `x!` asserts that `x` is not null and panics otherwise.
`x ??= y` assigns `y` only when `x` is null, and `x` is not null after it;
on booleans, `x ||= y` assigns only when `x` is false and `x &&= y` only
when it is true. The target (`o.f`, `a[i]`) is evaluated once, and `y` only
when assigned.

A `switch` over a union of string or numeric literals with a case for every
literal is exhaustive: like a `default`, it lets a function end without
`return`.

### Type predicates

A function, method or function literal can declare what its result tells
about a parameter, as in TypeScript:

- `function isText(x: unknown): x is string` returns a `boolean`; a call
  `isText(v)` narrows `v` to `string` where it is true, and, for a union,
  to the other members where it is false, in `if` / `else`, `&&`, `||`,
  `!` and `?:`. A method `isDog(): this is Dog` narrows its receiver the
  same way.
- `arr.filter(f)` with such a callback, a function (`shapes.filter(isCircle)`)
  or a literal (`xs.filter((x): x is string => x !== null)`), is an array
  of the narrowed type.
- `function assertText(x: unknown): asserts x is string` returns nothing,
  and narrows `x` after a call statement `assertText(v)`; `asserts cond`
  narrows what `cond` would narrow as a condition:
  `check(x !== null)` makes `x` not null after it.
- The type of `x is T` must be one that the parameter can have.

Unlike TypeScript, Ore checks the body against the predicate, because a
narrowed value is checked at run time and a wrong predicate would make the
program panic later, where the caller reads the value. Each value that a
function with `x is T` returns must be `false` or a check that narrows `x`
to `T` when true, with the facts that hold at the `return`:
`return typeof x === "string"`, `return s.kind === "circle"`,
`return isOther(x) && x.length > 0`, or `return true` after
`if (typeof x !== "string") return false`. `return true` alone, or a check
of something else, is an error ([ORE6077](../errors/ORE6077.md)). An
assertion function may return, with `return` or at its end, only where
the checks before have narrowed `x` to `T` (or `cond` to `true`), so it
must panic or exit on the other paths ([ORE6078](../errors/ORE6078.md)).

## Generics

- Type parameters may have defaults (`<T, C = T[]>`), which can use the
  parameters before them: a type or call that leaves the argument out, or
  whose arguments do not bind it, takes the default.
- Functions, classes, interfaces and type aliases may have type parameters,
  optionally constrained: `function longest<T extends Named>(items: T[]): T`.
  The constraint `object` takes the types whose values are not primitives:
  classes, interfaces, object types, arrays, maps, sets and functions.
  So may nested functions and function literals assigned to a `const`,
  whose instances are closures ([generic closures](04-functions.md#functions-and-closures)).
- Type arguments are written (`id<int>(5)`, `new Box<string>()`) or inferred
  from the arguments, also through arrays, unions, generic classes,
  interfaces and aliases (`map(xs, new Doubler())` infers `Mapper<A, B>`).
- Each set of type arguments creates a separate instance (monomorphization),
  checked with the concrete types: inside `longest<City>`, `T` is `City`. The
  constraint is checked where the instance is created. Errors inside a
  generic name the instance, e.g. `(in 'twice<string>')`. A generic that is
  never instantiated is only parsed.
- Class methods can have their own type parameters
  (`map<U>(f: (x: T) => U): Box<U>`), instantiated per call like generic
  functions; they cannot be used as values. Methods of interfaces and
  object literals can be generic too (see [Interfaces](#interfaces)).
  Their type parameters may have defaults, as those of functions.
  Since a generic method is checked only for the calls it has, a method
  with a parameter that nothing binds, such as `size<U = T>(): int`, can use
  what only some instances of its class have (`this.value.length`); a call
  on another instance is an error in that instance.
- A function literal passed for a parameter like `f: (x: T) => U` gets its
  parameter types from the type arguments inferred from the other arguments,
  and its result binds the rest: `box.map((n) => n * 2)`. A function
  literal that returns nothing binds such a result parameter to `void`.
- `void` is a type argument like any other (`new Box<void>(...)`): its
  value is `null`, and trailing parameters of its type may be left out of
  a call, so a `put: (value: T) => void` of a `Box<void>` is called as
  `put()`. A function whose result type is `null` may end without a
  `return`.
- `x instanceof Box` names a generic class without type arguments, and
  narrows a union such as `string | Box<int>` or `T | Box<T>` to its
  member of that class.
  With type arguments, `x instanceof Box<int>` names that instance, as
  TypeScript's instantiation expressions write it: it narrows a value of a
  base class of `Box` too, and is true only for a `Box<int>`, where
  JavaScript, which erases them, tests for the class.

## Computed types

Types computed from other types and from values, resolved when the type that
names them is:

- `keyof T` is the union of the names of T's members as string literal types:
  the public fields and methods of a class or an object type, the members of
  an interface. `keyof { x: int; y: int }` is `"x" | "y"`.
- `T["k"]` is the type of member `k` of T; `T["a" | "b"]` the union of the
  types of both. Of a union of object types, `U["k"]` is the union of the
  members' types of `k`, which every member must have, and `keyof U` the
  names that every member has; so `Omit<U, "k">`, as in TypeScript, is not
  distributive: one object type of the common members but `k`, each of the
  union of its types. `T[number]` is the element type of an array, or the union of
  the element types of a tuple; `T[0]` an element of a tuple.
- `typeof x` is the type of a variable or a function, and `typeof x.y` that of
  a field of one. Types are resolved before the values of top-level variables
  are checked: a top-level `const` initialized with literals only
  (`const obj = { a: 1, b: "s" }`) has the type of its value there, and any
  other top-level variable used this way needs a type annotation.
- `readonly T[]` is accepted and is `T[]`: arrays are not read-only yet.
- `T extends U ? X : Y` is X when T is assignable to U, else Y. When T is a
  type parameter of a generic alias and its argument a union, it is
  distributed over the members (`Exclude<"a" | "b", "a">` is `"b"`).
  `infer X` in the `extends` clause binds X to the matching part of T, in
  array, tuple, object, function, Map, Set and generic class types:
  `T extends (infer E)[] ? E : never`. A generic class in the clause also
  matches its subclasses, through their base class: `T extends Box<infer
  V> ? V : never` of a `class Crate extends Box<string>` is `string`.
- A mapped type `{ [K in Keys]: X }` has a field for each string literal type
  of Keys, of type X with K bound to it; `readonly`, `?`, and `-readonly`,
  `-?` add or remove the modifiers, which a mapped type over `keyof T` takes
  from T. `as N` renames a key, and leaves it out when N is `never`.
- A template literal type `` `on${K}` `` is the union of the strings it makes
  of the string literal types in it, and `string` with any other type.
  `Uppercase`, `Lowercase`, `Capitalize` and `Uncapitalize` change their
  letters.
- Numeric literal types (`0`, `-1.5`) take part in computations on types,
  as in `Prev[D]` and `D extends number = 10`, and are types of values too
  (see [numeric literal types](02-types.md#numeric-literal-types)). `never`
  inside tuples and object types takes part in them, as in
  `[D] extends [never]`; values cannot have it yet. In the `extends` clause
  of a conditional type, `unknown` matches any type, `object` any value
  that is not a primitive, `Function` any function and `readonly unknown[]`
  any array or tuple; `{}` matches object types
  structurally (`{} extends Pick<T, K>` when K is optional in T); and a
  template literal type with `infer` takes a string literal type apart
  (`` P extends `${infer K}.${infer Rest}` ``). A member of two parts of an
  intersection has the types common to both, and is optional only when it
  is optional in both.
- The utility types of TypeScript are global names: `Partial`, `Required`,
  `Readonly`, `Pick`, `Omit`, `Record` (of string literal keys an object
  type, of `string` a [dictionary](#dictionaries)), `Exclude`, `Extract`,
  `NonNullable`, `ReturnType`, `Parameters`, `InstanceType` and
  `ConstructorParameters` (of `typeof C`, a class's constructor type
  `new (params) => C`, which exists only in computations on types),
  `NoInfer` (a generic call does not infer its type arguments from that
  position) and `ReadonlyArray`, and more: `PartialExcept`, `PartialOmit`, `PartialPick`,
  `PartialWithExclusion`, `DeepPartial`, `DeepRequired`, `DeepReadonly`,
  `DeepMutable`, `PickByValueType`, `OmitByValueType`, `KeysOfType`,
  `PartialByKeys`, `RequiredByKeys`, `ReadonlyByKeys`, `MutableByKeys`,
  `StrictOmit`, `StrictPick`, `Merge`, `Simplify`, `Assign`,
  `NullableByKeys`, `NonNullableByKeys`, `OptionalNullable`, `RequiredKeys`,
  `OptionalKeys`, `Exact`, `Paths`, `Join`, `PathValue` and `Prev`
  (declared in runtime/core/types.ore).

## Dictionaries

- `{ [key: string]: V }` and `Record<string, V>` are the dictionary of
  values `V`: a reference to a hash table of string keys that keeps
  insertion order (the one of `Map`), used with the syntax of objects. It is
  a type of its own: a `Map<string, V>` does not convert to it, nor it to a
  map. `{ readonly [key: string]: V }` (as `Readonly<...>` and
  `Object.freeze` give) is read-only; a dictionary converts to the
  read-only one of the same values.
- An object literal for a dictionary type creates one: `{ a: 1, "b c": 2,
  [key]: 3, ...other }`, with the entries in order; a spread copies the
  entries of a dictionary of the same values or the fields of an object
  (each converted to `V`). A dictionary field without an initializer starts
  empty.
- `d.name` and `d[key]` (any string) read an entry: `V | null`, null when
  it is missing, as TypeScript's `noUncheckedIndexedAccess` makes it
  `V | undefined`. `d.name = v` and `d[key] = v` add or replace an entry;
  `d[key] ??= v` sets a missing one and gives the entry's value. `+=`,
  `++` and the other compound assignments are errors on entries
  ([ORE3090](../errors/ORE3090.md)): write `d.n = (d.n ?? 0) + 1`.
- `delete d[key]` and `delete d.name` remove an entry and are `true`, as in
  JavaScript; `key in d` tests one. `delete` and `in` apply to dictionaries
  only ([ORE3007](../errors/ORE3007.md), [ORE3019](../errors/ORE3019.md)).
- A dictionary has no methods (`d.get` is the entry `get`) and is not
  iterable, as an object is not: `Object.keys(d)`, `Object.values(d)` and
  `Object.entries(d)` list it, in insertion order. `keyof` of a dictionary
  is `string`, and indexing its type by any string gives `V`.
- `console.log` prints a dictionary as Node prints an object (`{ a: 1,
  'b c': 2 }`), and `JSON.stringify` and `JSON.parse` convert it to and
  from a JSON object.
- Keys are strings only: `{ [i: number]: V }` is an error
  ([ORE2069](../errors/ORE2069.md)); use a `Map` for other keys.

### Named entries

An object type or an interface of an index signature and properties,
`{ host: string; accept?: string; [name: string]: string }`, is a dictionary
whose properties are named entries: entries that every value of the type has,
but optional ones. It is the same hash table at run time; the names are known
to the checker only.

- The type of each named entry is assignable to the values' type, as
  TypeScript requires ([ORE2075](../errors/ORE2075.md)): the same type,
  members of a union of values, any type for `unknown` values, or string
  literal types of values that hold `string` (a required entry only). The other
  members are properties only ([ORE2074](../errors/ORE2074.md)), and there is
  one index signature ([ORE2073](../errors/ORE2073.md)).
- `d.host` and `d["host"]` read a named entry as its own type, `string`
  (`string | null` when optional); other entries read as `V | null`. The
  value is checked when read: an entry removed or changed through a key known
  only at run time (`delete d[key]`, `d[key] = v`) panics when read by its
  name (`unexpected null`, or `value is not of type ...`).
- `d.host = v` takes a value of the entry's type. A required named entry is
  always there, so its compound assignments work as for a field
  (`d.total += 1`, `d.total++`, `d.flag ||= x`); `??=` applies to an optional
  one. `delete d.host` of a required entry is an error
  ([ORE3094](../errors/ORE3094.md)), and `readonly` entries are not assigned
  or deleted.
- A literal of the type gives every required named entry
  ([ORE3095](../errors/ORE3095.md)), by name, from a spread object's fields or
  from a spread dictionary's required named entries. Its entries are in the
  order written, named or not, as JavaScript orders an object's properties.
- `console.log`, `JSON.stringify`, `Object.keys` and the others see a
  dictionary, its entries in insertion order. `JSON.parse` checks that the
  required named entries are there and that each named entry is of its type.
- A dictionary with named entries converts to one with fewer of them, of the
  same values, and to the plain dictionary `{ [key: string]: V }`; not the
  other way. A type alias or an interface names it in messages.

## The namespace Object

The functions of `Object` take dictionaries, objects and class instances.
The keys of an object are the names of its fields: of a class instance in
declaration order (base class first); of an object, in the order it was made
in, as JavaScript keeps the order properties were added to each object. A
literal makes an object in the order its properties are written (`{ b: 1, a:
2 }` has the keys `b`, `a`, also when its type declares `a` first), a spread
adds the fields of the object spread in that object's order, then the later
properties (`{ ...p, z: 0 }`), a property written again keeps its first
place, and the rest of a destructuring keeps the order of the object. An
object the program makes otherwise, as `JSON.parse<T>` does, is in the order
of the type's declaration or of the first literal of its shape; `JSON.parse`
takes the order of the text when the program makes objects of the type in
that order too. An optional field that is null is left out, as an absent
property, and one left out of a literal comes after the others. Methods are
not keys; accessors of object literals are not either.

An object type made in a single order costs nothing for it. One made in
several (the same shape written in two orders anywhere in the program, the
runtime included) gives each object a hidden word with the index of its
order, which printing, JSON, `Object.keys` and the others read; the fields
and their layout are the same.

- `Object.keys(o)`, `Object.values(o)` and `Object.entries(o)`: `string[]`,
  `V[]` and `[string, V][]`, where `V` is the type of a dictionary's values
  or the union of the types of an object's fields.
- `Object.hasOwn(o, key)`: whether a dictionary has the entry, or an object
  a field of that name (holding a value when it is optional).
- `Object.fromEntries(pairs)`: a dictionary of `[string, V]` pairs, a
  later key replacing an earlier one. The pairs come from an array or any
  other iterable of them: a `Map<string, V>`, a set, `map.entries()`, a
  `URLSearchParams`, a generator.
- `Object.groupBy(items, (element, index) => key)`: a dictionary of arrays,
  by the string key the function gives, the keys in the order they first
  appear. The elements come from an array or any other iterable, as a set,
  a map (its `[key, value]` pairs), a string (its characters) or a
  generator.
- `Object.assign(target, ...sources)`: copies the entries of dictionaries of
  the same values and the fields of objects into a dictionary, or the fields
  of objects into an object that has them writable; the value is `target`.
- `Object.freeze(d)` freezes a dictionary: setting or deleting an entry
  then panics with JavaScript's message (`Cannot add property c, object is
  not extensible`), and the result is read-only. `Object.isFrozen(d)` tells
  whether it is. Of an object, `freeze` returns it as it is, and
  `isFrozen` is whether all its fields are `readonly`; a primitive is
  always frozen, an array, a map or a set never.

## Maps

- `Map<K, V>` is a reference to a hash map that iterates in insertion order.
  `new Map<K, V>()` creates one; the type arguments may come from the context
  (`const m: Map<string, int> = new Map()`). A variable without an
  initializer starts as a new empty map.
- `new Map([[k1, v1], [k2, v2]])` creates a map from an array literal of
  `[key, value]` pairs, set in order (a repeated key keeps its first place
  and its last value). Without type arguments or a context, the key and
  value types are those of the first pair. Any other array of `[K, V]`
  [tuples](02-types.md#tuples) works the same, and so does any other
  iterable of them, such as a generator; `new Map(other)` copies another
  map.
- `get(key)` returns `V | null`; `set(key, value)` returns the map;
  `has`, `delete` (returns whether the key was present), `clear`, `size`.
  `keys()`, `values()` and `entries()` (`[key, value]` tuples) return lazy
  iterators in insertion order, as in JavaScript (see
  [Generators and iteration](04-functions.md#generators-and-iteration)).
- `forEach((value, key, map) => ...)` calls the function for each entry in
  insertion order; entries set during the loop are visited, deleted ones
  are not, and `clear` ends it. The function may take fewer parameters.
- `Map.groupBy(items, (element, index) => key)` groups the elements of an
  array, or of any other iterable as `Object.groupBy` takes, into a
  `Map<K, T[]>` by the key the function returns, the keys in the order they
  first appear.
- `for (const [key, value] of map)` iterates entries in insertion order.
- Keys compare like SameValueZero: numbers and strings by value (`NaN`
  equals `NaN`, `-0` equals `0`), objects, arrays, maps, sets and interface
  values by identity. A union is a key type when each of its members is one or is
  `null`: two union keys are the same key when they hold the same member
  and the same value as keys of that member's type, so a `Map<A | B, V>` of
  classes keys by identity, `null` is one key, and `1` as `i32` and `1` as
  `int` are different keys of a `Map<i32 | int, V>`. Functions, channels and
  `ptr` values cannot be keys.

## Sets

- `Set<T>` is a reference to a hash set that iterates in insertion order,
  with the hashing and equality of `Map` keys (unions included).
  `new Set<T>()` creates one; the type may come from the context; a
  variable or field without an initializer starts as a new empty set.
- `new Set(values)` adds the elements of an array (`new Set([1, 2, 2])`),
  of another set or of any other iterable; without a type argument, `T` is their element type.
- `add(value)` returns the set; `has`, `delete` (returns whether the value
  was present), `clear`, `size`; `values()` and `keys()` return a lazy iterator in
  insertion order, `entries()` one of `[value, value]` tuples, as for maps. `forEach((value, value2, set) => ...)` passes each
  value twice, as JavaScript does, and visits values added during the loop.
- The set methods of ES2024 take another `Set<T>` and return a new set or a
  `bool`: `union` (the elements of this set, then the new ones of the
  other), `intersection` (in the order of the smaller set, this one when
  they are as large), `difference`, `symmetricDifference` (this set's
  elements, then the other's), `isSubsetOf`, `isSupersetOf` and
  `isDisjointFrom`. JavaScript also takes set-like objects (a `Map`, or any
  object with `size`, `has` and `keys`); Ore takes sets only.
- `for (const x of set)` iterates the elements in insertion order, including
  those added during the loop, as in JavaScript.
- Sets cannot be converted to JSON.
