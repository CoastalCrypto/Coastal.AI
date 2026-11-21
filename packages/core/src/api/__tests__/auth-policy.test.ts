import { describe, it, expect } from 'vitest'
import { isPublicRoute, requiredRoleFor, satisfiesRole, DEFAULT_REQUIRED_ROLE } from '../auth-policy.js'

describe('isPublicRoute', () => {
  it('matches an exact listed route', () => {
    expect(isPublicRoute('/health')).toBe(true)
    expect(isPublicRoute('/api/version')).toBe(true)
  })

  it('matches a sub-path of a listed route', () => {
    expect(isPublicRoute('/api/admin/architect/callbacks/abc123')).toBe(true)
  })

  it('does not match an unrelated route', () => {
    expect(isPublicRoute('/api/chat')).toBe(false)
    expect(isPublicRoute('/api/admin/users')).toBe(false)
  })

  it('does not match a route that merely starts with a public route\'s prefix as a substring', () => {
    // '/api/versioning' starts with the characters '/api/version' but is not
    // '/api/version' or a '/'-delimited child of it — must not be public.
    expect(isPublicRoute('/api/versioning')).toBe(false)
  })
})

describe('satisfiesRole', () => {
  it('admin satisfies every requirement', () => {
    expect(satisfiesRole('admin', 'admin')).toBe(true)
    expect(satisfiesRole('admin', 'operator')).toBe(true)
    expect(satisfiesRole('admin', 'viewer')).toBe(true)
  })

  it('viewer only satisfies the viewer requirement', () => {
    expect(satisfiesRole('viewer', 'viewer')).toBe(true)
    expect(satisfiesRole('viewer', 'operator')).toBe(false)
    expect(satisfiesRole('viewer', 'admin')).toBe(false)
  })

  it('operator satisfies operator and viewer, not admin', () => {
    expect(satisfiesRole('operator', 'viewer')).toBe(true)
    expect(satisfiesRole('operator', 'operator')).toBe(true)
    expect(satisfiesRole('operator', 'admin')).toBe(false)
  })
})

describe('requiredRoleFor', () => {
  it('falls through to DEFAULT_REQUIRED_ROLE for an unlisted route', () => {
    expect(requiredRoleFor('GET', '/api/admin/users')).toBe(DEFAULT_REQUIRED_ROLE)
    expect(requiredRoleFor('GET', '/api/some-future-route-nobody-added-a-rule-for')).toBe(DEFAULT_REQUIRED_ROLE)
  })

  it('gates tool/shell execution routes at operator, not admin', () => {
    expect(requiredRoleFor('POST', '/api/chat')).toBe('operator')
    expect(requiredRoleFor('POST', '/api/team/run')).toBe('operator')
    expect(requiredRoleFor('POST', '/api/upload')).toBe('operator')
  })

  it('splits pipeline by method — run is operator, status read is viewer', () => {
    expect(requiredRoleFor('POST', '/api/pipeline/run')).toBe('operator')
    expect(requiredRoleFor('POST', '/api/pipeline/run/async')).toBe('operator')
    expect(requiredRoleFor('GET', '/api/pipeline/run/abc-123')).toBe('viewer')
  })

  it('splits the notes substrate — GET is viewer, mutation is operator', () => {
    expect(requiredRoleFor('GET', '/api/notes/abc')).toBe('viewer')
    expect(requiredRoleFor('POST', '/api/notes')).toBe('operator')
    expect(requiredRoleFor('DELETE', '/api/notes/abc')).toBe('operator')
  })

  it('splits persona the same way — GET is viewer, mutation is operator', () => {
    expect(requiredRoleFor('GET', '/api/persona')).toBe('viewer')
    expect(requiredRoleFor('POST', '/api/persona')).toBe('operator')
  })

  it('read-only dashboards and feeds are viewer', () => {
    expect(requiredRoleFor('GET', '/api/events')).toBe('viewer')
    expect(requiredRoleFor('GET', '/api/analytics')).toBe('viewer')
    expect(requiredRoleFor('GET', '/api/sessions')).toBe('viewer')
  })

  it('most-specific-prefix-first ordering: a GET-scoped rule does not leak to other methods', () => {
    // /api/knowledge has a GET-only viewer rule followed by a catch-all
    // operator rule for the same prefix — POST must fall through to the
    // second rule, not match the first with its method filter ignored.
    expect(requiredRoleFor('GET', '/api/knowledge')).toBe('viewer')
    expect(requiredRoleFor('POST', '/api/knowledge')).toBe('operator')
    expect(requiredRoleFor('DELETE', '/api/knowledge/abc')).toBe('operator')
  })
})
