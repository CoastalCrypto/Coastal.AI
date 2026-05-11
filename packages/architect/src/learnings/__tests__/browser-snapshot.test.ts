import { describe, it, expect, vi } from 'vitest'
import { createHttpSnapshotter, snapshotAll } from '../browser-snapshot.js'

function fakeResponse(opts: { status: number; body: string }): Response {
  return new Response(opts.body, { status: opts.status }) as unknown as Response
}

describe('createHttpSnapshotter', () => {
  it('returns ok=true for a 200 response and captures body length + preview', async () => {
    const fetchFn = vi.fn().mockResolvedValue(fakeResponse({ status: 200, body: '<html>hello</html>' }))
    const snapshotter = createHttpSnapshotter({ fetchFn, now: () => 1_000 })
    const s = await snapshotter.snapshot('http://localhost/x')
    expect(s.ok).toBe(true)
    expect(s.status).toBe(200)
    expect(s.bodyLength).toBe('<html>hello</html>'.length)
    expect(s.bodyPreview).toContain('hello')
    expect(s.fetchError).toBeNull()
  })

  it('returns ok=false for a 5xx response but still captures the body', async () => {
    const fetchFn = vi.fn().mockResolvedValue(fakeResponse({ status: 500, body: 'oops' }))
    const snapshotter = createHttpSnapshotter({ fetchFn })
    const s = await snapshotter.snapshot('http://localhost/x')
    expect(s.ok).toBe(false)
    expect(s.status).toBe(500)
    expect(s.bodyLength).toBe(4)
  })

  it('returns ok=false with fetchError when fetch throws', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    const snapshotter = createHttpSnapshotter({ fetchFn })
    const s = await snapshotter.snapshot('http://localhost/x')
    expect(s.ok).toBe(false)
    expect(s.status).toBe(0)
    expect(s.fetchError).toBe('ECONNREFUSED')
  })

  it('passes the URL through to fetchFn with custom user agent', async () => {
    const fetchFn = vi.fn().mockResolvedValue(fakeResponse({ status: 200, body: 'ok' }))
    await createHttpSnapshotter({ fetchFn, userAgent: 'TestBot/1.0' }).snapshot('http://x')
    expect(fetchFn).toHaveBeenCalledWith('http://x', expect.objectContaining({
      headers: expect.objectContaining({ 'user-agent': 'TestBot/1.0' }),
    }))
  })

  it('records duration via the injected clock', async () => {
    const fetchFn = vi.fn().mockResolvedValue(fakeResponse({ status: 200, body: 'ok' }))
    let t = 0
    const snapshotter = createHttpSnapshotter({ fetchFn, now: () => (t += 50) })
    const s = await snapshotter.snapshot('http://x')
    // Three now() calls: start (50), takenAt (100), then durationMs uses
    // a third call (150) minus start, giving 100ms duration.
    expect(s.takenAt).toBe(100)
    expect(s.durationMs).toBe(100)
  })

  it('always reports zero console errors (HTTP-only impl)', async () => {
    const fetchFn = vi.fn().mockResolvedValue(fakeResponse({ status: 200, body: 'ok' }))
    const s = await createHttpSnapshotter({ fetchFn }).snapshot('http://x')
    expect(s.consoleErrors).toEqual([])
  })
})

describe('snapshotAll', () => {
  it('snapshots URLs sequentially and returns one entry each', async () => {
    const fetchFn = vi.fn().mockResolvedValue(fakeResponse({ status: 200, body: 'x' }))
    const snapshotter = createHttpSnapshotter({ fetchFn })
    const results = await snapshotAll(snapshotter, ['http://a', 'http://b', 'http://c'])
    expect(results).toHaveLength(3)
    expect(results.map(r => r.url)).toEqual(['http://a', 'http://b', 'http://c'])
    expect(fetchFn).toHaveBeenCalledTimes(3)
  })

  it('does not short-circuit on a failed snapshot', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(fakeResponse({ status: 200, body: 'ok' }))
      .mockRejectedValueOnce(new Error('refused'))
      .mockResolvedValueOnce(fakeResponse({ status: 200, body: 'ok' }))
    const snapshotter = createHttpSnapshotter({ fetchFn })
    const results = await snapshotAll(snapshotter, ['http://a', 'http://b', 'http://c'])
    expect(results).toHaveLength(3)
    expect(results[1].ok).toBe(false)
  })
})
