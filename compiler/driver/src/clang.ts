export class ToolError extends Error {}

/** Runs the C compiler (`$CC`, default `clang`) and throws with its output on failure. */
export async function clang(args: string[]): Promise<void> {
  const cc = process.env.CC ?? "clang"
  let proc: ReturnType<typeof Bun.spawn>
  try {
    proc = Bun.spawn([cc, ...args], { stdout: "pipe", stderr: "pipe" })
  } catch {
    throw new ToolError(`C compiler '${cc}' not found. Install clang or set $CC.`)
  }
  const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr as ReadableStream).text()])
  if (code !== 0) throw new ToolError(`${cc} failed (exit ${code}):\n${stderr}`)
}
