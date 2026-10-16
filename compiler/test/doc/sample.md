# sample

`compiler/test/doc/sample.ore`

A sample module for `ore doc`: an export of each kind, with JSDoc tags.

```ore
import { Shape } from "./sample"
```

- [surface](#surface) (function)
- [Unit](#unit) (type)
- [sides](#sides) (const)
- [name](#name) (let)
- [version](#version) (let)
- [repeat](#repeat) (function)
- [larger](#larger) (function)
- [Shape](#shape) (interface)
- [Square](#square) (class)
- [Point](#point) (type)
- [helper](#helper) (function)

## surface

```ore
function surface(width: f64, height: f64): f64
```

The area of a rectangle.

## Unit

```ore
type Unit = "mm" | "cm" | "m"
```

A unit of length.

## sides

```ore
const sides: i64
```

How many sides a square has.

## name

```ore
let name: string
```

The name of the sample, and its version.

## version

```ore
let version: int
```

The name of the sample, and its version.

## repeat

```ore
function repeat(text: string, times: int): string
```

Repeats a text.

**Parameters**

- `text` — What to repeat.
- `times` — How many times; may be zero.

**Returns** The text, `times` times.

**Example**

```ore
repeat("ab", 3) // "ababab"
```

## larger

```ore
function larger(a: int, b: int): int
function larger(a: f64, b: f64): f64
```

The larger of two numbers.

## Shape

```ore
interface Shape
```

A shape with a name.

### name

```ore
readonly name: string
```

Its name.

### area

```ore
area(): f64
```

Its area, in square units.

## Square

```ore
class Square implements Shape
```

A square.

**@deprecated** Use a rectangle.

### name

```ore
readonly name: string
```

The name of every square.

### constructor

```ore
constructor(public side: f64)
```

A square of a side.

### area

```ore
area(): f64
```

The side times the side.

### perimeter

```ore
get perimeter(): f64
```

The length around it.

## Point

```ore
type Point = { x: f64; y: f64 }
```

A point on the plane.

## helper

```ore
function helper(): int
```
