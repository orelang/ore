import { parse, type Diagnostic, type Source } from "@ore/syntax"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import ts from "typescript"
import { resolveImport, runtimeModules, stdModules } from "./resolve"

export interface Program {
  /** Modules with each module after the modules it imports, the entry last (cycles aside). */
  modules: Source[]
  entry: Source
  /** For each module, the module each import specifier resolves to. */
  imports: Map<Source, Map<string, Source>>
  /** Syntax errors and unresolved imports. */
  diagnostics: Diagnostic[]
  /** Whether any module has syntax errors, so that it cannot be checked. */
  syntaxErrors: boolean
}

export interface LoadOptions {
  /** Texts of files that differ from the disk, such as documents open in an editor. */
  overrides?: Map<string, string>
  /** Name modules by absolute paths instead of paths relative to the working directory. */
  absolutePaths?: boolean
}

/** Parses an entry file and every module it imports, directly or not. */
export function loadProgram(entryPath: string, options: LoadOptions = {}): Program {
  const byPath = new Map<string, Source>()
  const imports = new Map<Source, Map<string, Source>>()
  const diagnostics: Diagnostic[] = []
  const order: Source[] = []
  let syntaxErrors = false

  const read = (path: string) => stdModules[path] ?? options.overrides?.get(path) ?? readFileSync(path, "utf8")
  const visit = (path: string, display: string): Source => {
    const existing = byPath.get(path)
    if (existing) return existing
    const parsed = parse(display, read(path))
    const source = parsed.source
    byPath.set(path, source)
    diagnostics.push(...parsed.diagnostics)
    if (parsed.diagnostics.length > 0) syntaxErrors = true
    const resolved = new Map<string, Source>()
    imports.set(source, resolved)
    for (const stmt of source.ast.statements) {
      const specifier = moduleSpecifier(stmt)
      if (!specifier) continue
      const target = resolveImport(specifier.text, path)
      if (!target) {
        const start = specifier.getStart(source.ast)
        diagnostics.push({ source, start, length: specifier.getEnd() - start, severity: "error", message: `Cannot find module '${specifier.text}'.` })
        continue
      }
      const key = target in stdModules ? target : resolve(target)
      resolved.set(specifier.text, visit(key, target in stdModules || options.absolutePaths ? key : displayPath(target)))
    }
    order.push(source)
    return source
  }

  // The runtime comes first, so that its top-level code runs before any other.
  for (const name of runtimeModules) visit(name, name)
  const entry = visit(resolve(entryPath), options.absolutePaths ? resolve(entryPath) : entryPath)
  return { modules: order, entry, imports, diagnostics, syntaxErrors }
}

function moduleSpecifier(stmt: ts.Statement): ts.StringLiteral | undefined {
  const spec = ts.isImportDeclaration(stmt) || ts.isExportDeclaration(stmt) ? stmt.moduleSpecifier : undefined
  return spec && ts.isStringLiteral(spec) ? spec : undefined
}

/** A path relative to the working directory when below it, for messages and stack traces. */
function displayPath(path: string): string {
  const cwd = process.cwd()
  return path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path
}
