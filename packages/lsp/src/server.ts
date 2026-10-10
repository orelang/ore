import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { TextDocument } from "vscode-languageserver-textdocument"
import {
  CompletionItemKind,
  ResponseError,
  type TextEdit,
  DiagnosticSeverity,
  TextDocuments,
  TextDocumentSyncKind,
  type Connection,
  type Diagnostic as LspDiagnostic,
} from "vscode-languageserver/node"
import { analyze, type Analysis, type Location, type Reference } from "./analysis"

/** Serves Ore language features over an LSP connection. */
export function serve(connection: Connection, version: string) {
  const documents = new TextDocuments(TextDocument)
  const analyses = new Map<string, Analysis>()

  let roots: string[] = []

  connection.onInitialize((params) => {
    roots = (params.workspaceFolders?.map((f) => f.uri) ?? (params.rootUri ? [params.rootUri] : [])).map(uriToPath)
    return {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental,
        hoverProvider: true,
        definitionProvider: true,
        referencesProvider: true,
        renameProvider: { prepareProvider: true },
        completionProvider: { triggerCharacters: ["."] },
      },
      serverInfo: { name: "ore", version },
    }
  })

  /** The current text of a file: the open document's, or the file on disk. */
  const textOf = (path: string): string | undefined => {
    const open = documents.get(pathToFileURL(path).href)
    if (open) return open.getText()
    try {
      return readFileSync(path, "utf8")
    } catch {
      return undefined
    }
  }

  /** Analyzes the current text of a document, or undefined if it cannot be read or checked. */
  const fresh = (uri: string): Analysis | undefined => {
    const path = uriToPath(uri)
    const text = textOf(path)
    if (text === undefined) return undefined
    try {
      return analyze(path, text)
    } catch {
      return undefined
    }
  }

  /**
   * The references to a symbol in the document's program and in every .ore
   * file of the workspace, whose programs may import it.
   */
  const workspaceReferences = (uri: string, key: string): Reference[] => {
    const files = new Set([uriToPath(uri), ...roots.flatMap(oreFiles)])
    const found = new Map<string, Reference>()
    for (const file of files) {
      const analysis = fresh(pathToFileURL(file).href)
      for (const r of analysis?.references(key) ?? []) found.set(`${r.path}:${r.range.start.line}:${r.range.start.character}`, r)
    }
    return [...found.values()]
  }

  const update = (document: TextDocument) => {
    let analysis: Analysis
    try {
      analysis = analyze(uriToPath(document.uri), document.getText())
    } catch (error) {
      connection.console.error(`ore: analysis failed for ${document.uri}: ${(error as Error).stack}`)
      return
    }
    analyses.set(document.uri, analysis)
    const diagnostics = analysis.diagnostics.map((d): LspDiagnostic => ({
      range: analysis.range(d.source, d.start, d.start + d.length),
      severity: d.severity === "error" ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning,
      source: "ore",
      message: d.message,
    }))
    void connection.sendDiagnostics({ uri: document.uri, diagnostics })
  }

  documents.onDidOpen((e) => update(e.document))
  documents.onDidChangeContent((e) => update(e.document))
  documents.onDidClose((e) => {
    analyses.delete(e.document.uri)
    void connection.sendDiagnostics({ uri: e.document.uri, diagnostics: [] })
  })

  connection.onHover(({ textDocument, position }) => {
    const hover = analyses.get(textDocument.uri)?.hover(position)
    return hover ? { contents: { kind: "markdown", value: hover.contents }, range: hover.range } : null
  })

  connection.onCompletion(({ textDocument, position }) => {
    // Analyze the current text: completion is requested right after typing.
    const document = documents.get(textDocument.uri)
    if (!document) return []
    let analysis: Analysis
    try {
      analysis = analyze(uriToPath(document.uri), document.getText())
    } catch {
      return []
    }
    return analysis.completions(position).map((c) => ({
      label: c.label,
      kind: c.kind === "method" ? CompletionItemKind.Method : CompletionItemKind.Field,
      detail: c.detail,
    }))
  })

  connection.onDefinition(({ textDocument, position }) => {
    const location = analyses.get(textDocument.uri)?.definition(position)
    return location ? { uri: locationUri(location, textDocument.uri), range: location.range } : null
  })

  connection.onReferences(({ textDocument, position, context }) => {
    const symbol = fresh(textDocument.uri)?.symbolAt(position)
    if (!symbol) return []
    return workspaceReferences(textDocument.uri, symbol.key)
      .filter((r) => context.includeDeclaration || !r.declaration)
      .map((r) => ({ uri: pathToFileURL(r.path).href, range: r.range }))
  })

  connection.onPrepareRename(({ textDocument, position }) => {
    const symbol = fresh(textDocument.uri)?.symbolAt(position)
    if (!symbol) return null
    if (symbol.builtin) throw new ResponseError(0, "Built-in declarations cannot be renamed.")
    return { range: symbol.range, placeholder: symbol.name }
  })

  connection.onRenameRequest(({ textDocument, position, newName }) => {
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(newName)) throw new ResponseError(0, `'${newName}' is not a valid name.`)
    const symbol = fresh(textDocument.uri)?.symbolAt(position)
    if (!symbol || symbol.builtin) return null
    const changes: Record<string, TextEdit[]> = {}
    for (const r of workspaceReferences(textDocument.uri, symbol.key)) {
      const uri = pathToFileURL(r.path).href
      ;(changes[uri] ??= []).push({ range: r.range, newText: `${r.prefix}${newName}${r.suffix}` })
    }
    return { changes }
  })

  documents.listen(connection)
  connection.listen()
}

function uriToPath(uri: string): string {
  return uri.startsWith("file:") ? fileURLToPath(uri) : uri
}

/** Files without a path on disk (the embedded std) are materialized into the cache. */
function locationUri(location: Location, current: string): string {
  if (location.text === undefined) return location.path === uriToPath(current) ? current : pathToFileURL(location.path).href
  const cache = process.env.ORE_CACHE ?? join(homedir(), ".cache", "ore")
  const path = join(cache, "lsp", location.path)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, location.text)
  return pathToFileURL(path).href
}

/** The .ore files below a directory, outside node_modules and hidden directories. */
function oreFiles(dir: string): string[] {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries.flatMap((e) => {
    if (e.name.startsWith(".") || e.name === "node_modules") return []
    const path = join(dir, e.name)
    if (e.isDirectory()) return oreFiles(path)
    return e.name.endsWith(".ore") ? [path] : []
  })
}
