# Tests

A test file `*.test.ore` imports from `"ore:test"`:

```ts
import { beforeEach, describe, expect, test } from "ore:test"

describe("math", () => {
  let base = 0
  beforeEach(() => {
    base = 1
  })

  test("adds", () => {
    expect(add(base, 2)).toBe(3)
    expect([base, 2]).toEqual([1, 2])
    expect(() => divide(1, 0)).toPanic("division by zero")
  })
})
```

`ore test` runs every test file below the given paths, skipping
`node_modules`, and exits with status 1 if any test fails. `ore test -t
<pattern>` (or `--test-name-pattern`) runs only the tests whose full names
match the regular expression, as in `-t "math > add"`; the test programs
read it from the environment variable `ORE_TEST_NAME_PATTERN`.

## Running

A test file is a program like any other. Its top-level code declares the
tests, groups and hooks, which run when that code ends, in order, each test
in a task of its own. A test fails when it panics, for example in a failed
expectation; the other tests still run. Each test prints `✓ name`,
`✗ name` with its failure under it, or `○ name (skipped)` /
`○ name (todo)`; the program ends with the counts, `3 passed, 1 failed`
(and `, 1 skipped`, `, 1 todo` when there are such tests).

A test declared outside the top-level code, in another task or inside a
running test, runs at once. `describe` and the hooks can only be called by
the top-level code.

## Declarations

| Function | Declares |
| --- | --- |
| `test(name, body)` | a test |
| `skip(name, body)` | a test that does not run, reported as skipped |
| `only(name, body)` | a test that runs alone: when a file has `only` tests, its other tests do not run |
| `todo(name)` | a test still to write, reported as todo |
| `describe(name, body)` | a group: `body` declares tests, groups and hooks, whose names it prefixes (`math > adds`) |
| `beforeAll(body)`, `afterAll(body)` | a hook run once before or after the tests of the group (or of the file) |
| `beforeEach(body)`, `afterEach(body)` | a hook run before or after each test of the group, inside the hooks of the groups around it |
| `fail(message)` | (a call, not a declaration) fails the current test |

A failing `beforeAll` fails the tests of its group without running them; a
failing `beforeEach` fails the test without running its body; a failing
`afterEach` or `afterAll` is reported as a failure too. A group without a
test that runs does not run its hooks.

Ore has no syntax for properties of functions, so the modifiers of other
frameworks, `test.skip`, `test.only` and `test.todo`, are the functions
`skip`, `only` and `todo`.

## Expectations

`expect(value)` makes an `Expectation`, whose matchers fail the test when the
value does not match; `.not` inverts them (`expect(x).not.toBe(0)`).

| Matcher | Passes when the value |
| --- | --- |
| `toBe(expected)` | is `===` to `expected` |
| `toEqual(expected)` | equals `expected` deeply: arrays, maps, sets and objects with equal entries in the same order, compared as `console.log` formats them, with every level and entry |
| `toBeNull()` | is null |
| `toBeTruthy()`, `toBeFalsy()` | is truthy or falsy as in JavaScript: falsy are null, `false`, 0, NaN, `0n` and `""` |
| `toContain(item)` | (an array) has an element `===` to `item`, or (a string) contains `item` |
| `toHaveLength(n)` | (an array or a string) has the length `n` |
| `toBeGreaterThan(n)`, `toBeGreaterThanOrEqual(n)`, `toBeLessThan(n)`, `toBeLessThanOrEqual(n)` | compares so with `n` |
| `toBeCloseTo(n, digits = 2)` | (a number) differs from `n` by less than half a unit of its `digits`th decimal |
| `toMatch(pattern)` | (a string) matches the `RegExp`, or contains the string |
| `toPanic(expected?)` | (a function) panics when called, with a message that contains `expected` (a string) or matches it (a `RegExp`) |

Ore has no exceptions: `toPanic` stands for `toThrow`. The function runs
in a task of its own, whose panic ends only that task.

The matchers that only apply to some values are generic methods
(`toHaveLength<U = T>(n: int)`), checked where they are called: on another
value, such as `expect(5).toHaveLength(1)`, they are a compile-time error
in the instance (`(in 'toHaveLength<i64>')`).

A failure shows the matcher, the expected and the received value, as Bun
does:

```
  ✗ math > adds
      expect(received).toBe(expected)

      Expected: 3
      Received: 2
```

When either value takes several lines (a large array or object, a string
with newlines), they are shown as a diff of their lines, `- ` for the
expected ones and `+ ` for the received ones, with three equal lines around
each difference.

`notToBe(other)` is `.not.toBe(other)`.
