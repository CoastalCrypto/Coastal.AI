/**
 * Wikilink + entity-mention parser.
 *
 * Two kinds of references find their way into our note graph:
 *
 *   1. Explicit wikilinks: `[[Note Title]]` or `[[note-id]]`. Obsidian's
 *      contract — if the user typed it, we link it.
 *
 *   2. Entity mentions: bare references to known entities (note titles
 *      already in the store, agent ids, file paths, etc.). The caller
 *      provides a lookup table; we match those literal strings as
 *      whole-word occurrences in the body.
 *
 * The parser only *reports* references. It does not write to the store —
 * the caller owns the link-creation policy (which kind of link, whether
 * to dedupe, etc.). Keeps this file pure and unit-testable.
 */

export interface WikilinkRef {
  /** The text inside the brackets, trimmed. May be a title or an id. */
  target: string
  /** Index in the source string where `[[` begins. */
  start: number
  /** Index in the source string where `]]` ends. */
  end: number
}

export interface MentionRef {
  /** The exact entity key the caller registered (canonical form). */
  target: string
  /** Position of the literal match in the source string. */
  start: number
  end: number
}

export interface ParseResult {
  wikilinks: WikilinkRef[]
  mentions: MentionRef[]
}

/**
 * Pull `[[target]]` references out of the body. Tolerates whitespace
 * inside the brackets and ignores nested/empty brackets.
 */
export function parseWikilinks(body: string): WikilinkRef[] {
  const refs: WikilinkRef[] = []
  const re = /\[\[([^\[\]\n]+?)\]\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) {
    const target = m[1].trim()
    if (target.length === 0) continue
    refs.push({ target, start: m.index, end: m.index + m[0].length })
  }
  return refs
}

/**
 * Find whole-word occurrences of any registered entity name in the body.
 * Skips spans already inside `[[ ]]` so wikilinks aren't double-counted
 * as plain mentions.
 *
 * `entities` is a map from canonical key → display name(s) we should
 * search for. Multi-word values are matched literally (with whitespace
 * normalized to a single space).
 */
export function parseMentions(
  body: string,
  entities: ReadonlyMap<string, string[]>,
  shouldLink: (target: string, surroundingText: string) => boolean = defaultShouldLink,
): MentionRef[] {
  const wikilinkSpans = parseWikilinks(body).map(r => [r.start, r.end] as const)
  const isInsideWikilink = (idx: number) =>
    wikilinkSpans.some(([s, e]) => idx >= s && idx < e)

  const refs: MentionRef[] = []
  const seenAtPos = new Set<string>()

  for (const [canonical, aliases] of entities) {
    for (const alias of aliases) {
      const trimmed = alias.trim()
      if (trimmed.length === 0) continue
      const escaped = escapeRegExp(trimmed).replace(/\s+/g, '\\s+')
      const re = new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, 'gi')
      let m: RegExpExecArray | null
      while ((m = re.exec(body)) !== null) {
        if (isInsideWikilink(m.index)) continue
        const surrounding = body.slice(Math.max(0, m.index - 40), Math.min(body.length, m.index + m[0].length + 40))
        if (!shouldLink(canonical, surrounding)) continue
        const key = `${canonical}|${m.index}`
        if (seenAtPos.has(key)) continue
        seenAtPos.add(key)
        refs.push({ target: canonical, start: m.index, end: m.index + m[0].length })
      }
    }
  }
  // Stable order — by position, then by canonical for deterministic output.
  refs.sort((a, b) => (a.start - b.start) || a.target.localeCompare(b.target))
  return refs
}

export function parseAll(
  body: string,
  entities: ReadonlyMap<string, string[]>,
  shouldLink?: (target: string, surroundingText: string) => boolean,
): ParseResult {
  return {
    wikilinks: parseWikilinks(body),
    mentions: parseMentions(body, entities, shouldLink),
  }
}

// ---------------------------------------------------------------------------
// Hooks for the auto-link policy.
//
// HEY HUMAN — this is the spot where your taste shapes the graph feel.
// `defaultShouldLink` is the predicate parseMentions consults before
// emitting a mention. Tweak it (or pass your own) to dial up/down how
// chatty the graph is. Examples in the comments below.
// ---------------------------------------------------------------------------

/** Stopwords that should NEVER auto-link even if registered. */
export const MENTION_STOPWORDS = new Set<string>([
  'a', 'an', 'the', 'and', 'or', 'but',
  'is', 'it', 'in', 'on', 'at', 'to', 'of', 'for',
  'this', 'that', 'these', 'those',
  'we', 'us', 'our', 'you', 'your',
  'core', 'web', 'src', 'ts', 'tsx', // package/extension names so common they'd be noise
])

/**
 * Default policy:
 *   - reject anything in MENTION_STOPWORDS
 *   - reject targets shorter than 3 chars
 *   - accept everything else
 *
 * If you want a stricter feel, narrow the predicate. If you want a denser
 * graph, broaden it. The whole policy is intentionally tiny so it's easy
 * to evolve by hand once we see the actual graph in the canvas.
 */
export function defaultShouldLink(target: string, _surrounding: string): boolean {
  const t = target.trim().toLowerCase()
  if (t.length < 3) return false
  if (MENTION_STOPWORDS.has(t)) return false
  return true
}

// ---------------------------------------------------------------------------
// Learned policy: blocks targets the user has repeatedly rejected.
//
// Wraps any base predicate (defaults to `defaultShouldLink`). Reads
// kept/rejected stats from a stats provider — typically `NoteStore.getMentionStats`,
// kept abstract so this module stays free of DB types and is easy to test.
//
// Block rule: rejected >= MIN_REJECTIONS_TO_BLOCK AND
//             rejected / (kept + rejected) >= REJECTION_RATIO_THRESHOLD.
// Both thresholds are constants here; the eventual user-tunable file or
// settings UI will override them through the config arg.
// ---------------------------------------------------------------------------

export interface MentionStats {
  kept: number
  rejected: number
  lastRejectedAt: number | null
}

export interface LearnedPolicyConfig {
  minRejections?: number
  rejectionRatio?: number
  base?: (target: string, surrounding: string) => boolean
}

export const MIN_REJECTIONS_TO_BLOCK = 3
export const REJECTION_RATIO_THRESHOLD = 0.5

/**
 * Returns a `shouldLink` predicate that consults learned feedback in
 * addition to the base rules. Pure factory — no I/O — so the caller wires
 * the stats provider once and reuses the predicate per parse.
 */
export function makeLearnedPolicy(
  getStats: (target: string) => MentionStats,
  config: LearnedPolicyConfig = {},
): (target: string, surrounding: string) => boolean {
  const minRejections = config.minRejections ?? MIN_REJECTIONS_TO_BLOCK
  const ratio = config.rejectionRatio ?? REJECTION_RATIO_THRESHOLD
  const base = config.base ?? defaultShouldLink

  return (target: string, surrounding: string) => {
    if (!base(target, surrounding)) return false
    const stats = getStats(target)
    if (stats.rejected < minRejections) return true
    const total = stats.kept + stats.rejected
    if (total === 0) return true
    return (stats.rejected / total) < ratio
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
