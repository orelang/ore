import type { ArrayType, BoolType, ChanType, FloatType, FuncType, IntType, InterfaceType, LiteralType, MapType, SetType, StringType, StructType, Type, UnionType } from "./types"

/**
 * Typed, name-resolved, structured IR produced by the checker.
 *
 * All implicit behavior of the source is explicit here: numeric literals have
 * concrete types, conversions are `convert` nodes, compound assignments are
 * expanded, and every local has a unique id.
 */

export interface Module {
  /** Path of the source file, as given to the compiler. */
  file: string
  functions: Func[]
  /**
   * The top-level code of each source module, in the order the program runs
   * it: every module after the modules it imports, the entry last.
   */
  inits: Func[]
  /** Every struct type used by the module. */
  structs: StructType[]
  /** Interface tables of structs converted to interfaces. */
  itabs: Itab[]
  /** Every union type used by the module. */
  unions: UnionType[]
}

/** The table for a struct used as an interface; see `InterfaceType`. */
export interface Itab {
  id: number
  struct: StructType
  iface: InterfaceType
}

export interface Func {
  /** Unique symbol name, safe to use in the target language. */
  name: string
  /** Name as written in the source. */
  sourceName: string
  /** 1-based source line of the declaration. */
  line: number
  /** Path of the declaring module, when it differs from the module's `file`. */
  file?: string
  /**
   * An external C function, called by its C name `name`: strings are passed
   * as NUL-terminated copies and returned strings are copied.
   */
  extern?: boolean
  /** For a variadic external function: the type of the arguments after `params`, as C passes them. */
  variadic?: Type
  type: FuncType
  params: Local[]
  /** `this` of a method, passed before the parameters. */
  receiver?: Local
  /**
   * For a closure: the locals of enclosing functions it uses, in the order of
   * its environment. The closure is called with the environment first.
   */
  captures?: Local[]
  body: Block
  exported: boolean
  /** Set by `//ore:` directives before the declaration. */
  attributes?: FuncAttributes
}

/** Code generation attributes of a function, from `//ore:` directives. */
export interface FuncAttributes {
  /** `//ore:noinline`: never inlined. */
  noinline?: boolean
  /** `//ore:inline`: always inlined by LLVM. */
  inline?: boolean
  /** `//ore:cold`: rarely called, optimized for size and placed apart. */
  cold?: boolean
  /** `//ore:export name`: visible to C as `name`, with the C calling convention. */
  exportName?: string
  /** `//ore:runtime name`, in the standard library: implements the runtime function `name` that generated code calls. */
  runtime?: string
  /** `//ore:naked`: no prologue or epilogue; the body is assembly only. */
  naked?: boolean
}

export interface Local {
  id: number
  name: string
  type: Type
  mutable: boolean
  /** Referenced by a closure other than the function that declares it. */
  captured?: boolean
  /** Assigned after its declaration. A captured local that is assigned lives in a heap box. */
  assigned?: boolean
  /**
   * Declared at the top level of a module: a global variable, set when the
   * module's top-level code runs and zero before. Never captured.
   */
  global?: boolean
  /** `//ore:threadlocal`: a global with a separate value, starting at zero, in each OS thread. */
  threadLocal?: boolean
  /** `//ore:export name`: a global visible to C as `name`. */
  exportName?: string
}

interface StmtBase {
  /** 1-based source line, for debug info and stack traces. */
  line?: number
}

export type Stmt = Block | LetStmt | ExprStmt | IfStmt | LoopStmt | ForOfStmt | SwitchStmt | UsingStmt | BreakStmt | ContinueStmt | ReturnStmt

export interface Block extends StmtBase {
  k: "block"
  body: Stmt[]
}

export interface LetStmt extends StmtBase {
  k: "let"
  local: Local
  /** Without an initializer, the local starts zeroed; used for hoisted functions. */
  init?: Expr
}

export interface ExprStmt extends StmtBase {
  k: "expr"
  expr: Expr
}

export interface IfStmt extends StmtBase {
  k: "if"
  cond: Expr
  then: Stmt
  else?: Stmt
}

/**
 * A loop. `while (c) s` has `cond`; `for (;c;u) s` has `cond` and `update`;
 * `do s while (c)` has `cond` and `condAfter`; a missing `cond` loops forever.
 * `continue` jumps to `update`, then to the condition check.
 */
export interface LoopStmt extends StmtBase {
  k: "loop"
  /** Unique within the function; the target of labeled `break` / `continue`. */
  id: number
  /** Set when a labeled `break` / `continue` targets this loop. */
  labeled: boolean
  /**
   * Variables declared by `for (let ...)`: each iteration has its own copy,
   * which matters when closures capture them.
   */
  perIteration?: Local[]
  cond?: Expr
  condAfter: boolean
  update?: Expr
  body: Stmt
}

/**
 * `for (const x of iterable)`: over array elements, or over the runes (`i32`)
 * of a string. The array length is re-read on every iteration.
 */
export interface ForOfStmt extends StmtBase {
  k: "for-of"
  id: number
  labeled: boolean
  /** The element, rune, or key of a map entry. */
  local: Local
  /** The value of a map entry, for `for (const [key, value] of map)`. */
  value?: Local
  iterable: Expr
  body: Stmt
}

/**
 * `switch`: `value` is stored in `local`, then the `test` of each clause is
 * evaluated in order until one is true (a clause without `test` is
 * `default`, chosen when none matches). Execution starts at that clause and
 * falls through the following ones until a `break`.
 */
export interface SwitchStmt extends StmtBase {
  k: "switch"
  id: number
  labeled: boolean
  /** The cases cover every possible value, as a default would. */
  exhaustive: boolean
  local: Local
  value: Expr
  clauses: { test?: Expr; body: Stmt[] }[]
}

/**
 * `using local = init` followed by the rest of its block in `body`: `dispose`
 * runs whenever control leaves `body`, by its end, `return`, `break` or
 * `continue`.
 */
export interface UsingStmt extends StmtBase {
  k: "using"
  local: Local
  init: Expr
  dispose: Stmt
  body: Stmt[]
}

/** Exits the innermost loop or switch, or the one with id `target` for a labeled break. */
export interface BreakStmt extends StmtBase {
  k: "break"
  target?: number
}

/** Continues the innermost loop, or the loop with id `target` for a labeled continue. */
export interface ContinueStmt extends StmtBase {
  k: "continue"
  target?: number
}

export interface ReturnStmt extends StmtBase {
  k: "return"
  value?: Expr
}

export type ArithOp = "+" | "-" | "*" | "/" | "%" | "&" | "|" | "^" | "<<" | ">>"
export type CompareOp = "===" | "!==" | "<" | "<=" | ">" | ">="

export type Expr =
  | IntLit
  | FloatLit
  | BoolLit
  | StringLit
  | LocalRef
  | Assign
  | IncDec
  | Arith
  | Compare
  | Logical
  | Unary
  | Not
  | Convert
  | Call
  | BuiltinCall
  | Conditional
  | Concat
  | Index
  | Len
  | Slice
  | ArrayLit
  | Push
  | Pop
  | ObjectLit
  | FieldGet
  | Alloc
  | MethodCall
  | ToIface
  | IfaceField
  | IfaceCall
  | NullLit
  | Recast
  | IsNull
  | Optional
  | Coalesce
  | UnionField
  | TypeOf
  | Is
  | Downcast
  | MapOp
  | SetOp
  | FuncRef
  | Closure
  | CallValue
  | BoundMethod
  | ArrayMethod
  | StringMethod
  | ChanOp
  | Bind
  | Seq

export interface IntLit {
  k: "int"
  type: IntType
  value: bigint
}

export interface FloatLit {
  k: "float"
  type: FloatType
  value: number
}

export interface BoolLit {
  k: "bool"
  type: BoolType
  value: boolean
}

export interface StringLit {
  k: "string"
  type: StringType | LiteralType
  value: string
}

export interface LocalRef {
  k: "local"
  type: Type
  local: Local
}

/** A place that can be assigned to. */
export type LValue =
  | { k: "local"; local: Local }
  /** A bounds-checked array element. */
  | { k: "element"; array: Expr; index: Expr }
  /** A field of a struct reference. */
  | { k: "field"; object: Expr; name: string }
  /** The field at `index` of an interface's members. */
  | { k: "iface-field"; value: Expr; index: number }
  /** A field that every member of a union of structs and interfaces has, with the same type. */
  | { k: "union-field"; value: Expr; name: string }

/**
 * Assignment. With `op` it is a compound assignment `target op= value`, where
 * `value` is already converted as the right operand of `op` and the target is
 * evaluated once. Compound assignments to locals are expanded by the checker.
 */
export interface Assign {
  k: "assign"
  type: Type
  target: LValue
  op?: ArithOp
  value: Expr
}

export interface IncDec {
  k: "incdec"
  type: IntType | FloatType
  target: LValue
  op: "++" | "--"
  prefix: boolean
}

/**
 * Arithmetic and bitwise operations. Both operands have the result type,
 * except the right operand of `<<` / `>>`, which may be any integer type.
 */
export interface Arith {
  k: "arith"
  type: IntType | FloatType
  op: ArithOp
  left: Expr
  right: Expr
}

export interface Compare {
  k: "compare"
  type: BoolType
  op: CompareOp
  left: Expr
  right: Expr
}

export interface Logical {
  k: "logical"
  type: BoolType
  op: "&&" | "||"
  left: Expr
  right: Expr
}

export interface Unary {
  k: "unary"
  type: IntType | FloatType
  op: "-" | "~"
  operand: Expr
}

export interface Not {
  k: "not"
  type: BoolType
  operand: Expr
}

/** Numeric conversion between distinct numeric types. */
export interface Convert {
  k: "convert"
  type: IntType | FloatType
  value: Expr
}

export interface Call {
  k: "call"
  type: Type
  func: Func
  args: Expr[]
}

/** A built-in function by its qualified name, such as `console.log` or `Math.sqrt`. */
export type BuiltinName = string

export interface BuiltinCall {
  k: "builtin"
  type: Type
  name: BuiltinName
  args: Expr[]
  /** For built-ins that return `Error`: how to create one from a message. */
  error?: { ctor: Func; itab: Itab }
  /** Type arguments, for `JSON.parse<T>` and the generic `unsafe` functions. */
  typeArgs?: Type[]
}

export interface Conditional {
  k: "cond"
  type: Type
  cond: Expr
  then: Expr
  else: Expr
}

/** String concatenation; non-string parts are formatted like `print` does. */
export interface Concat {
  k: "concat"
  type: StringType
  parts: Expr[]
}

/** Bounds-checked element read: an array element or a byte of a string. The index has any integer type. */
export interface Index {
  k: "index"
  type: Type
  target: Expr
  index: Expr
}

/** Length of an array, or of a string in bytes. */
export interface Len {
  k: "len"
  type: IntType
  value: Expr
}

/** JavaScript `slice`: a substring of byte offsets, or a copy of a range of an array. */
export interface Slice {
  k: "slice"
  type: Type
  value: Expr
  start?: Expr
  end?: Expr
}

export interface ArrayLit {
  k: "array"
  type: ArrayType
  elems: Expr[]
}

/** `array.push(...values)`; evaluates to the new length. */
export interface Push {
  k: "push"
  type: IntType
  array: Expr
  values: Expr[]
}

/** `array.pop()`; panics on an empty array. */
export interface Pop {
  k: "pop"
  type: Type
  array: Expr
}

/** Allocates a struct and initializes its fields in source order. */
export interface ObjectLit {
  k: "object"
  type: StructType
  fields: { name: string; value: Expr }[]
}

export interface FieldGet {
  k: "field"
  type: Type
  object: Expr
  name: string
}

/** A new zeroed instance of a struct; used at the start of constructors. */
export interface Alloc {
  k: "alloc"
  type: StructType
}

/** A direct call of a class method. */
export interface MethodCall {
  k: "method-call"
  type: Type
  func: Func
  receiver: Expr
  args: Expr[]
}

/**
 * Converts a struct to an interface with a static table, or an interface to
 * another interface by picking table entries: entry `i` of the result is
 * entry `indices[i]` of the source.
 */
export interface ToIface {
  k: "to-iface"
  type: InterfaceType
  value: Expr
  itab?: Itab
  indices?: number[]
}

/** Reads the field at `index` of an interface's members. */
export interface IfaceField {
  k: "iface-field"
  type: Type
  value: Expr
  index: number
}

/** Calls the method at `index` of an interface's members. */
export interface IfaceCall {
  k: "iface-call"
  type: Type
  value: Expr
  index: number
  method: FuncType
  args: Expr[]
}

/** `null` of a union type that contains `null`. */
export interface NullLit {
  k: "null"
  type: UnionType
}

/**
 * Converts between a union and its members: a member to a union containing it
 * (or containing all its members), or a union to a member or a smaller union.
 * Narrowing checks at run time that the value is one of the target's members
 * and panics otherwise.
 */
export interface Recast {
  k: "recast"
  type: Type
  value: Expr
}

/** Whether a value of a union type is `null`. */
export interface IsNull {
  k: "is-null"
  type: BoolType
  value: Expr
}

/**
 * Optional chaining `value?.…`: `null` if `value` is null, else `body`
 * evaluated with `binding` set to the non-null value and converted to `type`.
 */
export interface Optional {
  k: "optional"
  type: UnionType
  value: Expr
  binding: Local
  body: Expr
}

/** `value ?? fallback`: the non-null value, or `fallback`. */
export interface Coalesce {
  k: "coalesce"
  type: Type
  value: Expr
  fallback: Expr
}

/** Reads a field that every member of a union of structs and interfaces has. */
export interface UnionField {
  k: "union-field"
  type: Type
  value: Expr
  name: string
}

/** `typeof value`: "number", "boolean", "string" or "object" (also for null). */
export interface TypeOf {
  k: "typeof"
  type: StringType
  value: Expr
}

/**
 * `instanceof`: whether a union value holds `member`, or whether an interface
 * value refers to an instance of the class `member`. With `via`, the union
 * holds the interface `via` referring to an instance of `member`.
 */
export interface Is {
  k: "is"
  type: BoolType
  value: Expr
  member: Type
  via?: InterfaceType
}

/** The instance behind an interface value, which must be of class `type`; panics otherwise. */
export interface Downcast {
  k: "downcast"
  type: StructType
  value: Expr
}

/**
 * An operation of `Map`: `new Map()`, `map.get(key)` (the value or null),
 * `map.set(key, value)` (the map), `has`, `delete`, `clear`, `size`, and
 * `keys` / `values` as arrays in insertion order.
 */
export interface MapOp {
  k: "map"
  op: "new" | "get" | "set" | "has" | "delete" | "clear" | "size" | "keys" | "values"
  type: Type
  mapType: MapType
  map?: Expr
  key?: Expr
  value?: Expr
}

/**
 * An operation of `Set`: `new Set()` (with `value`, an array whose elements
 * it adds), `set.add(value)` (the set), `has`, `delete`, `clear`, `size`, and
 * `values` as an array in insertion order.
 */
export interface SetOp {
  k: "set"
  op: "new" | "add" | "has" | "delete" | "clear" | "size" | "values"
  type: Type
  setType: SetType
  set?: Expr
  value?: Expr
}

/** A top-level function used as a value. */
export interface FuncRef {
  k: "func-ref"
  type: FuncType
  func: Func
}

/** Creates a closure of `func`, capturing `func.captures` from the current function. */
export interface Closure {
  k: "closure"
  type: FuncType
  func: Func
}

/** Calls a function value. */
export interface CallValue {
  k: "call-value"
  type: Type
  callee: Expr
  args: Expr[]
}

/**
 * A method bound to its receiver as a function value: a class method
 * (`func`), or method `index` of an interface value.
 */
export interface BoundMethod {
  k: "bound-method"
  type: FuncType
  receiver: Expr
  func?: Func
  index?: number
}

/**
 * A method of arrays taking a callback or a value: forEach, map, filter,
 * reduce, find, findIndex, some, every, includes, indexOf, join, reverse,
 * sort. A callback is called with its first `arity` arguments of
 * (element, index) — or (accumulator, element, index) for reduce.
 */
export interface ArrayMethod {
  k: "array-method"
  method: string
  type: Type
  array: Expr
  args: Expr[]
  arity?: number
}

/** A method of strings, such as `indexOf` or `split`; omitted optional arguments are absent. */
export interface StringMethod {
  k: "string-method"
  method: string
  type: Type
  value: Expr
  args: Expr[]
}

/**
 * An operation of `Chan`: `new Chan(capacity)`, `send(value)`,
 * `receive()` (the value, or null once closed and empty), `close()`, and the
 * select cases `onReceive(handler)` and `onSend(value, handler)`.
 */
export interface ChanOp {
  k: "chan"
  op: "new" | "send" | "receive" | "close" | "on-receive" | "on-send"
  type: Type
  chanType: ChanType
  chan?: Expr
  value?: Expr
  /** For select cases: the handler, and how many arguments it takes. */
  handler?: Expr
  arity?: number
}

/**
 * Declares `locals` with their initial values in order, then evaluates to
 * `body`. Created by inlining a call: the locals are the parameters.
 */
export interface Bind {
  k: "bind"
  type: Type
  locals: { local: Local; init: Expr }[]
  body: Expr
}

/** Evaluates `exprs` in order; the value is the last one's. */
export interface Seq {
  k: "seq"
  type: Type
  exprs: Expr[]
}
