# @ore/syntax

Ore has the syntax of TypeScript, so a file is parsed by the TypeScript
parser (`ts.createSourceFile`); only the meaning differs, and the checker
rejects what Ore does not support.

- `parse(path, text)` returns a `Source` and the syntax errors.
- `Source` holds the path, the text and the AST, and maps offsets to lines
  and columns.
- `Diagnostic` is an error or a warning at a range of a source;
  `formatDiagnostic` prints it as `path:line:col: error: message` with the
  line and a caret.
