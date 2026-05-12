# Coastal.AI Web Design System

This document records the de-facto design language used across `packages/web`.
The architect ingests it on startup and surfaces the relevant sections in
the planner prompt whenever a work item touches a UI file. The goal is
**no design drift** — every new UI uses the tokens and idioms below
rather than introducing fresh ad-hoc colors, fonts, or component shapes.

The authoritative token source is [src/index.css](./src/index.css) under
the `@theme` block. This document explains *how* to use them.

## Color Tokens

All colors live in CSS custom properties. Components either reference
the variable directly (`color: var(--cyan)`) or use a verbatim hex value
that maps to the same token. Do not introduce ad-hoc hex values.

**Surfaces (deepest → shallowest):**
- `#050a0f` — page canvas (`--color-abyss`). The main background under everything.
- `#0a1628` — section background, sidebar panels (`--color-deep`).
- `#0d1f33` — card backgrounds (`--color-surface`). The default for any rectangular grouping.
- `#112240` — elevated cards, modals (`--color-panel`).
- `rgba(13, 31, 51, 0.80)` — glassmorphism overlay (`--color-glass-bg`).

**Borders:**
- `#1a3a5c` — standard solid borders (`--color-border`).
- `rgba(0, 229, 255, 0.12)` — subtle cyan-tinted borders for glass panels (`--color-border-subtle`).
- `rgba(0, 229, 255, 0.25)` — cyan accent borders for active surfaces.

**Cyan — primary accent:**
- `#00e5ff` — primary cyan (`--cyan`). Used for active state, focus rings, primary actions, agent nodes.
- `#00bfea` — hover state (`--cyan-glow`).
- `#67e8f9` — text on cyan-tinted surfaces (`--cyan-text`).

**Semantic colors (use these for state, never invent):**
- `#10b981` — success (`--color-success`). Tools, healthy state, applied changes.
- `#f59e0b` — warning (`--color-warning`). Channels, custom mode, attention needed.
- `#ef4444` — error (`--color-error`). Errors, destructive actions, vetoes.
- `#3b82f6` — info (`--color-info`).
- `#8b5cf6` — model accent. Reserved for AI model nodes/badges.
- `#a78bfa` — note accent (Obsidian violet). Reserved for knowledge-graph notes.
- `#fb7185` — handoff coral. Reserved for agent↔agent edges.

## Typography

Two families, no exceptions:
- `Space Grotesk` — UI text (labels, body, buttons). Falls back to Inter, system-ui.
- `JetBrains Mono` — code, monospace labels, metric badges, terminal output.

**Don't introduce a third family.** If you need a different visual weight,
use letter-spacing (`0.05em`–`0.08em` for label uppercase) or font-size
contrast, not a different font.

**Color rules:**
- `#e2f4ff` — primary text (`--text-primary`). The default. Cool off-white — never pure `#fff`.
- `#cfe6ff` — secondary highlight text on dark surfaces.
- `#94adc4` — secondary text (`--text-secondary`). Labels, captions.
- `#4a6a8a` — muted text (`--text-muted`). Placeholders, "no activity" states.
- `#050a0f` — text on cyan backgrounds (`--text-inverse`).

**Sizes (default scale, in px):**
- `9` — micro labels (uppercase, letter-spaced).
- `10` — small captions, badges.
- `11` — body small, button text in compact UI.
- `13` — body, sidebar headers.
- `14` — selected node title.

## Component Patterns

### Cards
Dark cards with a single-pixel translucent border. Reads as "panel" not "box."

```tsx
<div style={{
  background: '#0d1f33',
  border: '1px solid rgba(255,255,255,0.05)',
  borderRadius: 8,
  padding: '12px 16px',
}}>
  …
</div>
```

When the card is active/selected, swap the border for a cyan ring:
`border: '1px solid rgba(0,229,255,0.25)'` and add a `ring-1 ring-cyan-500/40`
class (or equivalent inline shadow).

### Glassmorphism Panels (sidebar, overlays)
Floating panels above the canvas use translucent surfaces with backdrop blur.

```tsx
<div style={{
  background: 'rgba(13,31,51,0.95)',
  backdropFilter: 'blur(12px)',
  border: '1px solid rgba(0,229,255,0.20)',
  borderRadius: 12,
  padding: '16px',
}}>
  …
</div>
```

### Buttons
Three weights: subtle (text-only), accent (cyan tint), destructive (red tint).

- **Subtle:** `bg-white/5 text-gray-400 hover:text-cyan-400`
- **Accent active:** `bg-cyan-500/20 text-cyan-300 ring-1 ring-cyan-500/40`
- **Destructive:** `background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.30)', color: '#ef4444'`

Always include a disabled state via `disabled:opacity-40` (or `opacity: 0.6`
inline) — never set `pointer-events: none` without a visual cue.

### Badges
Small metric/status pills, always JetBrains Mono.

```tsx
<span style={{
  fontSize: 9,
  fontFamily: 'JetBrains Mono, monospace',
  color: '#94adc4',
  border: '1px solid rgba(26,58,92,0.8)',
  background: 'rgba(10,22,40,0.6)',
  borderRadius: 4,
  padding: '2px 6px',
}}>
  {label}
</span>
```

State-colored badges follow the semantic palette: success-green, error-red.
Custom-mode badge is amber: `background: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b'`.

### Section Headings
All section headers are uppercase, letter-spaced, monospace, in muted blue.

```tsx
<h3 className="text-xs font-mono mb-2" style={{ color: '#94adc4' }}>
  POWER
</h3>
```

For inline headers with a state badge, use `flex items-center gap-2`.

### Form Controls
Knob choices (the v1.6 user-profile pattern) render as a flex-wrap row of
buttons, each tiny mono-text, with selected state via cyan accent:

```tsx
<button className={`text-[10px] font-mono px-2.5 py-1 rounded transition-colors ${
  selected
    ? 'bg-cyan-500/20 text-cyan-300 ring-1 ring-cyan-500/40'
    : 'bg-white/[0.02] text-gray-400 hover:text-cyan-400 hover:bg-white/[0.04]'
}`}>
  {opt.label}
</button>
```

## Animation Language

Animations are short and quiet. Use the keyframes defined in `index.css`:

- `fade-in` — 0.25s ease-out. Default for newly mounted content.
- `slide-up` / `slide-in` — 0.30–0.35s with the cubic-bezier(0.16, 1, 0.3, 1)
  spring. For drawers, sidebars, modals.
- `glow-pulse` — 2s alternating. For attention markers, but use sparingly.
- `agent-ping` — 2s ping ring. Only for live agent activity indicators.
- `blink` — 1s step-end. Cursor-style blinking, emergencies only.

Don't write new keyframes unless the existing language can't express the
motion — and if you do, add it to `index.css`, not inline.

## Layout Conventions

- **Container max-widths:** none by default. Pages flex to viewport. Add
  `max-w-*` classes only when reading flow demands it (long-form text).
- **NavBar:** fixed top, `top: 56` is the offset every page's first
  scrollable region uses (`top: 56, left: 0, right: 0, bottom: 0`).
- **Sidebars:** floating glass panels, `position: absolute, top: 16, right: 16`,
  `width: 320`, `maxHeight: 'calc(100vh - 100px)'`, internal `overflowY: auto`.
- **Toasts:** centered horizontally, `bottom: 72`, semantic-colored translucent
  background, monospace label, auto-dismiss after 3500ms.

## Status Color Mapping

When rendering agent/process state, use this table verbatim:

| Status     | Color     | Where      |
|------------|-----------|------------|
| `idle`     | `#94adc4` | nodes, dots |
| `thinking` | `#00e5ff` | nodes      |
| `executing`| `#10b981` | nodes      |
| `error`    | `#ef4444` | nodes, banners |
| `offline`  | `#4a6a8a` | nodes      |

Mode badges follow the same palette: `hands-on` cyan, `hands-off` neutral,
`autopilot` warning amber, `custom` warning amber with a label distinguishing
it from autopilot.

## Do / Don't

**Do:**
- Use the existing CSS custom properties or their hex equivalents.
- Use Space Grotesk for UI, JetBrains Mono for labels/code.
- Use letter-spacing 0.05–0.08em for uppercase labels.
- Use rgba() variants of accent colors for borders (never solid).
- Reach for `border-radius: 4px` (small), `8px` (default), `12px` (large).

**Don't:**
- Introduce a third font family.
- Use pure `#ffffff` text. Always `#e2f4ff` or one of the secondary tints.
- Use `color: red` / `color: green` literals — use the semantic palette.
- Add new keyframes when the existing animation set fits.
- Build inline styles that hardcode color values not in this document.
- Ship Tailwind classes mixed with inline styles for the same property
  (one or the other per element). The codebase pragmatically uses both,
  but mix them across elements, not within a single one.

## Where to Look

- [src/index.css](./src/index.css) — `@theme` token definitions (authoritative).
- [src/components/MyceliumCanvas.tsx](./src/components/MyceliumCanvas.tsx) — the canvas color/edge palette in code.
- [src/pages/AgentGraph.tsx](./src/pages/AgentGraph.tsx) — sidebar and toggle component patterns.
- [src/pages/architect/SettingsTab.tsx](./src/pages/architect/SettingsTab.tsx) — knob/preference UI patterns.
- [src/components/AgentNode.tsx](./src/components/AgentNode.tsx) — node-icon and node-color tables.
