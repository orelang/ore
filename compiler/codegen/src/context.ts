// Types and names shared by the layers of the emitter.


export interface EmitOptions {
  /** Keep a shadow stack of frames for panic stack traces. */
  debug: boolean
}

export const STR = "%ore.str"

export const FN = "%ore.fn"

export const IFACE = "%ore.iface"

export const FRAME = "%ore.frame"

export const ARRAY = "%ore.array"

export const MAP = "%ore.map"

export const SB = "%ore.sb"

export const JSON_VALUE = "%ore.json"

export const JSON_CTX = "%ore.json.ctx"

// Kinds of parsed JSON values, as runtime/core/json.ore makes them.
export const JSON_NULL = 0

export const JSON_BOOL = 1

export const JSON_NUMBER = 2

export const JSON_STRING = 3

export const JSON_ARRAY = 4

export const JSON_OBJECT = 5

/** Run-time panic messages that tests and users see; kept identical to the C backend. */
export const DIVIDE_BY_ZERO = "integer divide by zero"

export interface Breakable {
  id: number
  isSwitch: boolean
  breakLabel: string
  continueLabel: string
}

/** Where a local lives: its own stack slot, or a slot holding the address of its heap (or stack) box. */
export type Storage = { k: "direct"; ptr: string } | { k: "boxed"; holder: string }
