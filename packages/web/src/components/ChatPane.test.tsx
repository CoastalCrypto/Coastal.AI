// packages/web/src/components/ChatPane.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Chat from '../pages/Chat'

// vi.mock is hoisted to before imports by Vitest — mocks are in place when Chat loads
vi.mock('../api/client', () => ({
  CoreClient: vi.fn().mockImplementation(() => ({})),
  // coreClient is a pre-instantiated singleton — must be mocked directly
  coreClient: {
    listAgents: vi.fn().mockResolvedValue([]),
    listSessions: vi.fn().mockResolvedValue({ sessions: [] }),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    runTeam: vi.fn().mockResolvedValue({ reply: '', subtasks: [], subtaskCount: 0 }),
    uploadFile: vi.fn().mockResolvedValue({ filename: 'test.txt', text: '', isImage: false }),
  },
  adminClient: {
    listAgents: vi.fn().mockResolvedValue([]),
  },
}))
vi.mock('../hooks/useIsMobile', () => ({ useIsMobile: () => false }))

// Silence WebSocket noise from reconnect hook
const MockWS = vi.fn().mockImplementation(() => ({
  onopen: null, onmessage: null, onclose: null, onerror: null, close: vi.fn(),
}))
vi.stubGlobal('WebSocket', MockWS)

// jsdom doesn't implement scrollIntoView
window.HTMLElement.prototype.scrollIntoView = vi.fn()

describe('Chat component', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ agents: [] }),
    } as unknown as Response)
  })

  it('renders without errors', async () => {
    const { container } = render(<Chat />)
    expect(container).toBeTruthy()
  })

  it('displays message list', async () => {
    const { container } = render(<Chat />)
    // Chat component renders with initial greeting message
    expect(container.textContent).toContain('Hello')
  })
})
