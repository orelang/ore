; Ore highlighting on top of the TypeScript grammar.
; In Zed, later patterns take precedence over earlier ones.

; Variables and properties

(identifier) @variable

(property_identifier) @property

(shorthand_property_identifier) @property

(required_parameter
  pattern: (identifier) @variable.parameter)

(optional_parameter
  pattern: (identifier) @variable.parameter)

; Names in SCREAMING_CASE are constants.
((identifier) @constant
  (#match? @constant "^[A-Z][A-Z0-9_]+$"))

; Functions

(function_declaration
  name: (identifier) @function)

(call_expression
  function: (identifier) @function)

(call_expression
  function: (member_expression
    property: (property_identifier) @function.method))

(method_definition
  name: (property_identifier) @function.method)

; Types

(type_identifier) @type

(predefined_type) @type.builtin

((type_identifier) @type.builtin
  (#match? @type.builtin "^(i8|i16|i32|i64|u8|u16|u32|u64|f32|f64|int|uint|byte|bool)$"))

; Conversions such as `i32(x)` read as types.
(call_expression
  function: ((identifier) @type.builtin
    (#match? @type.builtin "^(i8|i16|i32|i64|u8|u16|u32|u64|f32|f64)$")))

(call_expression
  function: ((identifier) @function.builtin
    (#match? @function.builtin "^(println|print|panic|spawn|select)$")))

; Literals

(comment) @comment

((comment) @comment.doc
  (#match? @comment.doc "^/\\*\\*"))

[
  (string)
  (template_string)
] @string

(escape_sequence) @string.escape

(regex) @string.regex

(number) @number

[
  (true)
  (false)
] @boolean

[
  (null)
  (undefined)
] @constant.builtin

(this) @variable.special

; Punctuation

[
  "("
  ")"
  "["
  "]"
  "{"
  "}"
] @punctuation.bracket

[
  ";"
  ","
  "."
  ":"
] @punctuation.delimiter

(template_substitution
  "${" @punctuation.special
  "}" @punctuation.special)

; Operators

[
  "="
  "+="
  "-="
  "*="
  "/="
  "%="
  "&="
  "|="
  "^="
  "<<="
  ">>="
  "+"
  "-"
  "*"
  "/"
  "%"
  "++"
  "--"
  "<<"
  ">>"
  "&"
  "|"
  "^"
  "~"
  "!"
  "&&"
  "||"
  "==="
  "!=="
  "<"
  "<="
  ">"
  ">="
  "?"
  "=>"
  "..."
] @operator

; Keywords

[
  "as"
  "break"
  "case"
  "class"
  "const"
  "continue"
  "declare"
  "default"
  "do"
  "else"
  "enum"
  "export"
  "extends"
  "for"
  "from"
  "function"
  "if"
  "implements"
  "import"
  "in"
  "instanceof"
  "interface"
  "keyof"
  "let"
  "new"
  "of"
  "private"
  "protected"
  "public"
  "readonly"
  "return"
  "static"
  "switch"
  "type"
  "typeof"
  "using"
  "while"
] @keyword

; Accepted by the parser but rejected by Ore; still highlighted as keywords.
[
  "async"
  "await"
  "catch"
  "delete"
  "finally"
  "throw"
  "try"
  "var"
  "yield"
] @keyword
