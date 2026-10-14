// Files imported as text (`with { type: "text" }`): Ore sources and C headers
// that the compiler embeds.
declare module "*.ore" {
  const text: string
  export default text
}

declare module "*.h" {
  const text: string
  export default text
}

declare module "*.c" {
  const text: string
  export default text
}
