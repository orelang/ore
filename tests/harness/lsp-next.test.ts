/**
 * The language server of the compiler written in Ore (`ore-next lsp`), spoken
 * to over stdio as an editor would: the base protocol's framing (also split
 * across reads), the lifecycle, documents with full and incremental changes,
 * syntax diagnostics with UTF-16 positions, cancellation and errors.
 */
import { build } from "@ore/driver"
import { afterAll, beforeAll, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const root = join(import.meta.dir, "../..")
const work = mkdtempSync(join(tmpdir(), "ore-next-lsp-"))
const binary = join(work, "ore-next")

beforeAll(async () => {
  const result = await build(join(root, "compiler/next/src/main.ore"), { output: binary })
  expect(result.diagnostics.map((d) => d.message)).toEqual([])
}, 600_000)

afterAll(() => rmSync(work, { recursive: true, force: true }))

/** A minimal LSP client: frames messages, and collects what the server sends. */
class Client {
  private buffer = Buffer.alloc(0)
  private readonly received: any[] = []
  private readonly waiting: { predicate: (m: any) => boolean; resolve: (m: any) => void }[] = []
  readonly proc

  constructor() {
    this.proc = Bun.spawn([binary, "lsp"], { stdin: "pipe", stdout: "pipe", stderr: "inherit" })
    void this.read()
  }

  private async read() {
    for await (const chunk of this.proc.stdout) {
      this.buffer = Buffer.concat([this.buffer, chunk])
      for (;;) {
        const end = this.buffer.indexOf("\r\n\r\n")
        if (end < 0) break
        const length = Number(this.buffer.subarray(0, end).toString().match(/Content-Length: (\d+)/)![1])
        if (this.buffer.length < end + 4 + length) break
        const message = JSON.parse(this.buffer.subarray(end + 4, end + 4 + length).toString())
        this.buffer = this.buffer.subarray(end + 4 + length)
        const index = this.waiting.findIndex((w) => w.predicate(message))
        if (index >= 0) this.waiting.splice(index, 1)[0]!.resolve(message)
        else this.received.push(message)
      }
    }
  }

  /** The bytes of a message with its header. */
  static frame(message: object): Buffer {
    const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...message }))
    return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body])
  }

  write(bytes: Buffer | string) {
    this.proc.stdin.write(bytes)
    this.proc.stdin.flush()
  }

  send(message: object) {
    this.write(Client.frame(message))
  }

  /** The next message that matches, already received or to come. */
  wait(predicate: (m: any) => boolean): Promise<any> {
    const index = this.received.findIndex(predicate)
    if (index >= 0) return Promise.resolve(this.received.splice(index, 1)[0])
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no message from the server")), 5000)
      this.waiting.push({ predicate, resolve: (m) => (clearTimeout(timer), resolve(m)) })
    })
  }

  request(id: number | string, method: string, params: object): Promise<any> {
    const response = this.wait((m) => m.id === id && m.method === undefined)
    this.send({ id, method, params })
    return response
  }

  diagnostics(uri: string): Promise<any> {
    return this.wait((m) => m.method === "textDocument/publishDiagnostics" && m.params.uri === uri)
  }

  async initialize() {
    const init = await this.request(0, "initialize", { processId: null, rootUri: null, capabilities: {} })
    this.send({ method: "initialized", params: {} })
    return init
  }

  async close(): Promise<number> {
    this.proc.stdin.end()
    return await this.proc.exited
  }
}

const uri = "file:///tmp/ore%20lsp/main.ore"
// The `)` on line 1 is at byte 19 + 19 but UTF-16 character 17: 😀 is 4 bytes and 2 units.
const broken = 'const a = "😀é"\nconst b = "😀" + )\n'

test("lifecycle: initialize, shutdown and exit", async () => {
  const client = new Client()
  const early = await client.request(1, "textDocument/hover", { textDocument: { uri }, position: { line: 0, character: 0 } })
  expect(early.error.code).toBe(-32002)

  const init = await client.initialize()
  expect(init.result.capabilities).toEqual({
    textDocumentSync: 2,
    hoverProvider: true,
    definitionProvider: true,
    referencesProvider: true,
    renameProvider: { prepareProvider: true },
    completionProvider: { triggerCharacters: ["."] },
  })
  expect(init.result.serverInfo.name).toBe("ore")
  expect((await client.request("again", "initialize", { processId: null, rootUri: null, capabilities: {} })).error.code).toBe(-32600)

  expect((await client.request(2, "ore/unknown", {})).error.code).toBe(-32601)
  const shutdown = await client.request(3, "shutdown", {})
  expect(shutdown).toEqual({ jsonrpc: "2.0", id: 3, result: null })
  expect((await client.request(4, "textDocument/hover", { textDocument: { uri }, position: { line: 0, character: 0 } })).error.code).toBe(-32600)
  client.send({ method: "exit" })
  expect(await client.proc.exited).toBe(0)
}, 10_000)

test("exit without shutdown, and the end of the input, exit with 1", async () => {
  const client = new Client()
  await client.initialize()
  client.send({ method: "exit" })
  expect(await client.proc.exited).toBe(1)
  expect(await new Client().close()).toBe(1)
}, 10_000)

test("syntax diagnostics with UTF-16 ranges, through full and incremental changes", async () => {
  const client = new Client()
  await client.initialize()

  client.send({ method: "textDocument/didOpen", params: { textDocument: { uri, languageId: "ore", version: 1, text: broken } } })
  const opened = await client.diagnostics(uri)
  expect(opened.params.diagnostics.length).toBeGreaterThan(0)
  expect(opened.params.diagnostics[0]).toEqual({
    range: { start: { line: 1, character: 17 }, end: { line: 1, character: 18 } },
    severity: 1,
    source: "ore",
    message: "Identifier expected, got 'CloseParenToken'",
  })

  // Replace `)` with `1`: ranges after the emoji are in UTF-16 units.
  client.send({
    method: "textDocument/didChange",
    params: {
      textDocument: { uri, version: 2 },
      contentChanges: [{ range: { start: { line: 1, character: 17 }, end: { line: 1, character: 18 } }, text: "1" }],
    },
  })
  expect((await client.diagnostics(uri)).params.diagnostics).toEqual([])

  // Insert after the surrogate pair of line 0, then break line 1 at its end, in one change set.
  client.send({
    method: "textDocument/didChange",
    params: {
      textDocument: { uri, version: 3 },
      contentChanges: [
        { range: { start: { line: 0, character: 13 }, end: { line: 0, character: 13 } }, text: "ü" },
        { range: { start: { line: 1, character: 18 }, end: { line: 1, character: 18 } }, text: " *" },
      ],
    },
  })
  const star = (await client.diagnostics(uri)).params.diagnostics
  expect(star.length).toBeGreaterThan(0)
  expect(star[0].range.start).toEqual({ line: 2, character: 0 })

  // A full change, with CRLF line ends.
  client.send({
    method: "textDocument/didChange",
    params: { textDocument: { uri, version: 4 }, contentChanges: [{ text: 'const x = "ü"\r\nconst c = ]\r\n' }] },
  })
  const full = (await client.diagnostics(uri)).params.diagnostics
  expect(full[0].range).toEqual({ start: { line: 1, character: 10 }, end: { line: 1, character: 11 } })

  // Features that need the checker answer empty for now.
  const hover = await client.request(5, "textDocument/hover", { textDocument: { uri }, position: { line: 0, character: 6 } })
  expect(hover.result).toBeNull()
  const completion = await client.request(6, "textDocument/completion", { textDocument: { uri }, position: { line: 0, character: 6 } })
  expect(completion.result).toEqual([])
  const references = await client.request(7, "textDocument/references", {
    textDocument: { uri },
    position: { line: 0, character: 6 },
    context: { includeDeclaration: true },
  })
  expect(references.result).toEqual([])
  expect((await client.request(8, "textDocument/rename", { textDocument: { uri }, position: { line: 0, character: 6 }, newName: "1x" })).error.code).toBe(0)

  client.send({ method: "textDocument/didClose", params: { textDocument: { uri } } })
  expect((await client.diagnostics(uri)).params.diagnostics).toEqual([])
  expect((await client.request(9, "textDocument/hover", { textDocument: { uri: "file:///x.ore" } })).error.code).toBe(-32602)
  await client.close()
}, 10_000)

test("messages split across reads, and several in one read", async () => {
  const client = new Client()
  await client.initialize()
  const open = Client.frame({ method: "textDocument/didOpen", params: { textDocument: { uri, languageId: "ore", version: 1, text: broken } } })
  // Split inside the header, then inside the 4 bytes of the first emoji.
  const emoji = open.indexOf(Buffer.from("😀"))
  const cuts = [5, 17, emoji + 1, emoji + 3, open.length]
  const diagnostics = client.diagnostics(uri)
  let at = 0
  for (const cut of cuts) {
    client.write(open.subarray(at, cut))
    at = cut
    await Bun.sleep(30)
  }
  expect((await diagnostics).params.diagnostics[0].range.start).toEqual({ line: 1, character: 17 })

  const both = Buffer.concat([Client.frame({ id: 10, method: "shutdown", params: null }), Client.frame({ id: 11, method: "textDocument/hover", params: {} })])
  client.write(both)
  expect((await client.wait((m) => m.id === 10)).result).toBeNull()
  expect((await client.wait((m) => m.id === 11)).error.code).toBe(-32600)
  client.send({ method: "exit" })
  expect(await client.proc.exited).toBe(0)
}, 10_000)

test("cancellation, and messages that are not JSON-RPC", async () => {
  const client = new Client()
  await client.initialize()
  // The cancellation arrives with the request, before the server handles it.
  client.write(
    Buffer.concat([
      Client.frame({ id: "slow", method: "textDocument/hover", params: { textDocument: { uri }, position: { line: 0, character: 0 } } }),
      Client.frame({ method: "$/cancelRequest", params: { id: "slow" } }),
    ]),
  )
  expect((await client.wait((m) => m.id === "slow")).error.code).toBe(-32800)

  client.write("Content-Length: 7\r\n\r\n{nope!}")
  expect((await client.wait((m) => m.id === null)).error.code).toBe(-32700)
  client.write("Content-Type: x\r\n\r\n")
  expect((await client.wait((m) => m.id === null)).error.code).toBe(-32600)
  // The server still answers.
  expect((await client.request(12, "shutdown", {})).result).toBeNull()
  expect(await client.close()).toBe(0)
}, 10_000)
