/**
 * #542 — a magic link requested from the hosted sign-in can be opened on
 * another device (#540): the sheet shows a code, and once it is typed there the
 * hosted page INSIDE this app's modal navigates to `onelorn://callback?code=`.
 * Opened on this device, the OS hands the same URL to the app, possibly after a
 * relaunch. Pairing switches on only when the flow token carries a
 * `code_challenge`, so the hosted flow must send one on `/flow/init`, and its
 * verifier must survive a relaunch to exchange the code.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sha256 } from 'js-sha256'

const { store } = vi.hoisted(() => ({ store: new Map<string, string>() }))

vi.mock('../core/storage', () => ({
  KeychainStorage: vi.fn().mockImplementation(() => ({
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    set: vi.fn(async (k: string, v: string) => { store.set(k, v) }),
    delete: vi.fn(async (k: string) => { store.delete(k) }),
    clear: vi.fn(async () => { store.clear() }),
  })),
}))

const { flow, callback } = vi.hoisted(() => ({
  flow: { value: { status: 200, json: { action: 'present', url: 'https://hosted.onelo.tools/auth/hosted?token=art_1' } as Record<string, unknown> } },
  callback: { value: null as null | { status: number; json: Record<string, unknown> } },
}))

const SESSION_JSON = {
  access_token: 'at', refresh_token: 'rt', expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: 'u1', email: 'a@b.com', role: 'member', tenant_id: null, entitlement: 'none' },
}

const httpGetMock = vi.fn(async (url: string) => {
  if (url.includes('/api/sdk/config')) {
    return {
      status: 200,
      json: { supabase_url: 'https://x.supabase.co', supabase_anon_key: 'anon', tenant_id: 't', allow_custom_branding: false, paywall_enabled: false },
    }
  }
  if (url.includes('/api/sdk/flow/init')) return flow.value
  return { status: 404, json: {} }
})

const httpPostMock = vi.fn(async (url: string, _body?: Record<string, unknown>) => {
  if (url.includes('/api/sdk/auth/hosted-callback')) return callback.value ?? { status: 200, json: SESSION_JSON }
  return { status: 200, json: {} }
})

vi.mock('@onelo/core', async () => {
  const actual = await vi.importActual<typeof import('@onelo/core')>('@onelo/core')
  return {
    ...actual,
    httpGet: (...args: unknown[]) => httpGetMock(...(args as [string])),
    httpPost: (...args: unknown[]) => httpPostMock(...(args as [string, Record<string, unknown>])),
  }
})

import { TOKEN_KEYS } from '@onelo/core'
import { OneloAuth } from './auth'

const API = 'https://api.test'
const KEY = 'pk_test'

function s256(verifier: string): string {
  const bytes = new Uint8Array(sha256.arrayBuffer(verifier))
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function makeAuth(): Promise<OneloAuth> {
  const auth = new OneloAuth({ apiUrl: API, publishableKey: KEY })
  await auth.whenReady()
  return auth
}

async function waitForModal(auth: OneloAuth): Promise<void> {
  for (let i = 0; i < 50 && !auth.getModalState().visible; i++) await new Promise((r) => setTimeout(r, 0))
}

const flowInitUrl = () => String(httpGetMock.mock.calls.find((c) => String(c[0]).includes('/api/sdk/flow/init'))?.[0])
const exchanges = () => httpPostMock.mock.calls.filter((c) => String(c[0]).includes('/hosted-callback'))

describe('#542 hosted flow is bound to a persisted PKCE verifier', () => {
  beforeEach(() => {
    store.clear()
    httpGetMock.mockClear()
    httpPostMock.mockClear()
    callback.value = null
  })

  it('sends on /flow/init the S256 challenge of a verifier kept in secure storage', async () => {
    const auth = await makeAuth()
    void auth.loadAuthView()
    await waitForModal(auth)

    const stored = store.get(TOKEN_KEYS.MAGIC_LINK_VERIFIER)
    expect(stored, 'verifier persisted').toBeTruthy()
    const challenge = new URL(flowInitUrl()).searchParams.get('code_challenge')
    expect(challenge).toBe(s256(stored!))
  })

  it('a paired return inside the modal is exchanged with that verifier, then the slot is cleared', async () => {
    const auth = await makeAuth()
    const pending = auth.loadAuthView()
    await waitForModal(auth)
    const stored = store.get(TOKEN_KEYS.MAGIC_LINK_VERIFIER)

    // The hosted page navigated to onelorn://callback?code=… after the code was typed elsewhere.
    auth.getModalState().onResult!({ type: 'code', code: 'paired-code' })
    const session = await pending

    expect(session?.user.id).toBe('u1')
    expect(exchanges()).toHaveLength(1)
    expect(exchanges()[0][1]).toMatchObject({ code: 'paired-code', code_verifier: stored })
    expect(store.has(TOKEN_KEYS.MAGIC_LINK_VERIFIER), 'single use').toBe(false)
  })

  it('after a relaunch, the same-device deep link is exchanged with the stored verifier', async () => {
    const first = await makeAuth()
    void first.loadAuthView()
    await waitForModal(first)
    const stored = store.get(TOKEN_KEYS.MAGIC_LINK_VERIFIER)
    expect(stored).toBeTruthy()

    // Process killed while the user was in Mail; a NEW instance is launched by the link.
    const relaunched = await makeAuth()
    const session = await relaunched.handleLaunchUrl('onelorn://callback?code=same-device')

    expect(session?.user.id).toBe('u1')
    expect(exchanges().at(-1)![1]).toMatchObject({ code: 'same-device', code_verifier: stored })
  })

  it('handles the launch URL only once per instance (getInitialURL repeats it for the process)', async () => {
    const auth = await makeAuth()
    await auth.handleLaunchUrl('onelorn://callback?code=c1')
    await expect(auth.handleLaunchUrl('onelorn://callback?code=c1')).resolves.toBeNull()
    await expect(auth.handleLaunchUrl(null)).resolves.toBeNull()
    expect(exchanges()).toHaveLength(1)
  })

  it('a missing or mismatched verifier fails once with a clear error and does not retry', async () => {
    callback.value = { status: 401, json: { detail: 'PKCE verification failed' } }
    const auth = await makeAuth()

    await expect(auth.handleAuthCallback('onelorn://callback?code=stale')).rejects.toThrow(/different sign-in/i)
    expect(exchanges()).toHaveLength(1)
  })

  it('surfaces the backend reason on any other failed exchange', async () => {
    callback.value = { status: 401, json: { detail: 'Code already used' } }
    const auth = await makeAuth()
    await expect(auth.handleAuthCallback('onelorn://callback?code=used')).rejects.toThrow('Code already used')
  })

  it('a failed exchange keeps the stored verifier (it may belong to the flow still open)', async () => {
    const auth = await makeAuth()
    void auth.loadAuthView()
    await waitForModal(auth)
    const stored = store.get(TOKEN_KEYS.MAGIC_LINK_VERIFIER)

    callback.value = { status: 401, json: { detail: 'Code already used' } }
    await expect(auth.exchangeHostedCode('dup')).rejects.toThrow()
    expect(store.get(TOKEN_KEYS.MAGIC_LINK_VERIFIER)).toBe(stored)
  })

  it('the custom-UI sendMagicLink() stays unpaired', async () => {
    const auth = await makeAuth()
    await auth.sendMagicLink('a@b.com')
    const call = httpPostMock.mock.calls.find((c) => String(c[0]).includes('/api/sdk/auth/magic-link'))
    expect(call?.[1]).not.toHaveProperty('code_challenge')
  })
})
