import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import type { GateDecision } from './types.js'
import type { TrustLevel } from '../config.js'

const APPROVAL_TIMEOUT_MS = Number(process.env.CC_APPROVAL_TIMEOUT_MS ?? 300_000)

export class PermissionGate {
  private pendingApprovals = new Map<string, { resolve: (d: 'approved' | 'denied' | 'timeout') => void }>()

  constructor(private db: Database.Database) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_always_allow (
        agent_id  TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        PRIMARY KEY (agent_id, tool_name)
      )
    `)
  }

  evaluate(
    agentId: string,
    toolName: string,
    reversible: boolean,
    permittedTools?: string[],
    trustLevel?: TrustLevel,
  ): GateDecision {
    // Step 1: check permitted list
    if (!permittedTools || !permittedTools.includes(toolName)) return 'block'

    // Step 2: in autonomous mode, auto-allow all permitted tools
    if (trustLevel === 'autonomous') return 'allow'

    // Step 3: if reversible, allow
    if (reversible) return 'allow'

    // Step 4: check always-allow
    const alwaysAllow = this.db
      .prepare('SELECT 1 FROM agent_always_allow WHERE agent_id = ? AND tool_name = ?')
      .get(agentId, toolName)
    if (alwaysAllow) return 'allow'

    return 'queued'
  }

  setAlwaysAllow(agentId: string, toolName: string): void {
    this.db
      .prepare('INSERT OR IGNORE INTO agent_always_allow (agent_id, tool_name) VALUES (?, ?)')
      .run(agentId, toolName)
  }

  createPendingApproval(): { approvalId: string; promise: Promise<'approved' | 'denied' | 'timeout'> } {
    const approvalId = randomUUID()
    const promise = new Promise<'approved' | 'denied' | 'timeout'>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingApprovals.delete(approvalId)
        resolve('timeout')
      }, APPROVAL_TIMEOUT_MS)

      this.pendingApprovals.set(approvalId, {
        resolve: (decision) => {
          clearTimeout(timer)
          this.pendingApprovals.delete(approvalId)
          resolve(decision)
        },
      })
    })
    return { approvalId, promise }
  }

  resolveApproval(approvalId: string, decision: 'approved' | 'denied'): boolean {
    const pending = this.pendingApprovals.get(approvalId)
    if (!pending) return false
    pending.resolve(decision)
    return true
  }
}
