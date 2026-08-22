import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { ArchitectToast } from './ArchitectToast'

describe('ArchitectToast', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows a placeholder before the first tick, then the actual remaining seconds', () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)

    render(
      <ArchitectToast
        proposalId="p1"
        summary="Refactor the widget loader"
        vetoDeadline={10_000}
        onVeto={() => {}}
        onDismiss={() => {}}
      />
    )

    // The first tick fires inside useEffect, which flushes synchronously
    // under React's test environment — so by the time render() returns,
    // the placeholder should already be replaced with a real value.
    expect(screen.getByText(/10s remaining/)).toBeInTheDocument()
  })

  it('counts down as time passes, proving the value is not frozen at first render', () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)

    render(
      <ArchitectToast
        proposalId="p1"
        summary="Refactor the widget loader"
        vetoDeadline={10_000}
        onVeto={() => {}}
        onDismiss={() => {}}
      />
    )

    expect(screen.getByText(/10s remaining/)).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(screen.getByText(/7s remaining/)).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(screen.getByText(/4s remaining/)).toBeInTheDocument()
  })

  it('never shows a negative countdown once the deadline has passed', () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)

    render(
      <ArchitectToast
        proposalId="p1"
        summary="Refactor the widget loader"
        vetoDeadline={2000}
        onVeto={() => {}}
        onDismiss={() => {}}
      />
    )

    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    expect(screen.getByText(/0s remaining/)).toBeInTheDocument()
  })
})
