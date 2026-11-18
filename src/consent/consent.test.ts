/** #1073 — the consent check sends the device language; the backend picks the
 *  Page Language and links each legal document in it. */
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../sdk-headers', () => ({ sdkHeaders: vi.fn(async () => ({ 'X-Onelo-Sdk-Name': 'onelo-react-native' })) }))
vi.mock('@onelo/core', async () => {
  const actual = await vi.importActual<typeof import('@onelo/core')>('@onelo/core')
  return { ...actual, httpGet: vi.fn(), httpPost: vi.fn() }
})

import { httpGet } from '@onelo/core'
import { OneloConsent } from './consent'

const SESSION = { accessToken: 'tok', user: { id: 'u1', email: 'a@b.com' } }

function makeConsent() {
  const auth = { getSession: vi.fn(async () => SESSION), signOut: vi.fn(async () => {}) }
  return new OneloConsent('https://api.example.com', 'onelo_pk_test', auth as any, undefined, false)
}

afterEach(() => {
  vi.unstubAllGlobals()
  ;(httpGet as any).mockReset()
})

describe('OneloConsent.requiredConsents() — language', () => {
  it('sends the device language so the backend links the Page Language', async () => {
    vi.stubGlobal('navigator', { language: 'de-DE' })
    ;(httpGet as any).mockResolvedValue({
      status: 200,
      json: { required: [{
        doc_type: 'terms', version_id: 'v-1', version: '2026-06-01', enforcement: 'block', blocking: true,
        url: 'https://app/legal/t/a/terms?language=de', consent_url: 'https://app/legal/t/a/terms?language=de&gate=1',
      }] },
    })
    const [item] = await makeConsent().requiredConsents()
    const [url, headers] = (httpGet as any).mock.calls[0]
    expect(url).toBe('https://api.example.com/v1/sdk/consent/required?lang=de-DE')
    expect(headers).toMatchObject({ Authorization: 'Bearer tok' })
    expect(item).toMatchObject({ url: 'https://app/legal/t/a/terms?language=de', consentUrl: 'https://app/legal/t/a/terms?language=de&gate=1' })
  })
})
