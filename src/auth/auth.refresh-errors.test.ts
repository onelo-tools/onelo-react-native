/**
 * #548 — what a refused refresh tells the app.
 *
 * The backend answers /auth/refresh refusals as { detail: { error | error_code } }
 * (sdk_auth.py). Only `banned` is an account action ("suspended");
 * session_compromised / session_expired / session_invalid end the session with a
 * neutral error; no_plan_available stays plan-accurate. getSession() — which the
 * gate, timers and background work call — never throws for any of them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { store } = vi.hoisted(() => ({ store: new Map<string, string>() }))
const KEYS = {
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
    clear: vi.fn(async () => { for (const k of Object.values(KEYS)) store.delete(k) }),
  })),
}))
vi.mock('../core/pkce', () => ({
  generateCodeVerifier: vi.fn().mockReturnValue('verifier'),
  generateCodeChallenge: vi.fn().mockReturnValue('challenge'),
}))

const { refreshReply } = vi.hoisted(() => ({
  refreshReply: { status: 401, json: {} as Record<string, unknown> },
}))
vi.mock('@onelo/core', async () => {
  const actual = await vi.importActual<typeof import('@onelo/core')>('@onelo/core')
  return {
    ...actual,
    httpGet: vi.fn().mockResolvedValue({
      status: 200,
      json: { tenant_id: 'tenant-1', allow_custom_branding: true, paywall_enabled: false },
    }),
    httpPost: vi.fn(async (url: string) =>
      String(url).includes('/api/sdk/auth/refresh') ? refreshReply : { status: 200, json: {} }),
  }
})

import { OneloAuth } from './auth'

function seedSession(expiresInSec: number) {
  store.set(KEYS.ACCESS_TOKEN, 'at')
  store.set(KEYS.REFRESH_TOKEN, 'rt')
  store.set(KEYS.EXPIRES_AT, String(Math.floor(Date.now() / 1000) + expiresInSec))
  store.set(KEYS.USER_JSON, JSON.stringify({ id: 'u1', email: 'a@b.c' }))
}

async function newAuth() {
  const auth = new OneloAuth({ apiUrl: 'https://api.test', publishableKey: 'pk_test' })
  await auth.whenReady()
  return auth
}

describe('OneloAuth.refreshSession — refusal mapping (#548)', () => {
  beforeEach(() => { store.clear(); seedSession(10_000) })

  it.each(['session_compromised', 'session_expired', 'session_invalid'])(
    '%s → neutral session_ended, cleared + announced, NOT revoked',
    async (code) => {
      refreshReply.status = 401
      refreshReply.json = { detail: { error: code } }
      const auth = await newAuth()
      const seen: unknown[] = []
      auth.onAuthStateChange((s) => seen.push(s))
      const err = await auth.refreshSession().catch((e) => e)
      expect(err?.code).toBe('session_ended')
      expect(err?.message).toBe('Your session ended — please sign in again')
      expect(auth.isUserRevoked).toBe(false)
      expect(seen.at(-1)).toBeNull()
      expect(store.has(KEYS.REFRESH_TOKEN)).toBe(false)
    },
  )

  it('banned → user_revoked ("suspended") + isUserRevoked', async () => {
    refreshReply.status = 403
    refreshReply.json = { detail: { error: 'banned' } }
    const auth = await newAuth()
    await expect(auth.refreshSession()).rejects.toMatchObject({ code: 'user_revoked' })
    expect(auth.isUserRevoked).toBe(true)
  })

  it('no_plan_available → no_active_plan, not a revocation', async () => {
    refreshReply.status = 403
    refreshReply.json = { detail: { error_code: 'no_plan_available', message: 'x' } }
    const auth = await newAuth()
    await expect(auth.refreshSession()).rejects.toMatchObject({ code: 'no_active_plan' })
    expect(auth.isUserRevoked).toBe(false)
  })

  it('getSession near expiry with a refused refresh resolves null — never throws', async () => {
    store.clear(); seedSession(10)
    refreshReply.status = 401
    refreshReply.json = { detail: { error: 'session_compromised' } }
    const auth = await newAuth()
    await expect(auth.getSession()).resolves.toBeNull()
  })
})

describe('OneloAuth.refreshSession — transient failures keep the session (#547/#548)', () => {
  beforeEach(() => { store.clear(); seedSession(10_000) })

  it.each([
    [503, { detail: { error: 'refresh_unavailable' } }],
    [502, {}],
    [429, {}],
  ])('%s → session kept, nothing announced, server_error thrown', async (status, json) => {
    refreshReply.status = status as number
    refreshReply.json = json
    const auth = await newAuth()
    const seen: unknown[] = []
    auth.onAuthStateChange((s) => seen.push(s))
    await expect(auth.refreshSession()).rejects.toMatchObject({ code: 'server_error' })
    expect(seen).toEqual([])
    expect(store.get(KEYS.REFRESH_TOKEN)).toBe('rt')
    expect(auth.isUserRevoked).toBe(false)
    ;(auth as unknown as { clearRefreshTimer(): void }).clearRefreshTimer()
  })

  it('getSession with an expired token during a 503 answers the stored session — never throws into the gate', async () => {
    store.clear(); seedSession(-5)
    refreshReply.status = 503
    refreshReply.json = { detail: { error: 'refresh_unavailable' } }
    const auth = await newAuth()
    await expect(auth.getSession()).resolves.toMatchObject({ refreshToken: 'rt' })
    await expect(auth.getSession()).resolves.toMatchObject({ refreshToken: 'rt' }) // inside the backoff
    ;(auth as unknown as { clearRefreshTimer(): void }).clearRefreshTimer()
  })
})
