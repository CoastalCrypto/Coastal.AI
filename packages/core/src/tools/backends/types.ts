// packages/core/src/tools/backends/types.ts
export interface ShellResult {
  stdout: string
  exitCode: number
  timedOut: boolean
}

export interface ShellBackend {
  readonly name: string
  isAvailable(): Promise<boolean>
  execute(
    cmd: string,
    workdir: string,
    sessionId: string,
    timeoutMs?: number,
  ): Promise<ShellResult>
  /** Tears down any persistent connection/resource. Only backends that hold one (e.g. SshBackend) implement this. */
  dispose?(): Promise<void>
}
