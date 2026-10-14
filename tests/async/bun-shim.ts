// Ore's `time` and `task.microtask` in terms of Web APIs, so that the tests in
// this directory run unchanged in Bun, whose output is their reference.

const handle = (cancel: () => void) => ({ cancel })

;(globalThis as any).time = {
  timeout: (fn: () => void, ms: number) => {
    const id = setTimeout(fn, ms)
    return handle(() => clearTimeout(id))
  },
  interval: (fn: () => void, ms: number) => {
    const id = setInterval(fn, ms)
    return handle(() => clearInterval(id))
  },
  immediate: (fn: () => void) => {
    const id = setImmediate(fn)
    return handle(() => clearImmediate(id))
  },
  delay: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  sleep: (ms: number) => Bun.sleepSync(ms),
}

;(globalThis as any).task = { microtask: queueMicrotask }
