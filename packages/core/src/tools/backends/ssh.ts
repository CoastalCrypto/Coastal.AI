// packages/core/src/tools/backends/ssh.ts
import { readFileSync } from 'node:fs'
import { Client } from 'ssh2'
import type { ShellBackend, ShellResult } from './types.js'

export interface SshBackendOptions {
  host: string
  port: number
  username: string
  privateKeyPath: string
}

// ssh2's own default (20s) is fine for a one-off interactive connection but
// too slow for a tool call an agent is waiting on — fail fast instead, same
// spirit as DockerBackend.isAvailable()'s explicit 5s execSync timeout.
const CONNECT_TIMEOUT_MS = 10_000

/** Wraps a path in single quotes for a POSIX shell, escaping any embedded single quotes. */
function shellQuote(path: string): string {
  return `'${path.replace(/'/g, `'\\''`)}'`
}

/**
 * Remote equivalent of NativeBackend — full, unrestricted shell access on a
 * pre-configured SSH host instead of the local machine. One connection is
 * opened lazily and reused across calls (see dispose()) rather than
 * reconnecting per command.
 */
export class SshBackend implements ShellBackend {
  readonly name = 'ssh'
  private client: Client | null = null
  private connecting: Promise<Client> | null = null

  constructor(private readonly opts: SshBackendOptions) {}

  private connect(): Promise<Client> {
    if (this.client) return Promise.resolve(this.client)
    if (this.connecting) return this.connecting

    this.connecting = new Promise((resolve, reject) => {
      const client = new Client()
      client.on('ready', () => {
        this.client = client
        this.connecting = null
        resolve(client)
      })
      client.on('error', (err) => {
        this.client = null
        this.connecting = null
        reject(err)
      })
      client.connect({
        host: this.opts.host,
        port: this.opts.port,
        username: this.opts.username,
        privateKey: readFileSync(this.opts.privateKeyPath),
        readyTimeout: CONNECT_TIMEOUT_MS,
      })
    })
    return this.connecting
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.connect()
      return true
    } catch {
      return false
    }
  }

  async execute(
    cmd: string,
    workdir: string,
    _sessionId: string,
    timeoutMs = 30_000,
  ): Promise<ShellResult> {
    let client: Client
    try {
      client = await this.connect()
    } catch (err: any) {
      return { stdout: `Error: could not connect to ${this.opts.host}: ${err.message}`, exitCode: 1, timedOut: false }
    }

    const remoteCmd = `cd ${shellQuote(workdir)} && ${cmd}`

    return new Promise((resolve_) => {
      client.exec(remoteCmd, (err, stream) => {
        if (err) {
          resolve_({ stdout: `Error: exec failed: ${err.message}`, exitCode: 1, timedOut: false })
          return
        }

        let stdout = ''
        let stderr = ''
        let settled = false

        const timer = setTimeout(() => {
          settled = true
          stream.close()
          resolve_({
            stdout: `${stdout}${stderr}\n(remote command timed out after ${timeoutMs}ms)`,
            exitCode: 124,
            timedOut: true,
          })
        }, timeoutMs)

        stream.on('data', (d: Buffer) => { stdout += d.toString() })
        stream.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
        stream.on('close', (code: number | null) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve_({ stdout: stdout + stderr, exitCode: code ?? 0, timedOut: false })
        })
      })
    })
  }

  async dispose(): Promise<void> {
    if (this.client) {
      this.client.end()
      this.client = null
    }
    this.connecting = null
  }
}
