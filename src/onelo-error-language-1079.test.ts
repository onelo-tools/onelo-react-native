/**
 * #1079 — an `OneloError` message an App User may be shown (from @onelo/core)
 * follows the Page Language this SDK adopts, like its own texts (#1076). The
 * error code does not change; messages that address the developer stay English.
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

let configAnswer: { status: number; json: Record<string, unknown> } = { status: 200, json: {} }
vi.mock('@onelo/core', async (orig) => ({
  ...(await orig<typeof import('@onelo/core')>()),
  httpGet: vi.fn(async (url: string) =>
    url.includes('/api/sdk/config') ? configAnswer : { status: 404, json: {} }),
  httpPost: vi.fn().mockResolvedValue({ status: 200, json: {} }),
}))

import { OneloError, pageLanguage as corePageLanguage } from '@onelo/core'
import { OneloAuth } from './auth/auth'
import { _resetPageLanguageForTests, adoptPageLanguage } from './core/page-language'

const CONFIG = {
  supabase_url: 'https://x.supabase.co', supabase_anon_key: 'anon', tenant_id: 'tenant-1',
  allow_custom_branding: false, paywall_enabled: false,
}

beforeEach(() => {
  store.clear()
  _resetPageLanguageForTests()
  configAnswer = { status: 200, json: { ...CONFIG } }
  vi.stubGlobal('navigator', { language: 'de-DE' })
})
afterEach(() => {
  vi.unstubAllGlobals()
  _resetPageLanguageForTests()
})

describe('OneloError messages follow the Page Language (#1079)', () => {
  it('English until the backend answers', () => {
    expect(OneloError.sessionEnded().message).toBe('Your session ended — please sign in again')
  })

  it('the answer of /api/sdk/config reaches the error messages; the code is unchanged', async () => {
    configAnswer = { status: 200, json: { ...CONFIG, page_language: 'pl' } }
    const auth = new OneloAuth({ apiUrl: 'https://api.test', publishableKey: 'pk_test' })
    await auth.whenReady()
    expect(auth.pageLanguage).toBe('pl')
    expect(corePageLanguage()).toBe('pl')
    const e = OneloError.sessionEnded()
    expect(e.code).toBe('session_ended')
    expect(e.message).toBe('Twoja sesja się zakończyła — zaloguj się ponownie')
  })

  it('the language kept from the last launch reaches them too', () => {
    adoptPageLanguage('de-DE')
    expect(OneloError.userRevoked().message).toBe('Dieses Benutzerkonto wurde gesperrt')
    expect(OneloError.invalidKey('x').message).toBe('Invalid publishable key: x')
  })
})
