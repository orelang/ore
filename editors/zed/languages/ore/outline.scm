(function_declaration
  "function" @context
  name: (_) @name) @item

(type_alias_declaration
  "type" @context
  name: (_) @name) @item

(interface_declaration
  "interface" @context
  name: (_) @name) @item

(class_declaration
  "class" @context
  name: (_) @name) @item

(program
  (lexical_declaration
    "const" @context
    (variable_declarator
      name: (_) @name) @item))

(program
  (export_statement
    (lexical_declaration
      "const" @context
      (variable_declarator
        name: (_) @name) @item)))

(comment) @annotation
