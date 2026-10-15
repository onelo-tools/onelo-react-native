/**
 * #518 wiring (React Native): Onelo hands Features and the Event Stream the
 * auth session's access token, and a server that refuses every token does not
 * loop refresh → auth state change → features.load → refresh (review R1-1).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('./core/storage', () => ({
  KeychainStorage: vi.fn().mockImplementation(() => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
  })),
}))
vi.mock('./sdk-headers', async () => ({ ...(await vi.importActual<object>('./sdk-headers')), sdkHeaders: vi.fn().mockResolvedValue({}) }))
vi.mock('./core/instance-id', () => ({ getInstanceId: vi.fn().mockResolvedValue('iid') }))
vi.mock('./features/feature-cache', () => ({ loadFeatureCache: vi.fn().mockResolvedValue(null), saveFeatureCache: vi.fn().mockResolvedValue(undefined) }))

// Features REST (and everything else) goes through @onelo/core: every Features
// call that carries a Bearer is refused.
const featureAuths: Array<string | undefined> = []
function answer(url: string, headers?: Record<string, string>) {
  const auth = headers?.['Authorization']
  if (url.includes('/api/sdk/features/')) {
    featureAuths.push(auth)
    if (auth) return { status: 401, json: { detail: { error: 'invalid_user_token' } } }
    return { status: 200, json: { features: {}, config_version: 1 } }
  }
  return { status: 200, json: {} }
}
vi.mock('@onelo/core', async () => {
  const actual = await vi.importActual<typeof import('@onelo/core')>('@onelo/core')
  return {
    ...actual,
    httpGet: async (url: string, headers?: Record<string, string>) => answer(url, headers),
    httpPost: async (url: string, _body: unknown, headers?: Record<string, string>) => answer(url, headers),
  }
})

// The stream: refuse a Bearer (complete 401), accept anonymous (hold open).
const streamAuths: Array<string | undefined> = []
class FakeXHR {
  readyState = 0; status = 0; responseText = ''
  headers: Record<string, string> = {}
  onprogress: (() => void) | null = null
  onreadystatechange: (() => void) | null = null
  onerror: (() => void) | null = null
  ontimeout: (() => void) | null = null
  onabort: (() => void) | null = null
  open(): void { this.readyState = 1 }
  setRequestHeader(k: string, v: string): void { this.headers[k] = v }
  abort(): void {}
  send(): void {
    const auth = this.headers['Authorization']
    streamAuths.push(auth)
    queueMicrotask(() => {
      this.status = auth ? 401 : 200
      this.readyState = 2; this.onreadystatechange?.()
      if (!auth) return
      this.readyState = 3; this.responseText = JSON.stringify({ detail: { error: 'invalid_user_token' } }); this.onreadystatechange?.()
      this.readyState = 4; this.onreadystatechange?.()
    })
  }
}

import { Onelo } from './onelo'

const tick = () => new Promise((r) => setTimeout(r, 0))

describe('Onelo (RN) — Features use the auth session token (#518)', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('sends the session token, refreshes through auth once, and does not loop', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const originalXHR = (globalThis as Record<string, unknown>).XMLHttpRequest
    ;(globalThis as Record<string, unknown>).XMLHttpRequest = FakeXHR as unknown
    try {
      const onelo = new Onelo({ publishableKey: 'onelo_pk_test_x', apiUrl: 'https://api.example.com', featureEnvironment: 'test' })
      onelo.features.declare(['hero']) // test env → batch-ping on every load
      for (let i = 0; i < 5; i++) await tick()

      let n = 0
      const session = () => ({ accessToken: `tok-${n}`, refreshToken: 'r', expiresAt: 0, user: { id: 'u1' } })
      vi.spyOn(onelo.auth, 'getSession').mockImplementation(async () => session() as never)
      const notify = (s: unknown) =>
        (onelo.auth as unknown as { notifyListeners: (s: unknown) => void }).notifyListeners(s)
      // Like the real refresh: new token saved, auth listeners notified.
      const refresh = vi.spyOn(onelo.auth, 'refreshSession').mockImplementation(async () => {
        n++
        const s = session()
        notify(s)
        return s as never
      })
      featureAuths.length = 0
      streamAuths.length = 0
      notify(session()) // sign-in → features.load('u1') + stream.start
      for (let i = 0; i < 40; i++) await tick()

      // Whichever of Features / the stream is refused first triggers the one
      // refresh, so either may carry the session token from before or after it.
      expect(featureAuths[0]).toMatch(/^Bearer tok-[01]$/)
      expect(streamAuths[0]).toMatch(/^Bearer tok-[01]$/)
      expect(refresh).toHaveBeenCalledTimes(1)
      expect(featureAuths.length + streamAuths.length).toBeLessThan(20)
      onelo.destroy()
    } finally {
      ;(globalThis as Record<string, unknown>).XMLHttpRequest = originalXHR
    }
  })
})
