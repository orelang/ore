import { expect, test } from "bun:test"
import { join } from "node:path"

/** Minimal LSP client over stdio for an end-to-end check of `ore lsp`. */
class Client {
  private buffer = ""
  private readonly waiting: ((message: any) => boolean)[] = []
  private readonly proc = Bun.spawn(["bun", join(import.meta.dir, "../src/main.ts"), "lsp"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
  })

  constructor() {
    void this.read()
  }

  private async read() {
    const decoder = new TextDecoder()
    for await (const chunk of this.proc.stdout) {
      this.buffer += decoder.decode(chunk)
      for (;;) {
        const header = this.buffer.match(/^Content-Length: (\d+)\r\n\r\n/)
        if (!header) break
        const length = Number(header[1])
        const start = header[0].length
        if (Buffer.byteLength(this.buffer.slice(start)) < length) break
        const body = Buffer.from(this.buffer.slice(start)).subarray(0, length).toString()
        this.buffer = this.buffer.slice(start + body.length)
        const message = JSON.parse(body)
        const index = this.waiting.findIndex((w) => w(message))
        if (index !== -1) this.waiting.splice(index, 1)
      }
    }
  }

  send(message: object) {
    const body = JSON.stringify({ jsonrpc: "2.0", ...message })
    this.proc.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
    this.proc.stdin.flush()
  }

  wait(predicate: (message: any) => boolean): Promise<any> {
    return new Promise((resolve) => this.waiting.push((m) => (predicate(m) ? (resolve(m), true) : false)))
  }

  request(id: number, method: string, params: object): Promise<any> {
    const response = this.wait((m) => m.id === id)
    this.send({ id, method, params })
    return response
  }

  kill() {
    this.proc.kill()
  }
}

test("ore lsp publishes diagnostics and answers hover", async () => {
  const client = new Client()
  try {
    const init = await client.request(1, "initialize", { processId: null, rootUri: null, capabilities: {} })
    expect(init.result.capabilities.hoverProvider).toBe(true)
    client.send({ method: "initialized", params: {} })

    const uri = "file:///tmp/main.ore"
    const diagnostics = client.wait((m) => m.method === "textDocument/publishDiagnostics")
    client.send({
      method: "textDocument/didOpen",
      params: { textDocument: { uri, languageId: "ore", version: 1, text: "export function main() {\n  let x: u8 = 300\n}\n" } },
    })
    const published = await diagnostics
    expect(published.params.diagnostics.map((d: any) => d.message)).toEqual(["Constant 300 overflows 'u8' (range 0..255)."])

    const hover = await client.request(2, "textDocument/hover", { textDocument: { uri }, position: { line: 1, character: 7 } })
    expect(hover.result.contents.value).toBe("```ore\nlet x: u8\n```")
  } finally {
    client.kill()
  }
}, 10_000)

test("ore lsp renames a symbol across the files of the workspace", async () => {
  const { mkdtempSync, writeFileSync } = await import("node:fs")
  const { tmpdir } = await import("node:os")
  const { pathToFileURL } = await import("node:url")
  const dir = mkdtempSync(join(tmpdir(), "ore-rename-"))
  writeFileSync(join(dir, "lib.ore"), "export function twice(x: int): int {\n    return x * 2\n}\n")
  writeFileSync(join(dir, "main.ore"), 'import { twice } from "./lib"\n\nconsole.log(twice(1))\n')
  const client = new Client()
  try {
    const init = await client.request(1, "initialize", { processId: null, rootUri: pathToFileURL(dir).href, capabilities: {} })
    expect(init.result.capabilities.renameProvider).toEqual({ prepareProvider: true })
    client.send({ method: "initialized", params: {} })
    const lib = pathToFileURL(join(dir, "lib.ore")).href
    const main = pathToFileURL(join(dir, "main.ore")).href
    // Renamed from the declaration: main.ore is found by scanning the workspace.
    const rename = await client.request(2, "textDocument/rename", { textDocument: { uri: lib }, position: { line: 0, character: 17 }, newName: "double" })
    const edits = (uri: string) => (rename.result.changes[uri] ?? []).map((e: any) => `${e.range.start.line}:${e.range.start.character} ${e.newText}`).sort()
    expect(edits(lib)).toEqual(["0:16 double"])
    expect(edits(main)).toEqual(["0:9 double", "2:12 double"])
    const refs = await client.request(3, "textDocument/references", { textDocument: { uri: main }, position: { line: 2, character: 13 }, context: { includeDeclaration: false } })
    expect(refs.result.length).toBe(2)
  } finally {
    client.kill()
  }
}, 10_000)
