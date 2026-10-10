import { mkdirSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { TextDocument } from "vscode-languageserver-textdocument"
import {
  DiagnosticSeverity,
  TextDocuments,
  TextDocumentSyncKind,
  type Connection,
  type Diagnostic as LspDiagnostic,
} from "vscode-languageserver/node"
import { analyze, type Analysis, type Location } from "./analysis"

/** Serves Ore language features over an LSP connection. */
export function serve(connection: Connection, version: string) {
  const documents = new TextDocuments(TextDocument)
  const analyses = new Map<string, Analysis>()

  connection.onInitialize(() => ({
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      hoverProvider: true,
      definitionProvider: true,
    },
    serverInfo: { name: "ore", version },
  }))

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

  connection.onDefinition(({ textDocument, position }) => {
    const location = analyses.get(textDocument.uri)?.definition(position)
    return location ? { uri: locationUri(location, textDocument.uri), range: location.range } : null
  })

  documents.listen(connection)
  connection.listen()
}

function uriToPath(uri: string): string {
  return uri.startsWith("file:") ? fileURLToPath(uri) : uri
}

/** Files without a path on disk (the embedded std) are materialized into the cache. */
function locationUri(location: Location, current: string): string {
  if (location.text === undefined) return current
  const cache = process.env.ORE_CACHE ?? join(homedir(), ".cache", "ore")
  const path = join(cache, "lsp", location.path)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, location.text)
  return pathToFileURL(path).href
}
