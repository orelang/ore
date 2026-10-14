// Optimizations on the IR, shared by the backends.
export { isCtor, planStack, type StackPlan } from "./escape"
export { inlineCalls } from "./inline"
