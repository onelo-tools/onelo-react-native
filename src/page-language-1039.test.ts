/**
 * #1039 — every SDK sends the device language when it opens a hosted page and
 * the App passes none; a language the App passes is sent unchanged. The backend
 * picks the Page Language within the App Languages (#1036); the SDK never
 * chooses. Same scenarios in every SDK.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { store } = vi.hoisted(() => ({ store: new Map<string, string>() }))

vi.mock('./core/storage', () => ({
  KeychainStorage: vi.fn().mockImplementation(() => ({
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    set: vi.fn(async (k: string, v: string) => { store.set(k, v) }),
    delete: vi.fn(async (k: string) => { store.delete(k) }),
    clear: vi.fn(async () => { store.clear() }),
  })),
}))
vi.mock('./core/pkce', () => ({
  generateCodeVerifier: vi.fn().mockReturnValue('verifier'),
  generateCodeChallenge: vi.fn().mockReturnValue('challenge'),
}))

const httpGet = vi.fn(async (url: string) => {
  if (url.includes('/api/sdk/config')) {
    return { status: 200, json: {
      supabase_url: 'https://x.supabase.co', supabase_anon_key: 'anon', tenant_id: 'tenant-1',
      allow_custom_branding: false, paywall_enabled: false,
    } }
  }
  if (url.includes('/api/sdk/flow/init')) return { status: 200, json: { action: 'authorized' } }
  if (url.includes('/store-initiate')) return { status: 200, json: { store_url: 'https://st.test/store/hosted?token=srt_1' } }
  // upgrade-initiate: a refusal ends the call right after the request.
  return { status: 404, json: { detail: 'plan_not_purchasable' } }
})
vi.mock('@onelo/core', async (orig) => ({
  ...(await orig<typeof import('@onelo/core')>()),
  httpGet: (...a: unknown[]) => httpGet(...(a as [string])),
  httpPost: vi.fn().mockResolvedValue({ status: 200, json: {} }),
}))

import { OneloStore } from './store/store'
import { OneloAuth } from './auth/auth'

const SESSION = { accessToken: 'at' } as never

function makeStore() {
  return new OneloStore('https://api.test', 'pk_test', 'com.app', async () => 'at', async () => SESSION, undefined, 'onelorn', async () => SESSION)
}

function langSentTo(path: string): string | null {
  const call = httpGet.mock.calls.find((c) => new URL(c[0]).pathname === path)
  if (!call) throw new Error(`no request to ${path}`)
  return new URL(call[0]).searchParams.get('lang')
}

beforeEach(() => {
  httpGet.mockClear()
  store.clear()
  vi.stubGlobal('navigator', { language: 'de-DE' })
})
afterEach(() => { vi.unstubAllGlobals() })

describe('Store (store-initiate)', () => {
  it('sends the device language when the App passes none', async () => {
    await makeStore().initiateStoreFlow()
    expect(langSentTo('/api/sdk/paywall/store-initiate')).toBe('de-DE')
  })

  it('sends the language the App passes unchanged', async () => {
    await makeStore().initiateStoreFlow('pt-BR')
    expect(langSentTo('/api/sdk/paywall/store-initiate')).toBe('pt-BR')
  })
})

describe('Upgrade (upgrade-initiate)', () => {
  it('sends the device language when the App passes none', async () => {
    await makeStore().openUpgrade('pro').catch(() => {})
    expect(langSentTo('/api/sdk/paywall/upgrade-initiate')).toBe('de-DE')
  })

  it('sends the language the App passes unchanged', async () => {
    await makeStore().openUpgrade('pro', 'pl').catch(() => {})
    expect(langSentTo('/api/sdk/paywall/upgrade-initiate')).toBe('pl')
  })
})

describe('Sign-in (flow/init)', () => {
  it('sends the device language when the App passes none', async () => {
    const auth = new OneloAuth({ apiUrl: 'https://api.test', publishableKey: 'pk_test' })
    await auth.whenReady()
    await auth.resolveFlow()
    expect(langSentTo('/api/sdk/flow/init')).toBe('de-DE')
  })

  it('sends the language the App passes unchanged', async () => {
    const auth = new OneloAuth({ apiUrl: 'https://api.test', publishableKey: 'pk_test' })
    await auth.whenReady()
    await auth.resolveFlow('pl')
    expect(langSentTo('/api/sdk/flow/init')).toBe('pl')
  })
})
