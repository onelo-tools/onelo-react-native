/**
 * #25 — the gated auth entry points must WAIT for iOS App Attest to produce its
 * token before firing the first request. Otherwise a cold-start loadAuthView /
 * signIn races ahead of the ~3-4-round-trip attestation and the backend rejects
 * the tokenless request with 403 (then "works" seconds later once the token is
 * cached).
 *
 * These tests assert the ORDERING: with `attest_required: true`, no `/flow/init`
 * (loadAuthView) or `/auth/signin` (signIn) request goes out until the injected
 * attest-ready promise resolves; and without the injected gate (auth used
 * standalone) nothing hangs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { store } = vi.hoisted(() => ({ store: new Map<string, string>() }))

vi.mock('../core/storage', () => ({
  KeychainStorage: vi.fn().mockImplementation(() => ({
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    set: vi.fn(async (k: string, v: string) => { store.set(k, v) }),
    delete: vi.fn(async (k: string) => { store.delete(k) }),
    clear: vi.fn(async () => { store.clear() }),
  })),
}))

vi.mock('../core/pkce', () => ({
  generateCodeVerifier: vi.fn().mockReturnValue('verifier'),
  generateCodeChallenge: vi.fn().mockReturnValue('challenge'),
}))

const httpPostMock = vi.fn(async (_url: string, _body?: unknown, _headers?: Record<string, string>) => ({
  status: 200,
  json: {
    access_token: 'atok', refresh_token: 'rtok', expires_in: 3600,
    user: { id: 'u1', email: 'a@b.com', role: 'member', app_metadata: {} },
  },
}))
const httpGetMock = vi.fn(async (url: string) => {
  if (url.includes('/api/sdk/config')) {
    return { status: 200, json: {
      supabase_url: 'https://x.supabase.co',
      supabase_anon_key: 'anon',
      tenant_id: 'tenant-1',
      allow_custom_branding: true,   // so signIn/signUp reach the network
      paywall_enabled: false,
      attest_required: true,         // ← the gate under test
    } }
  }
  if (url.includes('/api/sdk/flow/init')) return { status: 200, json: { action: 'present', surface: 'sign_in', url: 'https://hosted' } }
  return { status: 404, json: {} }
})

vi.mock('@onelo/core', async () => {
  const actual = await vi.importActual<typeof import('@onelo/core')>('@onelo/core')
  return {
    ...actual,
    httpGet: (...args: unknown[]) => httpGetMock(...(args as [string])),
    httpPost: (...args: unknown[]) => httpPostMock(...(args as [string, unknown, Record<string, string>])),
  }
})

import { OneloAuth } from './auth'

const API = 'https://api.test'
const KEY = 'pk_test'

function deferred<T = void>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

const tick = async (n = 5) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)) }
const flowInitCalls = () => httpGetMock.mock.calls.filter((c) => String(c[0]).includes('/flow/init')).length
const signinCalls = () => httpPostMock.mock.calls.filter((c) => String(c[0]).includes('/auth/signin')).length

beforeEach(() => {
  store.clear()
  httpGetMock.mockClear()
  httpPostMock.mockClear()
})

describe('#25 — attest gating of first gated request', () => {
  it('loadAuthView waits for attestation before /flow/init when attest_required', async () => {
    const gate = deferred()
    const auth = new OneloAuth({ apiUrl: API, publishableKey: KEY }, () => gate.promise)
    await auth.whenReady()
    expect(auth.attestRequired).toBe(true)

    const p = auth.loadAuthView()
    await tick()
    // Attestation not done yet → flow/init MUST NOT have fired.
    expect(flowInitCalls()).toBe(0)

    gate.resolve()
    await tick()
    // Now attestation resolved → flow/init fires.
    expect(flowInitCalls()).toBe(1)

    // Cancel the opened modal so loadAuthView settles (no dangling promise).
    auth.getModalState().onResult?.({ type: 'cancelled' })
    await expect(p).resolves.toBeNull()
  })

  it('signIn waits for attestation before POST /auth/signin', async () => {
    const gate = deferred()
    const auth = new OneloAuth({ apiUrl: API, publishableKey: KEY }, () => gate.promise)
    await auth.whenReady()

    const p = auth.signIn('a@b.com', 'pw')
    await tick()
    expect(signinCalls()).toBe(0)   // blocked on attestation

    gate.resolve()
    await expect(p).resolves.toBeTruthy()
    expect(signinCalls()).toBe(1)
  })

  it('does not hang when no attest gate is injected (standalone auth use)', async () => {
    const auth = new OneloAuth({ apiUrl: API, publishableKey: KEY })  // no thunk
    await auth.whenReady()
    const p = auth.loadAuthView()
    await tick()
    expect(flowInitCalls()).toBe(1)  // fires immediately — nothing to await
    auth.getModalState().onResult?.({ type: 'cancelled' })
    await expect(p).resolves.toBeNull()
  })

  it('a failing (rejecting) attest gate does not block the request — best-effort', async () => {
    const auth = new OneloAuth({ apiUrl: API, publishableKey: KEY }, () => Promise.reject(new Error('attest failed')))
    await auth.whenReady()
    const p = auth.loadAuthView()
    await tick()
    expect(flowInitCalls()).toBe(1)  // rejection swallowed → proceeds
    auth.getModalState().onResult?.({ type: 'cancelled' })
    await expect(p).resolves.toBeNull()
  })

  it('a STALLED (never-settling) attest gate does not hang — proceeds after the cap', async () => {
    // A stalled network handshake never resolves/rejects. Without a bounded wait
    // this would hang loadAuthView forever (worse than the 403). Use fake timers
    // so we don't actually wait 5s.
    vi.useFakeTimers()
    try {
      const auth = new OneloAuth({ apiUrl: API, publishableKey: KEY }, () => new Promise<void>(() => { /* never settles */ }))
      await vi.advanceTimersByTimeAsync(0)  // let whenReady's microtasks flush
      await auth.whenReady()

      const p = auth.loadAuthView()
      await vi.advanceTimersByTimeAsync(0)
      expect(flowInitCalls()).toBe(0)               // still blocked before the cap

      await vi.advanceTimersByTimeAsync(5000)       // reach the cap
      expect(flowInitCalls()).toBe(1)               // proceeded tokenless

      auth.getModalState().onResult?.({ type: 'cancelled' })
      await expect(p).resolves.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
