// Channels: a pipeline of three async functions. A producer sends the numbers
// 1..n, a stage squares them modulo a prime and a consumer sums what arrives,
// each hop through a buffered channel made of promises.

class Chan<T> {
    items: T[] = []
    head = 0
    capacity: number
    closed = false
    receivers: ((v: T | null) => void)[] = []
    senders: (() => void)[] = []

    constructor(capacity: number) {
        this.capacity = capacity
    }

    // Waits for room, or hands the value to a waiting receiver.
    async send(v: T): Promise<void> {
        while (this.receivers.length === 0 && this.items.length - this.head >= this.capacity) {
            await new Promise<void>((resolve) => this.senders.push(resolve))
        }
        const receiver = this.receivers.shift()
        if (receiver !== undefined) receiver(v)
        else this.items.push(v)
    }

    // Waits for a value; null once the channel is closed and empty.
    async receive(): Promise<T | null> {
        if (this.head < this.items.length) {
            const v = this.items[this.head++]
            if (this.head === this.items.length) {
                this.items = []
                this.head = 0
            }
            this.senders.shift()?.()
            return v
        }
        if (this.closed) return null
        this.senders.shift()?.()
        return new Promise<T | null>((resolve) => this.receivers.push(resolve))
    }

    close() {
        this.closed = true
        for (const receiver of this.receivers) receiver(null)
        this.receivers = []
    }
}

const n = process.argv.length > 2 ? Number.parseInt(process.argv[2]) : 1000000

const numbers = new Chan<number>(100)
const squares = new Chan<number>(100)
const producer = (async () => {
    for (let i = 1; i <= n; i++) await numbers.send(i)
    numbers.close()
})()
const stage = (async () => {
    for (let v = await numbers.receive(); v !== null; v = await numbers.receive()) {
        await squares.send((v * v) % 1000003)
    }
    squares.close()
})()
let count = 0
let sum = 0
for (let v = await squares.receive(); v !== null; v = await squares.receive()) {
    count++
    sum += v
}
await producer
await stage
console.log(count, sum)
