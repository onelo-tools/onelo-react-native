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

import { OneloAttest, getCachedAttestToken, type AttestNativeModule } from './attest'
import { sdkHeaders } from './sdk-headers'

// `require('react-native')` can't run under a plain Node test runner (it loads
// RN's untransformed source), so subclass to inject the platform + native module
// — the honest seam the code exposes via `protected _isIOS/_native`.
const nativeAttestKey = vi.fn()
const nativeGenerateKey = vi.fn()
const nativeIsSupported = vi.fn()
class TestAttest extends OneloAttest {
  constructor(private readonly ios: boolean, private readonly linked: boolean) {
    super('https://api.onelo.tools', 'onelo_pk_live_x', 'com.example.app')
  }
  protected _isIOS(): boolean { return this.ios }
  protected _native(): AttestNativeModule | null {
    if (!this.linked) return null
    return {
      isSupported: () => nativeIsSupported(),
      generateKey: () => nativeGenerateKey(),
      attestKey: (keyId: string, challenge: string) => nativeAttestKey(keyId, challenge),
      generateAssertion: (keyId: string, clientData: string) => Promise.resolve(`assert(${keyId},${clientData.length})`),
      getBundleId: () => Promise.resolve('com.example.app'),
    }
  }
}

describe('OneloAttest', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    nativeIsSupported.mockResolvedValue(true)
    nativeGenerateKey.mockResolvedValue('key-123')
    nativeAttestKey.mockResolvedValue({ keyId: 'key-123', attestation: 'YXR0ZXN0' })
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

  it('no-ops on Android (never touches the native module)', async () => {
    await new TestAttest(false, true).start()
    expect(getCachedAttestToken()).toBeNull()
    expect(nativeGenerateKey).not.toHaveBeenCalled()
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
