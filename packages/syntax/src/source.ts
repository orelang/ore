import ts from "typescript"

/** A parsed `.ore` file. */
export class Source {
  readonly path: string
  readonly text: string
  readonly ast: ts.SourceFile

  constructor(path: string, text: string) {
    this.path = path
    this.text = text
    this.ast = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  }

  /** Zero-based line and column of an offset. */
  position(offset: number): { line: number; column: number } {
    const { line, character } = this.ast.getLineAndCharacterOfPosition(offset)
    return { line, column: character }
  }

  /** Text of a zero-based line, without the line break. */
  line(line: number): string {
    const starts = this.ast.getLineStarts()
    const start = starts[line] ?? this.text.length
    const end = starts[line + 1] ?? this.text.length
    return this.text.slice(start, end).replace(/\r?\n$/, "")
  }
}
