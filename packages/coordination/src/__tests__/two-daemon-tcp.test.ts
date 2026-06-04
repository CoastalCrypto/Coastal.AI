// packages/coordination/src/__tests__/two-daemon-tcp.test.ts
//
// The Phase 2 milestone: same end-to-end scenarios as
// two-daemon-handoff.test.ts, but over real TCP sockets instead of the
// in-memory bus. Proves the CoordinationDaemon code is transport-
// agnostic — swap the transport and everything still works.
//
// Validates the path that Phase 2 will use between a laptop and a
// BC-250 (two physical machines, same A2A protocol).

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type Database from 'better-sqlite3'
import {
  openCoordinationDb, TaskStore, ClaimStore,
  generateIdentity, createPeerRegistry,
  createTcpTransport, type TcpTransport,
  CoordinationDaemon,
} from '../index.js'

function wait(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

describe('two-daemon TCP e2e (Phase 2 milestone)', () => {
  let db: Database.Database
  let tasks: TaskStore
  let claims: ClaimStore

  let mainTransport: TcpTransport
  let coderTransport: TcpTransport
  let main: CoordinationDaemon
  let coder: CoordinationDaemon

  beforeEach(async () => {
    db = openCoordinationDb()
    tasks = new TaskStore(db)
    claims = new ClaimStore(db)

    const mainId = generateIdentity('main')
    const coderId = generateIdentity('coder')

    mainTransport = await createTcpTransport({
      identity: mainId,
      port: 0,
      bindAddress: '127.0.0.1',
      peerRegistry: createPeerRegistry(),
    })
    coderTransport = await createTcpTransport({
      identity: coderId,
      port: 0,
      bindAddress: '127.0.0.1',
      peerRegistry: createPeerRegistry(),
    })

    // Wire mutual outbound — each side dials the other.
    mainTransport.addPeer({
      agentId: 'coder', address: '127.0.0.1', port: coderTransport.getServerPort(),
    })
    coderTransport.addPeer({
      agentId: 'main', address: '127.0.0.1', port: mainTransport.getServerPort(),
    })
    await wait(50) // let the sockets establish

    main = new CoordinationDaemon({
      identity: mainId,
      transport: mainTransport,
      db, tasks, claims,
      worker: async () => { throw new Error('Main should not run tasks') },
      heartbeatIntervalMs: 0,
    })

    coder = new CoordinationDaemon({
      identity: coderId,
      transport: coderTransport,
      db, tasks, claims,
      worker: async (task) => ({ tcp_processed: task.payload }),
      shouldClaim: (t) => t.kind === 'demo',
      heartbeatIntervalMs: 0,
    })
  })

  afterEach(async () => {
    await main.stop()
    await coder.stop()
  })

  it('main submits, coder auto-claims via TCP, runs, completes', async () => {
    const submitted = await main.submit({ kind: 'demo', payload: { x: 99 } })
    // Allow time for: signing → write to socket → coder reads → verifies →
    // dispatches → worker runs → response written → main reads.
    await wait(200)

    const final = tasks.get(submitted.id)!
    expect(final.state).toBe('done')
    expect(final.result).toEqual({ tcp_processed: { x: 99 } })

    const history = claims.history(submitted.id)
    expect(history).toHaveLength(1)
    expect(history[0].agentId).toBe('coder')
    expect(history[0].releaseReason).toBe('completed')
  })

  it('coder ignores tasks not matching its policy', async () => {
    const submitted = await main.submit({ kind: 'review', payload: null })
    await wait(150)
    expect(tasks.get(submitted.id)?.state).toBe('queued')
    expect(claims.history(submitted.id)).toEqual([])
  })

  it('broadcast task.available is signed and verified end-to-end over TCP', async () => {
    // Watch all messages reaching the coder's transport
    const received: string[] = []
    coderTransport.subscribe(msg => received.push(msg.kind))

    await main.submit({ kind: 'demo', payload: null })
    await wait(150)

    expect(received).toContain('task.available')
  })
})
