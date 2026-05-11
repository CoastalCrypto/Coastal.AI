import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { UnifiedMemory } from '../../memory/index.js'
import { NOTE_KINDS, LINK_KINDS } from '../../memory/notes.js'

export interface NoteRouteDeps {
  memory: UnifiedMemory
}

const noteKindSchema = z.enum(NOTE_KINDS)
const linkKindSchema = z.enum(LINK_KINDS)

const createSchema = z.object({
  title: z.string().min(1).max(500),
  body: z.string().max(200_000).default(''),
  kind: noteKindSchema,
  sourceType: z.string().max(64).nullish(),
  sourceId: z.string().max(256).nullish(),
  id: z.string().max(256).optional(),
}).strict()

const updateSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  body: z.string().max(200_000).optional(),
  kind: noteKindSchema.optional(),
  sourceType: z.string().max(64).nullish(),
  sourceId: z.string().max(256).nullish(),
}).strict()

const listQuerySchema = z.object({
  kind: noteKindSchema.optional(),
  sourceType: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
}).strict()

const linkSchema = z.object({
  toId: z.string().min(1),
  kind: linkKindSchema.default('mentions'),
}).strict()

const subgraphQuerySchema = z.object({
  depth: z.coerce.number().int().min(0).max(4).default(1),
}).strict()

export async function noteRoutes(app: FastifyInstance, deps: NoteRouteDeps): Promise<void> {
  const { memory } = deps
  const notes = memory.notes

  app.get('/api/admin/notes', async (req, reply) => {
    const parsed = listQuerySchema.safeParse(req.query)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_query', details: parsed.error.flatten() })
    return { notes: notes.list(parsed.data), count: notes.count() }
  })

  app.get('/api/admin/notes/search', async (req, reply) => {
    const schema = z.object({ q: z.string().min(1), limit: z.coerce.number().int().min(1).max(100).default(20) }).strict()
    const parsed = schema.safeParse(req.query)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_query', details: parsed.error.flatten() })
    return { results: notes.search(parsed.data.q, parsed.data.limit) }
  })

  app.get('/api/admin/notes/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const note = notes.get(id)
    if (!note) return reply.code(404).send({ error: 'not_found' })
    return {
      note,
      outgoing: notes.outgoing(id),
      backlinks: notes.backlinks(id),
    }
  })

  app.get('/api/admin/notes/:id/graph', async (req, reply) => {
    const { id } = req.params as { id: string }
    const note = notes.get(id)
    if (!note) return reply.code(404).send({ error: 'not_found' })
    const parsed = subgraphQuerySchema.safeParse(req.query)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_query', details: parsed.error.flatten() })
    return notes.subgraph(id, parsed.data.depth)
  })

  app.post(
    '/api/admin/notes',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const parsed = createSchema.safeParse(req.body)
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten() })
      const note = notes.create(parsed.data)
      const mentioned = memory.materializeMentions(note)
      return reply.code(201).send({ note, mentioned: [...mentioned] })
    },
  )

  app.put(
    '/api/admin/notes/:id',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { id } = req.params as { id: string }
      const parsed = updateSchema.safeParse(req.body)
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten() })
      const updated = notes.update(id, parsed.data)
      if (!updated) return reply.code(404).send({ error: 'not_found' })
      const mentioned = memory.materializeMentions(updated)
      return { note: updated, mentioned: [...mentioned] }
    },
  )

  app.delete(
    '/api/admin/notes/:id',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { id } = req.params as { id: string }
      const removed = notes.delete(id)
      if (!removed) return reply.code(404).send({ error: 'not_found' })
      return { ok: true }
    },
  )

  // ----- Manual link management -----

  app.post(
    '/api/admin/notes/:id/links',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { id } = req.params as { id: string }
      const parsed = linkSchema.safeParse(req.body)
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten() })
      if (!notes.get(id)) return reply.code(404).send({ error: 'from_not_found' })
      if (!notes.get(parsed.data.toId)) return reply.code(404).send({ error: 'to_not_found' })
      const link = notes.link(id, parsed.data.toId, parsed.data.kind)
      if (!link) return reply.code(400).send({ error: 'self_link_refused' })
      return reply.code(201).send({ link })
    },
  )

  // DELETE with kind in body so callers can target a specific link type.
  // Omit kind to wipe all edges between the pair (records mention rejection
  // if an auto-mentions edge was among them — that's user-driven feedback).
  app.delete(
    '/api/admin/notes/:id/links/:toId',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { id, toId } = req.params as { id: string; toId: string }
      const kindParsed = z.object({ kind: linkKindSchema.optional() }).strict().safeParse(req.query)
      if (!kindParsed.success) return reply.code(400).send({ error: 'invalid_query', details: kindParsed.error.flatten() })
      const removed = notes.unlink(id, toId, kindParsed.data.kind)
      if (removed === 0) return reply.code(404).send({ error: 'no_such_link' })
      return { ok: true, removed }
    },
  )

  // ----- Learned policy surface (for the future tuning UI) -----

  app.get('/api/admin/notes/policy/feedback', async () => {
    return { feedback: notes.listMentionFeedback() }
  })

  app.delete(
    '/api/admin/notes/policy/feedback/:target',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req) => {
      const { target } = req.params as { target: string }
      notes.clearMentionFeedback(target)
      return { ok: true }
    },
  )
}
