import ts from "typescript"
import type { Diagnostic } from "./diagnostic"
import { Source } from "./source"

export interface ParseResult {
  source: Source
  diagnostics: Diagnostic[]
}

export function parse(path: string, text: string): ParseResult {
  const source = new Source(path, text)
  // parseDiagnostics is internal in the public typings but always present.
  const raw = (source.ast as ts.SourceFile & { parseDiagnostics: ts.DiagnosticWithLocation[] }).parseDiagnostics
  const diagnostics = raw.map((d): Diagnostic => ({
    source,
    start: d.start,
    length: d.length,
    severity: "error",
    message: ts.flattenDiagnosticMessageText(d.messageText, "\n"),
  }))
  return { source, diagnostics }
}
