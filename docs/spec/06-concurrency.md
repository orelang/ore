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
- Each task has a fixed stack (256 KiB; 8 MiB for the top-level code) with a guard page:
  overflowing it crashes the program.
- A file operation blocks only its OS thread: the scheduler starts another
  thread for the other tasks meanwhile. A task waiting for a program it ran
  (`process.output`, `process.run`) parks on the poller, like one waiting
  for a socket, and is no deadlock. `async`, `await` and `Promise` are
  rejected.

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
