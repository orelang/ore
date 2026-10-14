import ts from "typescript"

/** Whether an import has the attribute `type: "text"`. */
export function importsText(stmt: ts.ImportDeclaration): boolean {
  return (stmt.attributes?.elements ?? []).some(
    (e) => (ts.isIdentifier(e.name) ? e.name.text : e.name.text) === "type" && ts.isStringLiteral(e.value) && e.value.text === "text",
  )
}
