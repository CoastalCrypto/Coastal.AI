import { readFileSync } from 'node:fs'
import type { AgentConfig, ToolDefinition, ActionSummary } from './types.js'
import { PersonaManager, DEFAULT_PERSONA, type Persona } from '../persona/manager.js'
import type { ContextDoc } from '../context/store.js'
import type { UserModelStore } from '../persona/user-model.js'
import type { TrustLevel } from '../config.js'

export interface OllamaToolSchema {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: ToolDefinition['parameters']
  }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  images?: string[]
  tool_calls?: Array<{ id?: string; function: { name: string; arguments: Record<string, unknown> } }>
  tool_call_id?: string
}

export class AgentSession {
  private _soulContent: string | null = null
  private _systemPrompt: string | null = null
  private _actions: ActionSummary[] = []

  constructor(
    readonly agent: AgentConfig,
    readonly allowedTools: ToolDefinition[],
    private persona: Persona = DEFAULT_PERSONA,
    private contextDocs: Pick<ContextDoc, 'title' | 'content'>[] = [],
    private userModel: UserModelStore | null = null,
    private trustLevel: TrustLevel | null = null,
  ) {}

  get systemPrompt(): string {
    if (this._systemPrompt) return this._systemPrompt

    if (!this._soulContent) {
      try {
        this._soulContent = readFileSync(this.agent.soulPath, 'utf8')
      } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException).code
        if (code === 'ENOENT') {
          throw new Error(`Soul file not found for agent "${this.agent.id}": ${this.agent.soulPath}`)
        }
        throw err
      }
    }

    const interpolated = PersonaManager.interpolate(this._soulContent, this.persona)
    const toolLines = this.allowedTools
      .map(t => `- ${t.name}(${Object.keys(t.parameters.properties).join(', ')}): ${t.description}`)
      .join('\n')
    const now = new Date().toISOString()
    const contextSection = this.contextDocs.length > 0
      ? '\n\n---\n## Knowledge Library\n_The following documents have been uploaded to this workspace by the user. Treat them as authoritative reference material and cite them by title when you use them. When asked whether you can "see" or "access" the knowledge library, the answer is YES — it is the section below._\n\n'
        + this.contextDocs.map(d => `### ${d.title}\n${d.content}`).join('\n\n')
      : ''
    const userSection = this.userModel?.toPromptSection() ?? ''
    let basePrompt = `${interpolated}${contextSection}${userSection}\n\nAvailable tools:\n${toolLines}\n\nCurrent date/time: ${now}`

    if (this.trustLevel === 'autonomous') {
      basePrompt += '\n\n---\n**Autonomy Directive**: You have been granted full system autonomy and unrestricted tool access. Use tools proactively and directly without asking for permission or expressing hesitation. Execute user requests immediately, do not hedge, and focus on task completion over caution.'
    } else if (this.trustLevel === 'trusted') {
      basePrompt += '\n\n---\n**Workspace Boundary**: You have trusted-mode access within your designated workspace. Confirm before attempting to access or modify anything outside the workspace directory.'
    }

    this._systemPrompt = basePrompt
    return this._systemPrompt
  }

  get toolSchemas(): OllamaToolSchema[] {
    return this.allowedTools.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }))
  }

  buildMessages(userMessage: string, history: ChatMessage[]): ChatMessage[] {
    return [
      { role: 'system', content: this.systemPrompt },
      ...history,
      { role: 'user', content: userMessage },
    ]
  }

  get actions(): ActionSummary[] {
    return this._actions.slice()
  }

  getTrustLevel(): TrustLevel | null {
    return this.trustLevel
  }

  recordAction(summary: ActionSummary): void {
    this._actions.push(summary)
  }

  actionSummary(): string {
    if (this._actions.length === 0) return ''
    const counts = new Map<string, number>()
    for (const a of this._actions) {
      counts.set(a.tool, (counts.get(a.tool) ?? 0) + 1)
    }
    const parts = [...counts.entries()].map(([tool, count]) => `${tool}×${count}`)
    return `\n\n---\n_Actions: ${parts.join(' · ')}_`
  }

  invalidateSoulCache(): void {
    this._soulContent = null
    this._systemPrompt = null
  }
}
