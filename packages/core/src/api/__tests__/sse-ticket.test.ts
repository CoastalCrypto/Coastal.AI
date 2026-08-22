import { describe, it, expect, vi, afterEach } from 'vitest'
import { issueTicket, consumeTicket } from '../sse-ticket.js'

describe('sse-ticket', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('a freshly issued ticket is consumable', () => {
    const ticket = issueTicket()
    expect(consumeTicket(ticket)).toBe(true)
  })

  it('a ticket can only be consumed once', () => {
    const ticket = issueTicket()
    expect(consumeTicket(ticket)).toBe(true)
    expect(consumeTicket(ticket)).toBe(false)
  })

  it('an unknown ticket is rejected', () => {
    expect(consumeTicket('never-issued')).toBe(false)
  })

  it('an empty ticket is rejected', () => {
    expect(consumeTicket('')).toBe(false)
  })

  it('a ticket expires after its TTL', () => {
    vi.useFakeTimers()
    const ticket = issueTicket()
    vi.advanceTimersByTime(31_000)
    expect(consumeTicket(ticket)).toBe(false)
  })

  it('two issued tickets are distinct', () => {
    const a = issueTicket()
    const b = issueTicket()
    expect(a).not.toBe(b)
    expect(consumeTicket(a)).toBe(true)
    expect(consumeTicket(b)).toBe(true)
  })
})
