/**
 * Regression tests for refreshSession's sign-out epoch guard (auth.ts).
 *
 * THE critical fix: a token refresh already in flight must NOT resurrect a
 * session that was signed out while it awaited the network. refreshSession()
 * captures signOutEpoch BEFORE the httpPost await and refuses to write the fresh
 * tokens back if signOut() bumped the epoch in the meantime. Also covers the
 * happy path (no sign-out → tokens are persisted).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// A stateful, in-memory Keychain so signOut()'s clear() and saveSession()'s
// writes are observable through getSession().
const { store } = vi.hoisted(() => ({ store: new Map<string, string>() }))

const TOKEN_KEYS_LOCAL = {
  ACCESS_TOKEN: 'onelo_access_token',
  REFRESH_TOKEN: 'onelo_refresh_token',
  EXPIRES_AT: 'onelo_expires_at',
  USER_JSON: 'onelo_user',
}

vi.mock('../core/storage', () => ({
  KeychainStorage: vi.fn().mockImplementation(() => ({
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    set: vi.fn(async (k: string, v: string) => { store.set(k, v) }),
    delete: vi.fn(async (k: string) => { store.delete(k) }),
    clear: vi.fn(async () => {
      for (const k of Object.values(TOKEN_KEYS_LOCAL)) store.delete(k)
    }),
  })),
}))

vi.mock('../core/pkce', () => ({
  generateCodeVerifier: vi.fn().mockReturnValue('verifier'),
  generateCodeChallenge: vi.fn().mockReturnValue('challenge'),
}))

// Deferred refresh: /auth/refresh hangs until we call the captured resolver so
// we can inject a signOut() into the in-flight window.
const { httpPostImpl } = vi.hoisted(() => {
  const state: { resolveRefresh?: (json: Record<string, unknown>) => void } = {}
  const impl = vi.fn(async (url: string) => {
    if (String(url).includes('/api/sdk/auth/refresh')) {
      return new Promise((resolve) => {
        state.resolveRefresh = (json) => resolve({ status: 200, json })
      })
    }
    return { status: 200, json: {} }
  })
  return { httpPostImpl: Object.assign(impl, { state }) }
})

vi.mock('@onelo/core', async () => {
  const actual = await vi.importActual<typeof import('@onelo/core')>('@onelo/core')
  return {
    ...actual,
    httpGet: vi.fn().mockResolvedValue({
      status: 200,
      json: {
        supabase_url: 'https://x.supabase.co',
        supabase_anon_key: 'anon',
        tenant_id: 'tenant-1',
        allow_custom_branding: true,
        paywall_enabled: false,
      },
    }),
    httpPost: (...args: unknown[]) => httpPostImpl(...(args as [string])),
  }
})

import { OneloAuth } from './auth'

const refreshSessionJson = {
  access_token: 'fresh-access',
  refresh_token: 'fresh-refresh',
  expires_in: 900,
  user: { id: 'u1', email: 'a@b.com', role: 'member', tenant_id: null },
}

describe('OneloAuth.refreshSession — sign-out epoch guard', () => {
  beforeEach(() => {
    store.clear()
    httpPostImpl.mockClear()
    httpPostImpl.state.resolveRefresh = undefined
  })

  it('does NOT write the session back when signOut() lands mid-refresh (resurrection race)', async () => {
    store.set(TOKEN_KEYS_LOCAL.REFRESH_TOKEN, 'old-refresh')

    const auth = new OneloAuth({ apiUrl: 'https://api.test', publishableKey: 'pk_test' })
    await auth.whenReady()

    const listener = vi.fn()
    auth.onAuthStateChange(listener)

    // Kick off a refresh; it parks on the deferred httpPost.
    const refreshPromise = auth.refreshSession()
    // Let refreshSession read the token and reach the network await.
    await new Promise((r) => setTimeout(r, 0))
    expect(httpPostImpl.state.resolveRefresh).toBeDefined()

    // Sign out WHILE the refresh is in flight → bumps the epoch + clears storage.
    await auth.signOut()

    // Now the refresh resolves 200 with a perfectly valid session.
    httpPostImpl.state.resolveRefresh!(refreshSessionJson)
    const result = await refreshPromise

    // Guard must abandon the write-back.
    expect(result).toBeNull()
    expect(await auth.getSession()).toBeNull()
    expect(store.has(TOKEN_KEYS_LOCAL.ACCESS_TOKEN)).toBe(false)

    // Listeners must never have been notified with a live session.
    for (const call of listener.mock.calls) expect(call[0]).toBeNull()
  })

  it('happy path — no sign-out → the refreshed session is persisted and returned', async () => {
    store.set(TOKEN_KEYS_LOCAL.REFRESH_TOKEN, 'old-refresh')

    const auth = new OneloAuth({ apiUrl: 'https://api.test', publishableKey: 'pk_test' })
    await auth.whenReady()

    const listener = vi.fn()
    auth.onAuthStateChange(listener)

    const refreshPromise = auth.refreshSession()
    await new Promise((r) => setTimeout(r, 0))
    httpPostImpl.state.resolveRefresh!(refreshSessionJson)
    const result = await refreshPromise

    expect(result).not.toBeNull()
    expect(result?.user.id).toBe('u1')
    expect(result?.accessToken).toBe('fresh-access')
    expect(store.get(TOKEN_KEYS_LOCAL.ACCESS_TOKEN)).toBe('fresh-access')
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ accessToken: 'fresh-access' }))

    const session = await auth.getSession()
    expect(session?.user.id).toBe('u1')

    // Clean up armed heartbeat / refresh timers.
    await auth.signOut()
  })
})
