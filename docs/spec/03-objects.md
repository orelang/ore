# Objects, classes, interfaces and generics

## Object types

- An object type `{ x: f64; readonly id: int }` describes a record on the
  heap, used through references: assignment shares the object and `===`
  compares identity.
- Object types are structural: two object types with the same fields (names,
  types and `readonly`) are the same type, regardless of field order.
- An object literal for a known object type must have exactly its fields.
  Without a context type, the literal's type is inferred from its values;
  shorthand properties (`{ name }`) are allowed.
- Variables of object, class and interface types must be initialized: there
  is no `null` yet.

## Classes

- A class declares a nominal type: two classes are different types even with
  the same members. There is no inheritance (`extends`); use composition and
  interfaces.
- Members: fields (with a type annotation, an initializer, or both), one
  constructor, and methods. Constructor parameters with `public`, `private`
  or `readonly` declare fields. Static members are not supported yet.
- Getters and setters (`get celsius(): f64`, `set celsius(v: f64)`) define a
  property read and written like a field, by calling them; a getter needs a
  return type annotation, and both must have the same type. A property with
  only a getter is read-only. `p.x op= v` and `p.x++` call the getter, then
  the setter, evaluating `p` once. Accessors do not implement interface
  fields.
- `new C(...)` allocates an instance, assigns parameter properties, runs
  field initializers in order, then the constructor body. Field initializers
  cannot use `this`.
- A field without an initializer starts at its zero value. A field of a type
  without a zero value (class, object or interface) must be assigned at the
  top level of the constructor.
- `private` members are accessible only inside the class. `readonly` fields
  can be assigned only by the constructor of the class.
- Methods are called on instances; `obj.method` without a call is a
  function value bound to `obj`.
- `class C implements I` checks that `C` has the members of `I`.

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
  narrow to the class) and `x instanceof I` for an interface member of a
  union.

Narrowing applies inside `if` / `else`, `while` and `for` bodies, the operands
of `&&`, `||` and `?:`, `switch` clauses on a literal (clauses reached by
falling through code are not narrowed), and after an `if` whose branch always
exits (`if (x === null) return`). An assignment narrows to the assigned
value's type until the next assignment. Loops forget facts about variables
they assign.

A narrowed read is checked at run time and panics if the value is not of the
narrowed type, so a check made stale by a call cannot corrupt memory.

`x?.f`, `x?.m()` and `x?.[i]` give `null` when `x` is null. `x ?? y` gives
`y` when `x` is null. `x!` asserts that `x` is not null and panics otherwise.

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
- `get(key)` returns `V | null`; `set(key, value)` returns the map;
  `has`, `delete` (returns whether the key was present), `clear`, `size`.
  `keys()` and `values()` return arrays in insertion order.
- `for (const [key, value] of map)` iterates entries in insertion order.
- Keys compare like SameValueZero: numbers and strings by value (`NaN`
  equals `NaN`, `-0` equals `0`), objects, arrays and interface values by
  identity. Unions cannot be keys yet.
