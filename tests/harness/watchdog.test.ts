/**
 * ORE_WATCHDOG: a program that makes no progress is reported, with the
 * scheduler's state and the stacks of its threads, and ends with status 3.
 */
import { build } from "@ore/driver"
import { expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

test("the watchdog reports a program blocked on its standard input", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ore-watchdog-"))
  writeFileSync(join(dir, "main.ore"), 'console.log("waiting")\nconst data = fs.read(0, 1)\nconsole.log(data instanceof Error)\n')
  const result = await build(join(dir, "main.ore"), { output: join(dir, "main") })
  expect(result.diagnostics).toEqual([])
  // Standard input is a pipe that nobody writes to or closes.
  const proc = Bun.spawn([join(dir, "main")], { stdin: "pipe", stdout: "pipe", stderr: "pipe", env: { ...process.env, ORE_WATCHDOG: "1", ORE_THREADS: "2" } })
  const [code, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  expect(code).toBe(3)
  // Output printed before the program got stuck is flushed.
  expect(stdout).toBe("waiting\n")
  expect(stderr).toContain("watchdog: no task ran and nothing was allocated for 1 s")
  expect(stderr).toContain("in blocking calls 1")
  expect(stderr).toContain("native stacks:")
  expect(stderr).toMatch(/fdRead/)
}, 60_000)

test("the watchdog lets a program that ends in time end", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ore-watchdog-"))
  writeFileSync(join(dir, "main.ore"), 'task.sleep(1500)\nconsole.log("done")\n')
  const result = await build(join(dir, "main.ore"), { output: join(dir, "main") })
  expect(result.diagnostics).toEqual([])
  const proc = Bun.spawn([join(dir, "main")], { stdout: "pipe", stderr: "pipe", env: { ...process.env, ORE_WATCHDOG: "3" } })
  const [code, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()])
  expect(code).toBe(0)
  expect(stdout).toBe("done\n")
}, 60_000)
