# Objects, classes, interfaces and generics

## Object types

- An object type `{ x: f64; readonly id: int }` describes a record on the
  heap, used through references: assignment shares the object and `===`
  compares identity.
- Object types are structural: two object types with the same fields (names,
  types and `readonly`) are the same type, regardless of field order.
- An optional property `name?: T` has the type `T | null`: an object
  literal may leave it out, and then it is null; `JSON.stringify` leaves it
  out when it is null, as JavaScript leaves out `undefined`.
- An object literal for a known object type must have exactly its fields,
  but optional ones.
  Without a context type, the literal's type is inferred from its values;
  shorthand properties (`{ name }`) are allowed.
- `...object` in an object literal copies the fields of an object: the
  public fields of a class instance (not its methods), the fields of an
  object type or an interface. A later property replaces an earlier one
  (`{ ...p, y: 0 }`); the values are evaluated once, in order.
- Variables of object, class and interface types must be initialized: there
  is no `null` yet.

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
  (and then its type). A static method is a function, without `this`.
  `private` static members are used only inside the class declaration;
  generic classes cannot have static members yet.
- Getters and setters (`get celsius(): f64`, `set celsius(v: f64)`) define a
  property read and written like a field, by calling them; a getter needs a
  return type annotation, and both must have the same type. A property with
  only a getter is read-only. `p.x op= v` and `p.x++` call the getter, then
  the setter, evaluating `p` once. Accessors do not implement interface
  fields.
- `new C(...)` allocates an instance, assigns parameter properties, runs
  field initializers in order, then the constructor body. Field initializers
  cannot use `this`.
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
- Index signatures (`[key: string]: T`) are not supported in interfaces,
  object types and classes; use a `Map<K, V>`.
- `private` members are accessible only inside the class that declares them,
  `protected` members inside that class and its subclasses. Neither counts
  for interfaces. `readonly` fields can be assigned only by the constructor
  of the class that declares them.
- Methods are called on instances; `obj.method` without a call is a
  function value bound to `obj`.
- `class C implements I` checks that `C` has the members of `I`.

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
  be overridden.
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
which case the method is loaded from the table of the instance. An interface
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
- Interfaces are structural: interfaces with the same members are the same
  type. An interface converts implicitly to an interface with a subset of its
  members. `interface A extends B` includes the members of `B`.
- An interface value refers to the original object: fields read and written
  through the interface are the object's fields, and `===` compares the
  objects.
- An object literal for an interface may only have fields of the interface.
- An optional member `label?: T` of an interface has the type `T | null`. A
  class or object type conforms with a field `label` of that type, or
  without one: then reading `label` through the interface gives null, and
  assigning it panics. Optional methods are not supported.
- Object types (`type P = { ... }`) and interfaces differ on purpose: an
  object type is an exact record, an interface accepts any record or class
  with the members.

## Unions and null

- `A | B` is a union type. Unions are normalized: nested unions are
  flattened, duplicates removed, and `string` absorbs string literal types.
- `null` is a value only of unions that contain `null`. A variable of such a
  type without an initializer starts as `null`. There is no `undefined`.
- A string literal type such as `"circle"` has strings as values. A string
  literal expression takes the literal type its context asks for.
- A value converts implicitly to a union containing its type. A class or
  object converts to a union member that is an interface it implements, if
  exactly one does.
- A field that every member of a union of classes, object types and
  interfaces (without `null`) has, public, can be read without narrowing
  (`stmt.line`); its type is the union of the members' field types. It can
  be assigned (`stmt.line = 3`, `stmt.count++`) when it is writable and has
  the same type in every member.
- Representation: a reference type with `null` is a nullable reference; a
  union of string literals is a string; other unions are tagged values.

## Narrowing

Checks narrow the type of a variable, of `this`, or of a field path such as
`this.head.next`:

- `x !== null` and `x === null`;
- `x === "lit"` for a union of literal types, and `x.kind === "lit"` for a
  union of objects whose `kind` fields have literal types (discriminated
  unions);
- `typeof x === "string" | "number" | "boolean" | "object"`;
- `x instanceof C` for a class `C` (also on interface values, which then
  narrow to the class, and on instances of a base class of `C`) and
  `x instanceof I` for an interface member of a union.

Narrowing applies inside `if` / `else`, `while` and `for` bodies, the operands
of `&&`, `||` and `?:`, and `switch` clauses on a literal (clauses reached by
falling through code are not narrowed). An assignment narrows to the assigned
value's type until the next assignment; a `?:` keeps the union of its
branches' types (`u = t !== null ? t : "none"` makes `u` a string).

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

A `switch` over a union of string literals with a case for every literal is
exhaustive: like a `default`, it lets a function end without `return`.

## Generics

- Functions, classes, interfaces and type aliases may have type parameters,
  optionally constrained: `function longest<T extends Named>(items: T[]): T`.
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
  functions; they cannot be used as values, and interface methods cannot be
  generic. Default type arguments are not supported.
- A function literal passed for a parameter like `f: (x: T) => U` gets its
  parameter types from the type arguments inferred from the other arguments,
  and its result binds the rest: `box.map((n) => n * 2)`.

## Maps

- `Map<K, V>` is a reference to a hash map that iterates in insertion order.
  `new Map<K, V>()` creates one; the type arguments may come from the context
  (`const m: Map<string, int> = new Map()`). A variable without an
  initializer starts as a new empty map.
- `new Map([[k1, v1], [k2, v2]])` creates a map from an array literal of
  `[key, value]` pairs, set in order (a repeated key keeps its first place
  and its last value). Without type arguments or a context, the key and
  value types are those of the first pair. Any other array of `[K, V]`
  [tuples](02-types.md#tuples) works the same, and `new Map(other)` copies
  another map.
- `get(key)` returns `V | null`; `set(key, value)` returns the map;
  `has`, `delete` (returns whether the key was present), `clear`, `size`.
  `keys()`, `values()` and `entries()` (`[key, value]` tuples) return arrays
  in insertion order.
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
  with the hashing and equality of `Map` keys (unions included). `new Set<T>()` creates one;
  the type may come from the context; a variable or field without an
  initializer starts as a new empty set.
- `new Set(values)` adds the elements of an array (`new Set([1, 2, 2])`) or
  of another set; without a type argument, `T` is their element type.
- `add(value)` returns the set; `has`, `delete` (returns whether the value
  was present), `clear`, `size`; `values()` returns an array in insertion
  order.
- `for (const x of set)` iterates the elements in insertion order, including
  those added during the loop, as in JavaScript.
- Sets cannot be converted to JSON.
