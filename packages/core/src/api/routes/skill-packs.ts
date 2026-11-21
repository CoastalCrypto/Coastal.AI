import type { FastifyInstance } from 'fastify'
import { SkillPack, SkillPackManager } from '../../skills/skill-pack.js'
import { SkillStore } from '../../skills/store.js'
import { AgentRegistry } from '../../agents/registry.js'

export async function skillPackRoutes(
  fastify: FastifyInstance,
  opts: { skillStore: SkillStore; agentRegistry: AgentRegistry }
) {
  const { skillStore, agentRegistry } = opts

  /**
   * Import a SkillPack (Skills + optional Agents)
   */
  fastify.post<{ Body: any }>('/api/admin/skill-packs/import', async (req, reply) => {
    const pack = req.body
    if (!SkillPackManager.validate(pack)) {
      return reply.status(400).send({ error: 'Invalid SkillPack format' })
    }

    const results = {
      skillsCreated: 0,
      skillsSkipped: 0,
      agentsCreated: 0,
      agentsSkipped: 0,
      errors: [] as string[]
    }

    // 1. Import Skills
    for (const s of pack.skills) {
      const slug = s.name.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
      if (skillStore.getByName(slug)) {
        results.skillsSkipped++
        continue
      }
      try {
        skillStore.create({
          name: slug,
          description: s.description,
          prompt: s.prompt,
          agentId: s.agentId || 'general'
        })
        results.skillsCreated++
      } catch (e: any) {
        results.errors.push(`Skill ${s.name}: ${e.message}`)
      }
    }

    // 2. Import Agents (optional)
    if (pack.agents && Array.isArray(pack.agents)) {
      for (const a of pack.agents) {
        if (agentRegistry.list().find((ag) => ag.name === a.name)) {
          results.agentsSkipped++
          continue
        }
        try {
          agentRegistry.create({
            name: a.name,
            role: a.role ?? 'AI Assistant',
            soulPath: a.soul ?? '',
            tools: [],
            modelPref: a.model,
            voice: a.voice,
          })
          results.agentsCreated++
        } catch (e: any) {
          results.errors.push(`Agent ${a.name}: ${e.message}`)
        }
      }
    }

    return reply.send(results)
  })

  /**
   * Export selected skills/agents as a SkillPack
   */
  fastify.post<{ Body: { metadata: SkillPack['metadata'], skillIds: string[], agentIds?: string[] } }>(
    '/api/admin/skill-packs/export',
    async (req, reply) => {
      const { metadata, skillIds, agentIds } = req.body

      const skills = skillStore.getMany(skillIds)
      // agentRegistry.getMany() returns AgentConfig (soulPath/modelPref) — the
      // pack format (SkillPack['agents']) uses soul/model instead; the previous
      // per-id `.map(id => agentRegistry.get(id)).filter((a): a is any => ...)`
      // masked this same mismatch behind an `any` cast rather than satisfying it.
      const agents = agentIds
        ? agentRegistry.getMany(agentIds).map(a => ({
            name: a.name,
            role: a.role,
            soul: a.soulPath,
            model: a.modelPref,
            voice: a.voice,
          }))
        : []

      const pack = SkillPackManager.export(metadata, skills, agents)
      return reply.send(pack)
    }
  )
}
