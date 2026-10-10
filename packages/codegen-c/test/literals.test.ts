import { types } from "@ore/ir"
import { expect, test } from "bun:test"
import { floatLiteral, intLiteral, stringLiteral } from "../src/emit"

test("integer literals", () => {
  expect(intLiteral(types.u64, 18446744073709551615n)).toBe("((u64)18446744073709551615ULL)")
  expect(intLiteral(types.i64, -9223372036854775808n)).toBe("((i64)(-9223372036854775807LL - 1))")
  expect(intLiteral(types.i8, -1n)).toBe("((i8)(0LL - 1))")
})

test("float literals", () => {
  expect(floatLiteral(types.f64, 1)).toBe("(1.0)")
  expect(floatLiteral(types.f64, -0.1)).toBe("(-0.1)")
  expect(floatLiteral(types.f64, -0)).toBe("(-0.0)")
  expect(floatLiteral(types.f32, 1e21)).toBe("(1e+21f)")
  expect(floatLiteral(types.f64, Infinity)).toBe("((f64)__builtin_inf())")
})

test("string literals escape quotes, control bytes, trigraphs and UTF-8", () => {
  expect(stringLiteral('a"b\\c\n')).toBe('"a\\"b\\\\c\\012"')
  expect(stringLiteral("??=")).toBe('"\\077\\077="')
  expect(stringLiteral("ё")).toBe('"\\321\\221"')
})
