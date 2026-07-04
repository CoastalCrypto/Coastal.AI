import type { Task } from '../types.js'
import type { NodeRole } from './config.js'

/** Per-role daemon metadata. Pure data — the worker function itself is injected
 *  at the node-runtime boundary (keeps the Turbo graph acyclic). */
export interface RoleSpec {
  replicationRole: 'curator' | 'worker' | 'observer'
  taskKinds: string[]
  model: string | null
}

export const ROLE_SPECS: Record<NodeRole, RoleSpec> = {
  main:       { replicationRole: 'worker',   taskKinds: ['plan_task'],     model: 'llama3.1:13b' },
  coder:      { replicationRole: 'worker',   taskKinds: ['code_task'],     model: 'qwen2.5-coder:7b' },
  reviewer:   { replicationRole: 'worker',   taskKinds: ['review_task'],   model: 'deepseek-coder-v2-lite' },
  tester:     { replicationRole: 'worker',   taskKinds: ['test_task'],     model: 'codellama:7b' },
  designer:   { replicationRole: 'worker',   taskKinds: ['design_task'],   model: 'llava:7b' },
  researcher: { replicationRole: 'worker',   taskKinds: ['research_task'], model: 'llama3.1:8b' },
  writer:     { replicationRole: 'worker',   taskKinds: ['write_task'],    model: 'qwen2.5:7b' },
  trader:     { replicationRole: 'worker',   taskKinds: ['trade'],         model: null },
  curator:    { replicationRole: 'curator',  taskKinds: [],                model: 'phi3.5:3.8b' },
  monitor:    { replicationRole: 'observer', taskKinds: [],                model: 'phi3.5:3.8b' },
  sandbox:    { replicationRole: 'worker',   taskKinds: ['exec_task'],     model: null },
  voice:      { replicationRole: 'observer', taskKinds: [],                model: null },
}

export const shouldClaimFor = (spec: RoleSpec) =>
  (task: Task): boolean => spec.taskKinds.includes(task.kind)
