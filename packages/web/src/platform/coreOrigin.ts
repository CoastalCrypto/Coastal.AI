// Single source of truth for reaching the core backend from the web UI.
//
// In a normal browser (served by core or via the Vite dev proxy) the legacy
// default applies. In the Tauri desktop shell the core sidecar listens on a
// DYNAMIC port chosen at launch, which the shell injects — so the origin can't
// be baked at build time. Resolution order (first hit wins):
//
//   1. window.__COASTAL_CORE_PORT__   — injected by the Tauri shell
//   2. ?corePort=<n>                  — how the shell loads the UI
//   3. import.meta.env.VITE_CORE_PORT — build-time override
//   4. VITE_CORE_API_URL / default    — legacy browser/dev behavior

const DEFAULT_ORIGIN = 'http://127.0.0.1:4747'

function injectedPort(): string | null {
  const p = (globalThis as { __COASTAL_CORE_PORT__?: string | number }).__COASTAL_CORE_PORT__
  return p ? String(p) : null
}

function queryPort(): string | null {
  if (typeof location === 'undefined' || !location.search) return null
  return new URLSearchParams(location.search).get('corePort')
}

function envPort(): string | null {
  const p = import.meta.env.VITE_CORE_PORT
  return p ? String(p) : null
}

/** HTTP origin of the core backend, e.g. "http://127.0.0.1:53187". */
export function coreHttpOrigin(): string {
  const port = injectedPort() ?? queryPort() ?? envPort()
  if (port) return `http://127.0.0.1:${port}`
  return import.meta.env.VITE_CORE_API_URL || DEFAULT_ORIGIN
}

/** WebSocket origin of the core backend, e.g. "ws://127.0.0.1:53187". */
export function coreWsOrigin(): string {
  return coreHttpOrigin().replace(/^http/, 'ws')
}
