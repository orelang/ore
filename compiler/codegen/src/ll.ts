/**
 * Building textual LLVM IR: values, basic blocks and constants.
 */

/** An LLVM value: its type and its operand text (a register, a constant or a global). */
export interface V {
  ty: string
  v: string
}

export const voidValue: V = { ty: "void", v: "" }

/**
 * The body of one function under construction. Allocations go to the entry
 * block; code after a terminator starts a fresh, unreachable block, so that
 * callers never need to track whether a block is still open.
 */
export class FnBuilder {
  private allocas: string[] = []
  private code: string[] = []
  private counter = 0
  /** The label of the block being written, for `phi` operands. */
  block = "entry"
  private open = true

  temp(): string {
    return `%t${this.counter++}`
  }

  label(hint: string): string {
    return `${hint}.${this.counter++}`
  }

  isOpen(): boolean {
    return this.open
  }

  /** Emits an instruction into the current block. */
  emit(line: string) {
    if (!this.open) this.start(this.label("dead"))
    this.code.push(`  ${line}`)
  }

  /** Emits an instruction producing a value of type `ty`. */
  value(ty: string, rhs: string): V {
    const t = this.temp()
    this.emit(`${t} = ${rhs}`)
    return { ty, v: t }
  }

  /** A stack slot of type `ty` in the entry block. */
  alloca(ty: string): string {
    const slot = `%s${this.counter++}`
    this.allocas.push(`  ${slot} = alloca ${ty}, align 16`)
    return slot
  }

  /** Starts a block; an open block before it falls through into it. */
  start(label: string) {
    if (this.open) this.code.push(`  br label %${label}`)
    this.code.push(`${label}:`)
    this.block = label
    this.open = true
  }

  br(label: string) {
    if (!this.open) return
    this.code.push(`  br label %${label}`)
    this.open = false
  }

  condBr(cond: V, then: string, otherwise: string) {
    this.emit(`br i1 ${cond.v}, label %${then}, label %${otherwise}`)
    this.open = false
  }

  terminate(line: string) {
    this.emit(line)
    this.open = false
  }

  /** The function definition with its body, closing an open last block with `close`. */
  finish(header: string, close: string): string {
    if (this.open) this.code.push(`  ${close}`)
    return [`${header} {`, "entry:", ...this.allocas, ...this.code, "}"].join("\n")
  }
}

/** The bytes of a string as UTF-8. */
export function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

/** An LLVM string constant body, `c"..."`, for bytes. */
export function cString(bytes: Uint8Array): string {
  let out = 'c"'
  for (const b of bytes) out += b >= 0x20 && b < 0x7f && b !== 0x22 && b !== 0x5c ? String.fromCharCode(b) : `\\${b.toString(16).toUpperCase().padStart(2, "0")}`
  return `${out}"`
}

/** An LLVM float constant: the exact IEEE double bits in hexadecimal, as LLVM requires. */
export function floatConstant(value: number, bits: 32 | 64): string {
  const v = bits === 32 ? Math.fround(value) : value
  const view = new DataView(new ArrayBuffer(8))
  view.setFloat64(0, v)
  return `0x${view.getBigUint64(0).toString(16).toUpperCase().padStart(16, "0")}`
}

/** An integer of `bits` bits as LLVM writes it: signed, two's complement. */
export function intConstant(value: bigint, bits: number): string {
  if (bits === 1) return value === 0n ? "false" : "true"
  const mod = 1n << BigInt(bits)
  let v = ((value % mod) + mod) % mod
  if (v >= mod >> 1n) v -= mod
  return v.toString()
}

/** `sizeof(ty)` as a constant expression. */
export function sizeOf(ty: string): string {
  return `ptrtoint (ptr getelementptr (${ty}, ptr null, i32 1) to i64)`
}

/** A global name, with characters outside LLVM's plain identifiers spelled as `_xHH_`. */
export function globalName(name: string): string {
  return `@${name.replace(/[^A-Za-z0-9_.$]/g, (c) => `_x${c.codePointAt(0)!.toString(16)}_`)}`
}
