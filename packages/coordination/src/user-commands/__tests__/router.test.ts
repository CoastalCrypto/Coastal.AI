// packages/coordination/src/user-commands/__tests__/router.test.ts

import { describe, it, expect, beforeEach } from 'vitest'
import {
  createUserCommandRouter, type UserCommandRouter,
} from '../router.js'
import type {
  TelegramClient, TelegramOutgoing, TelegramIncoming,
} from '../../transport/telegram.js'
import type { A2AMessage, Task, TaskInput } from '../../types.js'
import type { A2ATransport } from '../../transport/types.js'

// ─── stubs ────────────────────────────────────────────────────────

class StubTelegramClient implements TelegramClient {
  private incomingHandlers = new Set<(msg: TelegramIncoming) => void>()
  public sent: TelegramOutgoing[] = []

  async sendMessage(msg: TelegramOutgoing): Promise<void> {
    this.sent.push(msg)
  }
  onMessage(handler: (msg: TelegramIncoming) => void): () => void {
    this.incomingHandlers.add(handler)
    return () => this.incomingHandlers.delete(handler)
  }
  async close(): Promise<void> {
    this.incomingHandlers.clear()
  }
  /** Test helper — simulate an incoming chat message. */
  receive(msg: TelegramIncoming): void {
    for (const h of this.incomingHandlers) h(msg)
  }
}

class StubTransport implements A2ATransport {
  private subscribers = new Set<(msg: A2AMessage) => void>()
  async send(_msg: A2AMessage): Promise<void> { /* noop */ }
  subscribe(handler: (msg: A2AMessage) => void): () => void {
    this.subscribers.add(handler)
    return () => this.subscribers.delete(handler)
  }
  async close(): Promise<void> {
    this.subscribers.clear()
  }
  /** Test helper — simulate a broadcast. */
  fire(msg: A2AMessage): void {
    for (const s of this.subscribers) s(msg)
  }
}

function makeTask(props: Partial<Task> = {}): Task {
  return {
    id: 'task-A',
    state: 'queued',
    kind: 'code_task',
    payload: { request: 'hi' },
    result: null,
    failureReason: null,
    ownerAgentId: null,
    retryCount: 0,
    maxRetries: 3,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    parentTaskId: null,
    ...props,
  }
}

function makeBroadcast(kind: A2AMessage['kind'], payload: unknown): A2AMessage {
  return {
    version: '0.1',
    messageId: 'm-1',
    from: { agentId: 'coder', publicKey: 'pk' },
    to: '*',
    timestamp: Date.now(),
    kind,
    payload,
    signature: 'sig',
  }
}

function flush(): Promise<void> {
  return new Promise(r => setTimeout(r, 5))
}

// ─── tests ────────────────────────────────────────────────────────

describe('createUserCommandRouter', () => {
  let client: StubTelegramClient
  let transport: StubTransport
  let submitted: TaskInput[]
  let getTaskReturn: Task | null
  let router: UserCommandRouter

  beforeEach(() => {
    client = new StubTelegramClient()
    transport = new StubTransport()
    submitted = []
    getTaskReturn = null
    router = createUserCommandRouter({
      client,
      transport,
      submit: async (input) => {
        submitted.push(input)
        return makeTask({ id: 'task-X', kind: input.kind, payload: input.payload })
      },
      getTask: () => getTaskReturn,
      allowedChats: new Set([100, 200]),
    })
  })

  afterEach(async () => {
    await router.stop()
  })

  it('ignores messages from non-allowlisted chats', async () => {
    client.receive({ chatId: 999, senderTelegramId: 1, text: '/help' })
    await flush()
    expect(client.sent).toEqual([])
  })

  it('ignores non-command messages', async () => {
    client.receive({ chatId: 100, senderTelegramId: 1, text: 'just chatting' })
    await flush()
    expect(client.sent).toEqual([])
  })

  it('replies to /help with the command list', async () => {
    client.receive({ chatId: 100, senderTelegramId: 1, text: '/help' })
    await flush()
    expect(client.sent).toHaveLength(1)
    expect(client.sent[0].text).toContain('/submit')
    expect(client.sent[0].text).toContain('/status')
  })

  it('/submit creates a task and replies with task ID', async () => {
    client.receive({
      chatId: 100, senderTelegramId: 1,
      text: '/submit code_task Build a hello world server in Rust',
    })
    await flush()
    expect(submitted).toHaveLength(1)
    expect(submitted[0].kind).toBe('code_task')
    expect((submitted[0].payload as { request: string }).request)
      .toBe('Build a hello world server in Rust')
    expect(client.sent[client.sent.length - 1].text).toContain('task-X')
  })

  it('/submit rejects missing description', async () => {
    client.receive({ chatId: 100, senderTelegramId: 1, text: '/submit code_task' })
    await flush()
    expect(submitted).toHaveLength(0)
    expect(client.sent[0].text).toMatch(/Usage:/)
  })

  it('/status returns current state for a known task', async () => {
    getTaskReturn = makeTask({
      id: 'task-Y',
      state: 'claimed',
      ownerAgentId: 'coder',
      retryCount: 1,
    })
    client.receive({ chatId: 100, senderTelegramId: 1, text: '/status task-Y' })
    await flush()
    const reply = client.sent[0].text
    expect(reply).toContain('task-Y')
    expect(reply).toContain('claimed')
    expect(reply).toContain('coder')
    expect(reply).toContain('retries: 1/3')
  })

  it('/status replies "not found" for unknown task', async () => {
    getTaskReturn = null
    client.receive({ chatId: 100, senderTelegramId: 1, text: '/status nope' })
    await flush()
    expect(client.sent[0].text).toContain('not found')
  })

  it('/unknown gives a helpful hint', async () => {
    client.receive({ chatId: 100, senderTelegramId: 1, text: '/launch missiles' })
    await flush()
    expect(client.sent[0].text).toMatch(/Unknown command/)
    expect(client.sent[0].text).toMatch(/\/help/)
  })

  it('replies in the originating chat when task.complete broadcast arrives', async () => {
    client.receive({
      chatId: 100, senderTelegramId: 1,
      text: '/submit code_task make a thing',
    })
    await flush()
    expect(router.pendingReplies().get('task-X')).toBe(100)

    transport.fire(makeBroadcast('task.complete', {
      task: makeTask({ id: 'task-X', state: 'done', result: { output: 'done!' } }),
      claim: { id: 'c-1', taskId: 'task-X', agentId: 'coder', claimedAt: 0,
               lastHeartbeat: 0, releasedAt: 1, releaseReason: 'completed',
               handoffToAgentId: null },
    }))
    await flush()

    // First message is the submit ack, second is the completion reply
    const completeReply = client.sent[client.sent.length - 1]
    expect(completeReply.chatId).toBe(100)
    expect(completeReply.text).toContain('done')
    expect(completeReply.text).toContain('task-X')
    // Pending entry pruned
    expect(router.pendingReplies().has('task-X')).toBe(false)
  })

  it('ignores task.complete for untracked tasks (no reply spam)', async () => {
    const sentBefore = client.sent.length
    transport.fire(makeBroadcast('task.complete', {
      task: makeTask({ id: 'never-submitted-via-router', state: 'done' }),
      claim: { id: 'c-1', taskId: 'x', agentId: 'a', claimedAt: 0,
               lastHeartbeat: 0, releasedAt: 1, releaseReason: 'completed',
               handoffToAgentId: null },
    }))
    await flush()
    expect(client.sent.length).toBe(sentBefore)
  })

  it('honors a custom command prefix', async () => {
    await router.stop()
    router = createUserCommandRouter({
      client, transport,
      submit: async () => makeTask(),
      getTask: () => null,
      allowedChats: new Set([100]),
      commandPrefix: '!',
    })
    client.receive({ chatId: 100, senderTelegramId: 1, text: '!help' })
    await flush()
    expect(client.sent[0].text).toContain('!submit')
  })

  it('stop() detaches handlers', async () => {
    await router.stop()
    client.receive({ chatId: 100, senderTelegramId: 1, text: '/help' })
    transport.fire(makeBroadcast('task.complete', {
      task: makeTask({ id: 'whatever' }),
      claim: { id: 'c', taskId: 'whatever', agentId: 'a', claimedAt: 0,
               lastHeartbeat: 0, releasedAt: 1, releaseReason: 'completed',
               handoffToAgentId: null },
    }))
    await flush()
    expect(client.sent).toEqual([])
  })
})

// shim — vitest doesn't auto-import afterEach in this file
import { afterEach } from 'vitest'
