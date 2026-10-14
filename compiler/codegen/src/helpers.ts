// Pure functions of the emitter.
import * as ir from "@ore/ir"
import type { Type, UnionType } from "@ore/ir"

/** Whether a local lives in a box: captured by a closure and assigned after its declaration. */
export function boxed(local: ir.Local): boolean {
  return local.captured === true && local.assigned === true
}

/** Variables declared at the top level of modules: directly in their top-level code, or after a `using` there. */
export function findGlobals(module: ir.Module): ir.Local[] {
  const found: ir.Local[] = []
  const visit = (stmts: ir.Stmt[]) => {
    for (const s of stmts) {
      if ((s.k === "let" || s.k === "using") && s.local.global) found.push(s.local)
      if (s.k === "using") visit(s.body)
    }
  }
  for (const init of module.inits) visit(init.body.body)
  return found
}

/** The id of a struct in interface tables; never 0. */
export function typeId(s: ir.StructType): number {
  return s.id + 1
}

/** The member of a union that holds values of a type; a string literal also fits `string`. */
export function memberIndex(u: UnionType, type: Type): number {
  const exact = u.members.findIndex((m) => ir.sameType(m, type))
  if (exact !== -1 || type.kind !== "literal") return exact
  return u.members.findIndex((m) => m.kind === "string")
}
