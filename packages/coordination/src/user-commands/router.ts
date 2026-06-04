// packages/coordination/src/user-commands/router.ts
//
// Translates human chat messages into agent tasks. The Phase 5 human
// ↔ swarm bridge: a user types `/submit code Build me a hello-world
// HTTP server in Rust` in a Telegram chat, the router parses it,
// hands it to a CoordinationDaemon as a task, and replies in the
// same chat when the task completes.
//
// Designed against the TelegramClient interface (chatId/senderId/text)
// so the same router can ride any text-message channel by satisfying
// that contract — Discord, Slack, IRC, etc.
//
// Trust model:
//   - allowedChats: only chats in this set can issue commands.
//     Empty = nothing allowed (default-deny).
//   - The CoordinationDaemon is the authority for what happens after
//     submission. The router has no privileged access to state.

import type { A2AMessage, Task, TaskInput } from '../types.js'
import type { TelegramClient } from '../transport/telegram.js'
import type { A2ATransport } from '../transport/types.js'

export interface UserCommandRouterConfig {
  client: TelegramClient
  /**
   * Bound to the daemon's submit() method. Inverting the dependency
   * keeps the router from knowing about the full daemon surface —
   * easier to test, and tomorrow's "submit goes through main agent
   * with approval workflow" can be slotted in without changing the
   * router's shape.
   */
  submit: (input: TaskInput) => Promise<Task>
  /**
   * Used for /status — read-only lookup against the daemon's local
   * store. Returns null when the task doesn't exist locally.
   */
  getTask: (taskId: string) => Task | null
  /**
   * Used to subscribe to task.complete / task.requeued / task.cancel
   * broadcasts so the router can reply when a previously-submitted
   * task finishes. Pass the daemon's transport.
   */
  transport: A2ATransport
  /** Chats permitted to issue commands. Default-deny if empty. */
  allowedChats: ReadonlySet<string | number>
  /** Command prefix. Default '/'. */
  commandPrefix?: string
}

export interface UserCommandRouter {
  stop(): Promise<void>
  /** Currently-tracked taskId → chatId mappings (test introspection). */
  pendingReplies(): Map<string, string | number>
}

interface ParsedCommand {
  name: string
  args: string[]
  /** The original raw text after the command name. */
  rest: string
}

export function createUserCommandRouter(config: UserCommandRouterConfig): UserCommandRouter {
  const { client, submit, getTask, transport, allowedChats } = config
  const prefix = config.commandPrefix ?? '/'

  /** taskId → chatId that submitted it. Pruned on task completion / requeue terminal. */
  const pending = new Map<string, string | number>()

  const send = (chatId: string | number, text: string) =>
    client.sendMessage({ chatId, text }).catch(() => { /* swallow — user already moved on */ })

  // ── inbound: parse + dispatch commands ────────────────────────────

  const unsubscribeFromClient = client.onMessage((msg) => {
    if (!allowedChats.has(msg.chatId)) return // default-deny
    if (!msg.text.startsWith(prefix)) return  // not a command — ignore
    const parsed = parseCommand(msg.text, prefix)
    if (!parsed) return

    switch (parsed.name) {
      case 'submit': return handleSubmit(parsed, msg.chatId)
      case 'status': return handleStatus(parsed, msg.chatId)
      case 'help':   return handleHelp(msg.chatId)
      default:
        void send(msg.chatId, `Unknown command: ${prefix}${parsed.name}. Try ${prefix}help.`)
        return
    }
  })

  // ── outbound: reply when a tracked task terminates ───────────────

  const unsubscribeFromTransport = transport.subscribe((amsg: A2AMessage) => {
    switch (amsg.kind) {
      case 'task.complete': {
        const { task } = amsg.payload as { task: Task }
        const chatId = pending.get(task.id)
        if (chatId === undefined) return
        pending.delete(task.id)
        const resultText = stringifyResult(task.result)
        void send(chatId, `✅ Task ${task.id} done.\n${resultText}`)
        return
      }
      case 'task.cancel': {
        const { task } = amsg.payload as { task: Task }
        const chatId = pending.get(task.id)
        if (chatId === undefined) return
        pending.delete(task.id)
        void send(chatId, `🛑 Task ${task.id} cancelled.\n${task.failureReason ?? ''}`.trim())
        return
      }
      default: return
    }
  })

  // ── handlers ─────────────────────────────────────────────────────

  function handleSubmit(parsed: ParsedCommand, chatId: string | number): void {
    if (parsed.args.length < 2) {
      void send(chatId, `Usage: ${prefix}submit <kind> <description>`)
      return
    }
    const kind = parsed.args[0]
    const description = parsed.rest.slice(kind.length).trim()
    if (description.length === 0) {
      void send(chatId, `Usage: ${prefix}submit <kind> <description>`)
      return
    }
    // Fire and forget — the router's reply happens on task.complete.
    void submit({
      kind,
      payload: { request: description },
    }).then((task) => {
      pending.set(task.id, chatId)
      void send(chatId, `📨 Submitted ${task.id} (kind=${kind}).`)
    }).catch((err: Error) => {
      void send(chatId, `⚠️ Failed to submit: ${err.message}`)
    })
  }

  function handleStatus(parsed: ParsedCommand, chatId: string | number): void {
    if (parsed.args.length !== 1) {
      void send(chatId, `Usage: ${prefix}status <taskId>`)
      return
    }
    const task = getTask(parsed.args[0])
    if (!task) {
      void send(chatId, `Task ${parsed.args[0]} not found.`)
      return
    }
    const lines = [
      `Task ${task.id}`,
      `  state: ${task.state}`,
      `  kind:  ${task.kind}`,
      task.ownerAgentId ? `  owner: ${task.ownerAgentId}` : null,
      task.retryCount > 0 ? `  retries: ${task.retryCount}/${task.maxRetries}` : null,
      task.failureReason ? `  reason: ${task.failureReason}` : null,
    ].filter(Boolean)
    void send(chatId, lines.join('\n'))
  }

  function handleHelp(chatId: string | number): void {
    void send(chatId, [
      `Coastal.AI swarm — available commands:`,
      `  ${prefix}submit <kind> <description>  — queue a task`,
      `  ${prefix}status <taskId>              — look up a task's current state`,
      `  ${prefix}help                         — show this message`,
    ].join('\n'))
  }

  // ── lifecycle ────────────────────────────────────────────────────

  return {
    async stop(): Promise<void> {
      unsubscribeFromClient()
      unsubscribeFromTransport()
      pending.clear()
    },
    pendingReplies(): Map<string, string | number> {
      return new Map(pending)
    },
  }
}

// ─── parsing ───────────────────────────────────────────────────────

function parseCommand(text: string, prefix: string): ParsedCommand | null {
  const raw = text.slice(prefix.length).trim()
  if (!raw) return null
  const firstSpace = raw.indexOf(' ')
  if (firstSpace === -1) {
    return { name: raw.toLowerCase(), args: [], rest: '' }
  }
  const name = raw.slice(0, firstSpace).toLowerCase()
  const rest = raw.slice(firstSpace + 1).trim()
  const args = rest.split(/\s+/).filter(Boolean)
  return { name, args, rest }
}

function stringifyResult(result: unknown): string {
  if (result === null || result === undefined) return '(no result)'
  if (typeof result === 'string') return result.slice(0, 1500)
  try {
    return JSON.stringify(result, null, 2).slice(0, 1500)
  } catch {
    return '(unstringifiable result)'
  }
}
