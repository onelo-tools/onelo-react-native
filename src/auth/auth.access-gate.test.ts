/**
 * `isAllowedIn` — the Access Gate answer, READ from the server.
 *
 * The rule `!paywallEnabled || entitlement === 'active'` once lived in this SDK,
 * in the JS SDK and in Swift — three copies, each found wrong on a different
 * day. The JS copy answered `true` while its config was still loading, so a
 * plan-less user walked into a paid app on every page load (2026-08-18). The
 * server now computes `allowed_in` and ships the conclusion.
 *
 * Contract: docs/sdk-access-gate-wiring.md
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { store } = vi.hoisted(() => ({ store: new Map<string, string>() }))

const TK = {
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
    clear: vi.fn(async () => { for (const k of Object.values(TK)) store.delete(k) }),
  })),
}))

vi.mock('../core/pkce', () => ({
  generateCodeVerifier: vi.fn().mockReturnValue('verifier'),
  generateCodeChallenge: vi.fn().mockReturnValue('challenge'),
}))

const { cfg, userRes } = vi.hoisted(() => ({
  cfg: { paywallEnabled: false },
  userRes: { value: { entitlement: 'none' } as Record<string, unknown> },
}))

vi.mock('@onelo/core', async () => {
  const actual = await vi.importActual<typeof import('@onelo/core')>('@onelo/core')
  return {
    ...actual,
    httpGet: vi.fn(async (url: string) => {
      if (url.includes('/api/sdk/config')) {
        return { status: 200, json: {
          supabase_url: 'https://x.supabase.co', supabase_anon_key: 'anon',
          tenant_id: 'tenant-1', allow_custom_branding: false,
          paywall_enabled: cfg.paywallEnabled,
        } }
      }
      if (url.includes('/api/sdk/auth/user')) return { status: 200, json: userRes.value }
      return { status: 404, json: {} }
    }),
    httpPost: vi.fn().mockResolvedValue({ status: 200, json: {} }),
  }
})

import { OneloAuth } from './auth'

function seedSession(user: Record<string, unknown>) {
  store.set(TK.ACCESS_TOKEN, 'atok')
  store.set(TK.REFRESH_TOKEN, 'rtok')
  store.set(TK.EXPIRES_AT, String(Math.floor(Date.now() / 1000) + 900))
  store.set(TK.USER_JSON, JSON.stringify({
    id: 'u1', email: 'a@b.com', role: 'member', tenantId: null, entitlement: 'none', ...user,
  }))
}

async function makeAuth() {
  const auth = new OneloAuth({ apiUrl: 'https://api.test', publishableKey: 'pk_test' })
  await auth.whenReady()
  return auth
}

beforeEach(() => {
  store.clear()
  cfg.paywallEnabled = false
  userRes.value = { entitlement: 'none' }
})

describe('isAllowedIn', () => {
  it('trusts a YES that nothing here could derive', async () => {
    // Paywall on, no entitlement — the old local rule refused. The server may
    // know about a grant this client has not seen, and it is the one deciding.
    cfg.paywallEnabled = true
    seedSession({ entitlement: 'none', allowedIn: true })
    const auth = await makeAuth()

    expect(await auth.isAllowedIn()).toBe(true)
  })

  it('honours a NO even when the local flags say otherwise', async () => {
    // No paywall + active entitlement → the old rule said "allowed". Giving a
    // paid product away cannot be undone.
    seedSession({ entitlement: 'active', allowedIn: false })
    const auth = await makeAuth()

    expect(await auth.isAllowedIn()).toBe(false)
  })

  it('falls back when the backend has not shipped allowed_in yet', async () => {
    // Compatibility, not a second source of truth: without it an app would be
    // locked out the moment this SDK updated ahead of the backend.
    seedSession({ entitlement: 'active' })
    const auth = await makeAuth()

    expect(await auth.isAllowedIn()).toBe(true)
  })

  it('refuses when nobody is signed in', async () => {
    const auth = await makeAuth()
    expect(await auth.isAllowedIn()).toBe(false)
  })

  it('refreshes the ANSWER, not just the entitlement', async () => {
    // Refreshing entitlement alone left a paying customer holding a stored
    // "not allowed" — locked out by the very call meant to let them in.
    cfg.paywallEnabled = true
    seedSession({ entitlement: 'none', allowedIn: false })
    const auth = await makeAuth()

    userRes.value = { entitlement: 'active', allowed_in: true }
    await auth.revalidateEntitlement()

    expect(await auth.isAllowedIn()).toBe(true)
  })
})
