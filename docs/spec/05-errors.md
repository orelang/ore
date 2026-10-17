# Errors

Errors are values. The built-in interface `Error` has a `message`; any class
with a `message: string` field is an `Error`. A fallible function returns a
union with `Error`:

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

`new Error(message)` and `new Error(message, { cause })` create an instance
of the runtime's `Error` class (runtime/core/error.ore), as JavaScript's:
`name` is `"Error"`, `message` the message (`""` by default), `cause` the
given cause or `null`, and `toString()` gives `"Name: message"` (the name
alone without a message). Classes extend it with `class NotFound extends
Error`, call `super(message)` and usually set `this.name`; without that the
name stays `"Error"`, as in JavaScript. An instance of the class or of a
subclass is an `Error`, so `x instanceof Error` is true for it, and
`console.log` prints it as `Name: message`. There is no `stack`: release
builds keep no frames, and debug builds keep them only for panics.
Through the `Error` interface only `message` is visible; narrow with
`instanceof` to the class to read the rest.

`Error.isError(value)` takes any value, as an `unknown`, and tells whether
it is an instance of the class `Error` or of a subclass, as JavaScript's
tells a genuine error; it narrows the value to the class, as `value
instanceof Error` narrows an `unknown`. An instance of a class that only
has a `message`, without extending `Error`, is an `Error` by the interface
but not by this test.

`AggregateError` is a global class that extends `Error`, as JavaScript's:
`new AggregateError(errors, message?, options?)` holds several errors in
`errors`, an `unknown[]`, and its name is `"AggregateError"`. It is what
`Promise.any` gives when every promise fails (see
[Concurrency](06-concurrency.md#async-functions-and-promises)).

`process.panic(message)` aborts the program with a stack trace. It is reserved for
bugs and unrecoverable states. `throw`, `try`, `catch`, `finally` are
rejected.

Scope-exit cleanup uses `using` declarations (`Symbol.dispose`), the Ore
equivalent of Go's `defer`.
