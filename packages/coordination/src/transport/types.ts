// packages/coordination/src/transport/types.ts
//
// The transport abstraction every A2A wire path implements. Phase 1
// ships the localhost in-memory bus; Phase 2 adds TCP + mDNS discovery;
// Phase 5 adds Telegram/Discord adapters. All three plug into this
// same interface, so the daemon code is transport-agnostic.

import type { A2AMessage } from '../types.js'

export interface A2ATransport {
  /**
   * Send a signed envelope. Resolves once the transport has accepted
   * the message for delivery (queued or sent). Does NOT wait for the
   * recipient to receive it — A2A is fire-and-forget at this layer.
   */
  send(msg: A2AMessage): Promise<void>

  /**
   * Subscribe to inbound messages. The handler is invoked for every
   * envelope addressed to this agent (or broadcast). Verification is
   * already performed by the transport — handlers only see messages
   * that passed signature checks.
   *
   * Returns an unsubscribe function.
   */
  subscribe(handler: (msg: A2AMessage) => void): () => void

  /** Release any resources (sockets, file handles, intervals). */
  close(): Promise<void>
}
