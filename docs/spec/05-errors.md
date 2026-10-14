# Errors

Errors are values. The built-in interface `Error` has a `message`; any class
with a `message: string` field is an `Error`, and `new Error(message)`
creates a basic one. A fallible function returns a union with `Error`:

```ts
class ParseError {
  constructor(readonly message: string, readonly position: int) {}
}

function parse(s: string): int | Error {
  if (s.length === 0) return new ParseError("empty input", 0)
  ...
}

const r = parse(input)
if (r instanceof Error) return r
// r: int here
if (r instanceof ParseError) console.log(r.position)
```

`process.panic(message)` aborts the program with a stack trace. It is reserved for
bugs and unrecoverable states. `throw`, `try`, `catch`, `finally` are
rejected.

Scope-exit cleanup uses `using` declarations (`Symbol.dispose`), the Ore
equivalent of Go's `defer`.
