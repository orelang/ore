# Changelog

All notable changes of Ore. Versions follow [Semantic Versioning](https://semver.org);
before 1.0, a minor version may change the language.

## Unreleased

- Streams, as in JavaScript, after the WHATWG Streams Standard with Node's
  algorithms, so that their promises settle in Node's order: the global
  classes `ReadableStream<R>` (`getReader()`, `cancel`, `tee`, `pipeTo`,
  `pipeThrough`, `values`, `for await`, `ReadableStream.from` of anything
  `for await` takes), `ReadableStreamDefaultReader`,
  `ReadableStreamDefaultController`, `WritableStream<W>`,
  `WritableStreamDefaultWriter` (backpressure through `ready` and
  `desiredSize`), `WritableStreamDefaultController` (with its `signal`),
  `TransformStream<I, O>`, `TransformStreamDefaultController`,
  `CountQueuingStrategy`, `ByteLengthQueuingStrategy` (of `u8[]` chunks),
  `TextEncoderStream` and `TextDecoderStream`, and the interfaces
  `QueuingStrategy` and `ReadableWritablePair`. Promises do not reject: a
  promise of a stream that JavaScript rejects is fulfilled with an `Error`
  (the reason, or an `Error` whose `cause` is the reason), `read()` is a
  `Promise<ReadableStreamReadResult<R> | Error>` and the promises of
  nothing are `Promise<Error | null>`; callbacks fail through
  `controller.error(reason)`, and what JavaScript throws at once panics.
  Byte streams and BYOB readers are left out. `Blob.stream()` is a
  `ReadableStream<u8[]>`, and `TextDecoder.decode(bytes, { stream: true })`
  decodes a stream of chunks.
- `void | Promise<T>`, TypeScript's result of a callback that may be async,
  is `Promise<T> | null`: a function or function literal of that result
  may return nothing, a void call, or a promise, and an async one returns
  its promise. `void` is still in no other union
  ([ORE2005](docs/errors/ORE2005.md)).
- `x as T` of an `unknown` is the value it holds as a `T`, checked at run
  time (a panic when it holds another type).
- A `return` without a value ends a function whose result is `null`, as an
  async function of a `Promise<void>`.
- The inference of a generic call takes the getters of a class for the
  fields of an interface: `stream.pipeThrough(new TextDecoderStream())`.
- Async generators and `for await`, as in JavaScript: `async function*`
  declarations and expressions, `async *method()` (also `async
  *[Symbol.asyncIterator]()` and in object literals) return an
  `AsyncGenerator<T, TReturn, TNext>`, whose `next()`, `next(value)` and
  `return(value)` return promises of `{ value, done }`; the body may
  `await`, `yield` and `return` await their values, and `yield*` takes
  another async generator (passing the values sent, giving its return value)
  or anything `for await` takes. Without an annotation the body gives the
  type, as for a generator. Calls made before the body gets to them wait in
  a queue, and the promises settle in the order and with the ticks of the
  ECMAScript specification. `for await (const x of iterable)`, in async
  functions and the top-level code, takes a value with
  `[Symbol.asyncIterator]()` (`Symbol.asyncIterator` is a well-known
  symbol) or any iterable of `for...of`, whose values (or the values of its
  promises) it awaits, as JavaScript's async-from-sync iterator does; a loop
  left early awaits the iterator's `return()`. The interfaces
  `AsyncIterator`, `AsyncIterable` and `AsyncIterableIterator` are global,
  and `Array.fromAsync(iterable)` is a promise of the values in an array.
  [ORE5013](docs/errors/ORE5013.md) is no longer reported; new:
  [ORE6084](docs/errors/ORE6084.md), [ORE6085](docs/errors/ORE6085.md),
  [ORE7047](docs/errors/ORE7047.md), [ORE7048](docs/errors/ORE7048.md).
  Object literals take `async` methods.
- A top-level `await` resumes the top-level code as the microtask that its
  promise's reaction is, as in JavaScript: the microtasks queued after it
  run once the code awaits again or ends, where all of them ran first.
- `JSON.parse<T>(text, reviver)` takes a reviver, as JavaScript's: `(key:
  string, value: unknown, context: { source: string } | null) => unknown`,
  called with each value, the parts first and the whole last with the key
  `""`, its result replacing the value and `JSON.omit` deleting it (an
  element left out is `null`: arrays have no holes). The context has the
  source text of a value that is not an array or an object. What it
  returns for the whole is then read as a `T` and checked as text is,
  with the place of the first problem in the `Error`. Without a reviver,
  `JSON.parse` reads the text straight into `T` as before.
- `JSON.parse<unknown>(text)` reads any JSON, as JavaScript's
  `JSON.parse`: numbers as `f64`s, arrays as `unknown[]`s and objects as
  dictionaries of `unknown`s; it returns an `unknown`, which holds the
  `Error` when the text is not JSON. An `unknown` in a type, a field
  `body: unknown`, is read the same way.
- The callback of an iterator's `flatMap` may return what `Iterator.from`
  takes but a string, an object with only `next()` too, and each result is
  stepped directly through the iterator `Iterator.from` gives for it,
  where it was iterated on a generator, a fiber, of its own. The type of
  its values is found as `for...of` finds an iterator, also for a class
  that only has `[Symbol.iterator]()` or `next()`.
- The timers of the web and Node are global names: `setTimeout(f, ms?,
  ...args)`, `setInterval`, `setImmediate`, `clearTimeout`,
  `clearInterval`, `clearImmediate` and `queueMicrotask`, over the queues
  of `time.timeout` and `task.microtask`, so that both run in one order.
  Delays are milliseconds, a `number`, and one below 1 ms or `NaN` is 1 ms,
  as in Node. They return Node's `Timeout`, the `time.Timer` of
  `time.timeout`, which now has `ref()`, `unref()`, `hasRef()` and
  `refresh()` beside `cancel()`: a timer or immediate unref'd does not keep
  the program running, but runs while something else does.
- A rest parameter can have a tuple type, `...p: [string, int?]`: it takes
  as many arguments as the tuple has elements, and in a function type it is
  its elements. Typed by a type parameter, `...args: A` with `A extends
  unknown[]`, it binds `A` to the tuple of the arguments, or of the
  parameters of a callback `f: (...args: A) => void`, as TypeScript does.
- Each object shows its properties in the order it was made in, as in
  JavaScript: printing, `JSON.stringify`, `Object.keys`, `values`,
  `entries` and `console.table` follow the literal that made it, the object
  a spread copied (then the properties after it), or the text `JSON.parse`
  read, also when the same object type is written in another order
  elsewhere, as the runtime's iterator results are (`{ value, done }`). An
  object of a type made in several orders keeps the index of its order in a
  hidden word; a type made in one order is as before. A property written
  again in a literal with spreads keeps its first place.
- `JSON.stringify(value, replacer, space)` takes a replacer function, `(key:
  string, value: unknown) => unknown`, called as in JavaScript (the whole
  value under `""`, then each property and element depth-first, the parts
  of what it returns too); it returns `JSON.omit` to leave a value out,
  where JavaScript returns `undefined`, and the call returns `string | null`.
- A literal assigned to a variable of a union of literal types narrows it to
  that literal, as in TypeScript: after `const k: keyof T = "label"`, `k` is
  `"label"`, and `o[k] = "text"` assigns only that member.
- A member is assigned through a key of a `keyof` type, as in TypeScript:
  `o[k] = v`, `o[k] += v`, `o[k]++` and `o[k] ??= v` store into the member
  `k` names, and `v` must convert to the type of each member `k` can name;
  so does `o[k] = v` with `K extends keyof T` in a generic function.
- `reduce` and `reduceRight` with a number as the initial value give the
  accumulator the element's type when the number fits it, as TypeScript
  does: `xs.reduce((a, b) => a + b, 0)` of a `number[]` is a `number`.
- `URLSearchParams` is iterable: `for (const [k, v] of params)`, spread,
  `Array.from` and `new Map(params)` take its pairs, and `keys()`,
  `values()` and `entries()` return lazy iterators, as in JavaScript.
- install.sh speaks like `ore`: the `{Ore}` wordmark and its colors (true
  color, the terminal's 256 or 16, or none, by the same rules: NO_COLOR,
  FORCE_COLOR, COLORTERM, TERM), a header with the version, platform,
  directory and URL, numbered steps with marks (ASCII when the locale is
  not UTF-8), a progress bar while it downloads, errors that say what failed,
  why and what to do, and a summary with next steps. On a terminal it asks
  before replacing an installed `ore`, installing system packages or editing
  shell startup files, and warns when another `ore` (Homebrew's) comes first
  in PATH. New options: `--version`, `--home`, `--yes`, `--no-modify-path`,
  `--verbose`, `--help` (and `ORE_YES`, `ORE_NO_MODIFY_PATH`, `ORE_VERBOSE`);
  without a terminal it does what it did.
- A generator function, method or function expression without a return
  type annotation takes its type from its body, as in TypeScript:
  `function* g() { yield 1; yield "a" }` returns a
  `Generator<i64 | string, void, null>`.
- An index signature with other members, `type D = { name: string; [key:
  string]: string }` and the same interface, is a dictionary whose other
  members are named entries: always there unless optional, read and written
  as their own types, checked by `delete`, literals and `JSON.parse`.
- Methods, instance and static, have overload signatures as top-level
  functions do: callers, through `this` and `super` too, see only the
  signatures, and a call has the result type of the one it takes. A subclass
  overrides them with the same signatures, and each signature implements an
  interface method of its type. Interfaces report overload signatures as not
  supported yet (ORE5066).
- Iterator helpers of ES2025 on generators, the iterators of `values()`,
  `keys()` and `entries()` and their own results: `map`, `filter`, `take`,
  `drop`, `flatMap`, `reduce`, `toArray`, `forEach`, `some`, `every` and
  `find`, lazy as in JavaScript, closing their source when they end before
  it; the global class `IteratorObject` that has them, and
  `Iterator.from(iterable)`. `infer` in a conditional type matches a
  subclass of the generic class it names, and a type parameter may be
  constrained by `object`.
- `next()` of a generator that `for...of` left early is done with the
  value null, where it panicked with an index out of range.
- Optional methods in interfaces and object types, `start?(): T`: a
  read-only member of type `(() => T) | null` that a class or object may
  leave out, or implement with a method or a field holding a function;
  call it with `p.start?.()` or after a check for null. Classes still
  cannot declare optional methods (ORE5014).
- `Object.fromEntries`, `Object.groupBy` and `Map.groupBy` take any
  iterable, as in JavaScript: a map, a set, a string, a generator,
  `map.entries()` or a `URLSearchParams`, not only an array.
- `Blob` and `File` are global classes, JavaScript's, written in Ore
  (runtime/core/blob.ore) after the W3C File API: `new Blob(parts,
  { type, endings })` of strings (UTF-8), `u8[]` (copied) and other blobs,
  `size`, `type` (lowercased, `""` when it is not printable ASCII),
  `slice(start, end, contentType)` with JavaScript's negative and clamped
  positions, sharing the bytes, and `text()`, `bytes()` and
  `arrayBuffer()`, which return promises; `arrayBuffer()` gives a `u8[]`,
  as Ore has no `ArrayBuffer`. `new File(parts, name, { type, endings,
  lastModified })` adds `name`, `lastModified` (now, in milliseconds, by
  default) and `webkitRelativePath` (`""`). `console.log` prints them as
  Node does and `JSON.stringify` writes `{}`. `stream()` is not there yet.
- `Array.isArray(x)` as a condition narrows a union, as in TypeScript: to
  its arrays when true, to its other members when false.
- Private and protected members are accessible anywhere in the declaration
  of their class, as in TypeScript: in static methods and `static` blocks,
  and in function expressions inside methods.
- An object literal for a union is never of a class with private or
  protected fields, as in TypeScript: `{ a: 1 }` for `Secret | { [key:
  string]: int }` is the dictionary.
- `Headers`, the global class of the Fetch Standard: from a record, an
  array of pairs or another `Headers`; `append`, `delete`, `get` (values
  joined with `, `, `null` when missing), `getSetCookie`, `has`, `set` and
  `forEach`, names without case and checked, values trimmed (an invalid one
  panics with JavaScript's `TypeError`); iterable, sorted by lowercased
  name with each `set-cookie` apart; printed by `console.log` as Node does.
- `Array.isArray(x)` as a condition narrows a union, as in TypeScript: to
  its arrays when true, to its other members when false.
- Private and protected members are accessible anywhere in the declaration
  of their class, as in TypeScript: in static methods and `static` blocks,
  and in function expressions inside methods.
- An object literal for a union is never of a class with private or
  protected fields, as in TypeScript: `{ a: 1 }` for `Secret | { [key:
  string]: int }` is the dictionary.
- `a ?? b` has the type `NonNullable<A> | B`, as in TypeScript: a fallback
  of another type, or one that may be null, widens the result instead of
  being refused (`xs.find(f) ?? null`, `n ?? "none"`).
- `JSON.stringify` writes an `unknown`, alone or as a field, element or
  map value, as the value it holds, as JavaScript writes any value, through
  the code a replacer function already used; one of a type JSON cannot
  convert panics. `JSON.parse` still cannot read an `unknown`.
- `crypto` and `performance`, the globals of JavaScript's hosts, as
  namespaces: `crypto.getRandomValues(array)` fills an array of an integer
  type (`u8[]` for `Uint8Array`, `i32[]`, ...) from the system's secure
  random number generator, panics with `QuotaExceededError` past 65536
  bytes, and rejects floats at compile time; `crypto.randomUUIDv4()` and
  `crypto.randomUUIDv7()` are those of "ore:crypto". `performance.now()`
  and `performance.timeOrigin` are milliseconds as `number`, as in
  JavaScript; `mark`, `measure` (mark names or the options `start`, `end`,
  `duration` and `detail`), `getEntries`, `getEntriesByName`,
  `getEntriesByType`, `clearMarks`, `clearMeasures` and `toJSON` follow
  the User Timing API as Node has it, with the global classes
  `PerformanceEntry`, `PerformanceMark` and `PerformanceMeasure`.
- `[Symbol.iterator]()` of strings, arrays, maps and sets is callable, as in
  JavaScript, and returns the iterators of the runtime with the iterator
  helpers. A string's, a `StringIterator`, gives its characters as strings
  of one code point (`"aé"[Symbol.iterator]().toArray()` is `["a", "é"]`),
  as `[...s]`, `Array.from(s)`, `Iterator.from(s)` and now `yield* s` do;
  `for (const r of s)` still gives runes (`i32`).
- `s.matchAll(re)` is a lazy `RegExpStringIterator` (an `IteratorObject` of
  `RegExpMatch`), as in JavaScript, not an array: each step finds the next
  match, from `re.lastIndex` on, without changing `re`; `for...of`, spread
  and `Array.from` take it as before. Without the `g` flag it panics with
  `TypeError: String.prototype.matchAll called with a non-global RegExp
  argument`, at the call.
- `Iterator.from(x)` is JavaScript's: it takes a string, and an object that
  has only `next()`; it returns an iterator that has the helpers already
  (a generator, an iterator of the runtime or a class extending
  `IteratorObject`) as it is, and wraps another one in an iterator whose
  `return()` calls its `return()`.
- `\p{...}` and `\P{...}` in regular expressions have every property that
  JavaScript has, from Unicode 17.0 as Node 24: all General_Category values
  and groups by any name (`Lu`, `Uppercase_Letter`, `gc=P`, `punct`), every
  script as `sc=`/`Script=` and `scx=`/`Script_Extensions=`, the binary
  properties (`Alphabetic`, `Emoji`, `Extended_Pictographic`, `ID_Start`,
  `White_Space`, `Assigned`...), and with `v` the properties of strings
  (`RGI_Emoji`, `Basic_Emoji`, `RGI_Emoji_Flag_Sequence`...), also in the
  class operations `[\p{RGI_Emoji}--\q{🇫🇷}]`. Other names are `Invalid
  property name`, as in V8. The tables are made from the Unicode data files
  by ci/regexp-properties.js (`--check` compares them with Node).
- Ignoring case in regular expressions compares the case of every
  character as JavaScript does: the simple case foldings of all of Unicode
  with `u` or `v` (Armenian, Georgian, Cherokee, Deseret...), and without
  them the one-character uppercase of the characters up to U+FFFF; it was
  the uppercase of ASCII, Latin-1, Greek and Cyrillic letters.
- A class of the `v` flag with many strings (a property of strings) matches
  them through a tree of their characters, and its operations compare
  strings by key.
- tests/fuzz/regexp also makes patterns with the flags `u` and `v`,
  properties, classes of strings and letters of every case, on Unicode
  subjects.
- `Event`, `CustomEvent<T>`, `EventTarget`, `AbortController` and
  `AbortSignal` are global classes, as in JavaScript: listeners with
  `once`, `passive`, `capture` and `signal`, `dispatchEvent`,
  `preventDefault`, `stopImmediatePropagation`, `abort(reason)`,
  `onabort`, `throwIfAborted` (a panic), `AbortSignal.abort`,
  `AbortSignal.timeout(ms)` (whose timer does not keep the program
  running, as in Node) and `AbortSignal.any`; classes extend
  `EventTarget`.
- `x instanceof Box<int>` names an instance of a generic class, as
  TypeScript's instantiation expressions, and narrows a value of a base
  class to it; `x instanceof Error` on an `unknown` narrows to the class of
  `new Error(...)`.
- Private members are accessible anywhere inside the declaration of their
  class, as in TypeScript: on other instances in static methods and static
  blocks too.
- An object literal argument of a generic call converts to the object type
  of its parameter once the type arguments are inferred, optional fields
  left out: `new CustomEvent("x", { detail: 1 })`.
- `FormData`, the global class of the XMLHttpRequest Standard: `new
  FormData()` (no form elements in Ore), `append` and `set` with a string
  or a blob (a blob becomes a `File` named `"blob"` or the file name
  given), `delete`, `get` (`null` when missing), `getAll`, `has` and
  `forEach`; iterable in order, with live `keys`, `values` and `entries`;
  values are `string | File`. `new URLSearchParams(formData)` takes its
  entries, a file as `[object File]`. `console.log` prints it as Node does
  and `JSON.stringify` writes `{}`. The `multipart/form-data` encoding
  waits for the bodies of `fetch`.
- Methods of interfaces and object types can be generic,
  `map<U>(f: (x: T) => U): U[]`, also in generic interfaces
  (`interface Box<T> { map<U>(f: (t: T) => U): Box<U> }`), and called
  through the interface with written or inferred type arguments. Generics
  stay monomorphized: the type arguments of every call through an
  interface, in the whole program and in the instances of other generics,
  are collected, and each class or object literal converted to the
  interface gets an instance of its generic method for each, until no
  more are needed; the interface table points to a table of them. A class
  conforms with a generic method of the same number of type parameters,
  whose instances are checked against the interface's; interfaces with
  generic methods convert to each other, and object literals can have
  generic methods (closures per instance, called through an interface or
  directly). ORE5055 now reports calls whose instances need ever larger
  type arguments; ORE5067 an optional generic method, ORE5068 two generic
  methods of one name in an intersection.
- A function value converts to a function type with more parameters, as in
  TypeScript: `target.addEventListener("x", f)` with `f` taking no
  parameters, `xs.map(double)` with `double(n: int)`, for named functions,
  function values and bound methods alike; the extra arguments are
  dropped. Its result may be narrower than the expected one, boxed into
  `unknown` or widened to a union (a `JSON.stringify` replacer `(k: string,
  v: unknown): string`), and its parameters wider, a base class for a
  subclass or `unknown` for any value. A top-level function converts to the
  same function each time, so the conversions are `===`.
- Field initializers use the module's variables, declared before or after
  the class, as they run when an instance is constructed: they were checked
  before the top-level code and could not find them. A field without an
  annotation has its type once the variables its initializer uses are
  declared; top-level code using it before is an error (ORE5069).
- `MessageChannel`, `MessagePort`, `MessageEvent` and `BroadcastChannel`,
  the global classes of the HTML Standard: `new MessageChannel<T>()` makes
  two entangled ports; `postMessage(message)` sends a structured clone,
  made then, dispatched to the other port as a `MessageEvent<T>` on the
  event loop, a task per message, in order, once the port started
  (`start()`, `onmessage`, or a `message` listener, as in Node); `close()`
  closes both, each getting a `close` event. `new BroadcastChannel<T>(name)`
  reaches the other open channels of the name. `T` is `unknown` by default,
  as JavaScript's messages are `any`. As in Node, a listening port and an
  open broadcast channel keep the program running, with `ref()`,
  `unref()` and a port's `hasRef()`. Ports and channels work from any task:
  what a task does is posted to the loop.
- `structuredClone` copies an `unknown` as the value it holds, by its type
  at run time; one that cannot be cloned panics with `DataCloneError`.
- A module variable of type `string` read before its declaration runs, by a
  function called earlier, is `""`: it held a string that printed and
  measured as `""` but was not `=== ""` and became `null` as a `string |
  null`. A tagged union with `null` (`int | string | null`) is `null` then.
- The default value of a parameter without an annotation may use module
  variables and constants declared further down, as in TypeScript
  (`function join(xs: string[], sep = separator)`): the variables are typed
  ahead of the top-level code, by their annotations or values, where it
  reported "Cannot find name". A variable whose value has a function in it,
  or calls a function declared after the parameter's, needs an annotation,
  on it or on the parameter (new: [ORE6086](docs/errors/ORE6086.md)).
- The language server lists an optional method of an interface, `area?():
  int`, as a method in completions, where it was a field.
- `console.log` prints generators, iterators, promises and async
  generators as Node does: `Object [Generator] {}`, `Object [Array
  Iterator] {}`, `Object [Iterator Helper] {}`, `[Map Iterator] { 'a', 'b'
  }` (the values left), `Promise { 1 }`, `Promise { <pending> }`, `Object
  [AsyncGenerator] {}`; a generator, which holds its fiber, was an error
  (ORE3060), and the others printed their fields. Generators and async
  generators have `toString()`, `[object Generator]`, as in JavaScript.
- The standard module `ore:tls`: TLS 1.2 and 1.3 clients and servers over
  TCP, from the system's OpenSSL 3. `connect({ host, port, servername?, ca?,
  rejectUnauthorized?, alpnProtocols? })` completes the handshake and
  returns a `Connection` (`read`, `readAll`, `write`, `close`,
  `alpnProtocol`, `authorized`) or an `Error` worded as Node's (`unable to
  get local issuer certificate`, `Hostname/IP does not match certificate's
  altnames: ...`); the certificate is verified against the system's trusted
  ones, or `ca`, and the host name or address, and SNI is sent.
  `createServer({ cert, key, alpnProtocols? })` gives a `Server` to
  `listen` and `accept` on. Tasks wait for the socket on the network poller,
  never blocking a thread. Only programs that import `ore:tls` link with
  OpenSSL: on Linux its run-time library (`libssl.so.3`), on macOS
  Homebrew's `openssl@3`; `install.sh` checks for it and offers to install
  it.
- A process that spawns many tasks no longer keeps what ended ones captured:
  a slot of a worker's run queue kept an ended task, and its closure, alive.
  The test runner, whose builds each spawn a task per part of the IR, grew
  to 8 GB and more over the suite; it stays under 4 GB on 16 tasks. The
  collector gives free pages back to the system beyond what the heap is to
  use before the next collection (as Go's scavenger), not only once half
  of the heap is free, and a build gives back what LLVM freed in glibc's
  arenas (`malloc_trim`). `ORE_GCTRACE` also shows the bytes in spans.

## 0.5.0

Dictionaries and Object, type predicates, generators and iterators, globalThis, URL, TextEncoder, structuredClone, as const, tuple forms, the this type, and class features.

- Dictionaries: `{ [key: string]: V }` and `Record<string, V>` are a type
  of their own, a hash table of string keys in insertion order used with
  the syntax of objects. Object literals create them (computed keys and
  spreads included); `d.a` and `d[k]` read an entry as `V | null`;
  `d[k] = v`, `d[k] ??= v`, `delete d[k]` and `k in d` work on them, as
  `delete` and `in` do on nothing else. `console.log` prints them as Node
  prints objects, `console.table` lists them, and JSON converts them to and
  from objects. `Object.freeze` makes one read-only, and writing it then
  panics with JavaScript's TypeError message. An index signature next to
  other members, or with keys other than strings, is still an error.
- The namespace `Object`: `keys`, `values`, `entries`, `hasOwn`, `assign`,
  `fromEntries`, `groupBy`, `freeze` and `isFrozen`, on dictionaries, objects
  and class instances (whose keys are their fields).
- `p["x"]` reads and assigns the member `x` of an object, an interface or a
  class instance, and `p[k]` with `k: keyof P` reads the field `k` names, of
  type `P[K]`.
- Type aliases inside functions and blocks, generic ones too, scoped to
  their block (they used to be ORE7016).
- Indexed access and `keyof` on a union of object types, as in
  TypeScript: `U["x"]` is the union of the members' field types, and
  `keyof U` their common names, so `Omit<U, "z">` gives one object type of
  the common fields but `z` (TypeScript's `Omit` is not distributive).
- Type predicates, as in TypeScript: `x is T` and `this is T` narrow the
  argument or receiver of a call in conditions, `filter` with such a
  callback gives an array of `T`, and `asserts x is T` and `asserts x`
  narrow after the call. Unlike TypeScript, the body is checked: each
  result must be `false` or a check that narrows the parameter to `T`,
  and an assertion function must panic or exit where the assertion does
  not hold. `x is T` used to be a parse error.
- Boolean literal types: `true` and `false` are types, and `boolean` is
  their union. A field of such a type discriminates a union of objects, as
  in the Result pattern `{ ok: true; value: T } | { ok: false; error: E }`:
  `if (r.ok)`, `if (!r.ok)`, `r.ok === false` and `switch (r.ok)` narrow
  `r`. An object literal for such a union picks its member by its `true`
  or `false` constant, and a `while` loop without a `break` narrows by its
  condition after it: after `while (!r.done) r = it.next()`, `r` is done.
- A class can implement an instance of a generic interface
  (`implements It<int>`).
- Generators and the iteration protocol, as in TypeScript: generator
  functions, methods and function expressions (`function*`, `*m()`,
  `*[Symbol.iterator]()`) return a `Generator<T, TReturn = void, TNext =
  null>` with `next()`, `next(value)` and `return(value)`; `yield`,
  `yield value` and `yield* iterable` (of a generator, its return value).
  A generator runs its body on a fiber of its own, the async functions'
  fibers. `Symbol.iterator` names methods as `Symbol.dispose` does, and the
  global `Iterator`, `Iterable` and `IterableIterator` interfaces and the
  `IteratorResult` type describe the protocol. `for...of`, spread,
  `Array.from`, `new Map` and `new Set` take any iterable; `for...of`
  calls `return()` when it leaves a loop early, which ends a generator's
  fiber. `keys()`, `values()` and `entries()` of arrays, maps and sets
  return lazy iterators, as in JavaScript, instead of arrays: code that
  indexed their result or read its `length` now spreads it,
  `[...map.keys()]`, or passes it to `Array.from`. Async generators are
  not supported ([ORE5013](docs/errors/ORE5013.md)), and there is no
  `throw()` (Ore has no exceptions).
- `JSON.stringify(value, replacer, space)` takes a replacer array, the
  keys of objects to keep, in its order, at every level (maps too), and a
  string `space`, its first 10 characters indenting each level; a number
  `space` is at most 10, as in JavaScript.
- `TextEncoder` and `TextDecoder` (UTF-8: `encode`, `encodeInto`, `decode`
  with `fatal` and `ignoreBOM`) and `atob` and `btoa` (base64 of binary
  strings), global names as in JavaScript, with `u8[]` for `Uint8Array`.
- A `RegExpMatch` is indexed, destructured and iterated as JavaScript's
  match arrays: `m[1]`, `const [, key, value] = s.match(re)!`,
  `for (const c of m)`, over its captures (`string | null`). Assigning to
  `m[i]` is an error (ORE3084).
- `globalThis`: the global names as members of one value, as in
  JavaScript (`globalThis.Math.max(1, 2)`, `new globalThis.Date(0)`,
  `globalThis.Promise<int>` as a type), resolved at compile time. A
  module's own top-level declarations are not on it, as in ES modules;
  nothing can be added to it, and it is no value itself (`const g =
  globalThis` is an error, ORE3091).
- `Promise.withResolvers<T>()`: `{ promise, resolve }`, a pending promise
  and the function that resolves it (no `reject`: promises do not reject).
- `fs.appendFile(path, data)`, Node's `appendFileSync`: appends to a file,
  created if missing. `process.platform` (`"darwin"`, `"linux"`) and
  `process.arch` (`"arm64"`, `"x64"`), Node's names for the target.
- Breaking: `task.sleep(ns)` and `task.after(ns, handler)` count
  nanoseconds, as everything in `time`: `task.sleep(10 * time.millisecond)`
  (they counted milliseconds). The timers still wait whole milliseconds,
  rounding up.
- `structuredClone(value)`, JavaScript's deep copy, as a global function:
  numbers, strings, bigints, arrays, tuples, `Map`s, `Set`s, `Date`s,
  object types, classes with only fields and unions, keeping shared
  references and cycles, by code generated for each type. Types holding
  functions (ORE4090), classes with methods (ORE4091), interfaces,
  `unknown` and channels (ORE4092) are compile-time errors.
- `URL` and `URLSearchParams` are global classes, JavaScript's, written in
  Ore (runtime/core/url.ore) after the WHATWG URL Standard's parser:
  special schemes with their default ports dropped and `\` read as `/`,
  dot segments resolved, the percent-encode sets of each component, IPv4
  hosts in all their forms and IPv6 hosts compressed, `file` URLs with
  drive letters, opaque hosts and paths of other schemes, and relative
  references resolved against a base (`new URL("../x", base)`). Every
  property but `origin` and `searchParams` has its setter; `searchParams`
  is linked both ways to the query; `URL.canParse` and `URL.parse`;
  `new URL` panics with `TypeError: Invalid URL` where JavaScript throws.
  `console.log` and `JSON.stringify` write them as Node does. Domains
  outside ASCII are not converted to Punycode.
- `as const`: literals keep their literal types, array literals are
  read-only tuples and object literals have read-only fields, so
  `(typeof Dirs)[number]` of `const Dirs = ["n", "s"] as const` is the
  union `"n" | "s"`.
- Interfaces and object types can declare fields with accessor
  signatures, `get x(): T` (read-only) and `set x(value: T)`.
- `readonly T[]` and `ReadonlyArray<T>` are enforced: the methods that
  change an array and index assignment are errors through them, and a
  read-only array does not convert to a mutable one. `readonly [A, B]` is a
  tuple of read-only elements. New utility types: `InstanceType` and
  `ConstructorParameters` of `typeof C` (a class's constructor type,
  `new (params) => C`), and `NoInfer`.
- Tuple types take the other forms of TypeScript: named elements
  `[x: f64, y: f64]` (documentation only), optional elements `[int,
  string?]` of type `T | null` that literals can leave out, rest elements
  that spread tuple types `[...A, ...B]`, and `infer` with rest elements in
  conditional types (`T extends [infer H, ...infer R] ? ...`). A rest
  element of array type in the type of a value is reported (ORE2072), as
  tuples have a fixed length.
- The type `this` in the non-static members of a class: a method
  `add(s: string): this` called on a subclass returns the subclass, so
  fluent APIs keep it, and parameters and fields can be of the type `this`
  (`equals(other: this): bool`, `next: this | null`). A method returning
  `this` must return the receiver (ORE5061); `this` in a static member or
  outside a class is an error as in TypeScript (ORE5059), and in an
  interface not supported yet (ORE5060).
- A template literal calls `toString()`: `` `${obj}` `` of a class or an
  interface with a `toString(): string` method gives what it returns, and
  of an error `"Name: message"`, instead of reporting ORE3060.
- `Error` is a class to extend, as in JavaScript: `class NotFound extends
  Error` calls `super(message)` and sets `this.name`; `new Error(message,
  { cause })` keeps the cause; errors have `name`, `message`, `cause` and
  `toString()`, `instanceof Error` is true for the subclasses, and
  `console.log` prints `Name: message`. The type `Error` stays the
  interface that any class with a `message` implements.
- Arrow functions in field initializers capture the instance, as in
  TypeScript: `h = (): int => this.x` works instead of reporting that
  `this` is only allowed inside a class. At the top level of a module and in
  its arrow functions, `this` is `null`.
- `static { ... }` blocks in classes, run where the class is declared, in
  order with the static field initializers.
- Methods can be called on a union of classes when every class has the
  method with the same type: `(a: Cat | Dog) => a.speak()` runs the method
  of the class the value holds, instead of reporting ORE4071.
- `private constructor` and `protected constructor` are enforced, as in
  TypeScript: `new C()` outside the class declaration is ORE5062, and
  extending a class with a private constructor is ORE5063; subclasses call
  a protected one through `super(...)`.
- Interfaces merge and extend classes, as in TypeScript: a second
  `interface X` adds its members to the first instead of reporting
  ORE5050, and `interface I extends SomeClass` takes the class's public
  fields and methods instead of reporting ORE5053.
- Copies of a read-only array (`slice`, `filter`, `concat`, `with`,
  `toSorted`, `toReversed`, `toSpliced`, `values`) are mutable arrays,
  as in TypeScript.
- `Object.keys`, `values` and `entries` of an object list its fields in
  the order it shows them.

## 0.4.8

Unterminated strings are errors; a heap that does not fragment.

- A string in quotes that a line break ends is an error, ORE1009
  ("Unterminated string literal."), as in JavaScript; it was read as if
  closed, and `ore fmt` printed code it could not read back. Found by
  `tests/fuzz/syntax.sh`.
- The collector keeps free runs of pages in bins by size and merges a freed
  run with its free neighbours: a large heap no longer breaks into small
  runs that every new span searched under the heap lock (the test runner,
  building hundreds of programs at once, grew to 7 GB and stalled).

## 0.4.7

Regular expressions: one group name in different alternatives, quantified groups around lookarounds.
- Regular expressions take one group name in different alternatives
  (ES2025, `(?<y>\d{4})-\d\d|\d\d\/(?<y>\d{4})`): the group that took part
  gives the name's value in `groups`, `\k<name>` and `$<name>`. A quantifier
  on a group around a lookaround (`(?:(?<=a))*`) is no longer rejected. Both
  found by tests/fuzz/regexp, which now matches tens of thousands of random
  patterns as Node does.
- `ORE_GCVERIFY=1` fills what a collection frees with garbage, so that a use
  of a freed object shows at once; `ci/matrix.sh` runs the suite's
  programs in release, on 16 threads, and under frequent and verified
  collections.

## 0.4.6

Objects show their fields in the order of their declaration; coverage of the suite.

- Printing, `console.table` and `JSON.stringify` show an object type's
  fields in the order of its declaration, or of the literal that made the
  type first, as JavaScript shows properties in the order they were added;
  they were sorted by name. Found by running the suite's programs under
  Node (`ci/node-diff.sh`).
- `ORE_COVERAGE=1` builds programs that count the runs of every statement
  and write them at exit, a panic included, as lcov to
  `$ORE_COVERAGE_DIR/ore-<pid>.lcov`; `ci/coverage.sh` measures the
  coverage of the compiler and the runtime by the test suite.

## 0.4.5

Value classes: small immutable classes without allocation.

- Small immutable classes are values when nothing can tell: a class with no
  base class or subclass and one to eight `readonly` fields of numbers,
  booleans or other such classes, whose instances the program never
  compares, prints, converts to an interface or `unknown`, or keeps in an
  array, a map, a set, a channel or a union, has its instances kept in
  registers and inside the objects that hold them instead of on the heap.
  `bench/structs`, which moves particles with an immutable `Vec3`, no
  longer allocates in its loop.

## 0.4.4

Tagged templates and String.raw.

- Tagged templates: `` tag`a${x}b` `` calls the tag with a
  `TemplateStringsArray` (the cooked strings, `null` for an invalid escape,
  and their `raw` text) and the substitutions, checked as a call against
  the tag's parameters. Each site passes the same strings object every
  time. `String.raw` works as a tag and as a function of `{ raw }` and
  strings.

## 0.4.3

Garbage collection pauses under 0.1 ms.

- Garbage collection pauses are under 0.1 ms on a 16-thread machine (from
  0.35 + 0.43 ms to 0.065 + 0.01 ms median, worst 1.2 ms to 0.2 ms; Go's are
  0.14 + 0.05 ms): a worker idle in the scheduler waits parked, with its
  registers saved and its stack pointer recorded, so the collector counts it
  as stopped without a signal; stopped threads sleep on a futex (`__ulock`
  on macOS) until the world runs again; the collector's waits spin before
  they sleep; and the second pause finishes marking on one thread when
  little is left.

## 0.4.2

Faster string-keyed maps.

- String-keyed maps are faster (`bench/knucleotide` about 1.9x, `wordcount`
  1.25x, `map` 1.25x, in CPU time on an M-series Mac). The index of a map
  keeps the high bits of each key's hash beside the entry, so probing
  compares keys only when those match; string keys and 8-byte keys
  (integers, objects by identity) are hashed and compared by the runtime
  itself, strings a word at a time instead of FNV-1a's byte at a time; and
  `map.set(key, f(map.get(key)))`, where `f` only computes with locals and
  constants (`counts.set(w, (counts.get(w) ?? 0) + 1)`), hashes and looks
  up the key once. `indexOf` and `split` no longer call memcmp for a
  one-byte separator.

## 0.4.1

JavaScript's Date as a global class, and checker fixes.

- `Date` is a global class, JavaScript's, written in Ore
  (runtime/core/date.ore): the constructors (`new Date()`, `new Date(ms)`,
  `new Date("2024-10-15T12:00Z")`, `new Date(2024, 9, 15, 12)`), the
  statics `Date.now()`, `Date.parse` and `Date.UTC`, the getters and
  setters in local time and in UTC with fields out of range carrying over,
  `toISOString`, `toJSON`, `toString`, `toDateString`, `toTimeString`,
  `toUTCString` and `toLocale*String` (en-US, the only locale). Invalid
  dates have a NaN time value and `toISOString` panics with `RangeError:
  Invalid time value`. Local time comes from `TZ` or /etc/localtime,
  read from the TZif files of /usr/share/zoneinfo with their POSIX rules,
  and UTC without them. `Date.parse` reads the ECMAScript format and, as
  V8, what `toString` and `toUTCString` print and the common other forms.
  `console.log` prints a date as Node does, and `JSON.stringify` writes it,
  as its ISO string.
  `Date.now()` is still an `int`.
- Generic classes can have static fields, `class Box<T> { static count = 0 }`:
  one for all instances, as in TypeScript, initialized where the class is
  declared, and read, assigned and updated from anywhere, its static and
  instance methods too. Their types cannot name the class's type
  parameters (ORE3082); ORE3079 is no longer reported.
- The condition of a `for` narrows its update clause too, as in TypeScript,
  unless the body assigns the variable: `for (let at = list; at !== null;
  at = at.next)` no longer reports that `at` may be null.
- `typeof` of a top-level `const` works in annotations: after the
  constant for any initializer (`let x: typeof name` with `const name =
  "ore"`), and before it, as in function signatures, when the initializer
  is made of literals, a template literal, `new C(...)` of a class that is
  not generic, or the name of another such constant.

## 0.4.0

JavaScript's built-in API (Array, String, Map, Set, Number, Math, console), the time namespace, modules with export * and directory imports, and promises with async and await.

- Promises and async functions, in JavaScript's order of microtasks and
  timers, without rejections: `Promise<T>` (`then`, `finally`,
  `Promise.resolve`, `all`, `race`, `any`), `async` functions, methods and
  arrow functions, `await` in them and in the top-level code,
  `task.microtask`, and `time.timeout`, `interval`, `immediate` (with
  `cancel()`), `delay` and `sleep`, in nanoseconds. The event loop runs in
  the top-level code; each async call is a fiber it switches to, so async
  code is single-threaded while tasks stay parallel, and a task can settle
  promises and call async functions, which wakes the loop. The program ends
  when the loop has nothing left; an unsettled top-level await exits with
  status 13. Every test of `tests/async` passes.
- The language grew what the promises needed: a function value converts to
  a function type whose parameters convert to its own (`(v: T | Promise<T>)
  => void` to `(v: T) => void`); type arguments are inferred through unions
  such as `U | Promise<U>`; `Promise<void>` is `Promise<null>`, and
  trailing parameters typed by such a type parameter may be left out
  (`Promise.resolve()`); a `const` or `let` whose value has functions that
  use it, as `const step = () => task.microtask(step)`, is declared before
  its value is checked.
- Generic classes can have static methods, generic ones too (`Box.of<U>(v)`),
  which do not see the class's type parameters, as in TypeScript; a generic
  class name works with `instanceof` and narrows a union to its instance
  (`v instanceof Box` for `T | Box<T>`). `void` is a type argument: its
  value is `null`, trailing parameters of its type may be left out
  (`new Box<void>((put) => put())`), and a void callback for a result type
  parameter binds it to `void`. A function returning `null` may end without
  a `return`. A null-returning call converted to a union is no longer
  dropped.
- `Map` and `Set` have JavaScript's whole API: `map.forEach((value, key,
  map) => ...)`, `Map.groupBy(items, (element, index) => key)`,
  `set.forEach((value, value2, set) => ...)`, `set.keys()`,
  `set.entries()`, and the set methods of ES2024: `union`, `intersection`,
  `difference`, `symmetricDifference`, `isSubsetOf`, `isSupersetOf` and
  `isDisjointFrom`, with JavaScript's order of elements. `keys()`,
  `values()` and `entries()` still return arrays.
- The built-in namespace `time`, in nanoseconds as `int` like Go:
  `time.now()` (a monotonic clock), `time.unixNanos()` (the wall clock),
  the durations `time.nanosecond` to `time.day`, and `time.parse` and
  `time.format`, a port of the npm package `ms` in nanoseconds:
  `time.parse("2.5 hrs")` is 9_000_000_000_000, `time.format(2 *
  time.minute, { long: true })` is "2 minutes". Its texts are those of
  `ms` (a bare number is milliseconds), plus `us`/`µs` and `ns`; what `ms`
  rejects is `null`.
- `randomUUIDv4()` and `randomUUIDv7()` in "ore:crypto" (RFC 9562), from
  the system's secure random numbers (getentropy). A version 7 UUID starts
  with the Unix time in milliseconds, then 12 bits of the time within it,
  and the UUIDs of a process increase strictly, so they sort by creation.

- Checker fixes: a generic object type alias that refers to itself
  (`type List<T> = { v: T; next: List<T> | null }`) works like a recursive
  alias without parameters instead of crashing the compiler; a string
  literal type, or a union narrowed to one, compares with a string constant
  it can hold and with any string; `typeof` of a top-level `const`
  initialized with literals works in type aliases without an annotation
  (`keyof typeof obj`); a string constant for a parameter `k: K` with
  `K extends keyof T` has its literal type, as in TypeScript.
- Stack overflow is a panic, `panic: stack overflow` with the Ore call stack
  (runs of the same frame counted on one line) and status 2, instead of a
  silent crash with status 138 or 139: a SIGSEGV/SIGBUS handler, on an
  alternate signal stack of each worker thread, reports a fault in the guard
  page of a task's stack, and leaves any other fault to the default action.
  `ORE_STACK` (such as `ORE_STACK=64M`) sets the size of every task's stack,
  the top-level code's included. Tasks get 1 MiB by default instead of
  256 KiB (about 9000 frames of a small function in a debug build instead of
  2300); stacks take memory only for the pages they touch.
- `export * from "./m"` and `export * as ns from "./m"`, as in TypeScript:
  a module's own exports take precedence, and a name that two `export *`
  give from different declarations is not exported and reported at the
  later one (ORE6073, "Module '…' has already exported a member named
  '…'"). ORE6015, which rejected `export *`, is no longer produced. `ore
  doc` lists the names a module re-exports with `export *`.
- Directory imports: `./lib` is `lib.ore` when it exists and the directory's
  `lib/index.ore` otherwise, as before; `./lib/`, `.` and `..` now name a
  directory's `index.ore` too.
- Strings have every method of JavaScript's `String.prototype`: `at`,
  `charAt`, `charCodeAt`, `concat`, `isWellFormed`, `toWellFormed`,
  `localeCompare`, `normalize`, `substr`, `trimLeft`, `trimRight`,
  `toLocaleUpperCase`, `toLocaleLowerCase`, `toString` and `valueOf`
  are new; `lastIndexOf`, `includes`, `startsWith` and `endsWith` take a
  position, `split` a limit, and positions clamp as in JavaScript
  (`"abc".indexOf("", 9)` is 3, not -1). `replace` and `replaceAll` with
  a string pattern read `$&`, `$$`, `` $` `` and `$'`
  (`"aXbX".replace("X", "$&$&")` is `"aXXbX"`) and take a function
  `(matched, offset, input) => string`. `toUpperCase` and `toLowerCase`
  map all of Unicode, not only ASCII, with the full mappings (`"é ß"` to
  `"É SS"`, a final sigma to `ς`), and `trim` removes all of JavaScript's
  white space; `replaceAll` with an empty pattern and `padStart`/`padEnd`
  no longer split a character. The Unicode 17.0 data is generated from
  node by `ci/unicode-tables.js` into `runtime/core/unicode-tables.ore`
  (33 KB).
- Arrays have the whole `Array.prototype` of JavaScript: `at`, `concat`,
  `copyWithin`, `entries`, `fill`, `findLast`, `findLastIndex`, `flat`,
  `flatMap`, `keys`, `lastIndexOf`, `reduceRight`, `toReversed`,
  `toSorted`, `toSpliced`, `values` and `with` are new; callbacks get the
  array as a third argument, `reduce` works without an initial value
  (panicking on an empty array as JavaScript throws), `includes` and
  `indexOf` take a `fromIndex`, and `splice()` takes no arguments. Also
  `Array.from` (arrays, strings, sets, maps and `{ length: n }`, with a
  map function), `Array.of`, `Array.isArray` and `new Array<T>(n)` of zero
  values. `entries`, `keys` and `values` return arrays until there are
  iterators.
- `console` has the rest of Node's API: `info` and `debug` (stdout),
  `warn` and `trace` (stderr, with the stack), `assert`, `count` and
  `countReset`, `time`, `timeLog` and `timeEnd` (`label: 1.234ms`),
  `group`, `groupCollapsed` and `groupEnd` (every line printed indented by
  two spaces a level), `table` (Node's box-drawn table of an array, a map,
  a set or an object) and `dir`. A first string with more values after it
  is a format, as in Node: `%s`, `%d`, `%i`, `%f`, `%j`, `%o`, `%O`, `%c`
  and `%%`.
- `console.log` prints an object literal's accessors as Node does
  (`b: [Getter]`, `c: [Getter/Setter]`), and a `RegExpMatch` as Node prints
  a match array (`[ '12', index: 3, input: 'a 12', groups: undefined ]`).
- `array.length = n` truncates an array, as in JavaScript; a negative or
  larger length panics, since an array has no holes.
- An unknown member of a built-in namespace, as `Math.TAU` or
  `process.argv`, is reported as such ("'Math' has no member 'LN2'")
  instead of suggesting to call a function of the namespace. The errors for
  `async` and `#private` names say `task.spawn()` and that `#` names are
  forbidden in Ore.
- Numbers have all of JavaScript's `Number.prototype`, on every numeric
  type: `toString(radix)` (fractions of floats in other radixes as V8
  writes them), `toFixed()` without digits, `toPrecision`, `toExponential`,
  `toLocaleString()` (en-US for now) and `valueOf()`; integers keep all
  their digits. Arguments out of range panic with JavaScript's messages.
- `Math` has every member of JavaScript's: the constants `LN10`, `LN2`,
  `LOG10E`, `LOG2E`, `SQRT1_2` and `SQRT2`, and `sinh`, `cosh`, `tanh`,
  `asinh`, `acosh`, `atanh`, `expm1`, `log1p`, `clz32`, `imul`, `fround`,
  `f16round`; `hypot` takes any number of values. `Math.round(-0.5)` is -0,
  `Math.min(0, -0)` is -0, and `Math.pow` and `**` give NaN for a NaN
  exponent and for ±1 to an infinity, as in JavaScript; `Math.cbrt` no
  longer gives -Infinity for the largest floats.
- `Number.parseInt` gives `null` for a number too large for an `int`
  instead of a wrapped one.

## 0.3.0

Ore's own garbage collector, precise and concurrent; faster tasks, regular expressions and JSON; benchmarks against C, Go, Bun and Node.

- Benchmarks in plain C next to Ore, Go, Bun and Node: `bench/<name>/main.c`
  for every benchmark, C17 and libc only (pthreads for `channels` and
  `tasks`, POSIX `regex.h` for `regex`), built by `bench/run.sh` with
  `$CC -O2 -march=native`. The script's markdown now starts with the date,
  the machine (CPU, cores and threads, memory, OS and kernel), the version
  of each toolchain and the timing method; `-o path` or `RESULTS=path`
  writes it to a file as well, and the columns are always ore, c, go, bun,
  node.
- Each worker thread has its own run queue, as in Go: a lock-free ring that
  tasks it spawns or wakes go to, with a slot for the task the running one
  woke last (so two tasks that wake each other run in turn on one thread),
  stolen from by idle workers, half of it moved to the global queue when
  full; the global queue is looked at every 61 tasks. bench/channels runs
  about 1.5–2x faster on 10 threads; bench/tasks is unchanged.
- Spawning tasks is about ten times faster (`bench/tasks`, 100000 tasks:
  1.1 s to 0.09 s on a 10-core Mac). A task gets its stack when it first
  runs, not when it is spawned, and gives it back when it ends to a cache
  of the worker and a shared one, so mapping and unmapping stacks is rare;
  the stacks are listed for the collector without its lock. A `WaitGroup`
  of "ore:sync" counts atomically and locks only when its count drops to
  zero. An idle worker is signalled only when there is one.
- `JSON.parse<T>` reads the text straight into a `T`, with no tree of
  values in between: keys are compared in place with the field names and
  strings without escapes share the bytes of the text. Only when that
  fails is the text parsed into values, to report the same error as
  before. `JSON.stringify` writes integers into its buffer without a
  string for each. bench/json runs about 3x faster in a quarter of the
  memory.
- The collector marks alongside the program: two short stops (scanning
  the roots, then finishing) instead of one for the whole collection, with
  a write barrier the compiler emits before stores of pointers into the
  heap. It scans objects precisely, by a pointer map of their type, and
  never scans arrays of numbers; it gives free pages back to the system;
  and its pace is set by `ORE_GOGC` and `ORE_MEMLIMIT`. `ORE_GCSTW=1`
  marks with the world stopped, as before.
- Regular expressions are faster (`bench/regex` about 2.6 times): the
  search skips bytes no match can start with and, after a failed try, the
  rest of a leading loop's run; a greedy loop of one character runs as one
  instruction, and keeps no choices when giving characters back could not
  match; `exec` and `test` reuse the expression's matcher; a replacement's
  `$` patterns are read once. `indexOf` compares only where the first byte
  is.
- `ore doc [file.ore | dirs...]` prints the API of modules: their exported
  functions, classes with their public members, interfaces, type aliases
  and variables, with their signatures as the hover shows them and their
  JSDoc (`@param`, `@returns`, `@example` and other tags), after the `//`
  comment the module starts with. On a terminal it is a colored listing;
  `--md` makes Markdown (with `-o dir`, a file per module and an
  `index.md`), `--json` a JSON dump for tools.
- `ore:test` grows toward `bun:test`: `describe` groups (their names prefix
  their tests', `math > adds`), the hooks `beforeAll`, `afterAll`,
  `beforeEach` and `afterEach`, `skip`, `only` and `todo` (Ore functions
  have no properties, so not `test.skip`), `.not`, and the matchers
  `toEqual` (deep), `toBeNull`, `toBeTruthy`, `toBeFalsy`, `toContain`,
  `toHaveLength`, `toBeGreaterThan(OrEqual)`, `toBeLessThan(OrEqual)`,
  `toBeCloseTo`, `toMatch` and `toPanic` (Ore's `toThrow`: the function
  runs in a task whose panic is caught). Failures show the matcher and the
  expected and received values, as a diff of lines when they take several.
  The tests of a file now run when its top-level code ends, so that `only`
  can apply; a test declared in another task still runs at once. `ore test
  -t <pattern>` runs only the tests whose full names match. The summary
  counts skipped and todo tests.
- The type parameters of generic methods may have defaults
  (`size<U = T>(): int`), as those of functions do; ORE5019 is no longer
  reported. A generic method is checked only for the calls it has, so such
  a method of a generic class can use what only some of its instances have.
- `unknown` as the type of values: any value converts to it, boxed with
  its type, and `console.log` prints it as that type. It can be compared
  with `===`, tested for `null` and narrowed with `typeof` (to `string`,
  `f64`, `bool` or `bigint`) and `instanceof` (to a class), which unbox it;
  anything else is an error, `Object is of type 'unknown'.` (ORE3078).
- Numeric literal types are types of values: `const n: 1 | 2 = 1`,
  `function rotate(d: 0 | 90 | 180 | 270)`, `type Dice = 1 | 2 | 3 | 4 | 5 | 6`.
  Their values are numbers held as an `f64`; they widen to `number`, and
  arithmetic and comparisons see numbers. A constant fits when it equals a
  member (ORE2067); `===` and `switch` narrow them, and a `switch` with a
  case for each is exhaustive. ORE2066 now concerns only `never` inside
  tuples and object types.
- Generic nested functions (`function id<T>(x: T): T` in a function body)
  and generic function literals of a `const` (`const id = <T>(x: T): T =>
  x`): each list of type arguments makes an instance, a closure that
  captures the variables of the enclosing functions like other nested
  functions. They can only be called; used as a value without a call, such
  a function is an error (ORE6071), and one that calls itself needs a
  return type annotation (ORE6072).
- Getters and setters, of classes and of object literals, implement
  interface fields: a getter a `readonly` field, a getter and a setter a
  writable one. Reads and writes through the interface (and through a union
  with interface members) call them. Fields of names that no accessor
  implements are read and written through interfaces as before; the others
  test the table entry first.
- `console.log` colors follow Node's rules for the terminal too: with no
  `TERM`, or one Node does not know, a terminal shows no colors, unless
  `COLORTERM`, `TERM_PROGRAM`, tmux or a known CI service says it does.
- The checker parses `builtin.d.ore` once per process instead of on every
  check, which the language server runs on every change.
- The language server tries a GitHub repository whose download failed
  again a minute later, or at once when a document importing it is saved,
  instead of never in the session.
- `Math.min()` and `Math.max()` with no arguments are `Infinity` and
  `-Infinity`, as in JavaScript (they were ORE4019), or the extreme of the
  integer type expected, as with only empty arrays spread in.
- Regular expressions of the `v` flag take string disjunctions
  (`[\q{abc|d}x]`), longest strings first, in their set operations too; a
  negated class that may hold strings is an error. With `u` (or `v`) and
  `i`, `\w`, `\W`, `\b` and `\B` count `ſ` and the Kelvin sign as word
  characters, as in JavaScript.
- Maps, sets and channels are scanned precisely by the collector: the
  compiler passes the pointer maps of their keys, values and entries, map
  entries and channel buffers are allocated with them (never scanned when
  they hold no pointers), and the arrays of `keys()` and `values()` carry
  the pointer map of their elements.

## 0.2.0

Closing the gaps with TypeScript, and the toolchain around the language.

- Diagnostics point at the places related to them: the first declaration of
  a name declared twice, the declaration of a variable read before it is
  assigned, the parameter, variable or field a value does not convert to,
  the interface member that is missing or differs, and the overload
  signatures of a call. The command line prints each as a `note:` with its
  position and source line under the error; the language server sends them
  as `relatedInformation`.
- Numeric literal types in computations on types (`Prev[D]`,
  `D extends number = 10`, `[D] extends [never]`); `infer` in template
  literal types; `unknown`, `object`, `Function` and `readonly unknown[]`
  in conditional types; `{}` matched structurally; members of
  intersections narrowed to the types common to their parts. With them, a
  library of utility types is global: `DeepPartial`, `DeepReadonly`,
  `Paths`, `PathValue`, `KeysOfType`, `PickByValueType`, `Merge`,
  `Assign`, `RequiredKeys`, `OptionalKeys`, `Exact` and more.
- `import config from "./config.json" with { type: "json" }` imports a JSON
  file as a constant, parsed when the program is compiled and typed as the
  same literal written in Ore; JSON syntax and type errors point into the
  file, and go to definition leads there. Unknown import types and
  attributes are errors (ORE6067 to ORE6070).
- The value of a JSON import takes the type of the first top-level
  declaration that it initializes, `const c: Config = config`: the file is
  checked against `Config` as an annotated literal would be, so `null` fits
  `string | null` and `[]` fits `string[]`, and errors point into the file.
- Conditional types `T extends U ? X : Y`, distributed over unions, with
  `infer`; mapped types `{ [K in keyof T]?: T[K] }` with `readonly`, `?`,
  `-`/`+` and `as`; template literal types and `Uppercase` and the other
  intrinsic string types. The utility types `Partial`, `Required`,
  `Readonly`, `Pick`, `Omit`, `Record`, `Exclude`, `Extract`, `NonNullable`,
  `ReturnType` and `Parameters` are global names.
- Getters and setters in object literals (`{ get x(): int { ... }, set x(v:
  int) { ... } }`), as in classes: closures whose `this` is the object,
  called by reads and writes of the property; a property with only a getter
  is read-only. Like those of classes, they do not implement interface
  fields yet, which a type error now says.
- Types computed from others: `keyof T`, indexed access `T["k"]`,
  `T["a" | "b"]` and `T[number]`, and `typeof x` (or `typeof x.y`) as a type.
- Benchmarks in `bench/`: the same algorithms in Ore, TypeScript (Bun and
  Node) and Go, built and timed by `bench/run.sh`, which checks that every
  runtime prints the same output and prints a markdown table of times;
  `fib`, `binary-trees` and `nbody` to start with.
- Arrays have `shift()`, `unshift(...values)` and `splice(start, count?,
  ...values)` as in JavaScript; `shift` panics on an empty array, like `pop`.
- Modules from GitHub: `import { x } from "https://github.com/owner/repo"`,
  with a path in the repository and `/tree/<ref>` for a branch, tag or
  commit. The repository is downloaded with git into the cache
  (`~/.cache/ore/modules/github/<owner>/<repo>/<commit>`), and again when
  its branch has a new commit; offline, the cached commit is used with a
  warning. `ore cache` counts the downloaded modules, `ore cache clean`
  removes them.
- `console.log` prints any value as Node's `util.inspect` does: arrays
  `[ 1, 2, 3 ]`, objects `{ x: 1, y: 'a' }`, class instances
  `Point { x: 1, y: 2 }` (by the class of the instance, also behind an
  interface), `Map(2) { 'a' => 1, 'b' => 2 }`, `Set(1) { 1 }`, tuples,
  functions `[Function: name]`, errors `Error: message`; strings inside
  values quoted, objects deeper than two levels as `[Object]`, at most 100
  entries, cycles as `[Circular *1]`, and Node's line breaking at 80
  columns with arrays of short entries grouped in columns. The code that
  formats a type is generated for it. `-0` prints as `-0`.
- `console.log` colors values as Node does when the output is a terminal:
  numbers, bigints and booleans yellow, strings inside values green, `null`
  bold, functions and `[Circular *1]` cyan, with Node's codes; lines are
  broken by the width without the colors. `FORCE_COLOR` and `NO_COLOR` are
  respected as in Node, `console.error` colors by standard error, and piped
  output stays the same.

- `bigint`, as in JavaScript: literals (`10n`, `0x1fn`), arithmetic with
  truncating division, `**`, shifts and bitwise operations in two's
  complement, comparison by value (also as `Map` keys and `Set` elements),
  `BigInt(x)` from integers, integral floats and text, `i64(b)`, `f64(b)` and
  the other conversions back, `toString(radix)`, `BigInt.parse`,
  `BigInt.asIntN` and `BigInt.asUintN`. Bigints and numbers do not mix:
  `1n + 1` is a compile error (`ORE2065`). `console.log` prints `10n`, as
  Node does.
- The command line prints in Ore's colors on a terminal: the labels,
  carets and links of diagnostics, the commands and headings of `ore help`,
  the ✓ and ✗ of `ore test`. `NO_COLOR` turns them off, `FORCE_COLOR` on;
  24-bit with `COLORTERM=truecolor`, the nearest of 256 with a `256color`
  TERM, the 16 basic colors otherwise. Piped output is unchanged.
- `process.isatty(fd)`: whether a file descriptor is a terminal.
  `fib`, `binary-trees` and `nbody` to start with. The script also prints a
  table of peak memory (from `/usr/bin/time`), skips a benchmark that has a
  `SKIP` file unless `ALL=1` or it is named exactly (`strings` for now), and
  there are `channels`, `tasks` and `regex` benchmarks.
- The language server downloads the repositories imported from GitHub in
  the background, once per session, with work-done progress in the
  editor's status bar; the hover of the import's URL tells the phase of the
  download, the commit cached, or the error.
- `ore run --watch` builds and runs the program again whenever one of its
  files changes (its modules, the files they import as text, package.json),
  stopping the one that runs; a build error is printed and the next change
  builds again. `ore build --watch` and `ore test --watch` too.
- Breaking: `new process.Command(...)` is gone. Programs are run by
  functions: `process.run`, `process.output` and the new `process.spawn`
  take the program and its arguments, and the nested namespace
  `process.command` has `run`, `output` and `spawn` with a third parameter,
  a `process.CommandOptions` (`cwd`, `env`, `clearEnv`, `stdin`, each
  optional): `process.command.run("make", [], { cwd: "build" })`.
- `process.spawn` and `process.command.spawn` start a program without
  waiting for it: a `process.Child` with `pid`, `wait()` and `kill(signal)`.
- Built-in namespaces can be nested, as `process.command` in `process`.
- Diagnostics have codes (`error[ORE2033]`) and a page each in
  `docs/errors`, linked from the command line and the language server.
- The language server runs the checker: type errors, hover with the
  signature or type and the JSDoc comment, go to definition (also into the
  standard library), completion after `.` with the members' comments,
  signature help, references and rename across the workspace, formatting,
  the outline, the inferred types of variables as inlay hints, semantic
  tokens from the checker, and quick fixes for the errors that say their fix
  (an explicit conversion, `===`, `let`, a misspelled name, an extra `!`).
- The language server parses the runtime and the standard library once per
  session and checks only their declarations, not the bodies of their
  functions and classes: an analysis of a small file takes about half the
  time.
- A build cache in `~/.cache/ore` (`$ORE_CACHE`, `$XDG_CACHE_HOME`;
  `ORE_CACHE=off` turns it off): LLVM's object files are kept by a hash of
  their IR, the compiler and the target. Debug builds are split by source
  file, so that the runtime is compiled once per compiler and an edit
  recompiles only the files it changes; release builds reuse the object of
  an unchanged program. `ore cache` prints its size, `ore cache clean`
  empties it.
- The editor extensions are released with Ore and carry its version: each
  release has `ore-vscode-vX.Y.Z.vsix`, also published to the Visual Studio
  Marketplace and Open VSX, and `ore-zed-vX.Y.Z.zip`, to install in Zed as a
  dev extension.
- Tuples `[A, B]`: literals in their context, constant indexing, `length`,
  destructuring (an array literal destructured by an array pattern is one),
  inference of generic parameters, JSON as arrays. `new Map(entries)` from
  any array of `[K, V]` tuples or another map, and `map.entries()`.
- Spread arguments: arrays among the rest arguments (`f(1, ...xs, 2)`) and
  into `push`, `console.log`, `Math.min` and `Math.max`, which take any number
  of values; tuples into any parameters (of built-in functions, methods and
  conversions too: `m.set(...entry)`), array literals and tuples.
- Object spread `{ ...o, x: 1 }`.
- `**` and `**=`, and `satisfies`.
- Static members of classes: `C.count`, `C.make()`.
- Optional, default and rest parameters of closures and function types.
- Overload signatures of top-level functions.
- Default type arguments: `<T, C = T[]>`.
- Intersections `A & B` of object types and interfaces.
- Methods in object literals (`{ add(n: int) { this.count += n } }`) and in
  object types, which are structural interfaces.
- Type aliases in any order, and recursive object types
  (`type Tree = { value: int; children: Tree[] }`).
- `typeof` of a function is `"function"`.
- `JSON.stringify(value, null, space)` takes its arguments as in JavaScript;
  `JSON.stringify(value, 2)` is now an error.
- Optional properties of object types and interfaces (`name?: T`), default values in
  destructuring (`{ size = 1 }`, `[x = 0]`) and `...rest` in object patterns.
- Errors for a rest element in a destructuring pattern that is not last
  (ORE7042), has a default value (ORE7043), or in an object pattern is a
  pattern itself (ORE7044); they were accepted before.
- `??=`, `||=` and `&&=`; an assigned `?:` narrows to its branches' types.
- `Number.NaN`, the infinities and the other constants of `Number`, and
  `Number.isNaN`, `isFinite`, `isInteger`, `isSafeInteger`.
- Regular expressions as in JavaScript: literals `/ab+c/gi` (their errors at
  compile time), `new RegExp(pattern, flags)`, `test`, `exec` and `lastIndex`
  with the flags `g`, `i`, `m`, `s` and `y`, and `match`, `matchAll`,
  `replace`, `replaceAll` (with `$1`, `$<name>` and functions), `split` and
  `search` on strings; a backtracking engine written in Ore in the runtime.
- Building a string by appending (`s += piece` in a loop) takes linear time
  instead of quadratic: a concatenation's buffer has room after its text, and
  the next append to the string that ends it writes in place, growing the
  buffer twice as large when it is full, like Go's `append`.
- Regular expressions: lookbehind `(?<=...)` and `(?<!...)`, matched
  backwards as in JavaScript; the `u` flag (`\u{...}`, `\p{...}` for the
  letter and number categories and the Latin, Greek, Cyrillic and Han
  scripts, the strict syntax, case folding), the `v` flag (nested classes,
  `--` and `&&`) and the `d` flag (`m.indices`, `m.groupIndices`).
- A narrowing `return` inside a loop body no longer narrows after the loop,
  which may run zero times or skip the `return` with `continue` or `break`.

## 0.1.1

- Code is generated for the baseline CPU of the architecture instead of the
  building machine's (`ORE_CPU=native` opts in): the Linux x86-64 release of
  0.1.0, built on CI with that machine's instructions, crashed with an
  illegal instruction on other processors.

## 0.1.0

The first release: the language, its runtime and its whole toolchain written
in Ore.

### Language

- TypeScript syntax with native semantics: sized integers (`i8` … `u64`,
  `int`, `uint`, `byte`) and floats (`f32`, `f64`), untyped numeric constants,
  explicit conversions, nominal classes with single inheritance (virtual
  methods, `super`, `protected`, abstract classes), structural interfaces,
  tagged unions with narrowing (also by assignment), generics by
  monomorphization, closures, destructuring, default and rest parameters,
  getters and setters, `using` for cleanup, errors as values.
- Collections: arrays (with `...spread` in literals), `Map` and `Set` with
  insertion order, strings as UTF-8 bytes, `JSON.stringify` and typed
  `JSON.parse`.
- Concurrency: tasks on an M:N scheduler (green threads on every CPU),
  channels, `select`, `ore:sync` (`Mutex`, `WaitGroup`), and a network poller
  on kqueue or epoll.
- Low-level code: `unsafe` (pointers, atomics, inline assembly), `//ore:`
  directives, C functions by `declare function`, `target.os` and
  `target.arch` folded at compile time.
- Modules, npm-style packages with `package.json`, files imported as text.

### Runtime

- Written in Ore, compiled with the program so that it inlines into it:
  strings, arrays, maps, number formatting (Ryu), JSON, the scheduler with
  its context switch in assembly, channels, sockets, files, processes.
- An own garbage collector in the shape of Go's: size-classed spans,
  per-thread allocation, parallel marking.
- `ORE_WATCHDOG=<seconds>` reports a stuck program with the stacks of its
  tasks and threads.

### Toolchain

- One `ore` command: `run`, `build`, `check`, `test`, `fmt`, `init`, `lsp`,
  `update`.
- The compiler is written in Ore and builds itself (`ci/bootstrap.sh`: stages
  2 and 3 emit the same LLVM IR). It calls LLVM through its C API, compiles
  debug builds on every CPU and links with lld.
- Releases for Linux (x86-64, arm64) and macOS (arm64) carry their LLVM and
  lld; `install.sh`, `brew install orelang/tap/ore` and `ore update`.
