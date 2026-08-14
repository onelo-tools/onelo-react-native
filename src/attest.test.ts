import { describe, it, expect, vi, beforeEach } from 'vitest'

// Keychain: in-memory stand-in so no native module is pulled in. attest.ts
// dynamic-imports './core/storage'; vi.mock intercepts that dynamic import.
const store: Record<string, string> = {}
vi.mock('./core/storage', () => ({
  KeychainStorage: class {
    async get(k: string) { return store[k] ?? null }
    async set(k: string, v: string) { store[k] = v }
    async delete(k: string) { delete store[k] }
    async clear() { /* noop */ }
  },
}))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)
function mockResponse(status: number, body: unknown) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response)
}

import { OneloAttest, getCachedAttestToken, getCachedIntegrityToken, maybeSelfHealFromError, type AttestNativeModule } from './attest'
import { sdkHeaders } from './sdk-headers'

// `require('react-native')` can't run under a plain Node test runner (it loads
// RN's untransformed source), so subclass to inject the platform + native module
// — the honest seam the code exposes via `protected _isIOS/_isAndroid/_native`.
const nativeAttestKey = vi.fn()
const nativeGenerateKey = vi.fn()
const nativeIsSupported = vi.fn()
const nativePrepareIntegrityToken = vi.fn()
const nativeRequestIntegrityToken = vi.fn()
class TestAttest extends OneloAttest {
  constructor(
    private readonly ios: boolean,
    private readonly linked: boolean,
    cloudProjectNumber?: number | null,
    private readonly android: boolean = false,
  ) {
    super('https://api.onelo.tools', 'onelo_pk_live_x', 'com.example.app', cloudProjectNumber)
  }
  protected _isIOS(): boolean { return this.ios }
  protected _isAndroid(): boolean { return this.android }
  protected _native(): AttestNativeModule | null {
    if (!this.linked) return null
    return {
      isSupported: () => nativeIsSupported(),
      generateKey: () => nativeGenerateKey(),
      attestKey: (keyId: string, challenge: string) => nativeAttestKey(keyId, challenge),
      generateAssertion: (keyId: string, clientData: string) => Promise.resolve(`assert(${keyId},${clientData.length})`),
      getBundleId: () => Promise.resolve('com.example.app'),
      prepareIntegrityToken: (cpn: number) => nativePrepareIntegrityToken(cpn),
      requestIntegrityToken: (hash: string) => nativeRequestIntegrityToken(hash),
    }
  }
}

describe('OneloAttest', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    nativeIsSupported.mockResolvedValue(true)
    nativeGenerateKey.mockResolvedValue('key-123')
    nativeAttestKey.mockResolvedValue({ keyId: 'key-123', attestation: 'YXR0ZXN0' })
    nativePrepareIntegrityToken.mockReset().mockResolvedValue(true)
    nativeRequestIntegrityToken.mockReset().mockResolvedValue('google-integrity-token')
    for (const k of Object.keys(store)) delete store[k]
  })

  // Runs FIRST — asserts the null baseline before any token is cached (the
  // module-level cache persists across tests in this file, by design).
  it('skips silently when App Attest is unsupported (no token, no attestKey call)', async () => {
    nativeIsSupported.mockResolvedValue(false)
    await new TestAttest(true, true).start()
    expect(getCachedAttestToken()).toBeNull()
    expect(nativeAttestKey).not.toHaveBeenCalled()
    const headers = await sdkHeaders('com.example.app')
    expect(headers['X-Attest-Token']).toBeUndefined()
  })

  it('no-ops on Android without a configured cloudProjectNumber', async () => {
    await new TestAttest(false, true, null, true).start()
    expect(getCachedIntegrityToken()).toBeNull()
    expect(nativePrepareIntegrityToken).not.toHaveBeenCalled()
  })

  it('no-ops on Android when the native module is not linked', async () => {
    await new TestAttest(false, false, 12345, true).start()
    expect(getCachedIntegrityToken()).toBeNull()
    expect(nativePrepareIntegrityToken).not.toHaveBeenCalled()
  })

  it('exchanges Play Integrity on Android and sdkHeaders sends X-Integrity-Token', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    mockFetch.mockResolvedValueOnce(
      mockResponse(200, { integrity_token: 'onelo-integrity-jwt', expires_at: future }),
    )

    await new TestAttest(false, true, 12345, true).start()

    expect(getCachedIntegrityToken()).toBe('onelo-integrity-jwt')
    const headers = await sdkHeaders('com.example.app')
    expect(headers['X-Integrity-Token']).toBe('onelo-integrity-jwt')
    expect(headers['X-Attest-Token']).toBeUndefined()

    expect(nativePrepareIntegrityToken).toHaveBeenCalledWith(12345)
    expect(nativeRequestIntegrityToken).toHaveBeenCalledTimes(1)

    const [url, init] = mockFetch.mock.calls[0]
    expect(String(url)).toContain('/api/sdk/auth/play-integrity')
    const postBody = JSON.parse(init.body)
    expect(postBody.integrity_token).toBe('google-integrity-token')
    expect(postBody.package_name).toBe('com.example.app')
    expect(postBody.publishable_key).toBe('onelo_pk_live_x')
  })

  it('self-heals a stale cached Play Integrity token on a backend bundle_id_mismatch reject', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    mockFetch.mockResolvedValueOnce(mockResponse(200, { integrity_token: 'first-token', expires_at: future }))
    await new TestAttest(false, true, 12345, true).start()
    expect(getCachedIntegrityToken()).toBe('first-token')

    // Backend later stops recognizing the cached credential (e.g. the bundle
    // was removed/re-added out of band) — flow/init surfaces this as a hard
    // reject code, which must drop the stale cache and re-exchange.
    nativeRequestIntegrityToken.mockResolvedValueOnce('second-google-token')
    mockFetch.mockResolvedValueOnce(mockResponse(200, { integrity_token: 'second-token', expires_at: future }))
    maybeSelfHealFromError({ detail: { error: 'bundle_id_mismatch' } })
    await vi.waitFor(() => expect(getCachedIntegrityToken()).toBe('second-token'))
    expect(nativePrepareIntegrityToken).toHaveBeenCalledTimes(2)
  })

  it('does NOT self-heal on an unrelated error code', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    mockFetch.mockResolvedValueOnce(mockResponse(200, { integrity_token: 'stable-token', expires_at: future }))
    await new TestAttest(false, true, 12345, true).start()
    expect(getCachedIntegrityToken()).toBe('stable-token')

    maybeSelfHealFromError({ detail: { error: 'rate_limit_exceeded' } })
    await new Promise((r) => setTimeout(r, 0))
    expect(getCachedIntegrityToken()).toBe('stable-token')
    expect(nativePrepareIntegrityToken).toHaveBeenCalledTimes(1)
  })

  it('attests, caches the token, and sdkHeaders sends X-Attest-Token', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    mockFetch
      .mockResolvedValueOnce(mockResponse(200, { challenge: 'chal-1' }))
      .mockResolvedValueOnce(mockResponse(200, { attest_token: 'jwt-token', expires_at: future }))

    await new TestAttest(true, true).start()

    expect(getCachedAttestToken()).toBe('jwt-token')
    const headers = await sdkHeaders('com.example.app')
    expect(headers['X-Attest-Token']).toBe('jwt-token')

    // Fresh key each time + correct backend contract on the POST body.
    expect(nativeGenerateKey).toHaveBeenCalledTimes(1)
    const postBody = JSON.parse(mockFetch.mock.calls[1][1].body)
    expect(postBody.platform).toBe('ios')
    expect(postBody.key_id).toBe('key-123')
    expect(postBody.publishable_key).toBe('onelo_pk_live_x')
    expect(postBody.attestation).toBe('YXR0ZXN0')
    // Challenge GET carries the instance-id binding header.
    const getHeaders = mockFetch.mock.calls[0][1].headers
    expect(getHeaders['X-Onelo-Instance-Id']).toBeTruthy()
  })
})
