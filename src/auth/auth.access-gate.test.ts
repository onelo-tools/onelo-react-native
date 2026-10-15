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

describe('Email Verification (#819)', () => {
  it('withholds an unverified user on a FREE app — the server says no', async () => {
    seedSession({ entitlement: 'none', allowedIn: false, emailVerified: false, accessReason: 'email_unverified' })
    const auth = await makeAuth()
    expect(await auth.isAllowedIn()).toBe(false)
    const session = await auth.getSession()
    expect(session?.user.accessReason).toBe('email_unverified')
  })

  it('lets them in once the refresh reports the address verified', async () => {
    seedSession({ entitlement: 'none', allowedIn: false, emailVerified: false, accessReason: 'email_unverified' })
    const auth = await makeAuth()

    userRes.value = { entitlement: 'none', allowed_in: true, email_verified: true }
    await auth.revalidateEntitlement()

    expect(await auth.isAllowedIn()).toBe(true)
    const session = await auth.getSession()
    expect(session?.user.emailVerified).toBe(true)
    expect(session?.user.accessReason).toBeUndefined()
  })

  it('resends as the signed-in user and confirms with the publishable key', async () => {
    const core = await import('@onelo/core')
    const post = vi.mocked(core.httpPost)
    seedSession({ entitlement: 'none', allowedIn: false })
    const auth = await makeAuth()

    post.mockResolvedValueOnce({ status: 200, json: { sent: true, email_verified: false } })
    await expect(auth.resendVerificationEmail()).resolves.toEqual({ sent: true, emailVerified: false })
    const [rUrl, rBody, rHeaders] = post.mock.calls.at(-1) as [string, Record<string, unknown>, Record<string, string>]
    expect(rUrl).toBe('https://api.test/api/sdk/auth/verify-email/resend')
    expect(rBody).toEqual({ publishableKey: 'pk_test' })
    expect(rHeaders.Authorization).toBe('Bearer atok')

    post.mockResolvedValueOnce({ status: 200, json: { email_verified: true } })
    // The refresh after confirming answers fresh; /user is deliberately left
    // saying "no" — it is cached per token for 30 s and must not be asked.
    post.mockResolvedValueOnce({ status: 200, json: {
      session: { access_token: 'atok2', refresh_token: 'rtok2', expires_in: 900 },
      user: { id: 'u1', email: 'a@b.com', entitlement: 'none', allowed_in: true, email_verified: true },
    } })
    userRes.value = { entitlement: 'none', allowed_in: false, email_verified: false, access_reason: 'email_unverified' }
    await auth.confirmEmail('tok')
    const urls = post.mock.calls.slice(-2).map((c) => c[0])
    expect(urls).toEqual([
      'https://api.test/api/sdk/auth/verify-email/confirm',
      'https://api.test/api/sdk/auth/refresh',
    ])
    expect(post.mock.calls.at(-2)![1]).toEqual({ publishableKey: 'pk_test', token: 'tok' })
    // Confirming on this device lets the user in at once.
    expect(await auth.isAllowedIn()).toBe(true)
    expect((await auth.getSession())?.user.emailVerified).toBe(true)
  })

  it('resend refuses with no session', async () => {
    const auth = await makeAuth()
    await expect(auth.resendVerificationEmail()).rejects.toMatchObject({ code: 'not_authenticated' })
  })
})
