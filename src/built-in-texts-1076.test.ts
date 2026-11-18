/**
 * #1076 — the React Native SDK's own texts ('Sign In', 'Cancel', 'Close
 * feedback', the feature badges, the retry screen) are in the App User's Page
 * Language (ADR-0043): the language the App passes, else the device language
 * within the App Languages, else the App's default. The backend chooses it
 * (`page_language` from `/api/sdk/config`, #1074); the SDK adopts, keeps and
 * renders it. Onelo translates its texts into en, pl, de, fr, es, it, pt, nl.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

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
const httpGet = vi.fn(async (url: string, _headers?: Record<string, string>) => {
  if (url.includes('/api/sdk/config')) return configAnswer
  if (url.includes('/api/sdk/flow/init')) return { status: 200, json: { action: 'authorized' } }
  if (url.includes('/store-initiate')) return { status: 200, json: { store_url: 'https://st.test/store/hosted?token=srt_1' } }
  if (url.includes('/consent/required')) return { status: 200, json: { required: [] } }
  return { status: 404, json: { detail: 'plan_not_purchasable' } }
})
vi.mock('@onelo/core', async (orig) => ({
  ...(await orig<typeof import('@onelo/core')>()),
  httpGet: (...a: unknown[]) => httpGet(...(a as [string, Record<string, string>])),
  httpPost: vi.fn().mockResolvedValue({ status: 200, json: {} }),
}))

import { OneloError } from '@onelo/core'
import { OneloAuth } from './auth/auth'
import { OneloStore } from './store/store'
import { OneloConsent } from './consent/consent'
import { OneloWaitlist } from './waitlist/waitlist'
import { FeatureState } from './features/features'
import {
  PAGE_LANGUAGE_STORAGE_KEY, SUPPORTED_TEXT_LANGUAGES, _resetPageLanguageForTests, acceptLanguage,
  adoptPageLanguage, currentPageLanguage,
} from './core/page-language'
import { ONELO_TEXTS, appUserMessage, oneloText, withAppUserText, type OneloTextKey } from './core/texts'

const CONFIG = {
  supabase_url: 'https://x.supabase.co', supabase_anon_key: 'anon', tenant_id: 'tenant-1',
  allow_custom_branding: false, paywall_enabled: false,
}

function requestTo(path: string): { url: URL; headers: Record<string, string> } {
  const call = httpGet.mock.calls.find((c) => new URL(c[0]).pathname === path)
  if (!call) throw new Error(`no request to ${path}`)
  return { url: new URL(call[0]), headers: call[1] ?? {} }
}

beforeEach(() => {
  httpGet.mockClear()
  store.clear()
  _resetPageLanguageForTests()
  configAnswer = { status: 200, json: { ...CONFIG } }
  vi.stubGlobal('navigator', { language: 'de-DE' })
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
let warn: { mockRestore: () => void }
afterEach(() => {
  vi.unstubAllGlobals()
  warn.mockRestore()
})

describe('every built-in text exists in every language Onelo translates into', () => {
  const keys = Object.keys(ONELO_TEXTS.en) as OneloTextKey[]

  it('has the eight languages', () => {
    expect(Object.keys(ONELO_TEXTS).sort()).toEqual([...SUPPORTED_TEXT_LANGUAGES].sort())
  })

  for (const lang of SUPPORTED_TEXT_LANGUAGES) {
    it(`${lang}: every text, none empty, the plan placeholder kept`, () => {
      expect(Object.keys(ONELO_TEXTS[lang]).sort()).toEqual([...keys].sort())
      for (const key of keys) expect(ONELO_TEXTS[lang][key].trim()).not.toBe('')
      expect(ONELO_TEXTS[lang].badgeAvailableIn).toContain('{plan}')
    })
  }

  it('translates the chrome away from English', () => {
    for (const lang of SUPPORTED_TEXT_LANGUAGES.filter((l) => l !== 'en')) {
      for (const key of ['signIn', 'cancel', 'closeFeedback', 'retry', 'somethingWentWrong'] as const) {
        expect(ONELO_TEXTS[lang][key], `${lang}.${key}`).not.toBe(ONELO_TEXTS.en[key])
      }
    }
  })
})

describe('the texts follow the Page Language', () => {
  it('is English before the backend first answers', () => {
    expect(currentPageLanguage()).toBe('en')
    expect(oneloText('signIn')).toBe('Sign In')
    expect(oneloText('cancel')).toBe('Cancel')
    expect(oneloText('closeFeedback')).toBe('Close feedback')
  })

  it('draws every text in the adopted language, by primary subtag', () => {
    adoptPageLanguage('pl-PL')
    expect(oneloText('signIn')).toBe('Zaloguj się')
    expect(oneloText('cancel')).toBe('Anuluj')
    expect(oneloText('closeFeedback')).toBe('Zamknij opinie')
  })

  it('falls back to English for a language Onelo does not translate into', () => {
    adoptPageLanguage('sv')
    expect(oneloText('signIn')).toBe('Sign In')
  })

  it('keeps the current language when the answer is missing or no language tag', () => {
    adoptPageLanguage('de')
    expect(adoptPageLanguage(null)).toBeNull()
    expect(adoptPageLanguage(42)).toBeNull()
    expect(adoptPageLanguage('')).toBeNull()
    expect(currentPageLanguage()).toBe('de')
  })

  it('feature badges: translated, the plan name as written', () => {
    adoptPageLanguage('de')
    expect(new FeatureState('f', 'new').badgeLabel).toBe('Neu')
    expect(new FeatureState('f', 'coming_soon').badgeLabel).toBe('Demnächst verfügbar')
    expect(new FeatureState('f', 'upsell', undefined, 'pro', 'Pro Max').badgeLabel).toBe('Verfügbar im Plan Pro Max')
    expect(new FeatureState('f', 'upsell').badgeLabel).toBe('Plan ändern')
    expect(new FeatureState('f', 'greyed').badgeLabel).toBe('🔒')
  })

  it('feature badges in English: the hosted pages\' words', () => {
    expect(new FeatureState('f', 'coming_soon').badgeLabel).toBe('Coming soon')
    expect(new FeatureState('f', 'upsell', undefined, 'pro').badgeLabel).toBe('Available in pro')
    expect(new FeatureState('f', 'upsell').badgeLabel).toBe('Change plan')
  })

  // The badge words are the hosted pages' own (owner decision, as Swift #1074
  // and Android #1075): pinned to both frontend dictionaries in every language.
  const frontend = join(__dirname, '../../../frontend/lib')
  const hasFrontend = existsSync(join(frontend, 'hosted-notice-i18n.ts')) && existsSync(join(frontend, 'store-i18n.ts'))
  it.skipIf(!hasFrontend)('feature badges match hosted-notice-i18n.ts and store-i18n.ts in every language', () => {
    const notice = readFileSync(join(frontend, 'hosted-notice-i18n.ts'), 'utf8')
    const storeText = readFileSync(join(frontend, 'store-i18n.ts'), 'utf8')
    const values = (src: string, field: string): string[] =>
      [...src.matchAll(new RegExp(`\\b${field}:\\s*(?:\\(plan\\)\\s*=>\\s*)?(['"\`])(.*?)\\1`, 'g'))].map((m) => m[2])
    const order = ['en', 'pl', 'de', 'fr', 'es', 'pt', 'it', 'nl']
    const blockOrder = (src: string) =>
      [...src.matchAll(/^ {2}(en|pl|de|fr|es|it|pt|nl): \{/gm)].map((m) => m[1])
    const comingSoon = values(notice, 'lockComingSoon')
    const availableIn = values(notice, 'lockAvailableIn').map((v) => v.replace('${plan}', '{plan}'))
    const changePlan = values(storeText, 'changePlan')
    const noticeLangs = blockOrder(notice)
    const storeLangs = blockOrder(storeText)
    expect(noticeLangs.sort()).toEqual([...order].sort())
    expect(storeLangs.sort()).toEqual([...order].sort())
    blockOrder(notice).forEach((lang, i) => {
      expect(ONELO_TEXTS[lang].badgeComingSoon, `${lang} coming soon`).toBe(comingSoon[i])
      expect(ONELO_TEXTS[lang].badgeAvailableIn, `${lang} available in`).toBe(availableIn[i])
    })
    blockOrder(storeText).forEach((lang, i) => {
      expect(ONELO_TEXTS[lang].badgeUpgrade, `${lang} change plan`).toBe(changePlan[i])
    })
  })
})

describe('/api/sdk/config answers the Page Language', () => {
  it('asks with the device language and the device languages as Accept-Language', async () => {
    const auth = new OneloAuth({ apiUrl: 'https://api.test', publishableKey: 'pk_test' })
    await auth.whenReady()
    const { url, headers } = requestTo('/api/sdk/config')
    expect(url.searchParams.get('lang')).toBe('de-DE')
    expect(headers['Accept-Language']).toBe('de-DE')
  })

  it('asks with the language the App passes; the device language stays the next choice', async () => {
    const auth = new OneloAuth({ apiUrl: 'https://api.test', publishableKey: 'pk_test', language: 'pt-PT' })
    await auth.whenReady()
    const { url, headers } = requestTo('/api/sdk/config')
    expect(url.searchParams.get('lang')).toBe('pt-PT')
    expect(headers['Accept-Language']).toBe('de-DE')
  })

  it('adopts the answer: the texts and auth.pageLanguage, kept for the next launch', async () => {
    configAnswer = { status: 200, json: { ...CONFIG, page_language: 'fr' } }
    const auth = new OneloAuth({ apiUrl: 'https://api.test', publishableKey: 'pk_test' })
    await auth.whenReady()
    expect(auth.pageLanguage).toBe('fr')
    expect(oneloText('signIn')).toBe('Se connecter')
    await vi.waitFor(() => expect(store.get(PAGE_LANGUAGE_STORAGE_KEY)).toBe('fr'))
  })

  it('an answer without page_language (older backend) keeps English', async () => {
    const auth = new OneloAuth({ apiUrl: 'https://api.test', publishableKey: 'pk_test' })
    await auth.whenReady()
    expect(auth.pageLanguage).toBe('en')
    expect(store.has(PAGE_LANGUAGE_STORAGE_KEY)).toBe(false)
  })

  it('this launch\'s answer wins over the language kept from the last one', async () => {
    store.set(PAGE_LANGUAGE_STORAGE_KEY, 'it')
    configAnswer = { status: 200, json: { ...CONFIG, page_language: 'nl' } }
    const auth = new OneloAuth({ apiUrl: 'https://api.test', publishableKey: 'pk_test' })
    await auth.whenReady()
    await new Promise((r) => setTimeout(r, 0))
    expect(auth.pageLanguage).toBe('nl')
  })

  it('a failed config request speaks the language kept from the last launch', async () => {
    store.set(PAGE_LANGUAGE_STORAGE_KEY, 'it')
    configAnswer = { status: 503, json: {} }
    const auth = new OneloAuth({ apiUrl: 'https://api.test', publishableKey: 'pk_test' })
    await auth.whenReady()
    expect(auth.pageLanguage).toBe('it')
    expect(oneloText('signIn')).toBe('Accedi')
  })
})

describe('the App\'s language is the default of every Page Language request', () => {
  const makeStore = (language?: string) =>
    new OneloStore('https://api.test', 'pk_test', 'com.app', async () => 'at', undefined, undefined, 'onelorn',
      async () => null, undefined, language)

  it('sign-in (flow/init)', async () => {
    const auth = new OneloAuth({ apiUrl: 'https://api.test', publishableKey: 'pk_test', language: 'es' })
    await auth.whenReady()
    await auth.resolveFlow()
    expect(requestTo('/api/sdk/flow/init').url.searchParams.get('lang')).toBe('es')
  })

  it('a call\'s own language wins', async () => {
    const auth = new OneloAuth({ apiUrl: 'https://api.test', publishableKey: 'pk_test', language: 'es' })
    await auth.whenReady()
    await auth.resolveFlow('pl')
    expect(requestTo('/api/sdk/flow/init').url.searchParams.get('lang')).toBe('pl')
  })

  it('store and upgrade', async () => {
    await makeStore('nl').initiateStoreFlow()
    await makeStore('nl').openUpgrade('pro').catch(() => {})
    expect(requestTo('/api/sdk/paywall/store-initiate').url.searchParams.get('lang')).toBe('nl')
    expect(requestTo('/api/sdk/paywall/upgrade-initiate').url.searchParams.get('lang')).toBe('nl')
  })

  it('the store without an App language still sends the device language', async () => {
    await makeStore().initiateStoreFlow()
    expect(requestTo('/api/sdk/paywall/store-initiate').url.searchParams.get('lang')).toBe('de-DE')
  })

  it('required consents', async () => {
    const auth = { getSession: async () => ({ accessToken: 'at' }) }
    await new OneloConsent('https://api.test', 'pk_test', auth as never, undefined, false, 'it').requiredConsents()
    expect(requestTo('/v1/sdk/consent/required').url.searchParams.get('lang')).toBe('it')
  })

  it('waitlist join', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }), clone() { return this } })
    vi.stubGlobal('fetch', fetchMock)
    await new OneloWaitlist('https://api.test', 'pk_test', undefined, 'fr').join('beta', 'ada@example.com')
    await new OneloWaitlist('https://api.test', 'pk_test', undefined, 'fr').join('beta', 'ada@example.com', { language: 'pl' })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).language).toBe('fr')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).language).toBe('pl')
  })
})

describe('the retry screen shows the App User words in the Page Language', () => {
  beforeEach(() => { adoptPageLanguage('de') })

  it('an App User\'s own error, translated', () => {
    expect(appUserMessage(OneloError.sessionEnded())).toBe('Ihre Sitzung ist abgelaufen — bitte melden Sie sich erneut an')
    expect(appUserMessage(OneloError.cancelled())).toBe('Die Anmeldung wurde abgebrochen')
  })

  it('a lost connection says so', () => {
    expect(appUserMessage(OneloError.network('offline'))).toBe(ONELO_TEXTS.de.connectionProblem)
    expect(appUserMessage(new TypeError('Network request failed'))).toBe(ONELO_TEXTS.de.connectionProblem)
  })

  it('a server or developer message becomes "Something went wrong", logged for the developer', () => {
    expect(appUserMessage(OneloError.server('Config request failed: HTTP 500'))).toBe(ONELO_TEXTS.de.somethingWentWrong)
    expect(appUserMessage(OneloError.invalidKey('bad'))).toBe(ONELO_TEXTS.de.somethingWentWrong)
    expect(appUserMessage(new Error('boom'))).toBe(ONELO_TEXTS.de.somethingWentWrong)
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Config request failed: HTTP 500'))
  })

  it('a marked server error shows its App User text', () => {
    const e = withAppUserText(OneloError.server('Failed to resolve auth flow: store_not_configured'), 'storeNotConfiguredContactSupport')
    expect(appUserMessage(e)).toBe(ONELO_TEXTS.de.storeNotConfiguredContactSupport)
    expect(e.message).toBe('Failed to resolve auth flow: store_not_configured')
  })

  it('the flow router\'s store_not_configured is marked', async () => {
    httpGet.mockImplementationOnce(async () => ({ status: 200, json: { ...CONFIG } }))
    const auth = new OneloAuth({ apiUrl: 'https://api.test', publishableKey: 'pk_test' })
    await auth.whenReady()
    httpGet.mockImplementationOnce(async () => ({ status: 409, json: { detail: 'store_not_configured' } }))
    const err = await auth.resolveFlow().catch((e: unknown) => e)
    expect(appUserMessage(err)).toBe(ONELO_TEXTS.de.storeNotConfiguredContactSupport)
  })
})

describe('the SDK screens draw no English literal of their own', () => {
  const files = [
    'auth/auth-modal.tsx', 'auth/OneloAuthGate.tsx', 'feedback/FeedbackModal.tsx', 'store/store-modal.tsx',
    'customer-portal/customer-portal-modal.tsx', 'consent/consent-modal.tsx',
  ]
  const english = ['Sign In', 'Cancel', 'Retry', 'Manage Subscription', 'Back', '‹ Back', 'Go back', 'Close',
    'Close feedback', 'Close checkout', 'Close customer portal']

  for (const file of files) {
    it(file, () => {
      const source = readFileSync(join(__dirname, file), 'utf8')
      for (const text of english) expect(source, `${file}: '${text}'`).not.toContain(`'${text}'`)
    })
  }
})

describe('Accept-Language', () => {
  it('lists the device languages, most preferred first', () => {
    expect(acceptLanguage(['pl-PL', 'en-GB', 'de'])).toBe('pl-PL, en-GB;q=0.9, de;q=0.8')
    expect(acceptLanguage([])).toBeNull()
  })
})
