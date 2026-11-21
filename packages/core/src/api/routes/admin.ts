import type { FastifyInstance } from 'fastify'
import { loadConfig, invalidateConfig } from '../../config.js'
import { ModelRegistry } from '../../models/registry.js'
import { QuantizationPipeline } from '../../models/quantizer.js'
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes, timingSafeEqual, createHmac } from 'node:crypto'

const SESSION_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

export function getOrCreateAdminToken(dataDir: string): string {
  const envToken = process.env.CC_ADMIN_TOKEN
  if (envToken) return envToken

  const tokenFile = join(dataDir, '.admin-token')
  if (existsSync(tokenFile)) return readFileSync(tokenFile, 'utf8').trim()

  const token = randomBytes(32).toString('hex')
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(tokenFile, token, { mode: 0o600 })
  console.log(`[coastal-ai] Admin token written to ${tokenFile}`)
  return token
}

function createSessionToken(adminToken: string): string {
  const expiry = Date.now() + SESSION_TTL_MS
  const nonce = randomBytes(16).toString('hex')
  const payload = `${expiry}:${nonce}`
  const sig = createHmac('sha256', adminToken).update(payload).digest('hex')
  return `${payload}:${sig}`
}

export function validateSessionToken(adminToken: string, sessionToken: string): boolean {
  try {
    const lastColon = sessionToken.lastIndexOf(':')
    if (lastColon === -1) return false
    const payload = sessionToken.slice(0, lastColon)
    const sig = sessionToken.slice(lastColon + 1)
    const expiry = Number(payload.split(':')[0])
    if (isNaN(expiry) || Date.now() > expiry) return false
    const expected = createHmac('sha256', adminToken).update(payload).digest('hex')
    const a = Buffer.from(sig, 'hex')
    const b = Buffer.from(expected, 'hex')
    return a.length === b.length && timingSafeEqual(a, b)
  } catch {
    return false
  }
}

export async function adminRoutes(fastify: FastifyInstance) {
  const config = loadConfig()
  const adminToken = getOrCreateAdminToken(config.dataDir)
  const modelRegistry = new ModelRegistry(config.dataDir)
  const registryPath = join(config.dataDir, 'model-registry.json')

  // POST /api/admin/login — validates admin token, returns a 24h session token
  // This route is intentionally exempt from the auth hook below
  fastify.post<{ Body: { token: string } }>('/api/admin/login', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['token'],
        properties: { token: { type: 'string' } },
      },
    },
  }, async (req, reply) => {
    const { token } = req.body
    const a = Buffer.from(token, 'utf8')
    const b = Buffer.from(adminToken, 'utf8')
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return reply.status(401).send({ error: 'Invalid admin token' })
    }
    return reply.send({ sessionToken: createSessionToken(adminToken) })
  })

  // Auth hook — accepts either x-admin-token (raw) or x-admin-session (login-derived)
  // Auth for all /api/admin routes is handled by the root-level hook in server.ts
  // (supports raw token, HMAC session, and user JWT with admin role).

  // GET /api/admin/models
  fastify.get('/api/admin/models', async () => {
    return modelRegistry.listGrouped()
  })

  // ── Ollama helpers ──────────────────────────────────────────────────────

  async function fetchOllamaModels(): Promise<Array<{ name: string; sizeGb: number; modifiedAt: string }>> {
    const res = await fetch(`${config.ollamaUrl}/api/tags`)
    if (!res.ok) throw new Error(`Ollama returned HTTP ${res.status} from ${config.ollamaUrl}`)
    const data = await res.json() as { models?: Array<{ name: string; size?: number; modified_at?: string }> }
    return (data.models ?? []).map((m) => ({
      name: m.name,
      sizeGb: m.size ? Math.round((m.size / 1e9) * 10) / 10 : 0,
      modifiedAt: m.modified_at ?? '',
    }))
  }

  function syncOllamaToRegistry(ollamaModels: Array<{ name: string; sizeGb: number }>) {
    const existing = modelRegistry.listActiveIds()
    for (const m of ollamaModels) {
      if (existing.has(m.name)) continue
      const baseName = m.name.split(':')[0]
      const tag = m.name.includes(':') ? m.name.split(':')[1] : 'latest'
      modelRegistry.register({
        id: m.name,
        hfSource: `ollama://${m.name}`,
        baseName,
        quantLevel: tag,
        sizeGb: m.sizeGb,
      })
    }
  }

  // ── Domain registry auto-bootstrap ──────────────────────────────────────────
  // If model-registry.json doesn't exist yet, auto-assign available Ollama models
  // to all four routing domains so local models work out of the box.
  function bootstrapDomainRegistry(ollamaModels: Array<{ name: string; sizeGb: number }>) {
    if (existsSync(registryPath)) return // user already configured
    if (ollamaModels.length === 0) return

    // Sort largest→smallest (bigger = more capable = higher priority)
    const sorted = [...ollamaModels].sort((a, b) => b.sizeGb - a.sizeGb)
    const high   = sorted[0].name
    const medium = (sorted[1] ?? sorted[0]).name
    const low    = (sorted[sorted.length - 1]).name

    const domains = ['coo', 'cfo', 'cto', 'general'] as const
    const reg: Record<string, Record<string, string>> = {}
    for (const d of domains) {
      reg[d] = { high, medium, low }
    }
    mkdirSync(config.dataDir, { recursive: true })
    writeFileSync(registryPath, JSON.stringify(reg, null, 2))
    console.log(`[coastal-ai] Auto-bootstrapped domain registry with ${ollamaModels.length} Ollama model(s). High-priority: ${high}`)
  }

  // Auto-sync Ollama models into registry on startup (best-effort)
  if (process.env.NODE_ENV !== 'test') {
    fetchOllamaModels()
      .then(models => { syncOllamaToRegistry(models); bootstrapDomainRegistry(models) })
      .catch((err: Error) => console.warn(`[coastal-ai] Ollama auto-sync skipped: ${err.message}`))
  }

  // GET /api/admin/ollama/models — list models currently pulled in Ollama
  fastify.get('/api/admin/ollama/models', async (_req, reply) => {
    try {
      const ollamaModels = await fetchOllamaModels()
      // Auto-sync any newly-found models into registry
      syncOllamaToRegistry(ollamaModels)
      const registered = modelRegistry.listActiveIds()
      return reply.send({
        ollamaUrl: config.ollamaUrl,
        models: ollamaModels.map(m => ({ ...m, imported: registered.has(m.name) })),
      })
    } catch (err: any) {
      return reply.status(503).send({
        ollamaUrl: config.ollamaUrl,
        error: err.message ?? 'Could not reach Ollama',
        models: [],
      })
    }
  })

  // POST /api/admin/ollama/import — import a locally-pulled Ollama model into the registry
  fastify.post<{ Body: { name: string } }>('/api/admin/ollama/import', {
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string' } },
      },
    },
  }, async (req, reply) => {
    const { name } = req.body
    const ollamaModels = await fetchOllamaModels()
    const found = ollamaModels.find(m => m.name === name)
    if (!found) return reply.status(404).send({ error: `Model "${name}" not found in Ollama` })
    syncOllamaToRegistry([found])
    return reply.send({ ok: true })
  })

  // POST /api/admin/ollama/sync — import ALL locally-pulled Ollama models into registry
  fastify.post('/api/admin/ollama/sync', async () => {
    const ollamaModels = await fetchOllamaModels()
    syncOllamaToRegistry(ollamaModels)
    return { synced: ollamaModels.length }
  })

  // POST /api/admin/ollama/pull — pull a model from Ollama hub with streaming progress
  fastify.post<{ Body: { name: string; sessionId: string } }>('/api/admin/ollama/pull', {
    schema: {
      body: {
        type: 'object',
        required: ['name', 'sessionId'],
        properties: {
          name: { type: 'string' },
          sessionId: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const { name, sessionId } = req.body

    if (!/^[a-zA-Z0-9_.:-]+(?:\/[a-zA-Z0-9_.:-]+)*$/.test(name)) {
      return reply.status(400).send({ error: 'Invalid model name' })
    }

    // Stream pull progress in background, broadcast via WebSocket
    ;(async () => {
      try {
        const res = await fetch(`${config.ollamaUrl}/api/pull`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, stream: true }),
        })
        if (!res.ok) {
          fastify.websocketServer?.clients.forEach((c: any) => {
            if (c._sessionId === sessionId) {
              c.send(JSON.stringify({ type: 'ollama_pull_error', name, error: `Ollama returned ${res.status}` }))
            }
          })
          return
        }
        const reader = res.body!.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const lines = buf.split('\n')
          buf = lines.pop() ?? ''
          for (const line of lines) {
            if (!line.trim()) continue
            try {
              const chunk = JSON.parse(line) as {
                status?: string
                completed?: number
                total?: number
                digest?: string
              }
              fastify.websocketServer?.clients.forEach((c: any) => {
                if (c._sessionId === sessionId) {
                  c.send(JSON.stringify({ type: 'ollama_pull_progress', name, ...chunk }))
                }
              })
            } catch { /* skip */ }
          }
        }
        // Auto-import into registry after successful pull
        const ollamaModels = await fetchOllamaModels()
        const pulled = ollamaModels.find(m => m.name === name || m.name.startsWith(`${name}:`))
        if (pulled) syncOllamaToRegistry([pulled])

        fastify.websocketServer?.clients.forEach((c: any) => {
          if (c._sessionId === sessionId) {
            c.send(JSON.stringify({ type: 'ollama_pull_done', name }))
          }
        })
      } catch (err: any) {
        fastify.websocketServer?.clients.forEach((c: any) => {
          if (c._sessionId === sessionId) {
            c.send(JSON.stringify({ type: 'ollama_pull_error', name, error: err.message }))
          }
        })
      }
    })()

    return reply.status(202).send({ message: 'Pull started', name })
  })

  // DELETE /api/admin/models/:quantId
  fastify.delete<{ Params: { quantId: string } }>('/api/admin/models/:quantId', async (req, reply) => {
    const { quantId } = req.params
    if (!modelRegistry.isActive(quantId)) {
      return reply.status(404).send({ error: `Model not found in registry: ${quantId}` })
    }
    // Remove from Ollama (best-effort)
    try {
      await fetch(`${config.ollamaUrl}/api/delete`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: quantId }),
      })
    } catch { /* Ollama may not be running */ }
    modelRegistry.deactivate(quantId)
    return reply.status(204).send()
  })

  // POST /api/admin/models/add
  fastify.post<{
    Body: { hfModelId: string; quants: ('Q4_K_M' | 'Q5_K_M' | 'Q8_0')[]; sessionId: string }
  }>('/api/admin/models/add', {
    schema: {
      body: {
        type: 'object',
        required: ['hfModelId', 'quants', 'sessionId'],
        properties: {
          hfModelId: { type: 'string' },
          quants: { type: 'array', items: { type: 'string', enum: ['Q4_K_M', 'Q5_K_M', 'Q8_0'] } },
          sessionId: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const { hfModelId, quants, sessionId } = req.body

    if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(hfModelId)) {
      return reply.status(400).send({ error: 'hfModelId must be in owner/repo format (e.g. org/model-name)' })
    }

    // Start pipeline in background
    const pipeline = new QuantizationPipeline({
      dataDir: config.dataDir,
      llamaCppDir: config.llamaCppDir,
      ollamaUrl: config.ollamaUrl,
      onProgress: (event) => {
        // Broadcast to the requesting WebSocket session
        fastify.websocketServer?.clients.forEach((client) => {
          if ((client as any)._sessionId === sessionId) {
            client.send(JSON.stringify(event))
          }
        })
      },
    })

    pipeline.run(hfModelId, quants).catch((err) => {
      console.error('[admin] quantization failed:', err.message)
    })

    return reply.status(202).send({ message: 'Pipeline started', hfModelId, quants })
  })

  // GET /api/admin/registry — returns current registry file contents
  fastify.get('/api/admin/registry', async (_req, reply) => {
    if (!existsSync(registryPath)) return reply.send({})
    try { 
      return reply.send(JSON.parse(readFileSync(registryPath, 'utf8'))) 
    } catch { 
      return reply.send({}) 
    }
  })

  // PATCH /api/admin/registry
  fastify.patch<{
    Body: Record<string, Record<string, string>>
  }>('/api/admin/registry', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: {
          type: 'object',
          additionalProperties: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const updates = req.body

    // Validate all model names exist in registry
    for (const [, urgencyMap] of Object.entries(updates)) {
      for (const [, modelId] of Object.entries(urgencyMap ?? {})) {
        if (!modelRegistry.isActive(modelId)) {
          return reply.status(422).send({ error: `Model not found in registry: ${modelId}` })
        }
      }
    }

    // Load existing registry
    let existing: Record<string, Record<string, string>> = {}
    if (existsSync(registryPath)) {
      try {
        const parsed: unknown = JSON.parse(readFileSync(registryPath, 'utf8'))
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          existing = parsed as Record<string, Record<string, string>>
        }
      } catch {}
    }

    // Merge and write (deep merge to preserve existing urgency keys within a domain)
    const merged: Record<string, Record<string, string>> = { ...existing }
    for (const [domain, urgencyMap] of Object.entries(updates)) {
      if (urgencyMap && typeof urgencyMap === 'object') {
        merged[domain] = { ...(merged[domain] ?? {}), ...(urgencyMap as Record<string, string>) }
      }
    }
    mkdirSync(config.dataDir, { recursive: true })
    writeFileSync(registryPath, JSON.stringify(merged, null, 2))

    return reply.send({ ok: true })
  })

  // PATCH /api/admin/trust-level — change the agent shell trust tier
  fastify.patch<{ Body: { level: 'sandboxed' | 'trusted' | 'autonomous' | 'remote' } }>(
    '/api/admin/trust-level',
    {
      schema: {
        body: {
          type: 'object',
          required: ['level'],
          properties: {
            level: { type: 'string', enum: ['sandboxed', 'trusted', 'autonomous', 'remote'] },
          },
        },
      },
    },
    async (req, reply) => {
      const { level } = req.body
      const trustFile = join(config.dataDir, '.trust-level')
      mkdirSync(config.dataDir, { recursive: true })
      writeFileSync(trustFile, level, { encoding: 'utf8', mode: 0o600 })
      invalidateConfig()
      return reply.send({ ok: true, level, note: 'Restart the server for the new trust level to take effect.' })
    },
  )

  // GET /api/admin/trust-level — read the current trust level
  fastify.get('/api/admin/trust-level', async () => {
    const trustFile = join(config.dataDir, '.trust-level')
    const level = existsSync(trustFile)
      ? readFileSync(trustFile, 'utf8').trim()
      : (process.env.CC_TRUST_LEVEL ?? 'sandboxed')
    return { level }
  })

  // ── Architect routes ─────────────────────────────────────────────────────

  // In-memory proposal store (one active proposal at a time)
  const proposals = new Map<string, {
    summary: string
    diff: string
    status: 'pending' | 'vetoed'
    expiresAt: number
  }>()

  // POST /api/admin/architect/propose — coastal-architect announces a proposal
  fastify.post<{ Body: { summary: string; diff: string } }>('/api/admin/architect/propose', {
    schema: {
      body: {
        type: 'object',
        required: ['summary', 'diff'],
        properties: {
          summary: { type: 'string', maxLength: 500 },
          diff: { type: 'string', maxLength: 50000 },
        },
      },
    },
  }, async (req, reply) => {
    const { summary, diff } = req.body
    const proposalId = randomBytes(8).toString('hex')
    const expiresAt = Date.now() + 70_000 // 70s — slightly longer than architect's 60s veto window
    proposals.set(proposalId, { summary, diff, status: 'pending', expiresAt })
    // Broadcast to connected WebSocket clients
    fastify.websocketServer?.clients.forEach((client: any) => {
      client.send(JSON.stringify({
        type: 'architect_proposal',
        proposalId,
        summary,
        diff,
        vetoDeadline: expiresAt,
      }))
    })
    return reply.send({ proposalId })
  })

  // GET /api/admin/architect/proposal/:id — poll proposal status
  fastify.get<{ Params: { id: string } }>('/api/admin/architect/proposal/:id', async (req, reply) => {
    const proposal = proposals.get(req.params.id)
    if (!proposal) return reply.status(404).send({ error: 'Not found' })
    if (proposal.status === 'pending' && Date.now() > proposal.expiresAt) {
      proposal.status = 'vetoed' // treat expired as vetoed for cleanup
      return reply.send({ status: 'expired' })
    }
    return reply.send({ status: proposal.status })
  })

  // POST /api/admin/architect/veto — UI veto button
  fastify.post<{ Body: { proposalId: string } }>('/api/admin/architect/veto', {
    schema: {
      body: {
        type: 'object',
        required: ['proposalId'],
        properties: { proposalId: { type: 'string' } },
      },
    },
  }, async (req, reply) => {
    const proposal = proposals.get(req.body.proposalId)
    if (!proposal) return reply.status(404).send({ error: 'Not found' })
    proposal.status = 'vetoed'
    fastify.websocketServer?.clients.forEach((client: any) => {
      client.send(JSON.stringify({ type: 'architect_vetoed', proposalId: req.body.proposalId }))
    })
    return reply.send({ ok: true })
  })

  // POST /api/admin/architect/run — manual trigger (sends SIGUSR1 to architect process)
  fastify.post('/api/admin/architect/run', async (_req, reply) => {
    const pidFile = join(config.dataDir, '.architect-pid')
    if (!existsSync(pidFile)) return reply.status(503).send({ error: 'coastal-architect not running' })
    try {
      const pid = Number(readFileSync(pidFile, 'utf8').trim())
      process.kill(pid, 'SIGUSR1')
      return reply.send({ ok: true, note: 'Triggered architect cycle via SIGUSR1' })
    } catch {
      return reply.status(500).send({ error: 'Failed to signal architect' })
    }
  })

  // POST /api/admin/architect/applied — architect broadcasts successful merge to UI
  fastify.post<{ Body: { summary: string; testsDelta: string } }>('/api/admin/architect/applied', {
    schema: {
      body: {
        type: 'object',
        required: ['summary', 'testsDelta'],
        properties: {
          summary: { type: 'string', maxLength: 500 },
          testsDelta: { type: 'string', maxLength: 200 },
        },
      },
    },
  }, async (req, reply) => {
    fastify.websocketServer?.clients.forEach((client: any) => {
      client.send(JSON.stringify({ type: 'architect_applied', ...req.body }))
    })
    return reply.send({ ok: true })
  })

  // GET /api/admin/cloud-consent
  fastify.get('/api/admin/cloud-consent', async (_req, reply) => {
    const consentFile = join(config.dataDir, '.cloud-consent')
    const granted = existsSync(consentFile)
    const grantedAt = granted ? statSync(consentFile).mtimeMs : null
    return reply.send({
      mem0Available: !!process.env.MEM0_API_KEY,
      consentGranted: granted,
      consentGrantedAt: grantedAt,
    })
  })

  // POST /api/admin/cloud-consent
  fastify.post<{ Body: { granted: boolean } }>('/api/admin/cloud-consent', {
    schema: {
      body: {
        type: 'object',
        required: ['granted'],
        properties: { granted: { type: 'boolean' } },
      },
    },
  }, async (req, reply) => {
    const consentFile = join(config.dataDir, '.cloud-consent')
    if (req.body.granted) {
      mkdirSync(config.dataDir, { recursive: true })
      writeFileSync(consentFile, new Date().toISOString(), { mode: 0o600 })
      return reply.send({ granted: true, message: 'Cloud consent granted. Restart the server to activate Mem0.' })
    } else {
      if (existsSync(consentFile)) unlinkSync(consentFile)
      return reply.send({ granted: false, message: 'Cloud consent revoked.' })
    }
  })

  fastify.addHook('onClose', async () => {
    modelRegistry.close()
  })
}
