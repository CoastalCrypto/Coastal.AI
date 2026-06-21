import { z } from 'zod'
import { readFileSync } from 'node:fs'

export const NodeRole = z.enum([
  'main', 'coder', 'reviewer', 'tester', 'designer', 'researcher',
  'writer', 'trader', 'curator', 'monitor', 'sandbox', 'voice',
])
export type NodeRole = z.infer<typeof NodeRole>

export const NodeConfig = z.object({
  schema: z.literal('coastal-node-config/v1'),
  nodeId: z.string().min(1),
  role: NodeRole,
  curatorNodeId: z.string().min(1),
  paths: z.object({
    dataDir: z.string().min(1),
    identity: z.string().min(1),
    sharedVault: z.string().min(1),
    inbox: z.string().min(1),
    inboxBase: z.string().min(1),
  }),
  address: z.string().min(1),
})
export type NodeConfig = z.infer<typeof NodeConfig>

export const RosterEntry = z.object({
  nodeId: z.string().min(1),
  role: NodeRole,
  pubkey: z.string().min(1),
  deviceId: z.string().min(1),
  address: z.string().min(1),
})
export type RosterEntry = z.infer<typeof RosterEntry>
export const PublicTuple = RosterEntry

export const Roster = z.object({
  schema: z.literal('coastal-roster/v1'),
  generatedAt: z.number(),
  nodes: z.array(RosterEntry).min(1),
})
  .refine(r => new Set(r.nodes.map(n => n.nodeId)).size === r.nodes.length, {
    message: 'roster has duplicate nodeIds',
  })
  .refine(r => r.nodes.filter(n => n.role === 'curator').length === 1, {
    message: 'roster must have exactly one curator',
  })
export type Roster = z.infer<typeof Roster>

export function loadNodeConfig(path: string): NodeConfig {
  return NodeConfig.parse(JSON.parse(readFileSync(path, 'utf8')))
}
export function loadRoster(path: string): Roster {
  return Roster.parse(JSON.parse(readFileSync(path, 'utf8')))
}
