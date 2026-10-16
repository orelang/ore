# Concurrency

Ore uses green threads ("tasks") without function coloring, like Go:

```ts
const results = new Chan<string>()
task.spawn(() => results.send(work()))
console.log(results.receive())
```

- `task.spawn(fn)` starts a task. Tasks run in parallel on several OS
  threads, one per CPU by default (set with the `ORE_THREADS` environment
  variable). A thread switches tasks when one waits on a channel, sleeps
  (`task.sleep(ms)`) or calls `task.yield()`; there is no preemption, so a
  task computing without waiting keeps its thread. The program ends when
  the entry file's top-level code ends, as when `main` returns in Go. When every task waits, the program panics with a
  deadlock.
- `ORE_WATCHDOG=<seconds>` starts a watchdog for tests: when no task has
  started or resumed and nothing was allocated for that long, the program
  prints the scheduler's state, the stack of every task (in debug builds) and
  of every OS thread, and exits with status 3. It reports a program stuck in
  the runtime, which the deadlock panic cannot see, but also one that computes
  that long without allocating, so its limit should be generous.
- Tasks share memory. As in Go, unsynchronized access to the same variable
  from several tasks, with at least one write, is a data race and its result
  is undefined; communicate through channels or use `ore:sync`.
- `Chan<T>` is a channel: `new Chan<T>()` hands values over directly (send
  waits for a receiver), `new Chan<T>(n)` buffers `n` values. `send(v)`
  waits for room and panics on a closed channel; `receive()` waits for a
  value and returns `null` once the channel is closed and empty; `close()`
  wakes all waiting tasks. `for (const v of ch)` receives until the channel
  is closed.
- `task.select(cases, otherwise?)` runs the handler of one case that can
  proceed, choosing at random among several, or else waits for the first
  one. Cases are `ch.onReceive((v) => ...)` (`v` is `null` once closed),
  `ch.onSend(value, () => ...)` and `task.after(ms, () => ...)`. With
  `otherwise`, it runs instead of waiting when no case is ready.
- Each task has a fixed stack with a guard page: 1 MiB, and 8 MiB for the
  top-level code and the tests of `ore test`. `ORE_STACK=<size>` sets the size
  of every stack, top-level code included: bytes, or with a unit `K`, `M` or
  `G` (powers of 1024), such as `ORE_STACK=64M`; at least 64 KiB. A stack is
  reserved address space that takes memory only for the pages it touches, so
  a large size costs little, but it is reserved for every task that runs at
  once. Recursion that overflows a stack is a panic, `panic: stack overflow`
  with the call stack (runs of the same frame counted on one line), status 2;
  a release build has no call stack, and may turn simple recursion into a
  loop that does not overflow.
- A file operation blocks only its OS thread: the scheduler starts another
  thread for the other tasks meanwhile. A task waiting for a program it ran
  (`process.output`, `process.run`) parks on the poller, like one waiting
  for a socket, and is no deadlock.

## Async functions and promises

Beside tasks, Ore has JavaScript's single-threaded event loop: promises,
`async` functions and `await`, with microtasks and timers in JavaScript's
order. A promise never rejects: a failure is a value, as everywhere in Ore
(`Promise<int | ParseError>`), and a panic in an async function ends the
program as anywhere else.

```ts
async function fetchCount(name: string): Promise<int> {
    await time.delay(10 * time.millisecond)
    return name.length
}

const counts = await Promise.all([fetchCount("a"), fetchCount("bcd")])
console.log(counts) // [ 1, 3 ]
```

- `Promise<T>` is a global class. `new Promise<T>((resolve) => ...)` runs
  its executor at once; `resolve(value)` fulfills it once (later calls do
  nothing), and `resolve(promise)` makes it follow that promise.
  `then(f)` returns a promise of what `f` returns (of its value, when `f`
  returns a promise), `finally(f)` one of the same value after `f` ran.
  The statics are `Promise.resolve(value?)`, `all`, `race` and `any` (the
  same as `race`, since nothing rejects). There is no `reject` and no
  `catch`.
- An `async` function, method or arrow function returns `Promise<T>`, which
  its return type must be (`Promise<void>` without an annotation); its
  `return` statements give a `T` or a promise of one. It runs at once until
  its first `await`, then the caller continues.
- `await p` suspends an async function until `p` is fulfilled and gives its
  value; `await value` of anything else takes one tick, as for a fulfilled
  promise. The top-level code of a module may `await` too: it runs the
  event loop until the promise is fulfilled. A top-level `await` that
  nothing can settle any more (no timer, no task left that could) ends the
  program with "Warning: unsettled top-level await" and status 13, as in
  Node.
- `task.microtask(f)` queues a microtask (`queueMicrotask`). `time.timeout(f,
  ns)`, `time.interval(f, ns)` and `time.immediate(f)` return a timer with
  `cancel()` (`setTimeout`, `setInterval`, `setImmediate`); `time.delay(ns)`
  is a promise fulfilled after `ns` nanoseconds. Durations are nanoseconds,
  as everywhere in `time`: `time.timeout(f, 50 * time.millisecond)`.
- Order: the code that runs now, then all microtasks (including those they
  queue), then the immediates queued before this turn, then the timers that
  are due, by deadline and then creation, with the microtasks after each
  callback.
- The program ends when its top-level code has ended and the event loop has
  nothing left that can run: timers keep it running, a promise that nobody
  settles does not, and tasks still running are stopped then.
- Async code is single-threaded: only the top-level code and async functions
  hold the event loop, one at a time, so between two `await`s nothing else
  of them runs, however many threads there are. Tasks still run in
  parallel. A task can settle a promise, call an async function or queue a
  microtask or a timer: that is handed to the event loop, which wakes up for
  it. Blocking calls in async code (a channel receive, `time.sleep`, file
  I/O) block the event loop, as synchronous I/O does in Node; timers due
  meanwhile run after it. When the top-level code awaits a promise that only
  a task could settle and every task waits forever, the program panics with
  a deadlock.
- Each call of an async function runs as a fiber: a task with its own stack
  that only the event loop resumes, so suspending it costs a switch of
  stacks, and a call that awaits forever keeps its stack.

The standard module `ore:sync` provides `Mutex` (`lock`, `unlock`, and
`acquire()` for `using guard = mutex.acquire()`) and `WaitGroup` (`add`,
`done`, `wait`), both built on channels.

The standard module `ore:net` provides TCP: `listen(port, host?)` returns a
`Listener` (`accept()`, `port`, `close()`) and `connect(host, port)` a
`Conn` (`read(max?)`, `readAll()`, `write(data)`, `close()`), or an `Error`.
Both are `Disposable`. Sockets are non-blocking: a task waiting for one
parks, and the runtime's poller (kqueue or epoll) resumes it when the socket
is ready, so waiting occupies no OS thread. Tasks waiting for the network
are not a deadlock.

```ts
import { listen } from "ore:net"

const server = listen(8080)
if (server instanceof Error) process.panic(server.message)
for (;;) {
    const conn = server.accept()
    if (conn instanceof Error) continue
    task.spawn(() => {
        using c = conn
        c.write("hello\n")
    })
}
```
