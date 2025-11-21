declare module "@wcjiang/whereis" {
  function whereis(command: string): Promise<string | null>
  export default whereis
}
