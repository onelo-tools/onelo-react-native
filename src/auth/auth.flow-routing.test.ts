/**
 * Tests for the centralised flow routing in loadAuthView / resolveFlow (auth.ts).
 *
 * `/api/sdk/flow/init` returns the single next step:
 *   - action 'authorized' → show content, NO WebView (returns current session)
 *   - action 'present'    → open the hosted WebView at `url`
 *   - 404 / 405           → endpoint not deployed → fall back to legacy /auth/initiate
 *   - any real error (e.g. store_not_configured, 400) → THROW, never fall back
 *
 * The last point is the fallback-tightening regression: a real routing error must
 * surface, not be masked by silently opening the legacy initiate URL.
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

// Mutable per-test flow/init response.
const { flow } = vi.hoisted(() => ({ flow: { value: { status: 200, json: {} as Record<string, unknown> } } }))

const httpGetMock = vi.fn(async (url: string) => {
  if (url.includes('/api/sdk/config')) {
    return { status: 200, json: {
      supabase_url: 'https://x.supabase.co',
      supabase_anon_key: 'anon',
      tenant_id: 'tenant-1',
      allow_custom_branding: false,
      paywall_enabled: false,
    } }
  }
  if (url.includes('/api/sdk/flow/init')) return flow.value
  if (url.includes('/api/sdk/auth/initiate')) return { status: 200, json: { hosted_url: 'https://legacy-initiate' } }
  if (url.includes('/api/sdk/auth/user')) return { status: 200, json: { entitlement: 'none' } }
  return { status: 404, json: {} }
})

vi.mock('@onelo/core', async () => {
  const actual = await vi.importActual<typeof import('@onelo/core')>('@onelo/core')
  return {
    ...actual,
    httpGet: (...args: unknown[]) => httpGetMock(...(args as [string])),
    httpPost: vi.fn().mockResolvedValue({ status: 200, json: {} }),
  }
})

import { OneloAuth } from './auth'

const API = 'https://api.test'
const KEY = 'pk_test'

function seedValidSession() {
  store.set(TK.ACCESS_TOKEN, 'atok')
  store.set(TK.REFRESH_TOKEN, 'rtok')
  store.set(TK.EXPIRES_AT, String(Math.floor(Date.now() / 1000) + 900))
  store.set(TK.USER_JSON, JSON.stringify({ id: 'u1', email: 'a@b.com', role: 'member', tenantId: null, entitlement: 'none' }))
}

/** Poll (across macrotasks) until the modal opens — loadAuthView has several
 *  chained awaits (flow/init, then getHostedUrl on the fallback path). */
async function waitForModal(auth: OneloAuth, tries = 50): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (auth.getModalState().visible) return
    await new Promise((r) => setTimeout(r, 0))
  }
}
const initiateWasCalled = () => httpGetMock.mock.calls.some((c) => String(c[0]).includes('/api/sdk/auth/initiate'))

async function makeAuth() {
  const auth = new OneloAuth({ apiUrl: API, publishableKey: KEY })
  await auth.whenReady()
  return auth
}

describe('OneloAuth.loadAuthView — flow routing', () => {
  beforeEach(() => {
    store.clear()
    httpGetMock.mockClear()
  })

  it('(regression) assigns modal onResult BEFORE notifying — the first notify carries a live handler, not a no-op', async () => {
    // The bug: notifyModalListeners() fired while _modalResolve was still null, so
    // the gate rendered <AuthModal onResult={no-op}> and there was no second notify
    // — the WebView callback hit the no-op, exchangeHostedCode never ran, sign-in
    // failed silently. The fix assigns _modalResolve BEFORE the open notify.
    flow.value = { status: 200, json: { action: 'present', url: 'https://hosted' } }
    const auth = await makeAuth()
    const onResultAtNotify: unknown[] = []
    auth.onModalStateChange(() => { onResultAtNotify.push(auth.getModalState().onResult) })

    void auth.loadAuthView() // hangs on the modal promise until onResult is called — don't await
    await waitForModal(auth)

    const state = auth.getModalState()
    expect(state.visible).toBe(true)
    expect(state.url).toBe('https://hosted')
    expect(state.onResult).toBeTypeOf('function')
    // The open notify (first) MUST already carry the resolver — with the bug it was null.
    expect(onResultAtNotify[0]).toBeTypeOf('function')

    await auth.signOut() // stop armed timers
  })

  it("(a) action 'authorized' → returns current session, opens NO modal/webview", async () => {
    seedValidSession()
    flow.value = { status: 200, json: { action: 'authorized' } }
    const auth = await makeAuth()
    const modalListener = vi.fn()
    auth.onModalStateChange(modalListener)

    const result = await auth.loadAuthView()

    expect(result?.user.id).toBe('u1')
    expect(auth.getModalState().visible).toBe(false)
    expect(modalListener).not.toHaveBeenCalled()
    expect(initiateWasCalled()).toBe(false)

    await auth.signOut() // stop armed timers
  })

  it("(b) action 'present' → opens the modal at the returned url", async () => {
    flow.value = { status: 200, json: { action: 'present', surface: 'signin', url: 'https://hosted-signin' } }
    const auth = await makeAuth()
    const modalListener = vi.fn()
    auth.onModalStateChange(modalListener)

    const p = auth.loadAuthView()
    await waitForModal(auth)

    expect(auth.getModalState().visible).toBe(true)
    expect(auth.getModalState().url).toBe('https://hosted-signin')
    expect(modalListener).toHaveBeenCalled()
    expect(initiateWasCalled()).toBe(false)

    auth.getModalState().onResult?.({ type: 'cancelled' })
    await expect(p).resolves.toBeNull()
  })

  it('(c) 404 / 405 → falls back to legacy /auth/initiate', async () => {
    for (const status of [404, 405]) {
      store.clear()
      httpGetMock.mockClear()
      flow.value = { status, json: {} }
      const auth = await makeAuth()

      const p = auth.loadAuthView()
      await waitForModal(auth)

      expect(auth.getModalState().visible).toBe(true)
      expect(auth.getModalState().url).toBe('https://legacy-initiate')
      expect(initiateWasCalled()).toBe(true)

      auth.getModalState().onResult?.({ type: 'cancelled' })
      await expect(p).resolves.toBeNull()
    }
  })

  it('(d) a real error body (store_not_configured, 400) THROWS and does NOT fall back to initiate', async () => {
    flow.value = { status: 400, json: { detail: 'store_not_configured' } }
    const auth = await makeAuth()

    await expect(auth.loadAuthView()).rejects.toThrow('store_not_configured')
    expect(initiateWasCalled()).toBe(false)
  })
})

describe('OneloAuth.resolveFlow', () => {
  beforeEach(() => {
    store.clear()
    httpGetMock.mockClear()
  })

  it("maps action 'authorized'", async () => {
    flow.value = { status: 200, json: { action: 'authorized' } }
    const auth = await makeAuth()
    expect((await auth.resolveFlow()).action).toBe('authorized')
  })

  it("maps action 'present' with url", async () => {
    flow.value = { status: 200, json: { action: 'present', surface: 'store', url: 'https://hosted-store' } }
    const auth = await makeAuth()
    const decision = await auth.resolveFlow()
    expect(decision.action).toBe('present')
    if (decision.action === 'present') expect(decision.url).toBe('https://hosted-store')
  })

  it('throws on a real error, surfacing the backend reason', async () => {
    flow.value = { status: 400, json: { detail: 'store_not_configured' } }
    const auth = await makeAuth()
    await expect(auth.resolveFlow()).rejects.toThrow('store_not_configured')
  })
})
