// packages/core/src/memory/kinds-registry.ts
//
// Note-kind registry. Core ships with eight generic kinds that apply to
// any agentic system; verticals (trading-architect, image-architect,
// future plugins) register additional kinds at module-load time.
//
// Why a registry instead of a closed enum:
//   - Coastal.AI's substrate is meant to be domain-neutral. Hardcoding
//     'trade' (or 'image' or 'audio') in core would couple the kernel
//     to optional verticals.
//   - A registry keeps the type-level surface tight (CORE_KINDS gives
//     core code compile-time safety) while letting plugins extend the
//     runtime set without forking core.
//
// Validation lives in the application layer (NoteStore.create / upsert
// throw on unregistered kinds). The DB-level CHECK is dropped so plugins
// can register kinds at runtime without schema migrations.

export const CORE_KINDS = [
  'cycle',       // architect cycle outcome
  'learning',    // distilled lesson the architect remembered
  'code',        // code-graph: function/file/module
  'design',      // DESIGN.md tokens, component patterns
  'eval',        // promptfoo / built-in eval result
  'dom',         // browser snapshot
  'visual_diff', // structural / vision diff between snapshots
  'user',        // user-authored note (Obsidian-style)
] as const

export type CoreNoteKind = typeof CORE_KINDS[number]

const KIND_NAME_RE = /^[a-z][a-z0-9_]*$/

const extraKinds = new Set<string>()

/**
 * Register an additional kind. Plugins call this at module-load time
 * (typically from their entry point's top level so importing the
 * package is the registration trigger).
 *
 * Idempotent — re-registering the same kind is a no-op. Throws if the
 * name doesn't match the [a-z][a-z0-9_]* convention so DB queries that
 * compose kind into note-id prefixes stay safe.
 */
export function registerKind(kind: string): void {
  if (!KIND_NAME_RE.test(kind)) {
    throw new Error(`registerKind: invalid kind name "${kind}" — must match /^[a-z][a-z0-9_]*$/`)
  }
  if ((CORE_KINDS as readonly string[]).includes(kind)) return // already known
  extraKinds.add(kind)
}

/** Sorted snapshot of every currently-known kind (core + dynamic). */
export function allKinds(): readonly string[] {
  return [...CORE_KINDS, ...extraKinds].sort()
}

/** True iff the kind is one of the core set or has been registered. */
export function isRegisteredKind(kind: string): kind is string {
  return (CORE_KINDS as readonly string[]).includes(kind) || extraKinds.has(kind)
}

/** Test-only — clear the dynamic set so suites stay isolated. */
export function _resetKindsRegistryForTests(): void {
  extraKinds.clear()
}
