# Diagnostics

Every error and warning of the compiler has a code, shown as `error[ORE2033]` by
the command line and with a link by the language server; each code has a page
here. The code is found by the message ([`compiler/src/syntax/codes.ore`](../../compiler/src/syntax/codes.ore)):
a code keeps its number once given.

```console
$ ore check main.ore
main.ore:2:25: error[ORE3022]: Only strings can be concatenated with '+'. Use a template literal: `${a}${b}`.
  const label = "items: " + count
                          ^
  see https://github.com/orelang/ore/blob/main/docs/errors/ORE3022.md
```

A diagnostic may point at places related to it, such as the first declaration
of a name declared twice; each is printed under it as a note, and sent by the
language server as `relatedInformation`:

```console
$ ore check main.ore
main.ore:2:5: error[ORE7003]: Cannot redeclare 'count' in the same scope.
  let count = 2
      ^^^^^
  see https://github.com/orelang/ore/blob/main/docs/errors/ORE7003.md
  main.ore:1:5: note: 'count' is declared here.
    let count = 1
        ^^^^^
```

Each page gives the message, with `…` for the parts that vary (names, types,
numbers), then:

- **What it means**: the rule behind the message, and why Ore has it. Many
  errors come from places where Ore differs from TypeScript on purpose — no
  `any`, no exceptions, explicit numeric conversions, nominal classes; the
  [differences](../spec/10-differences.md) list them all.
- **Example**: a short program that produces the error.
- **How to fix**: the usual fixes, each with a corrected program.

The examples and fixes are whole programs, checked with `ore check`: an
example reports its page's code, and a fix reports no error. (A few
messages are not produced by the compiler at present; their pages say so.
A block after `<!-- no-check -->` is not checked: its message is not
produced, or it needs the network.) A line
`// file: name.ore` starts another file of the same example, next to the
first one. The link after the group on each page leads to the section of
the [specification](../spec) that states the rule.

The codes are grouped by the part of the language they concern:

## ORE1xxx: Syntax

| Code | Message |
|---|---|
| [ORE1001](ORE1001.md) | Identifier expected. |
| [ORE1002](ORE1002.md) | '…' expected. |
| [ORE1003](ORE1003.md) | Declaration expected. |
| [ORE1004](ORE1004.md) | Module specifier expected. |
| [ORE1005](ORE1005.md) | Template continuation expected. |
| [ORE1006](ORE1006.md) | Identifier expected. '…' is a reserved word in strict mode. … |
| [ORE1007](ORE1007.md) | Unterminated regular expression literal. |
| [ORE1008](ORE1008.md) | Invalid regular expression: …. |
| [ORE1009](ORE1009.md) | Unterminated string literal. |

## ORE2xxx: Types and constants

| Code | Message |
|---|---|
| [ORE2001](ORE2001.md) | 'any' is not supported in Ore. |
| [ORE2002](ORE2002.md) | 'unknown' is not supported yet. |
| [ORE2003](ORE2003.md) | 'undefined' is not supported in Ore. Use 'null'. |
| [ORE2004](ORE2004.md) | Only string, number and boolean literal types are supported yet. |
| [ORE2005](ORE2005.md) | A union cannot contain '…'. |
| [ORE2006](ORE2006.md) | 'Map' expects exactly 2 type arguments. |
| [ORE2007](ORE2007.md) | 'Set' expects exactly 1 type argument. |
| [ORE2008](ORE2008.md) | 'Chan' expects exactly 1 type argument. |
| [ORE2009](ORE2009.md) | 'Array' expects exactly 1 type argument. |
| [ORE2010](ORE2010.md) | Generic type '…' requires type arguments. |
| [ORE2011](ORE2011.md) | Type '…' is not generic. |
| [ORE2012](ORE2012.md) | Generic function types are not supported. |
| [ORE2013](ORE2013.md) | Parameters of function types need a type. |
| [ORE2014](ORE2014.md) | A rest parameter must be the last parameter, of an array type. |
| [ORE2015](ORE2015.md) | A required parameter cannot follow an optional parameter. |
| [ORE2016](ORE2016.md) | This kind of type is not supported yet. |
| [ORE2017](ORE2017.md) | Cannot find type '…'. |
| [ORE2018](ORE2018.md) | Only types of modules imported with '… as' can be qualified. |
| [ORE2019](ORE2019.md) | '…' has no type '…'. |
| [ORE2020](ORE2020.md) | Module '…' has no exported type '…'. |
| [ORE2021](ORE2021.md) | Methods in object types are not supported yet. Use an interface. |
| [ORE2022](ORE2022.md) | Only properties are supported in object types. |
| [ORE2023](ORE2023.md) | Property '…' must have a type annotation. |
| [ORE2024](ORE2024.md) | Duplicate property '…'. |
| [ORE2025](ORE2025.md) | Type '…' cannot be a Map key. |
| [ORE2026](ORE2026.md) | Type '…' cannot be an element of a Set. |
| [ORE2027](ORE2027.md) | '#' private names are forbidden in Ore. Use the 'private' modifier. |
| [ORE2028](ORE2028.md) | Computed property names are not supported. |
| [ORE2029](ORE2029.md) | A value cannot have type '…'. |
| [ORE2030](ORE2030.md) | Type 'null' is not assignable to type '…'. |
| [ORE2031](ORE2031.md) | Type '…' is not assignable to type '…': the value may be null. Check it with '!== null' first, or use '??' or '!'. |
| [ORE2032](ORE2032.md) | Type '…' is not assignable to type '…': …. |
| [ORE2033](ORE2033.md) | Type '…' is not assignable to type '…'. |
| [ORE2034](ORE2034.md) | Constant … overflows '…' (range …..…). |
| [ORE2035](ORE2035.md) | An integer constant is not assignable to type '…'. |
| [ORE2036](ORE2036.md) | A floating-point constant is not assignable to integer type '…'. Use '…(...)' to truncate. |
| [ORE2037](ORE2037.md) | A floating-point constant is not assignable to type '…'. |
| [ORE2038](ORE2038.md) | A numeric constant is not assignable to type '…'. |
| [ORE2039](ORE2039.md) | Ambiguous constant for type '…'. Convert it explicitly, e.g. '…(...)'. |
| [ORE2040](ORE2040.md) | Operator '…' requires integer operands. |
| [ORE2041](ORE2041.md) | Operator '~' requires an integer operand. |
| [ORE2042](ORE2042.md) | Division by zero. |
| [ORE2043](ORE2043.md) | Exponent … is too large. |
| [ORE2044](ORE2044.md) | Shift count must not be negative. |
| [ORE2045](ORE2045.md) | Shift count … is too large. |
| [ORE2046](ORE2046.md) | An index signature makes a dictionary, '{ name: string; [key: string]: T }': it is not a member of a class, of a generic interface or of an interface that extends another. |
| [ORE2047](ORE2047.md) | Cannot find name '…'. Use '…'. |
| [ORE2048](ORE2048.md) | Type '…' cannot be converted to or from JSON: the keys of a Map must be strings. |
| [ORE2049](ORE2049.md) | Type '…' cannot be converted to or from JSON. |
| [ORE2050](ORE2050.md) | A class or a tuple cannot be part of an intersection; use an interface, or extend the class. |
| [ORE2051](ORE2051.md) | Only object types and interfaces can be intersected, not '…'. |
| [ORE2052](ORE2052.md) | Member '…' has the type '…' in one part of the intersection and '…' in another. |
| [ORE2053](ORE2053.md) | 'keyof' needs an object type, a class or an interface with members, not '…'. |
| [ORE2054](ORE2054.md) | An index type is a string literal or a union of them, not '…'. |
| [ORE2055](ORE2055.md) | Type '…' has no elements indexed by number. |
| [ORE2056](ORE2056.md) | '…' is not known yet here: give it a type annotation to use 'typeof …' before it. |
| [ORE2057](ORE2057.md) | 'typeof …' needs a variable or a function with a known type. |
| [ORE2058](ORE2058.md) | This type operator is not supported. |
| [ORE2059](ORE2059.md) | The keys of a mapped type are string literal types or 'string', not '…'. |
| [ORE2060](ORE2060.md) | A key of a mapped type is a string literal type, not '…'. |
| [ORE2061](ORE2061.md) | A mapped type needs the type of its fields: '{ [K in Keys]: T }'. |
| [ORE2062](ORE2062.md) | 'infer' declares a type only in the 'extends' clause of a conditional type. |
| [ORE2063](ORE2063.md) | 'infer' is supported in array, tuple, object, function, Map, Set and generic class types. |
| [ORE2064](ORE2064.md) | 'intrinsic' is only the type of Uppercase, Lowercase, Capitalize and Uncapitalize. |
| [ORE2065](ORE2065.md) | An integer constant is not assignable to type 'bigint'. Write a bigint literal: '…n'. |
| [ORE2066](ORE2066.md) | Type '…' exists only in computations on types: values cannot have 'never' in a tuple or an object type yet. |
| [ORE2067](ORE2067.md) | Constant … is not assignable to type '…'. |
| [ORE2068](ORE2068.md) | An index signature has one parameter and a type: '[key: string]: T'. |
| [ORE2069](ORE2069.md) | The keys of a dictionary are strings, not '…'; for other keys, use a 'Map<K, V>'. |
| [ORE2070](ORE2070.md) | The type '…' is 'readonly' and cannot be assigned to the mutable type '…'. |
| [ORE2071](ORE2071.md) | A required element cannot follow an optional element. |
| [ORE2072](ORE2072.md) | A rest element of type '…' is not supported: tuples have a fixed length in Ore. Spread a tuple type, or use an array. |
| [ORE2073](ORE2073.md) | A dictionary has one index signature, '[key: string]: T'. |
| [ORE2074](ORE2074.md) | The other members of an object type with an index signature are properties, its named entries: '{ name: string; [key: string]: string }'. |
| [ORE2075](ORE2075.md) | Property '…' of type '…' is not assignable to 'string' index type '…'. |

## ORE3xxx: Expressions

| Code | Message |
|---|---|
| [ORE3001](ORE3001.md) | Field initializers cannot use 'this'. |
| [ORE3002](ORE3002.md) | A static method or block has no 'this'; name the class: '….name'. |
| [ORE3003](ORE3003.md) | 'this' can only be used inside a class. |
| [ORE3004](ORE3004.md) | 'super' can only call the constructor or a method of the base class: 'super(...)' or 'super.m(...)'. |
| [ORE3005](ORE3005.md) | Type assertions are not supported in Ore. Use a conversion such as 'i32(x)'. |
| [ORE3006](ORE3006.md) | 'await' is only allowed in async functions and in the top-level code of a module. |
| [ORE3007](ORE3007.md) | 'delete' removes an entry of a dictionary, '{ [key: string]: T }', only. |
| [ORE3008](ORE3008.md) | This expression is not supported yet. |
| [ORE3009](ORE3009.md) | '…' is a class. Create an instance with 'new …(...)'. |
| [ORE3010](ORE3010.md) | '…' is a generic function and cannot be used as a value. |
| [ORE3011](ORE3011.md) | '…' is a namespace; call its functions, e.g. '….…(...)'. |
| [ORE3012](ORE3012.md) | '…' is a module; use its exports, e.g. '….name'. |
| [ORE3013](ORE3013.md) | External function '…' cannot be used as a value. |
| [ORE3014](ORE3014.md) | Function '…' has overload signatures and cannot be used as a value. |
| [ORE3015](ORE3015.md) | '…' is a function and cannot be used as a value yet. |
| [ORE3016](ORE3016.md) | '…' is not supported in Ore. Use '…'. |
| [ORE3017](ORE3017.md) | '>>>' is not supported in Ore. Use '>>' on an unsigned type. |
| [ORE3018](ORE3018.md) | The comma operator is not supported in Ore. |
| [ORE3019](ORE3019.md) | 'in' tests the keys of a dictionary, '{ [key: string]: T }', only, not of '…'. |
| [ORE3020](ORE3020.md) | Operator '…' is not supported. |
| [ORE3021](ORE3021.md) | Operator '…' requires integer operands, got '…' and '…'. |
| [ORE3022](ORE3022.md) | Only strings can be concatenated with '+'. Use a template literal: `${a}${b}`. |
| [ORE3023](ORE3023.md) | Operator '…' cannot be applied to types '…' and '…'. Convert one side explicitly, e.g. '…(x)'. |
| [ORE3024](ORE3024.md) | Operator '…' requires integer operands, got '…'. |
| [ORE3025](ORE3025.md) | Operator '…' cannot be applied to type '…'. |
| [ORE3026](ORE3026.md) | A constant cannot be null. |
| [ORE3027](ORE3027.md) | Type '…' cannot be null, so this comparison is always …. |
| [ORE3028](ORE3028.md) | Cannot compare '…' with '…'. |
| [ORE3029](ORE3029.md) | '…=' cannot assign to an accessor; write 'x = x … v'. |
| [ORE3030](ORE3030.md) | '…=' cannot assign to a field of an interface or a union; write 'x = x … v'. |
| [ORE3031](ORE3031.md) | Type '…' cannot be null; '??=' is not needed. |
| [ORE3032](ORE3032.md) | Operator '…=' needs a boolean, got '…'. |
| [ORE3033](ORE3033.md) | Property '…' has a setter but no getter. |
| [ORE3034](ORE3034.md) | Cannot infer the type of '…' from this value. Add a type annotation, e.g. 'let …: T'. |
| [ORE3035](ORE3035.md) | Strings are immutable. |
| [ORE3036](ORE3036.md) | Type '…' cannot be indexed. |
| [ORE3037](ORE3037.md) | Cannot assign to '…' because it is a read-only property. |
| [ORE3038](ORE3038.md) | Cannot assign to '…' because it is not a variable. |
| [ORE3039](ORE3039.md) | Property '…' does not exist on type '…'. |
| [ORE3040](ORE3040.md) | Cannot assign to '…' because it has a getter but no setter. |
| [ORE3041](ORE3041.md) | Only variables, fields and array elements can be assigned to. |
| [ORE3042](ORE3042.md) | Cannot find name '…'. |
| [ORE3043](ORE3043.md) | Cannot assign to '…' because it is a constant. |
| [ORE3044](ORE3044.md) | Cannot assign to '…': its type differs between the members of '…'. |
| [ORE3045](ORE3045.md) | Branches of '?:' cannot be 'void'. |
| [ORE3046](ORE3046.md) | Only an array, a tuple or an iterable can be spread into an array. |
| [ORE3047](ORE3047.md) | An array cannot contain values of type '…'. |
| [ORE3048](ORE3048.md) | Only a tuple can be spread into a tuple. |
| [ORE3049](ORE3049.md) | Expected … element(s) for tuple type '…', got …. |
| [ORE3050](ORE3050.md) | Array holes are not supported. |
| [ORE3051](ORE3051.md) | Cannot infer the type of an empty array. Add a type annotation, e.g. 'let a: int[] = []'. |
| [ORE3052](ORE3052.md) | Only an object can be spread into an object literal, got '…'. |
| [ORE3053](ORE3053.md) | Accessors in object literals are not supported yet. |
| [ORE3054](ORE3054.md) | Cannot tell which member of '…' this object literal is. Give its discriminant field a literal value. |
| [ORE3055](ORE3055.md) | No member of '…' matches this object literal. |
| [ORE3056](ORE3056.md) | Property '…' does not exist in type '…'. |
| [ORE3057](ORE3057.md) | Missing … … of type '…'. |
| [ORE3058](ORE3058.md) | Object literal may only specify known properties, and '…' does not exist in type '…'. |
| [ORE3059](ORE3059.md) | A property cannot have type '…'. |
| [ORE3060](ORE3060.md) | Cannot format a value of type '…'. |
| [ORE3061](ORE3061.md) | Module '…' has no exported value '…'. |
| [ORE3062](ORE3062.md) | Static members of generic classes are not supported yet. |
| [ORE3063](ORE3063.md) | Class '…' has no static member '…'. |
| [ORE3064](ORE3064.md) | '…' is a generic method and cannot be used as a value; call it. |
| [ORE3065](ORE3065.md) | … The value may be null: check it with '!== null' first, or use '?.'. |
| [ORE3066](ORE3066.md) | A constant is not an object. |
| [ORE3067](ORE3067.md) | A value of type '…' is never an instance of '…'. |
| [ORE3068](ORE3068.md) | The right side of 'instanceof' must be a class or an interface. |
| [ORE3069](ORE3069.md) | Type '…' cannot be null; '!' is not needed. |
| [ORE3070](ORE3070.md) | The left side of '??' cannot be null. |
| [ORE3071](ORE3071.md) | Type '…' cannot be null; '??' is not needed. |
| [ORE3072](ORE3072.md) | A tuple is indexed by a constant integer. |
| [ORE3073](ORE3073.md) | Tuple type '…' of length … has no element at index …. |
| [ORE3074](ORE3074.md) | Index … must not be negative. |
| [ORE3075](ORE3075.md) | An index must be an integer, got '…'. |
| [ORE3076](ORE3076.md) | Accessors are not supported in an object literal with methods yet. |
| [ORE3077](ORE3077.md) | A method of an object literal needs a return type annotation, or a type to fit. |
| [ORE3078](ORE3078.md) | Object is of type 'unknown'. |
| [ORE3079](ORE3079.md) | Static fields of generic classes are not supported yet. |
| [ORE3080](ORE3080.md) | An expression of type 'void' cannot be awaited. |
| [ORE3081](ORE3081.md) | A union of promises and other values cannot be awaited yet. |
| [ORE3082](ORE3082.md) | Static members cannot reference class type parameters. |
| [ORE3083](ORE3083.md) | The key of a dictionary is a string, not '…'. |
| [ORE3084](ORE3084.md) | Index signature in type '…' only permits reading. |
| [ORE3085](ORE3085.md) | The operand of a 'delete' operator cannot be a read-only property. |
| [ORE3086](ORE3086.md) | Only a dictionary of '…' or an object can be spread into '…', got '…'. |
| [ORE3087](ORE3087.md) | A literal of '…' has only properties and spreads. |
| [ORE3088](ORE3088.md) | Type '…' is indexed by the name of a member, a string literal or a 'keyof' type. |
| [ORE3089](ORE3089.md) | Only a member named by a string literal or a 'keyof' type can be assigned to: 'object["name"] = value'. |
| [ORE3090](ORE3090.md) | An entry of a dictionary is assigned with '=' or '??=': it is '…' when read. |
| [ORE3091](ORE3091.md) | 'globalThis' cannot be used as a value; use its members, as 'globalThis.Math'. |
| [ORE3092](ORE3092.md) | 'as const' takes array literals without spread elements. |
| [ORE3093](ORE3093.md) | 'as const' takes object literals of 'name: value' properties. |
| [ORE3094](ORE3094.md) | The operand of a 'delete' operator must be optional: '…' is a required entry of '…'. |
| [ORE3095](ORE3095.md) | Property '…' is missing in this literal but required in type '…'. |

## ORE4xxx: Calls and built-in functions

| Code | Message |
|---|---|
| [ORE4001](ORE4001.md) | Type arguments are only allowed for generic functions. |
| [ORE4002](ORE4002.md) | '…' takes no arguments. |
| [ORE4003](ORE4003.md) | A constant has no '…' method. |
| [ORE4004](ORE4004.md) | Type '…' has no '[Symbol.dispose]' method. |
| [ORE4005](ORE4005.md) | '…' has no member '…'. |
| [ORE4006](ORE4006.md) | Spread arguments are not supported yet. |
| [ORE4007](ORE4007.md) | Conversion '…' expects exactly 1 argument, got …. |
| [ORE4008](ORE4008.md) | Cannot convert … to '…'. |
| [ORE4009](ORE4009.md) | Cannot convert '…' to '…'. |
| [ORE4010](ORE4010.md) | Only an array or a tuple can be spread into arguments. |
| [ORE4011](ORE4011.md) | Class '…' must be instantiated with 'new …(...)'. |
| [ORE4012](ORE4012.md) | '…' is not a function. |
| [ORE4013](ORE4013.md) | No overload of '…' takes these arguments. Its signatures: …. |
| [ORE4014](ORE4014.md) | The callback of '…' must return a value. |
| [ORE4015](ORE4015.md) | Cannot join elements of type '…'. |
| [ORE4016](ORE4016.md) | Sorting '…' needs a comparator: 'sort((a, b) => ...)'. |
| [ORE4017](ORE4017.md) | The comparator of '…' must return a number. |
| [ORE4018](ORE4018.md) | Expected a function of type '…', got '…'. |
| [ORE4019](ORE4019.md) | '…' expects at least 1 argument(s), got 0. |
| [ORE4020](ORE4020.md) | '…' needs numbers, got '…'. |
| [ORE4021](ORE4021.md) | An array of '…' cannot be spread into '…' of '…'. |
| [ORE4022](ORE4022.md) | '…' expects … argument(s), got …. |
| [ORE4023](ORE4023.md) | '…' expects 1 to 3 argument(s), got …. |
| [ORE4024](ORE4024.md) | The second argument of 'JSON.stringify' is a replacer, null, an array of keys or a function '(key: string, value: unknown) => unknown': write 'JSON.stringify(value, null, 2)' to indent. |
| [ORE4025](ORE4025.md) | 'JSON.parse' needs the type to read, e.g. 'JSON.parse<Config>(text)'. |
| [ORE4026](ORE4026.md) | '…' expects 1 argument(s), got …. |
| [ORE4027](ORE4027.md) | '…' takes one type argument. |
| [ORE4028](ORE4028.md) | '…' needs a type argument, e.g. '…'. |
| [ORE4029](ORE4029.md) | '…' cannot work on '…'. |
| [ORE4030](ORE4030.md) | '…' needs an object, array or map type, got '…'. |
| [ORE4031](ORE4031.md) | Atomic operations need an integer or 'ptr', got '…'. |
| [ORE4032](ORE4032.md) | '…' converts between numeric types, not '…' and '…'. |
| [ORE4033](ORE4033.md) | '…' needs types of the same size: '…' has … bits, '…' …. |
| [ORE4034](ORE4034.md) | '…' needs the name of a top-level function. |
| [ORE4035](ORE4035.md) | '…' needs an object, array or map, got '…'. |
| [ORE4036](ORE4036.md) | '…' needs an integer, got '…'. |
| [ORE4037](ORE4037.md) | '…' expects a template and constraints, got … argument(s). |
| [ORE4038](ORE4038.md) | The template and the constraints of 'unsafe.asm' must be string literals. |
| [ORE4039](ORE4039.md) | An operand of 'unsafe.asm' must be a number or 'ptr', got '…'. |
| [ORE4040](ORE4040.md) | 'unsafe.asm' can return a number or 'ptr', got '…'. |
| [ORE4041](ORE4041.md) | Unknown function '…'. |
| [ORE4042](ORE4042.md) | A spread argument must be a tuple, or be passed to a rest parameter. |
| [ORE4043](ORE4043.md) | A constant is not a function. |
| [ORE4044](ORE4044.md) | A value of type '…' is not a function. |
| [ORE4045](ORE4045.md) | This function expects … argument(s), got …. |
| [ORE4046](ORE4046.md) | 'new Map' takes at most one argument: an array of [key, value] pairs. |
| [ORE4047](ORE4047.md) | An entry of 'new Map' must be a [key, value] pair. |
| [ORE4048](ORE4048.md) | Cannot infer the types of the Map. Write 'new Map<K, V>()' or annotate the variable. |
| [ORE4049](ORE4049.md) | 'new Map' takes an array of [key, value] pairs, got '…'. |
| [ORE4050](ORE4050.md) | 'new Set' takes at most one argument: an array or a set of values. |
| [ORE4051](ORE4051.md) | Cannot infer the type of the Set. Write 'new Set<T>()' or annotate the variable. |
| [ORE4052](ORE4052.md) | 'new Set' takes an array or a set of values, got '…'. |
| [ORE4053](ORE4053.md) | Only named classes can be instantiated. |
| [ORE4054](ORE4054.md) | Cannot infer the type of the channel. Write 'new Chan<T>()' or annotate the variable. |
| [ORE4055](ORE4055.md) | 'new Chan' takes at most a capacity. |
| [ORE4056](ORE4056.md) | Cannot create an instance of an abstract class '…'. |
| [ORE4057](ORE4057.md) | '…' is not a class. |
| [ORE4058](ORE4058.md) | Class '…' is not generic. |
| [ORE4059](ORE4059.md) | A 'super' call is only allowed in the constructor of a class that extends another class. |
| [ORE4060](ORE4060.md) | A 'super' call must be a statement at the top level of the constructor, and the only one. |
| [ORE4061](ORE4061.md) | 'super' can only be used in the methods and constructor of a class that extends another class. |
| [ORE4062](ORE4062.md) | Type arguments are only allowed for generic functions and methods. |
| [ORE4063](ORE4063.md) | Generic method '…' cannot be called through 'super' yet. |
| [ORE4064](ORE4064.md) | Method '…' does not exist on base class '…'. |
| [ORE4065](ORE4065.md) | Abstract method '…' in class '…' cannot be accessed via super expression. |
| [ORE4066](ORE4066.md) | … expects at least … argument(s), got …. |
| [ORE4067](ORE4067.md) | … expects … argument(s), got …. |
| [ORE4068](ORE4068.md) | An array of '…' cannot be spread into an array of '…'. |
| [ORE4069](ORE4069.md) | Field '…' is not a method. |
| [ORE4070](ORE4070.md) | Method '….…' expects … argument(s), got …. |
| [ORE4071](ORE4071.md) | Method '…' does not exist on type '…'. |
| [ORE4072](ORE4072.md) | 'toFixed' expects 0 to 1 argument(s), got …. |
| [ORE4073](ORE4073.md) | Only an array can be spread into an array. |
| [ORE4074](ORE4074.md) | 'pop' expects no arguments, got …. |
| [ORE4075](ORE4075.md) | 'slice' expects at most 2 arguments, got …. |
| [ORE4076](ORE4076.md) | 'internal' is only for the standard library. Add '//ore:internal' at the top of the file to use it here. |
| [ORE4077](ORE4077.md) | '…' may be null: call it with '…?.(...)'. |
| [ORE4078](ORE4078.md) | The depth of 'flat' must be an integer constant or 'Infinity'. |
| [ORE4079](ORE4079.md) | Cannot infer the type of the array. Write 'new Array<T>(length)' or annotate the variable. |
| [ORE4080](ORE4080.md) | 'new Array(length)' needs elements with a zero value, and '…' has none. Use 'Array.from({ length }, (_, i) => ...)'. |
| [ORE4081](ORE4081.md) | 'Array.isArray' cannot test an 'unknown' yet. |
| [ORE4082](ORE4082.md) | 'Array.from' takes an iterable (an array, a string, a set, a map, a generator...) or '{ length: n }', got '…'. |
| [ORE4083](ORE4083.md) | 'Array.from' takes an object only as '{ length: n }'. |
| [ORE4084](ORE4084.md) | 'Array.from({ length })' needs a function to make the elements: '(_, i) => ...'. |
| [ORE4085](ORE4085.md) | A dictionary has no methods: '…' is an entry, of type '…'. |
| [ORE4086](ORE4086.md) | '…' takes a dictionary, an object or a class instance, got '…'. |
| [ORE4087](ORE4087.md) | '…' cannot copy '…' into '…': give it …. |
| [ORE4088](ORE4088.md) | '…' cannot copy the field '…' into '…': it has no writable field '…'. |
| [ORE4089](ORE4089.md) | A dictionary is not iterable: use 'new Map(Object.entries(d))'. |
| [ORE4090](ORE4090.md) | structuredClone cannot clone a function: '…' could not be cloned. |
| [ORE4091](ORE4091.md) | structuredClone cannot clone '…': an instance of a class with methods would lose them, as JavaScript copies it into a plain object. |
| [ORE4092](ORE4092.md) | structuredClone cannot clone '…': its values could not be cloned. |
| [ORE4093](ORE4093.md) | Method '…' has different types in the members of '…': '…' and '…'. |
| [ORE4094](ORE4094.md) | Spread arguments are not supported in a call of '…' on a union. |
| [ORE4095](ORE4095.md) | '…' takes an iterable (an array, a string, a set, a map, a generator...), got '…'. |
| [ORE4096](ORE4096.md) | 'Object.fromEntries' takes [string, value] pairs, got '…'. |
| [ORE4097](ORE4097.md) | A dictionary is not iterable: use 'Object.entries(d)'. |
| [ORE4098](ORE4098.md) | Type '…' has no '[Symbol.iterator]' method. |
| [ORE4099](ORE4099.md) | The second argument of 'JSON.parse' is a reviver function '(key: string, value: unknown, context: { source: string } \| null) => unknown'. |

## ORE5xxx: Classes and interfaces

| Code | Message |
|---|---|
| [ORE5001](ORE5001.md) | A class declaration must have a name. |
| [ORE5002](ORE5002.md) | Modifier '…' is not allowed on classes. |
| [ORE5003](ORE5003.md) | Duplicate declaration '…'. |
| [ORE5004](ORE5004.md) | Classes can only extend a single class. |
| [ORE5005](ORE5005.md) | Class '…' extends itself. |
| [ORE5006](ORE5006.md) | A class can only extend a class. |
| [ORE5007](ORE5007.md) | Duplicate member '…'. |
| [ORE5008](ORE5008.md) | Only methods can be abstract. |
| [ORE5009](ORE5009.md) | Definitely-assigned fields are not supported. |
| [ORE5010](ORE5010.md) | Optional field '…' needs a type annotation. |
| [ORE5011](ORE5011.md) | Field '…' needs a type annotation or an initializer. |
| [ORE5012](ORE5012.md) | Methods cannot be 'readonly'. |
| [ORE5013](ORE5013.md) | Async generators are not supported in Ore. |
| [ORE5014](ORE5014.md) | Optional methods are not supported in classes. |
| [ORE5015](ORE5015.md) | Abstract methods can only appear within an abstract class. |
| [ORE5016](ORE5016.md) | Method '…' cannot have an implementation because it is marked abstract. |
| [ORE5017](ORE5017.md) | Generic methods cannot be abstract. |
| [ORE5018](ORE5018.md) | A method must have a body. |
| [ORE5019](ORE5019.md) | Default type arguments are not supported yet. |
| [ORE5020](ORE5020.md) | A class can have only one constructor. |
| [ORE5021](ORE5021.md) | A constructor must have a body. |
| [ORE5022](ORE5022.md) | This class member is not supported. |
| [ORE5023](ORE5023.md) | Non-abstract class '…' does not implement inherited abstract member '…' from class '…'. |
| [ORE5024](ORE5024.md) | This member cannot have an 'override' modifier because it is not declared in the base class '…'. |
| [ORE5025](ORE5025.md) | This member cannot have an 'override' modifier because its containing class '…' does not extend another class. |
| [ORE5026](ORE5026.md) | '…' is private in base class '…' and cannot be redeclared. |
| [ORE5027](ORE5027.md) | Accessors cannot be overridden yet: '…' is an accessor of base class '…'. |
| [ORE5028](ORE5028.md) | '…' is already declared in base class '…' as a …; only methods can be overridden. |
| [ORE5029](ORE5029.md) | Method '…' must have the type of the method it overrides in '…': '…', not '…'. |
| [ORE5030](ORE5030.md) | Method '…' overrides a method of '…' and cannot be private. |
| [ORE5031](ORE5031.md) | Method '…' is public in '…' and must stay public. |
| [ORE5032](ORE5032.md) | This static member is not supported. |
| [ORE5033](ORE5033.md) | Duplicate static member '…'. |
| [ORE5034](ORE5034.md) | Static members cannot be abstract. |
| [ORE5035](ORE5035.md) | Static members cannot be protected; make it private or public. |
| [ORE5036](ORE5036.md) | Static field '…' needs a type annotation or an initializer. |
| [ORE5037](ORE5037.md) | Only fields and methods can be static. |
| [ORE5038](ORE5038.md) | Generic static methods are not supported yet. |
| [ORE5039](ORE5039.md) | Static field '…' of type '…' needs an initializer. |
| [ORE5040](ORE5040.md) | Modifier '…' is not allowed here. |
| [ORE5041](ORE5041.md) | Field '…' of type '…' must be initialized in its declaration or at the top level of the constructor. |
| [ORE5042](ORE5042.md) | Constructors for derived classes must contain a 'super' call. |
| [ORE5043](ORE5043.md) | 'super' must be called before accessing 'this' in the constructor of a derived class. |
| [ORE5044](ORE5044.md) | A getter or setter must have a body. |
| [ORE5045](ORE5045.md) | Getter '…' must have a return type annotation. |
| [ORE5046](ORE5046.md) | Setter '…' must take one parameter with a type annotation. |
| [ORE5047](ORE5047.md) | The getter and setter of '…' must have the same type, got '…' and '…'. |
| [ORE5048](ORE5048.md) | '…' is not an interface. |
| [ORE5049](ORE5049.md) | Class '…' does not implement '…': …. |
| [ORE5050](ORE5050.md) | Duplicate type '…'. |
| [ORE5051](ORE5051.md) | Member '…' conflicts with an inherited member of a different type. |
| [ORE5052](ORE5052.md) | Interface '…' extends itself. |
| [ORE5053](ORE5053.md) | An interface can only extend interfaces and classes. |
| [ORE5054](ORE5054.md) | Call and construct signatures are not supported. |
| [ORE5055](ORE5055.md) | Generic method '…' of '…' is called through the interface with type arguments that grow without end: '…'. |
| [ORE5056](ORE5056.md) | This interface member is not supported. |
| [ORE5057](ORE5057.md) | '…' is protected and only accessible inside class '…' and its subclasses. |
| [ORE5058](ORE5058.md) | '…' is private and only accessible inside class '…'. |
| [ORE5059](ORE5059.md) | A 'this' type is available only in a non-static member of a class or interface. |
| [ORE5060](ORE5060.md) | A 'this' type in an interface is not supported yet. |
| [ORE5061](ORE5061.md) | A method returning 'this' must return 'this' or what a method returning 'this' returns on it. |
| [ORE5062](ORE5062.md) | Constructor of class '…' is … and only accessible within the class declaration. |
| [ORE5063](ORE5063.md) | Cannot extend a class '…': its constructor is private. |
| [ORE5064](ORE5064.md) | Overload signatures must all be public, private or protected, as the implementation. |
| [ORE5065](ORE5065.md) | Method '…' must have the signatures of the method it overrides in '…': …. |
| [ORE5066](ORE5066.md) | Overload signatures are not supported in interfaces yet. |
| [ORE5067](ORE5067.md) | An optional method of an interface cannot be generic. |
| [ORE5068](ORE5068.md) | Member '…' is a different generic method in each part of the intersection. |
| [ORE5069](ORE5069.md) | Field '…' is used before its type is known: its initializer uses '…', declared further down. Annotate the field. |

## ORE6xxx: Declarations, functions, generics, modules and C

| Code | Message |
|---|---|
| [ORE6001](ORE6001.md) | This overload signature has no implementation after it. |
| [ORE6002](ORE6002.md) | '…' is not a C name. |
| [ORE6003](ORE6003.md) | An exported function takes and returns numbers, 'bool' and 'ptr' only, not '…'. |
| [ORE6004](ORE6004.md) | An exported function cannot have optional or rest parameters. |
| [ORE6005](ORE6005.md) | '…' is already exported by '…'. |
| [ORE6006](ORE6006.md) | An exported variable holds a number, 'bool' or 'ptr', not '…'. |
| [ORE6007](ORE6007.md) | '…' is already exported. |
| [ORE6008](ORE6008.md) | A thread-local variable holds a number, 'bool' or 'ptr', not '…'. |
| [ORE6009](ORE6009.md) | A thread-local variable starts at zero in each thread: write 'let name: T' with a type and no value. |
| [ORE6010](ORE6010.md) | Variable '…' needs a type annotation or an initializer. |
| [ORE6011](ORE6011.md) | Variable '…' is used by functions, so it must have a value where it is declared. |
| [ORE6012](ORE6012.md) | Variable '…' is used before being assigned. |
| [ORE6013](ORE6013.md) | Duplicate export '…'. |
| [ORE6014](ORE6014.md) | Default exports are not supported in Ore. Use named exports. |
| [ORE6015](ORE6015.md) | Use 'export { name }' to re-export; 'export …' is not supported. |
| [ORE6016](ORE6016.md) | Default imports are not supported in Ore. Use 'import { name } from ...'. |
| [ORE6017](ORE6017.md) | Module '…' has no exported member '…'. |
| [ORE6018](ORE6018.md) | A text import has one name: 'import text from "…" with { type: "text" }'. |
| [ORE6019](ORE6019.md) | Cannot export '…': it is not declared in this module. |
| [ORE6020](ORE6020.md) | A function declaration must have a name. |
| [ORE6021](ORE6021.md) | Generic overload signatures are not supported yet. |
| [ORE6022](ORE6022.md) | The return type of an async function must be 'Promise<T>'. |
| [ORE6023](ORE6023.md) | Default exports are not supported in Ore. |
| [ORE6024](ORE6024.md) | A generic function cannot have overload signatures yet. |
| [ORE6025](ORE6025.md) | Overload signatures must all be exported or not, as the implementation. |
| [ORE6026](ORE6026.md) | A declared function cannot have a body. |
| [ORE6027](ORE6027.md) | External functions cannot be generic. |
| [ORE6028](ORE6028.md) | An external function needs a C name. |
| [ORE6029](ORE6029.md) | The variadic arguments of a C function are i64, f64 or ptr, as C promotes them: write '...args: i64[]'. |
| [ORE6030](ORE6030.md) | An external function cannot have optional parameters. |
| [ORE6031](ORE6031.md) | Type '…' cannot be passed to C. |
| [ORE6032](ORE6032.md) | Type '…' cannot be returned from C. |
| [ORE6033](ORE6033.md) | A type parameter without a default cannot follow one with a default. |
| [ORE6034](ORE6034.md) | '…' expects … type argument(s), got …. |
| [ORE6035](ORE6035.md) | Too many instances of generics; '…' may instantiate itself endlessly. |
| [ORE6036](ORE6036.md) | Type '…' does not satisfy the constraint '…' of '…'. |
| [ORE6037](ORE6037.md) | Parameter '…' must have a type annotation. |
| [ORE6038](ORE6038.md) | A rest parameter must be the last parameter. |
| [ORE6039](ORE6039.md) | A rest parameter must have an array type. |
| [ORE6040](ORE6040.md) | A parameter with a default value is already optional. |
| [ORE6041](ORE6041.md) | A required parameter cannot follow an optional or rest parameter. |
| [ORE6042](ORE6042.md) | Duplicate parameter '…'. |
| [ORE6043](ORE6043.md) | Function '…' must return a value of type '…' on every path. |
| [ORE6044](ORE6044.md) | Enums are not supported in Ore. Use a union of literal types. |
| [ORE6045](ORE6045.md) | Namespaces are not supported in Ore. Use modules. |
| [ORE6046](ORE6046.md) | This declaration is not supported at the top level. |
| [ORE6047](ORE6047.md) | Cannot find file '…'. |
| [ORE6048](ORE6048.md) | Cannot find module '…'. |
| [ORE6049](ORE6049.md) | Unknown directive '//ore:…'. Known: …. |
| [ORE6050](ORE6050.md) | '//ore:…' needs a C name, e.g. '//ore:… my_function'. |
| [ORE6051](ORE6051.md) | '//ore:…' takes no argument. |
| [ORE6052](ORE6052.md) | '//ore:runtime' is only for the standard library. Add '//ore:internal' at the top of the file to use it here. |
| [ORE6053](ORE6053.md) | '//ore:…' goes at the top of the file, before the first statement. |
| [ORE6054](ORE6054.md) | '//ore:export' applies to a function, or to a top-level 'let' of one name. |
| [ORE6055](ORE6055.md) | '//ore:…' applies to a function declaration with a body, not generic. |
| [ORE6056](ORE6056.md) | '//ore:threadlocal' applies to a top-level 'let' of plain names. |
| [ORE6057](ORE6057.md) | A '//ore:naked' function holds only 'unsafe.asm(template, constraints)' statements. |
| [ORE6058](ORE6058.md) | A function cannot be both '//ore:noinline' and '//ore:inline'. |
| [ORE6059](ORE6059.md) | Cannot infer type argument… of '…'. Specify them, e.g. '…<...>(...)'. |
| [ORE6060](ORE6060.md) | A '//ore:naked' function can branch only on conditions known at compile time, such as 'target.arch'. |
| [ORE6061](ORE6061.md) | A parameter property is only allowed in a constructor. |
| [ORE6062](ORE6062.md) | A recursive type alias needs an object type in its cycle: '{ next: T \| null }'. |
| [ORE6063](ORE6063.md) | Invalid GitHub module URL '…': expected https://github.com/<owner>/<repo>[/tree/<ref>][/<path>]. |
| [ORE6064](ORE6064.md) | Cannot download …: … |
| [ORE6065](ORE6065.md) | Cannot import …: it has no branch or tag '…'. |
| [ORE6066](ORE6066.md) | Cannot import …: modules from GitHub are kept in the cache, which is off. |
| [ORE6067](ORE6067.md) | Invalid JSON: …. |
| [ORE6068](ORE6068.md) | A JSON import has one name: 'import data from "…" with { type: "json" }'. |
| [ORE6069](ORE6069.md) | Unknown import type '…'. Use 'text' or 'json'. |
| [ORE6070](ORE6070.md) | Unknown import attribute '…'. Only 'type' is supported. |
| [ORE6071](ORE6071.md) | A generic function value must be instantiated: give its type arguments or call it. |
| [ORE6072](ORE6072.md) | '…' calls itself, so it needs a return type annotation. |
| [ORE6073](ORE6073.md) | Module '…' has already exported a member named '…'. Consider explicitly re-exporting to resolve the ambiguity. |
| [ORE6074](ORE6074.md) | Cannot find parameter '…'. |
| [ORE6075](ORE6075.md) | A 'this' type predicate is allowed only in a method. |
| [ORE6076](ORE6076.md) | A type predicate's type must be assignable to its parameter's type: '…' is not assignable to '…'. |
| [ORE6077](ORE6077.md) | This result does not show that '…' is '…': return a check of '…' that narrows it, such as 'typeof x === "string"' or 'x instanceof C', or false. |
| [ORE6078](ORE6078.md) | The function can return here without showing that '…' is '…': it must panic or exit where the assertion does not hold. |
| [ORE6079](ORE6079.md) | A generator function needs a return type annotation, such as 'Generator<T>': …. |
| [ORE6080](ORE6080.md) | The return type of a generator function must be 'Generator<T, TReturn, TNext>', 'Iterator<T>' or 'IterableIterator<T>', not '…'. |
| [ORE6081](ORE6081.md) | 'yield' is only allowed in generator functions. |
| [ORE6082](ORE6082.md) | 'yield' without a value yields null, which type '…' does not include. |
| [ORE6083](ORE6083.md) | 'yield*' takes a generator of the same value and next types: '…' and '…'. |
| [ORE6084](ORE6084.md) | The return type of an async generator function must be 'AsyncGenerator<T, TReturn, TNext>', 'AsyncIterator<T>' or 'AsyncIterableIterator<T>', not '…'. |
| [ORE6085](ORE6085.md) | 'yield*' yields values of type '…', which type '…' does not include. |

## ORE7xxx: Statements

| Code | Message |
|---|---|
| [ORE7001](ORE7001.md) | Declare one resource per 'using'. |
| [ORE7002](ORE7002.md) | 'using' needs a name and an initializer. |
| [ORE7003](ORE7003.md) | Cannot redeclare '…' in the same scope. |
| [ORE7004](ORE7004.md) | Type '…' is not disposable: it needs a '[Symbol.dispose](): void' method. |
| [ORE7005](ORE7005.md) | A nested function needs a name and a body. |
| [ORE7006](ORE7006.md) | Nested generic functions are not supported. |
| [ORE7007](ORE7007.md) | Cannot find loop label '…'. |
| [ORE7008](ORE7008.md) | Cannot continue '…': it labels a switch. |
| [ORE7009](ORE7009.md) | 'break' must be inside a loop or switch. |
| [ORE7010](ORE7010.md) | 'continue' must be inside a loop. |
| [ORE7011](ORE7011.md) | A function declaration must be at the top level or directly in a block. |
| [ORE7012](ORE7012.md) | Exceptions are not supported in Ore. Return an error value, or call panic() for unrecoverable failures. |
| [ORE7013](ORE7013.md) | 'for...in' is not supported in Ore. Use 'for...of'. |
| [ORE7014](ORE7014.md) | Labels are only supported on loops and switches. |
| [ORE7015](ORE7015.md) | Duplicate label '…'. |
| [ORE7016](ORE7016.md) | This statement is not supported yet. |
| [ORE7017](ORE7017.md) | 'using' must be a statement directly in a block. |
| [ORE7018](ORE7018.md) | 'var' is not supported in Ore. Use 'let' or 'const'. |
| [ORE7019](ORE7019.md) | A destructuring declaration must be initialized. |
| [ORE7020](ORE7020.md) | A 'const' declaration must be initialized. |
| [ORE7021](ORE7021.md) | Cannot assign an expression of type '…' to a variable. |
| [ORE7022](ORE7022.md) | Cannot infer a type from 'null'. Add a type annotation, e.g. 'let …: T \| null = null'. |
| [ORE7023](ORE7023.md) | Destructure a property by its name. |
| [ORE7024](ORE7024.md) | Type '…' cannot be destructured as an array. |
| [ORE7025](ORE7025.md) | Type '…' cannot be destructured as an object. |
| [ORE7026](ORE7026.md) | A tuple cannot contain values of type '…'. |
| [ORE7027](ORE7027.md) | The loop variable must be declared with 'const' or 'let'. |
| [ORE7028](ORE7028.md) | The loop variable cannot have a type annotation; its type comes from the iterable. |
| [ORE7029](ORE7029.md) | Iterate a Map with 'for (const [key, value] of map)'. |
| [ORE7030](ORE7030.md) | Type '…' is not iterable. |
| [ORE7031](ORE7031.md) | Duplicate name '…'. |
| [ORE7032](ORE7032.md) | Cannot switch on a value of type '…'. |
| [ORE7033](ORE7033.md) | A switch can have only one 'default' clause. |
| [ORE7034](ORE7034.md) | 'return' is only allowed in a function. Use 'process.exit()' to end the program. |
| [ORE7035](ORE7035.md) | A constructor cannot return a value. |
| [ORE7036](ORE7036.md) | A return value of type '…' is required. |
| [ORE7037](ORE7037.md) | A function without a return type annotation cannot return a value. |
| [ORE7038](ORE7038.md) | Generic closures are not supported. |
| [ORE7039](ORE7039.md) | This function takes … parameter(s), but … are expected. |
| [ORE7040](ORE7040.md) | Parameter '…' needs a type annotation here. |
| [ORE7041](ORE7041.md) | Parameter type '…' does not match the expected '…'. |
| [ORE7042](ORE7042.md) | A rest element must be last in a destructuring pattern. |
| [ORE7043](ORE7043.md) | A rest element cannot have a default value. |
| [ORE7044](ORE7044.md) | The rest of an object pattern must be a name, not a pattern. |
| [ORE7045](ORE7045.md) | A dictionary is not iterable: loop over 'Object.keys(d)' or 'Object.entries(d)'. |
| [ORE7046](ORE7046.md) | Type '…' is not iterable: it needs a '[Symbol.iterator]()' method. |
| [ORE7047](ORE7047.md) | 'for await' is only allowed in async functions and in the top-level code of a module. |
| [ORE7048](ORE7048.md) | Type '…' is not async iterable: it needs a '[Symbol.asyncIterator]()' method whose iterator's 'next()' returns a promise of an 'IteratorResult', or a '[Symbol.iterator]()' method. |
