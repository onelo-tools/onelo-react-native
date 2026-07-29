/**
 * #29 — `initialize()` must NEVER swallow a startup failure silently. The classic
 * case: the host app forgot `import 'react-native-get-random-values'`, so
 * `generateCodeVerifier()` throws with a fix-it message — which used to be eaten
 * by the catch, leaving `isReady=false` forever with NO trace (attestation +
 * everything /config-gated silently dead). Now it is logged + surfaced on
 * `initError`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../core/storage', () => ({
  KeychainStorage: vi.fn().mockImplementation(() => ({
    get: vi.fn(async () => null),
    set: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
    clear: vi.fn(async () => {}),
  })),
}))

const PKCE_MSG =
  "[Onelo] Secure random is unavailable for PKCE. Install `react-native-get-random-values`"

vi.mock('../core/pkce', () => ({
  generateCodeVerifier: () => { throw new Error(PKCE_MSG) },
  generateCodeChallenge: vi.fn(),
}))

vi.mock('@onelo/core', async () => {
  const actual = await vi.importActual<typeof import('@onelo/core')>('@onelo/core')
  return { ...actual, httpGet: vi.fn(), httpPost: vi.fn() }
})

import { OneloAuth } from './auth'

beforeEach(() => { vi.clearAllMocks() })

describe('#29 — no silent swallow in initialize()', () => {
  it('surfaces the failure on initError + console.warn (not eaten), isReady stays false', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const auth = new OneloAuth({ apiUrl: 'https://api.test', publishableKey: 'pk_test' })
    await auth.whenReady() // resolves (catch does not rethrow), but must have surfaced the error

    expect(auth.isReady).toBe(false)
    expect(auth.initError).toContain('Secure random is unavailable')
    expect(warn).toHaveBeenCalled()
    expect(String(warn.mock.calls[0]?.[0])).toContain('SDK initialization failed')
    // The pkce.ts fix-it message reaches the console — the whole point of #29.
    expect(String(warn.mock.calls[0]?.[0])).toContain('react-native-get-random-values')

    warn.mockRestore()
  })
})
