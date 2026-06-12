export const SESSION_EXPIRED = 'SESSION_EXPIRED' as const

export interface Persona {
  agentName: string
  agentRole: string
  personality: string
  orgName: string
  orgContext: string
  ownerName: string
}

export interface SendMessageOptions {
  message: string
  sessionId?: string
  model?: string
  images?: string[]
}

export interface SendMessageResult {
  reply: string
  sessionId: string
  domain?: string
  model?: string
}

export interface ModelVariant {
  id: string
  quantLevel: string
  sizeGb: number
  addedAt: number
  active: boolean
}

export interface ModelGroup {
  baseName: string
  hfSource: string
  variants: ModelVariant[]
}

export interface OllamaModel {
  name: string
  sizeGb: number
  modifiedAt: string
  imported: boolean
}

export type RegistryUpdate = Record<string, Record<string, string>>

export interface AgentRecord {
  id: string
  name: string
  role: string
  builtIn: boolean
  active: boolean
}

export interface KnowledgeDoc {
  id: string
  title: string
  mimeType: string
  sizeBytes: number
  scope: string
  chunkCount: number
  contextDocIds: string[]
  sourceType: 'pdf' | 'docx' | 'text' | 'image' | 'other'
  createdAt: number
}

export interface AgentMemorySummary {
  contexts: number
  toolsUsed: number
  actions: number
  bindings: number
  lastActionAt: number | null
}

export interface SystemStats {
  cpu: { percent: number }
  mem: { total: number; used: number; free: number; cached: number }
  disk: Array<{ path: string; total: number; used: number; free: number }>
  gpu: { name: string; vramUsed: number; vramTotal: number; utilPercent: number } | null
  models: string[]
  uptime: number
}

export interface HardwareSummary {
  ramGb: number
  freeRamGb: number
  cpuCores: number
  vramGb: number | null
  gpuName: string | null
  diskFreeGb: number
  dataDir: string
}

export interface ModelRecommendation {
  model: string
  reason: string
  sizeGb: number
  tier: 'minimum' | 'recommended' | 'optimal'
}

export interface HardwareScan {
  hardware: HardwareSummary
  recommendations: ModelRecommendation[]
}

export interface Session {
  id: string
  title: string
  created_at: number
  updated_at: number
}

// Mirrors the seven architect user_profile knobs. Keep in sync with
// packages/core/src/architect/user-profile/store.ts — column enums.
export type PlanVerbosity = 'brief' | 'standard' | 'detailed'
export type AutoApproveThreshold = 'never' | 'low-risk-only' | 'aggressive'
export type TestStrictness = 'must-pass' | 'warn' | 'advisory'
export type GatePolicy = 'every-stage' | 'plan-only' | 'merge-only'
export type Tone = 'terse' | 'standard' | 'explanatory'
export type IterationPatience = 'stop-at-2' | 'stop-at-5' | 'stop-at-budget'
export type RiskPosture = 'conservative' | 'balanced' | 'experimental'

export interface UserProfile {
  id: string
  planVerbosity: PlanVerbosity
  autoApproveThreshold: AutoApproveThreshold
  testStrictness: TestStrictness
  gatePolicy: GatePolicy
  tone: Tone
  iterationPatience: IterationPatience
  riskPosture: RiskPosture
  createdAt: number
  updatedAt: number
}

export type UserProfilePatch = Partial<Omit<UserProfile, 'id' | 'createdAt' | 'updatedAt'>>

export interface PreferenceOption {
  value: string
  label: string
  rationale: string
}

export interface PreferenceQuestion {
  id: keyof UserProfilePatch
  prompt: string
  options: PreferenceOption[]
  default: string
}

// ── Notes / knowledge graph ────────────────────────────────────────────────
// CORE_NOTE_KINDS mirrors the kernel's CORE_KINDS in
// packages/core/src/memory/kinds-registry.ts. Vertical packages
// (trading-architect, future image-architect, etc.) register additional
// kinds at runtime, so the wire-level NoteKind is intentionally `string`
// — the web client renders any kind the server returns without compile-
// time gating. Use CORE_NOTE_KINDS when filtering UI to known-built-ins.
export const CORE_NOTE_KINDS = [
  'cycle', 'learning', 'code', 'design', 'eval',
  'dom', 'visual_diff', 'user',
] as const
export type CoreNoteKind = typeof CORE_NOTE_KINDS[number]
/** Wire-level kind: any string the registry has accepted server-side. */
export type NoteKind = string

/** @deprecated alias for CORE_NOTE_KINDS during the Tier-2 transition. */
export const NOTE_KINDS = CORE_NOTE_KINDS

export const LINK_KINDS = [
  'mentions', 'derives_from', 'contradicts', 'supersedes', 'contains',
] as const
export type LinkKind = typeof LINK_KINDS[number]

export interface NoteRecord {
  id: string
  title: string
  body: string
  kind: NoteKind
  sourceType: string | null
  sourceId: string | null
  createdAt: number
  updatedAt: number
}

export interface NoteLinkRecord {
  fromId: string
  toId: string
  kind: LinkKind
  createdAt: number
}

export interface NoteWithLinks {
  note: NoteRecord
  outgoing: NoteLinkRecord[]
  backlinks: NoteLinkRecord[]
}

export interface NoteSubgraph {
  nodes: NoteRecord[]
  edges: NoteLinkRecord[]
}

export interface MentionFeedbackRecord {
  target: string
  rejectedCount: number
  lastRejectedAt: number | null
}

export interface NoteCreateInput {
  title: string
  body: string
  kind: NoteKind
  sourceType?: string | null
  sourceId?: string | null
  id?: string
}

export type NotePatchInput = Partial<Omit<NoteCreateInput, 'id'>>

export class CoreClient {
  private baseUrl: string
  private sessionToken: string | undefined

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
    // Don't cache at construction — read fresh in adminHeaders() so user
    // sessions set after module load are picked up automatically.
  }

  /**
   * Safely extracts an error message from a failed response.
   * Reads body as text first to avoid "Unexpected end of JSON input" when
   * the server returns an empty or non-JSON error body.
   */
  private async extractError(res: Response, fallback: string): Promise<never> {
    let message = fallback
    try {
      const text = await res.text()
      if (text) {
        const json = JSON.parse(text)
        if (json.error) message = json.error
        else if (json.message) message = json.message
      }
    } catch {
      // body was not JSON — use fallback
    }
    throw new Error(message)
  }

  /** Exchange the raw admin token for a short-lived (24h) session token. */
  async login(adminToken: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: adminToken }),
    })
    if (!res.ok) throw new Error('Invalid admin token')
    const { sessionToken } = await res.json() as { sessionToken: string }
    this.sessionToken = sessionToken
    sessionStorage.setItem('cc_admin_session', sessionToken)
  }

  get isAuthenticated(): boolean {
    return Boolean(this.sessionToken ?? sessionStorage.getItem('cc_admin_session'))
  }

  /** Throw SESSION_EXPIRED if response is 401 so callers can redirect to login */
  private checkAuth(res: Response): void {
    if (res.status === 401) throw new Error(SESSION_EXPIRED)
  }

  private adminHeaders(): Record<string, string> {
    const token = this.sessionToken ?? sessionStorage.getItem('cc_admin_session') ?? ''
    return token ? { 'x-admin-session': token } : {}
  }

  async sendMessage(options: SendMessageOptions): Promise<SendMessageResult> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Chat request failed (${res.status}): ${text}`)
    }

    return res.json()
  }

  async listModels(): Promise<ModelGroup[]> {
    const res = await fetch(`${this.baseUrl}/api/admin/models`, {
      headers: this.adminHeaders(),
    })
    this.checkAuth(res)
    if (!res.ok) throw new Error(`Failed to list models (${res.status})`)
    return res.json()
  }

  async removeModel(quantId: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/admin/models/${encodeURIComponent(quantId)}`, {
      method: 'DELETE',
      headers: this.adminHeaders(),
    })
    this.checkAuth(res)
    if (!res.ok) throw new Error(`Failed to remove model (${res.status})`)
  }

  async addModel(hfModelId: string, quants: string[], sessionId: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/admin/models/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.adminHeaders() },
      body: JSON.stringify({ hfModelId, quants, sessionId }),
    })
    if (!res.ok) throw new Error(`Failed to start install (${res.status})`)
  }

  async listOllamaModels(): Promise<{ ollamaUrl: string; models: OllamaModel[]; error?: string }> {
    const res = await fetch(`${this.baseUrl}/api/admin/ollama/models`, {
      headers: this.adminHeaders(),
    })
    this.checkAuth(res)
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Failed to list Ollama models (${res.status}): ${text}`)
    }
    const data = await res.json() as { ollamaUrl: string; models: OllamaModel[]; error?: string }
    return data
  }

  async importOllamaModel(name: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/admin/ollama/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.adminHeaders() },
      body: JSON.stringify({ name }),
    })
    if (!res.ok) throw new Error(`Failed to import model (${res.status})`)
  }

  async syncOllamaModels(): Promise<{ synced: number }> {
    const res = await fetch(`${this.baseUrl}/api/admin/ollama/sync`, {
      method: 'POST',
      headers: this.adminHeaders(),
    })
    if (!res.ok) throw new Error(`Failed to sync Ollama models (${res.status})`)
    return res.json()
  }

  async pullOllamaModel(name: string, sessionId: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/admin/ollama/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.adminHeaders() },
      body: JSON.stringify({ name, sessionId }),
    })
    if (!res.ok) throw new Error(`Failed to start pull (${res.status}): ${await res.text()}`)
  }

  async getRegistry(): Promise<RegistryUpdate> {
    const res = await fetch(`${this.baseUrl}/api/admin/registry`, {
      method: 'GET',
      headers: this.adminHeaders(),
    })
    this.checkAuth(res)
    if (!res.ok) throw new Error(`Failed to get registry (${res.status})`)
    return res.json()
  }

  async updateRegistry(updates: RegistryUpdate): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/admin/registry`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...this.adminHeaders() },
      body: JSON.stringify(updates),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Failed to update registry (${res.status}): ${text}`)
    }
  }

  async getPersona(): Promise<{ persona: Persona; configured: boolean }> {
    const res = await fetch(`${this.baseUrl}/api/persona`)
    if (!res.ok) throw new Error(`Failed to get persona (${res.status})`)
    return res.json()
  }

  async getSystemStats(): Promise<SystemStats> {
    const res = await fetch(`${this.baseUrl}/api/system/stats`)
    if (!res.ok) throw new Error(`Failed to get system stats (${res.status})`)
    return res.json()
  }

  async getHardwareScan(): Promise<HardwareScan> {
    const res = await fetch(`${this.baseUrl}/api/admin/hardware-scan`, {
      headers: this.adminHeaders(),
    })
    if (!res.ok) throw new Error(`Hardware scan failed (${res.status})`)
    return res.json()
  }

  async getLogs(service?: string, lines?: number): Promise<{ service: string; lines: string[] }> {
    const params = new URLSearchParams()
    if (service) params.set('service', service)
    if (lines)   params.set('lines', String(lines))
    const res = await fetch(`${this.baseUrl}/api/admin/logs?${params}`, {
      headers: this.adminHeaders(),
    })
    if (!res.ok) throw new Error(`Failed to get logs (${res.status})`)
    return res.json()
  }

  async checkForUpdate(): Promise<{ updateAvailable: boolean; localCommit: string; remoteCommit: string | null }> {
    const res = await fetch(`${this.baseUrl}/api/admin/update-check`, { headers: this.adminHeaders() })
    if (!res.ok) return { updateAvailable: false, localCommit: 'unknown', remoteCommit: null }
    return res.json()
  }

  async triggerUpdate(): Promise<{ ok: boolean; message: string }> {
    const res = await fetch(`${this.baseUrl}/api/admin/update`, {
      method: 'POST',
      headers: this.adminHeaders(),
    })
    if (!res.ok) throw new Error(`Failed to trigger update (${res.status})`)
    return res.json()
  }

  async listSessions(limit?: number): Promise<{ sessions: Session[] }> {
    const params = limit ? `?limit=${limit}` : ''
    const res = await fetch(`${this.baseUrl}/api/sessions${params}`)
    if (!res.ok) throw new Error(`Failed to list sessions (${res.status})`)
    return res.json()
  }

  async uploadFile(file: File): Promise<{ filename: string; mimeType: string; size: number; text?: string; dataUrl?: string; isImage?: boolean }> {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(`${this.baseUrl}/api/upload`, { method: 'POST', body: form })
    if (!res.ok) await this.extractError(res, `Upload failed (${res.status})`)
    return res.json()
  }

  async runTeam(task: string, sessionId?: string): Promise<{ reply: string; subtaskCount: number; subtasks: Array<{ subtaskId: string; reply: string }> }> {
    const res = await fetch(`${this.baseUrl}/api/team/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task, sessionId }),
    })
    if (!res.ok) throw new Error(`Team run failed (${res.status})`)
    return res.json()
  }

  async deleteSession(id: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/sessions/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Delete session failed (${res.status}): ${text}`)
    }
  }

  async setPersona(updates: Partial<Persona>): Promise<{ persona: Persona; configured: boolean }> {
    const res = await fetch(`${this.baseUrl}/api/persona`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    if (!res.ok) throw new Error(`Failed to set persona (${res.status})`)
    return res.json()
  }

  async resolveApproval(
    approvalId: string,
    decision: 'approve' | 'deny' | 'always_allow',
    agentId: string,
    toolName: string,
  ): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/admin/approvals/${approvalId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.adminHeaders() },
      body: JSON.stringify({ decision, agentId, toolName }),
    })
    this.checkAuth(res)
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Resolve approval failed (${res.status}): ${text}`)
    }
  }

  async getAnalytics(): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/analytics`)
    if (!res.ok) throw new Error(`Analytics failed (${res.status})`)
    return res.json()
  }

  async listTools(): Promise<any[]> {
    const res = await fetch(`${this.baseUrl}/api/admin/tools`, { headers: this.adminHeaders() })
    if (!res.ok) throw new Error(`List tools failed (${res.status})`)
    return res.json()
  }

  async createTool(data: { name: string; description: string; parameters: string; implBody: string }): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/admin/tools`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.adminHeaders() },
      body: JSON.stringify(data),
    })
    if (!res.ok) throw new Error(`Create tool failed (${res.status}): ${await res.text()}`)
    return res.json()
  }

  async updateTool(id: string, data: Partial<{ name: string; description: string; parameters: string; implBody: string; enabled: boolean }>): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/admin/tools/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...this.adminHeaders() },
      body: JSON.stringify(data),
    })
    if (!res.ok) throw new Error(`Update tool failed (${res.status})`)
    return res.json()
  }

  async deleteTool(id: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/admin/tools/${id}`, {
      method: 'DELETE',
      headers: this.adminHeaders(),
    })
    this.checkAuth(res)
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Delete tool failed (${res.status}): ${text}`)
    }
  }

  async testTool(data: { implBody: string; parameters?: string; args?: Record<string, unknown> }): Promise<{ output: string; success: boolean }> {
    const res = await fetch(`${this.baseUrl}/api/admin/tools/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.adminHeaders() },
      body: JSON.stringify(data),
    })
    if (!res.ok) throw new Error(`Test failed (${res.status})`)
    return res.json()
  }

  async listChannels(): Promise<any[]> {
    const res = await fetch(`${this.baseUrl}/api/admin/channels`, { headers: this.adminHeaders() })
    if (!res.ok) throw new Error(`List channels failed (${res.status})`)
    return res.json()
  }

  async createChannel(data: { type: string; name: string; config: Record<string, string> }): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/admin/channels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.adminHeaders() },
      body: JSON.stringify(data),
    })
    if (!res.ok) throw new Error(`Create channel failed (${res.status}): ${await res.text()}`)
    return res.json()
  }

  async updateChannel(id: string, data: Partial<{ name: string; config: Record<string, string>; enabled: boolean }>): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/admin/channels/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...this.adminHeaders() },
      body: JSON.stringify(data),
    })
    if (!res.ok) throw new Error(`Update channel failed (${res.status})`)
    return res.json()
  }

  async deleteChannel(id: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/admin/channels/${id}`, {
      method: 'DELETE',
      headers: this.adminHeaders(),
    })
    this.checkAuth(res)
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Delete channel failed (${res.status}): ${text}`)
    }
  }

  async testChannel(id: string, message?: string): Promise<{ success: boolean; error?: string }> {
    const res = await fetch(`${this.baseUrl}/api/admin/channels/${id}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.adminHeaders() },
      body: JSON.stringify({ message }),
    })
    if (!res.ok) throw new Error(`Test channel failed (${res.status})`)
    return res.json()
  }

  async broadcastChannels(message: string): Promise<any[]> {
    const res = await fetch(`${this.baseUrl}/api/admin/channels/broadcast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.adminHeaders() },
      body: JSON.stringify({ message }),
    })
    if (!res.ok) throw new Error(`Broadcast failed (${res.status})`)
    return res.json()
  }

  // ── Architect ─────────────────────────────────────────────────────────────

  async architectStatus(): Promise<{ power: string; mode: string }> {
    const res = await fetch(`${this.baseUrl}/api/admin/architect/status`, { headers: this.adminHeaders() })
    this.checkAuth(res)
    if (!res.ok) throw new Error(`Architect status failed (${res.status})`)
    return res.json()
  }

  async architectWorkItems(status = 'all'): Promise<any[]> {
    const res = await fetch(`${this.baseUrl}/api/admin/architect/work-items?status=${status}`, { headers: this.adminHeaders() })
    this.checkAuth(res)
    if (!res.ok) throw new Error(`Failed to list work items (${res.status})`)
    return res.json()
  }

  async architectCreateWorkItem(data: { title: string; body?: string }): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/admin/architect/work-items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.adminHeaders() },
      body: JSON.stringify(data),
    })
    this.checkAuth(res)
    if (!res.ok) await this.extractError(res, `Create work item failed (${res.status})`)
    return res.json()
  }

  async architectPatchWorkItem(id: string, data: Record<string, unknown>): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/admin/architect/work-items/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...this.adminHeaders() },
      body: JSON.stringify(data),
    })
    this.checkAuth(res)
    if (!res.ok) await this.extractError(res, `Patch work item failed (${res.status})`)
    return res.json()
  }

  async architectActivity(limit = 50): Promise<any[]> {
    const res = await fetch(`${this.baseUrl}/api/admin/architect/activity?limit=${limit}`, { headers: this.adminHeaders() })
    this.checkAuth(res)
    if (!res.ok) throw new Error(`Activity failed (${res.status})`)
    return res.json()
  }

  async architectCycle(id: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/admin/architect/cycles/${id}`, { headers: this.adminHeaders() })
    this.checkAuth(res)
    if (!res.ok) throw new Error(`Cycle not found (${res.status})`)
    return res.json()
  }

  async architectApproval(cycleId: string, data: { gate: string; decision: string; comment?: string }): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/admin/architect/cycles/${cycleId}/approval`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.adminHeaders() },
      body: JSON.stringify(data),
    })
    this.checkAuth(res)
    if (!res.ok) await this.extractError(res, `Approval failed (${res.status})`)
    return res.json()
  }

  async architectSetPower(state: 'on' | 'off'): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/admin/architect/power`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.adminHeaders() },
      body: JSON.stringify({ state }),
    })
    this.checkAuth(res)
    if (!res.ok) throw new Error(`Power change failed (${res.status})`)
    return res.json()
  }

  async architectSetMode(mode: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/admin/architect/mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.adminHeaders() },
      body: JSON.stringify({ mode }),
    })
    this.checkAuth(res)
    if (!res.ok) throw new Error(`Mode change failed (${res.status})`)
    return res.json()
  }

  async architectRunNow(): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/admin/architect/run-now`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.adminHeaders() },
      body: JSON.stringify({}),
    })
    this.checkAuth(res)
    if (!res.ok) throw new Error(`Run-now failed (${res.status})`)
    return res.json()
  }

  async architectInsights(range = 30): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/admin/architect/insights?range=${range}`, { headers: this.adminHeaders() })
    this.checkAuth(res)
    if (!res.ok) throw new Error(`Insights failed (${res.status})`)
    return res.json()
  }

  async architectReceipts(): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/admin/architect/receipts`, { headers: this.adminHeaders() })
    this.checkAuth(res)
    if (!res.ok) throw new Error(`Receipts failed (${res.status})`)
    return res.json()
  }

  async architectGetUserProfile(): Promise<UserProfile> {
    const res = await fetch(`${this.baseUrl}/api/admin/architect/user-profile`, { headers: this.adminHeaders() })
    this.checkAuth(res)
    if (!res.ok) throw new Error(`User profile fetch failed (${res.status})`)
    return res.json()
  }

  async architectUpdateUserProfile(patch: UserProfilePatch): Promise<UserProfile> {
    const res = await fetch(`${this.baseUrl}/api/admin/architect/user-profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...this.adminHeaders() },
      body: JSON.stringify(patch),
    })
    this.checkAuth(res)
    if (!res.ok) await this.extractError(res, `User profile update failed (${res.status})`)
    return res.json()
  }

  async architectGetWizardQuestions(): Promise<{ questions: PreferenceQuestion[] }> {
    const res = await fetch(`${this.baseUrl}/api/admin/architect/user-profile/questions`, { headers: this.adminHeaders() })
    this.checkAuth(res)
    if (!res.ok) throw new Error(`Wizard questions fetch failed (${res.status})`)
    return res.json()
  }

  // ── Notes / knowledge graph ───────────────────────────────────────────────

  async listNotes(filter: { kind?: NoteKind; limit?: number; offset?: number } = {}): Promise<{ notes: NoteRecord[]; count: number }> {
    const params = new URLSearchParams()
    if (filter.kind) params.set('kind', filter.kind)
    if (filter.limit !== undefined) params.set('limit', String(filter.limit))
    if (filter.offset !== undefined) params.set('offset', String(filter.offset))
    const qs = params.toString()
    const res = await fetch(`${this.baseUrl}/api/admin/notes${qs ? '?' + qs : ''}`, { headers: this.adminHeaders() })
    this.checkAuth(res)
    if (!res.ok) throw new Error(`Notes list failed (${res.status})`)
    return res.json()
  }

  async getNote(id: string): Promise<NoteWithLinks> {
    const res = await fetch(`${this.baseUrl}/api/admin/notes/${encodeURIComponent(id)}`, { headers: this.adminHeaders() })
    this.checkAuth(res)
    if (!res.ok) await this.extractError(res, `Note fetch failed (${res.status})`)
    return res.json()
  }

  async getNoteSubgraph(id: string, depth = 1): Promise<NoteSubgraph> {
    const res = await fetch(`${this.baseUrl}/api/admin/notes/${encodeURIComponent(id)}/graph?depth=${depth}`, { headers: this.adminHeaders() })
    this.checkAuth(res)
    if (!res.ok) await this.extractError(res, `Note subgraph failed (${res.status})`)
    return res.json()
  }

  async createNote(input: NoteCreateInput): Promise<{ note: NoteRecord; mentioned: string[] }> {
    const res = await fetch(`${this.baseUrl}/api/admin/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.adminHeaders() },
      body: JSON.stringify(input),
    })
    this.checkAuth(res)
    if (!res.ok) await this.extractError(res, `Note create failed (${res.status})`)
    return res.json()
  }

  async updateNote(id: string, patch: NotePatchInput): Promise<{ note: NoteRecord; mentioned: string[] }> {
    const res = await fetch(`${this.baseUrl}/api/admin/notes/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...this.adminHeaders() },
      body: JSON.stringify(patch),
    })
    this.checkAuth(res)
    if (!res.ok) await this.extractError(res, `Note update failed (${res.status})`)
    return res.json()
  }

  async deleteNote(id: string): Promise<{ ok: true }> {
    const res = await fetch(`${this.baseUrl}/api/admin/notes/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: this.adminHeaders(),
    })
    this.checkAuth(res)
    if (!res.ok) await this.extractError(res, `Note delete failed (${res.status})`)
    return res.json()
  }

  async linkNotes(fromId: string, toId: string, kind: LinkKind = 'mentions'): Promise<{ link: NoteLinkRecord }> {
    const res = await fetch(`${this.baseUrl}/api/admin/notes/${encodeURIComponent(fromId)}/links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.adminHeaders() },
      body: JSON.stringify({ toId, kind }),
    })
    this.checkAuth(res)
    if (!res.ok) await this.extractError(res, `Link create failed (${res.status})`)
    return res.json()
  }

  /** Removing a 'mentions' edge here records user feedback that suppresses
   *  future auto-mentions of the target. Other link kinds are removed cleanly. */
  async unlinkNotes(fromId: string, toId: string, kind?: LinkKind): Promise<{ ok: true; removed: number }> {
    const url = `${this.baseUrl}/api/admin/notes/${encodeURIComponent(fromId)}/links/${encodeURIComponent(toId)}${kind ? `?kind=${kind}` : ''}`
    const res = await fetch(url, { method: 'DELETE', headers: this.adminHeaders() })
    this.checkAuth(res)
    if (!res.ok) await this.extractError(res, `Unlink failed (${res.status})`)
    return res.json()
  }

  async listMentionFeedback(): Promise<{ feedback: MentionFeedbackRecord[] }> {
    const res = await fetch(`${this.baseUrl}/api/admin/notes/policy/feedback`, { headers: this.adminHeaders() })
    this.checkAuth(res)
    if (!res.ok) throw new Error(`Feedback list failed (${res.status})`)
    return res.json()
  }

  async clearMentionFeedback(target: string): Promise<{ ok: true }> {
    const res = await fetch(`${this.baseUrl}/api/admin/notes/policy/feedback/${encodeURIComponent(target)}`, {
      method: 'DELETE',
      headers: this.adminHeaders(),
    })
    this.checkAuth(res)
    if (!res.ok) await this.extractError(res, `Feedback clear failed (${res.status})`)
    return res.json()
  }

  // ── Auth / Users ────────────────────────────────────────────────────────────

  async checkSetup(): Promise<{ needsSetup: boolean }> {
    const res = await fetch(`${this.baseUrl}/api/auth/setup`)
    if (!res.ok) throw new Error(`Setup check failed (${res.status})`)
    return res.json()
  }

  async setupFirstUser(username: string, password: string): Promise<{ sessionToken: string; user: any }> {
    const res = await fetch(`${this.baseUrl}/api/auth/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    if (!res.ok) await this.extractError(res, `Setup failed (${res.status})`)
    return res.json()
  }

  async loginUser(username: string, password: string): Promise<{ sessionToken: string; user: any }> {
    const res = await fetch(`${this.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    if (!res.ok) await this.extractError(res, `Login failed (${res.status})`)
    return res.json()
  }

  async getMe(): Promise<{ user: any }> {
    const res = await fetch(`${this.baseUrl}/api/auth/me`, { headers: this.adminHeaders() })
    if (!res.ok) throw new Error('Not authenticated')
    return res.json()
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<{ user: any }> {
    const res = await fetch(`${this.baseUrl}/api/auth/password`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...this.adminHeaders() },
      body: JSON.stringify({ currentPassword, newPassword }),
    })
    if (!res.ok) await this.extractError(res, `Failed (${res.status})`)
    return res.json()
  }

  setSession(token: string): void {
    this.sessionToken = token
    sessionStorage.setItem('cc_admin_session', token)
  }

  clearSession(): void {
    this.sessionToken = undefined
    sessionStorage.removeItem('cc_admin_session')
    sessionStorage.removeItem('cc_user')
  }

  async listAgents(): Promise<AgentRecord[]> {
    const res = await fetch(`${this.baseUrl}/api/admin/agents`, { headers: this.adminHeaders() })
    if (!res.ok) throw new Error(`Failed to list agents (${res.status})`)
    return res.json()
  }

  async getAgentMemorySummary(): Promise<Record<string, AgentMemorySummary>> {
    const res = await fetch(`${this.baseUrl}/api/admin/agents/memory-summary`, { headers: this.adminHeaders() })
    if (!res.ok) throw new Error(`Failed to load memory summary (${res.status})`)
    return res.json()
  }

  async ingestKnowledge(file: File, scope = 'global'): Promise<KnowledgeDoc> {
    const form = new FormData()
    form.append('file', file)
    form.append('scope', scope)
    const res = await fetch(`${this.baseUrl}/api/admin/knowledge/ingest`, {
      method: 'POST',
      headers: this.adminHeaders(),
      body: form,
    })
    this.checkAuth(res)
    if (!res.ok) await this.extractError(res, `Ingest failed (${res.status})`)
    return res.json()
  }

  async listKnowledge(): Promise<KnowledgeDoc[]> {
    const res = await fetch(`${this.baseUrl}/api/admin/knowledge`, { headers: this.adminHeaders() })
    this.checkAuth(res)
    if (!res.ok) throw new Error(`List knowledge failed (${res.status})`)
    return res.json()
  }

  async deleteKnowledge(id: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/admin/knowledge/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: this.adminHeaders(),
    })
    this.checkAuth(res)
    if (!res.ok) await this.extractError(res, `Delete knowledge failed (${res.status})`)
  }

  async voteEdgeFeedback(agentId: string, toolName: string, value: 1 | -1): Promise<{ score: number; weight: number }> {
    const res = await fetch(
      `${this.baseUrl}/api/admin/agents/${encodeURIComponent(agentId)}/tools/${encodeURIComponent(toolName)}/feedback`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.adminHeaders() },
        body: JSON.stringify({ value }),
      }
    )
    if (!res.ok) await this.extractError(res, `Failed to record feedback (${res.status})`)
    return res.json()
  }

  async listUsers(): Promise<any[]> {
    const res = await fetch(`${this.baseUrl}/api/admin/users`, { headers: this.adminHeaders() })
    if (!res.ok) throw new Error(`List users failed (${res.status})`)
    return res.json()
  }

  async createUser(username: string, password: string, role: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/admin/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.adminHeaders() },
      body: JSON.stringify({ username, password, role }),
    })
    if (!res.ok) await this.extractError(res, `Create user failed (${res.status})`)
    return res.json()
  }

  async updateUser(id: string, data: { role?: string; password?: string; username?: string }): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/admin/users/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...this.adminHeaders() },
      body: JSON.stringify(data),
    })
    if (!res.ok) throw new Error(`Update user failed (${res.status})`)
    return res.json()
  }

  async deleteUser(id: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/admin/users/${id}`, {
      method: 'DELETE',
      headers: this.adminHeaders(),
    })
    this.checkAuth(res)
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Delete user failed (${res.status}): ${text}`)
    }
  }

  async getTrustLevel(): Promise<'sandboxed' | 'trusted' | 'autonomous'> {
    const res = await fetch(`${this.baseUrl}/api/admin/trust-level`, { headers: this.adminHeaders() })
    if (!res.ok) throw new Error(`Failed to get trust level (${res.status})`)
    const { level } = await res.json() as { level: 'sandboxed' | 'trusted' | 'autonomous' }
    return level
  }

  async setTrustLevel(level: 'sandboxed' | 'trusted' | 'autonomous'): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/admin/trust-level`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...this.adminHeaders() },
      body: JSON.stringify({ level }),
    })
    if (!res.ok) throw new Error(`Failed to set trust level (${res.status})`)
  }

  async restartServer(): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/admin/restart`, {
      method: 'POST',
      headers: this.adminHeaders(),
    })
    if (!res.ok) throw new Error(`Failed to restart server (${res.status})`)
  }
}

// Core origin resolves the Tauri-injected dynamic sidecar port when present,
// otherwise the legacy dev/prod default. See platform/coreOrigin.ts.
import { coreHttpOrigin } from '../platform/coreOrigin'
const coreBaseUrl = coreHttpOrigin()
export const coreClient = new CoreClient(coreBaseUrl)
export const adminClient = new CoreClient(coreBaseUrl)
