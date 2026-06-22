import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  loadNodeConfig, loadRoster, assembleRoster, buildPublicTuple, bringNodeOnline,
  loadOrCreateIdentity, createPeerRegistry, createTcpTransport,
  createOpenObserveClient, openCoordinationDb,
  type FetchLike, type Roster,
} from '@coastal-ai/coordination'
import { NoteStore } from '@coastal-ai/core/memory/notes'
import { workerFor } from './worker-table.js'

const NODE_CONFIG_PATH = '/etc/coastal/node.json'
const ROSTER_PATH = '/etc/coastal/roster.json'

/** Pass-1: write this node's public tuple from its config + identity + Syncthing device id. */
function emitPublic(deviceId: string, out: string): void {
  const cfg = loadNodeConfig(NODE_CONFIG_PATH)
  const identity = loadOrCreateIdentity(cfg.nodeId, cfg.paths.identity)
  writeFileSync(out, JSON.stringify(buildPublicTuple(cfg, identity, deviceId), null, 2))
}

/** Provisioning: fold every staged public tuple into a validated roster. */
function assemble(stageDir: string, out: string): void {
  const tuples = readdirSync(stageDir)
    .filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(readFileSync(join(stageDir, f), 'utf8')) as unknown)
  writeFileSync(out, JSON.stringify(assembleRoster(tuples, Date.now()), null, 2))
}

/** Boot: bring this node fully online from /etc/coastal/{node,roster}.json. */
async function run(): Promise<void> {
  const cfg = loadNodeConfig(NODE_CONFIG_PATH)
  const roster: Roster = loadRoster(ROSTER_PATH)
  const registry = createPeerRegistry({ persistencePath: join(cfg.paths.dataDir, 'peers.json') })
  const db = openCoordinationDb({ dbPath: join(cfg.paths.dataDir, 'coordination.db') })
  const noteStore = new NoteStore({ dataDir: cfg.paths.dataDir })
  const identity = loadOrCreateIdentity(cfg.nodeId, cfg.paths.identity)

  const openobserve = createOpenObserveClient({
    baseUrl: process.env.COASTAL_OO_URL ?? 'http://127.0.0.1:5080',
    org: process.env.COASTAL_OO_ORG ?? 'default',
    auth: process.env.COASTAL_OO_AUTH ?? '',
    fetchImpl: fetch as unknown as FetchLike,
  })

  // createTcpTransport is async (resolves once listening), so build it up front
  // and hand the ready instance to the synchronous makeTransport hook.
  const listenPort = Number(cfg.address.split(':')[1])
  const transport = await createTcpTransport({
    identity,
    peerRegistry: registry,
    port: listenPort,
    initialPeers: roster.nodes
      .filter(n => n.nodeId !== cfg.nodeId)
      .map(n => {
        const [address, port] = n.address.split(':')
        return { agentId: n.nodeId, address, port: Number(port) }
      }),
  })

  const stUrl = process.env.COASTAL_ST_URL ?? 'http://127.0.0.1:8384'
  const stApiKey = process.env.COASTAL_ST_APIKEY ?? ''
  const handle = await bringNodeOnline(cfg, roster, {
    db, registry, openobserve, noteStore,
    syncthingHttp: async (method, path, body) => {
      const res = await fetch(`${stUrl}${path}`, {
        method,
        headers: { 'X-API-Key': stApiKey, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      return res.json().catch(() => ({}))
    },
    makeTransport: () => transport,
    workerFor,
    notify: (alerts) => { for (const a of alerts) console.warn(`[alert] ${a.severity} ${a.nodeId}: ${a.reason}`) },
  })
  process.on('SIGTERM', () => { void handle.stop().then(() => process.exit(0)) })
}

const [cmd, ...rest] = process.argv.slice(2)
if (cmd === 'emit-public') {
  const di = rest.indexOf('--device-id'); const oi = rest.indexOf('--out')
  emitPublic(rest[di + 1], rest[oi + 1])
} else if (cmd === 'assemble') {
  const oi = rest.indexOf('--out')
  assemble(rest[0], rest[oi + 1])
} else if (cmd === 'run') {
  void run()
} else {
  console.error('usage: coastal-cluster <emit-public --device-id ID --out PATH | assemble DIR --out PATH | run>')
  process.exit(1)
}
