import { expect, test } from "bun:test"
import { cString, floatConstant, intConstant } from "../src/ll"

test("integer constants are two's complement in their width", () => {
  expect(intConstant(18446744073709551615n, 64)).toBe("-1")
  expect(intConstant(-9223372036854775808n, 64)).toBe("-9223372036854775808")
  expect(intConstant(255n, 8)).toBe("-1")
  expect(intConstant(127n, 8)).toBe("127")
  expect(intConstant(1n, 1)).toBe("true")
})

test("float constants are exact IEEE doubles in hexadecimal", () => {
  expect(floatConstant(1, 64)).toBe("0x3FF0000000000000")
  expect(floatConstant(-0, 64)).toBe("0x8000000000000000")
  expect(floatConstant(Infinity, 64)).toBe("0x7FF0000000000000")
  // A float constant is the double of the value rounded to f32.
  expect(floatConstant(0.1, 32)).toBe("0x3FB99999A0000000")
})

test("string constants escape quotes, backslashes, control bytes and UTF-8", () => {
  expect(cString(new TextEncoder().encode('a"b\\c\n'))).toBe('c"a\\22b\\5Cc\\0A"')
  expect(cString(new TextEncoder().encode("ё"))).toBe('c"\\D1\\91"')
})
