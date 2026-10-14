# Tests

A test file `*.test.ore` imports from `"ore:test"`:

```ts
import { test, expect, fail } from "ore:test"

test("adds", () => {
  expect(add(1, 2)).toBe(3)
})
```

A test file is a program like any other: its top-level `test(...)` calls run
the tests in order. A test fails when it panics, for example in a failed expectation
(`toBe`, `notToBe`, `fail`); the other tests still run. `ore test` runs every
test file below the given paths, skipping `node_modules`, and exits with
status 1 if any test fails.
