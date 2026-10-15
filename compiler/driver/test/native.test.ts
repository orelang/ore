import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { libDir, nativeCode } from "../src"

test("libDirs: paths relative to the package, commands, missing ones skipped", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ore-native-")))
  mkdirSync(join(root, "lib"))
  mkdirSync(join(root, "vendor/lib"), { recursive: true })
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({
      name: "native",
      ore: {
        link: ["m", "z", "m"],
        sources: ["c/a.c"],
        libDirs: ["lib", "missing", `$(echo ${join(root, "vendor/lib")})`, "$(false)", "$(no-such-command-ore)", "lib"],
      },
    }),
  )
  writeFileSync(join(root, "main.ore"), "")
  expect(nativeCode([join(root, "main.ore")])).toEqual({
    link: ["m", "z"],
    sources: [join(root, "c/a.c")],
    libDirs: [join(root, "lib"), join(root, "vendor/lib")],
  })
  expect(libDir(root, "/")).toBe("/")
  expect(libDir(root, "$(true)")).toBeUndefined()
})
