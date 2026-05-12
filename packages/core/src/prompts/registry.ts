// packages/core/src/prompts/registry.ts
//
// Versioned prompt registry. Each prompt has a stable id (e.g. 'planner'),
// a numeric version that bumps on every meaningful template change, and a
// `render(vars)` function that produces the final string sent to the LLM.
//
// Why versioned: eval results in the notes layer are scored against
// (promptId, version). When a prompt changes, prior eval scores belong
// to the OLD version — they do not retroactively certify the new one.
// The registry is the single source of truth so the architect, the
// gate, and the eval runner all agree on which template is current.

/**
 * Prompt-variable bag. Index-signature kept for ergonomic introspection
 * (e.g. logging unknown keys), but PromptDefinition's generic is
 * intentionally unconstrained so structurally-typed interfaces work
 * without requiring a redundant index signature.
 */
export interface PromptVariables {
  [key: string]: string | number | boolean | null | undefined
}

export interface PromptDefinition<V = PromptVariables> {
  /** Stable identifier (e.g. 'planner', 'building-revise'). */
  id: string
  /** Bumped on every meaningful template edit. Eval history is scoped to this. */
  version: number
  /** One-line description for UI / docs. */
  description: string
  /** Render function. Pure; no I/O. */
  render: (vars: V) => string
  /** Names of variables the template expects. Used for validation in the registry. */
  expectedVars: readonly (keyof V & string)[]
}

export interface PromptRecord {
  id: string
  version: number
  description: string
  expectedVars: readonly string[]
}

const REGISTRY = new Map<string, PromptDefinition>()

/** Register a prompt. Throws on duplicate (id, version). Idempotent for
 *  the SAME definition object so re-imports during HMR don't blow up. */
export function registerPrompt<V>(def: PromptDefinition<V>): void {
  const key = registryKey(def.id, def.version)
  const existing = REGISTRY.get(key)
  if (existing && existing !== (def as unknown as PromptDefinition)) {
    throw new Error(`registerPrompt: duplicate (id=${def.id}, version=${def.version})`)
  }
  REGISTRY.set(key, def as unknown as PromptDefinition)
}

/** Look up a specific (id, version). Throws if not registered. */
export function getPrompt<V = PromptVariables>(
  id: string, version: number,
): PromptDefinition<V> {
  const def = REGISTRY.get(registryKey(id, version))
  if (!def) throw new Error(`getPrompt: no such prompt (id=${id}, version=${version})`)
  return def as PromptDefinition<V>
}

/** Return the highest registered version for a prompt id, or null. */
export function getLatestPrompt<V = PromptVariables>(
  id: string,
): PromptDefinition<V> | null {
  let best: PromptDefinition | null = null
  for (const def of REGISTRY.values()) {
    if (def.id !== id) continue
    if (!best || def.version > best.version) best = def
  }
  return best as PromptDefinition<V> | null
}

/** Snapshot of every registered prompt. Used by the daemon to write code-graph
 *  style notes for prompts on startup, and by future REST/UI to enumerate. */
export function listPrompts(): PromptRecord[] {
  return [...REGISTRY.values()]
    .map(d => ({ id: d.id, version: d.version, description: d.description, expectedVars: d.expectedVars }))
    .sort((a, b) => a.id.localeCompare(b.id) || a.version - b.version)
}

/** Reset the registry. Test-only helper to keep suites isolated. */
export function _resetPromptRegistryForTests(): void {
  REGISTRY.clear()
}

function registryKey(id: string, version: number): string {
  return `${id}@${version}`
}
