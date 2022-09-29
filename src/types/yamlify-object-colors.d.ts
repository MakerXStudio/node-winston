// yamlify-object has been re-written in TS, yamlify-object-colors has not
declare module 'yamlify-object-colors' {
  type Colors = {
    base?(string: unknown): string
    date?(string: unknown): string
    error?(string: unknown): string
    symbol?(string: unknown): string
    string?(string: unknown): string
    number?(string: unknown): string
    boolean?(string: unknown): string
    regexp?(string: unknown): string
    null?(string: unknown): string
    undefined?(string: unknown): string
  }
  const colors: Colors
  export default colors
}
