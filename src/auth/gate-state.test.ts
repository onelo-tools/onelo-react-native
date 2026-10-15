/**
 * #819 — `OneloAuthGate` shows the app only on the server's answer. Its old
 * local rule (`signedIn && (!paywall || entitled)`) let a user the server
 * withholds for Email Verification into a free app.
 */
import { describe, it, expect, vi } from 'vitest'
import { resolveGateState } from './gate-state'

const session = { accessToken: 'a', refreshToken: 'r', expiresAt: 0, user: {
  id: 'u1', email: 'u@x.io', role: 'member' as const, tenantId: null, entitlement: 'none' as const,
} }

function auth(signedIn: boolean, allowedIn: boolean) {
  return {
    whenReady: vi.fn(async () => {}),
    getSession: vi.fn(async () => (signedIn ? session : null)),
    isAllowedIn: vi.fn(async () => allowedIn),
  }
}

describe('resolveGateState', () => {
  it('withholds a signed-in user the server says no to (Email Verification on a free app)', async () => {
    expect(await resolveGateState(auth(true, false))).toEqual({ signedIn: true, allowedIn: false })
  })

  it('shows the app when the server says yes', async () => {
    expect(await resolveGateState(auth(true, true))).toEqual({ signedIn: true, allowedIn: true })
  })

  it('never asks about a signed-out visitor', async () => {
    const a = auth(false, true)
    expect(await resolveGateState(a)).toEqual({ signedIn: false, allowedIn: false })
    expect(a.isAllowedIn).not.toHaveBeenCalled()
  })

  it('waits for config before deciding', async () => {
    const a = auth(true, true)
    await resolveGateState(a)
    expect(a.whenReady.mock.invocationCallOrder[0]).toBeLessThan(a.isAllowedIn.mock.invocationCallOrder[0])
  })
})
