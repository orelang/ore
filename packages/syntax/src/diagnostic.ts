import ts from "typescript"
import type { Source } from "./source"

export type Severity = "error" | "warning"

export interface Diagnostic {
  source: Source
  start: number
  length: number
  severity: Severity
  message: string
}

export function diagnosticAt(source: Source, node: ts.Node, message: string, severity: Severity = "error"): Diagnostic {
  const start = node.getStart(source.ast)
  return { source, start, length: node.getEnd() - start, severity, message }
}

/** Formats a diagnostic as `path:line:col: severity: message` followed by the source line and a caret. */
export function formatDiagnostic(d: Diagnostic): string {
  const { line, column } = d.source.position(d.start)
  const text = d.source.line(line)
  const width = Math.max(1, Math.min(d.length, text.length - column))
  return [
    `${d.source.path}:${line + 1}:${column + 1}: ${d.severity}: ${d.message}`,
    `  ${text}`,
    `  ${" ".repeat(column)}${"^".repeat(width)}`,
  ].join("\n")
}
