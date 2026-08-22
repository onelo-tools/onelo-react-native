/**
 * Regression for the RN "magic link has nowhere to land while the modal isn't
 * mounted" gap (2026-08-20): `<AuthModal>`'s own `Linking` listener only runs
 * while `visible` (auth-modal.tsx:298-308), so a hosted-auth flow that finishes
 * via the OS deep link while the modal happens to be unmounted was silently
 * dropped — no other Onelo SDK had this restriction.
 *
 * `OneloAuth.handleAuthCallback(url)` is the modal-lifetime-independent entry
 * point a host app wires into its own app-root `Linking` listener.
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

const { flow } = vi.hoisted(() => ({ flow: { value: { status: 200, json: {} as Record<string, unknown> } } }))

const httpGetMock = vi.fn(async (url: string) => {
  if (url.includes('/api/sdk/config')) {
    return {
      status: 200,
      json: {
        supabase_url: 'https://x.supabase.co', supabase_anon_key: 'anon',
        tenant_id: 'tenant-1', allow_custom_branding: false, paywall_enabled: false,
      },
    }
  }
  if (url.includes('/api/sdk/flow/init')) return flow.value
  return { status: 404, json: {} }
})

const httpPostMock = vi.fn(async (url: string) => {
  if (url.includes('/api/sdk/auth/hosted-callback')) {
    return {
      status: 200,
      json: {
        access_token: 'at', refresh_token: 'rt', expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { id: 'u1', email: 'a@b.com', role: 'member', tenant_id: null, entitlement: 'none' },
      },
    }
  }
  return { status: 200, json: {} }
})

vi.mock('@onelo/core', async () => {
  const actual = await vi.importActual<typeof import('@onelo/core')>('@onelo/core')
  return {
    ...actual,
    httpGet: (...args: unknown[]) => httpGetMock(...(args as [string])),
    httpPost: (...args: unknown[]) => httpPostMock(...(args as [string])),
  }
})

import { OneloAuth } from './auth'

const API = 'https://api.test'
const KEY = 'pk_test'

async function waitForModal(auth: OneloAuth, tries = 50): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (auth.getModalState().visible) return
    await new Promise((r) => setTimeout(r, 0))
  }
}

async function makeAuth(): Promise<OneloAuth> {
  const auth = new OneloAuth({ apiUrl: API, publishableKey: KEY })
  await auth.whenReady()
  return auth
}

describe('OneloAuth.handleAuthCallback', () => {
  beforeEach(() => {
    store.clear()
    httpGetMock.mockClear()
    httpPostMock.mockClear()
  })

  it('ignores a URL that is not our callback scheme', async () => {
    flow.value = { status: 200, json: { action: 'present', url: 'https://hosted' } }
    const auth = await makeAuth()
    await expect(auth.handleAuthCallback('https://example.com/not-ours')).resolves.toBeNull()
    await auth.signOut()
  })

  it('a pending loadAuthView() flow resolves via handleAuthCallback even though nothing rendered <AuthModal> — the reported gap', async () => {
    flow.value = { status: 200, json: { action: 'present', url: 'https://hosted-signin' } }
    const auth = await makeAuth()

    // loadAuthView() is pending — <AuthModal> was NEVER mounted (or was already
    // unmounted). Before the fix, a deep link in this state had nowhere to go;
    // this is exactly what a magic link opened in the system browser hits.
    const pending = auth.loadAuthView()
    await waitForModal(auth)

    const result = await auth.handleAuthCallback('onelorn://callback?code=abc123')
    // handleAuthCallback itself returns null here — the outcome lands on the
    // ORIGINAL loadAuthView() promise, exactly as it would if <AuthModal> had
    // caught the deep link itself.
    expect(result).toBeNull()

    const session = await pending
    expect(session?.user.id).toBe('u1')
    expect(auth.getModalState().visible).toBe(false)
  })

  it('a gate refusal from a known hosted origin re-presents the modal on the refusal surface', async () => {
    flow.value = { status: 200, json: { action: 'present', url: 'https://hosted.onelo.tools/auth/hosted' } }
    const auth = await makeAuth()
    void auth.loadAuthView()
    await waitForModal(auth)

    const gateUrl = 'https://hosted.onelo.tools/no-plan/hosted?reason=no_plan'
    await auth.handleAuthCallback(`onelorn://callback?gate=${encodeURIComponent(gateUrl)}`)

    expect(auth.getModalState().visible).toBe(true)
    expect(auth.getModalState().url).toBe(gateUrl)

    await auth.signOut()
  })

  it('refuses a gate URL from a foreign origin', async () => {
    flow.value = { status: 200, json: { action: 'present', url: 'https://hosted.onelo.tools/auth/hosted' } }
    const auth = await makeAuth()
    const pending = auth.loadAuthView()
    await waitForModal(auth)

    const foreignGate = 'https://evil.example.com/phish'
    await auth.handleAuthCallback(`onelorn://callback?gate=${encodeURIComponent(foreignGate)}`)

    await expect(pending).rejects.toThrow('unknown origin')
  })

  it('with NO pending loadAuthView() flow (sendMagicLink + a custom "check your inbox" screen), exchanges the code directly', async () => {
    const auth = await makeAuth()
    // No loadAuthView() call in flight — this is sendMagicLink()'s own flow.
    const session = await auth.handleAuthCallback('onelorn://callback?code=xyz789')
    expect(session?.user.id).toBe('u1')
    const call = httpPostMock.mock.calls.find((c) => String(c[0]).includes('/hosted-callback'))
    expect(call).toBeTruthy()
    await auth.signOut()
  })

  it('with no pending flow and no code, returns null (nothing to complete)', async () => {
    const auth = await makeAuth()
    await expect(auth.handleAuthCallback('onelorn://callback?error=access_denied')).resolves.toBeNull()
  })
})
