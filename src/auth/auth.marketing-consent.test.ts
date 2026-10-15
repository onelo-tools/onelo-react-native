/** #818 — a custom React Native sign-up screen asks with the /config text,
 *  and signUp sends the ticked consent in the language of that text. */
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

const { calls } = vi.hoisted(() => ({
  calls: { configUrls: [] as string[], posts: [] as Array<{ url: string; body: Record<string, unknown> }> },
}))
const QUESTION = { asked: true, text: 'Updates from Turingo.', language: 'pl' }

vi.mock('@onelo/core', async () => {
  const actual = await vi.importActual<typeof import('@onelo/core')>('@onelo/core')
  return {
    ...actual,
    httpGet: vi.fn(async (url: string) => {
      if (url.includes('/api/sdk/config')) {
        calls.configUrls.push(url)
        return { status: 200, json: {
          supabase_url: 'https://x.supabase.co', supabase_anon_key: 'anon', tenant_id: 'tenant-1',
          allow_custom_branding: true, paywall_enabled: false, signup_marketing_consent: QUESTION,
        } }
      }
      return { status: 404, json: {} }
    }),
    httpPost: vi.fn(async (url: string, body: Record<string, unknown>) => {
      calls.posts.push({ url, body })
      return { status: 200, json: {
        access_token: 'acc', refresh_token: 'ref', expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { id: 'u1', email: 'a@b.c' },
      } }
    }),
  }
})

import { OneloAuth } from './auth'

beforeEach(() => {
  store.clear()
  calls.configUrls.length = 0
  calls.posts.length = 0
})

describe('OneloAuth — Marketing Consent at sign-up (#818)', () => {
  it('asks /config with a language and exposes the question', async () => {
    const auth = new OneloAuth({ apiUrl: 'https://api.test', publishableKey: 'pk_test' })
    await auth.whenReady()
    expect(calls.configUrls[0]).toMatch(/[?&]lang=/)
    expect(auth.getSignupMarketingConsent()).toEqual(QUESTION)
  })

  it('sends the ticked consent, and nothing when unticked', async () => {
    const auth = new OneloAuth({ apiUrl: 'https://api.test', publishableKey: 'pk_test' })
    await auth.whenReady()
    await auth.signUp('a@b.c', 'Passw0rd!x', { marketingConsent: true })
    await auth.signUp('b@b.c', 'Passw0rd!x')
    const signups = calls.posts.filter((p) => p.url.endsWith('/api/sdk/auth/signup'))
    expect(signups[0].body).toMatchObject({ marketing_consent: true, lang: 'pl' })
    expect(signups[1].body).not.toHaveProperty('marketing_consent')
  })
})
