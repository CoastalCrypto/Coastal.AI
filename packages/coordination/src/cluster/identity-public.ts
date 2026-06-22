import type { AgentIdentity } from '../types.js'
import { RosterEntry, type NodeConfig, type RosterEntry as RosterEntryT } from './config.js'

/**
 * Build this node's public tuple (pass-1 output of the two-pass provisioning
 * flow). Only public material — nodeId/role/address from the baked node config,
 * the Ed25519 public key from the on-node identity, and the Syncthing device id.
 * The private key never appears here.
 */
export function buildPublicTuple(
  cfg: NodeConfig, identity: AgentIdentity, deviceId: string,
): RosterEntryT {
  return RosterEntry.parse({
    nodeId: cfg.nodeId, role: cfg.role,
    pubkey: identity.publicKey, deviceId, address: cfg.address,
  })
}
