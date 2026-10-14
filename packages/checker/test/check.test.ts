import { describe, expect, test } from "bun:test"
import { parse } from "@ore/syntax"
import { check } from "../src"

function run(body: string, top = "") {
  const { source } = parse("test.ore", `${top}\nexport function main() {\n${body}\n}\n`)
  return check(source)
}

function errors(body: string, top = ""): string[] {
  return run(body, top).diagnostics.map((d) => d.message)
}

function ok(body: string, top = "") {
  expect(errors(body, top)).toEqual([])
}

describe("numeric literals", () => {
  test("untyped integers adapt to context", () => {
    ok("let a: u8 = 255; let b: i64 = -9223372036854775808; let c: f32 = 1")
  })

  test("constant overflow is an error", () => {
    expect(errors("let a: u8 = 256")).toEqual(["Constant 256 overflows 'u8' (range 0..255)."])
    expect(errors("let a: i8 = -129")).toEqual(["Constant -129 overflows 'i8' (range -128..127)."])
  })

  test("a failed constant conversion does not cascade", () => {
    expect(errors("let x: i32 = 1; let y: f64 = x + 0.5")).toEqual([
      "A floating-point constant is not assignable to integer type 'i32'. Use 'i32(...)' to truncate.",
    ])
  })

  test("float constants are not assignable to integers", () => {
    expect(errors("let a: i32 = 1.5")[0]).toContain("not assignable to integer type 'i32'")
  })

  test("constant expressions fold with arbitrary precision", () => {
    ok("let a: u64 = (1 << 64) - 1")
    ok("const big = 1 << 100; let a: i32 = big >> 98")
  })

  test("constant division by zero is an error", () => {
    expect(errors("let a = 1 / 0")).toEqual(["Division by zero."])
  })

  test("default types are int and f64", () => {
    const { info } = run("let a = 5; let b = 5.0")
    const types = [...info.types.values()].map((t) => (t.kind === "int" || t.kind === "float" ? t.name : t.kind))
    expect(types).toContain("i64")
    expect(types).toContain("f64")
  })
})

describe("conversions", () => {
  test("mixing numeric types requires explicit conversion", () => {
    const [message] = errors("let a: i32 = 1; let b: f64 = 2; let c = a + b")
    expect(message).toContain("Operator '+' cannot be applied to types 'i32' and 'f64'")
  })

  test("conversion functions convert between numeric types", () => {
    ok("let a: i32 = 1; let b: f64 = 2; let c = f64(a) + b; let d: u8 = u8(c)")
  })

  test("untyped constants are range-checked by conversions", () => {
    expect(errors("let a = u8(300)")).toEqual(["Constant 300 overflows 'u8' (range 0..255)."])
  })

  test("float constants are truncated by integer conversions", () => {
    ok("let a: i32 = i32(2.7); let b: i8 = i8(-128.9)")
    expect(errors("let a = u8(256.5)")).toEqual(["Constant 256 overflows 'u8' (range 0..255)."])
  })

  test("number is f64", () => {
    ok("let a: number = 1.5; let b: f64 = a")
  })
})

describe("statements", () => {
  test("loops and branches", () => {
    ok(`
      let sum = 0
      for (let i = 0; i < 10; i++) {
        if (i % 2 === 0) continue
        sum += i
      }
      while (true) { break }
      do { sum-- } while (sum > 0)
    `)
  })

  test("const variables cannot be assigned", () => {
    expect(errors("const a: i32 = 1; a = 2")).toEqual(["Cannot assign to 'a' because it is a constant."])
  })

  test("break outside a loop", () => {
    expect(errors("break")).toEqual(["'break' must be inside a loop or switch."])
  })

  test("var and == are rejected", () => {
    expect(errors("var a = 1")[0]).toContain("'var' is not supported")
    expect(errors("let a = 1 == 1")[0]).toContain("Use '==='")
  })
})

describe("functions", () => {
  test("calls check arity and argument types", () => {
    const top = "function add(a: i32, b: i32): i32 { return a + b }"
    ok("let x: i32 = add(1, 2)", top)
    expect(errors("add(1)", top)[0]).toContain("expects 2 argument(s), got 1")
    expect(errors("let x: i64 = 1; add(x, 2)", top)[0]).toContain("Type 'i64' is not assignable to type 'i32'")
  })

  test("missing return is an error", () => {
    expect(errors("", "function f(a: i32): i32 { if (a > 0) return 1 }")[0]).toContain("must return a value")
  })

  test("functions may end with an infinite loop or panic", () => {
    ok("", "function f(): i32 { while (true) {} }\nfunction g(): i32 { process.panic(\"no\") }")
  })

  test("mutual recursion", () => {
    ok("", `
      function even(n: u32): bool { return n === 0 ? true : odd(n - 1) }
      function odd(n: u32): bool { return n === 0 ? false : even(n - 1) }
    `)
  })

  test("parameters require type annotations", () => {
    expect(errors("", "function f(a): void {}")).toEqual(["Parameter 'a' must have a type annotation."])
  })
})

describe("top level", () => {
  function program(text: string) {
    const { source } = parse("test.ore", text)
    return check(source)
  }

  test("top-level statements are the program; variables are globals", () => {
    const { module, diagnostics } = program("let count = 0\nfunction bump() { count++ }\nbump()\nconsole.log(count)")
    expect(diagnostics).toEqual([])
    const [init] = module!.inits
    const decl = init!.body.body[0]!
    expect(decl.k === "let" && decl.local.global).toBe(true)
  })

  test("constants of literals are known before any code runs", () => {
    ok("let a: u8 = N; let b: f32 = N", "const N = 200")
    expect(errors("let a: u8 = N", "const N = 300")[0]).toContain("overflows")
  })

  test("'return' needs a function", () => {
    expect(program("return").diagnostics.map((d) => d.message)[0]).toContain("'return' is only allowed in a function")
  })
})

describe("contextual types", () => {
  test("branches of ?: take an expected literal union", () => {
    ok('const a: Dir = n > 0 ? "up" : "down"', 'type Dir = "up" | "down"\nconst n = 1')
    expect(errors('const a: Dir = n > 0 ? "up" : "left"', 'type Dir = "up" | "down"\nconst n = 1')[0]).toContain("'Dir'")
  })

  test("messages name a union by its alias", () => {
    expect(errors('const k: Kind = "c"', 'type Kind = "a" | "b"')).toEqual(["Type 'string' is not assignable to type 'Kind'."])
  })
})
