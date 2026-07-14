import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('react-native-keychain', () => ({
  setInternetCredentials: vi.fn().mockResolvedValue(true),
  getInternetCredentials: vi.fn().mockResolvedValue(false),
  resetInternetCredentials: vi.fn().mockResolvedValue(true),
}))

const mockFetch = vi.fn()
global.fetch = mockFetch

import { OneloAuth } from '../../src/auth/auth'

function mockConfigResponse(overrides: Record<string, unknown> = {}) {
  mockFetch.mockResolvedValueOnce({
    status: 200,
    json: async () => ({
      supabase_url: 'https://test.supabase.co',
      supabase_anon_key: 'anon-key',
      tenant_id: 'tenant-1',
      allow_custom_branding: true,
      ...overrides,
    }),
  })
}

describe('OneloAuth (React Native)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws if apiUrl is missing', () => {
    expect(() => new OneloAuth({ publishableKey: 'pk_test', apiUrl: '' })).toThrow('apiUrl is required')
  })

  it('throws if publishableKey is missing', () => {
    expect(() => new OneloAuth({ publishableKey: '', apiUrl: 'https://api.test' })).toThrow('publishableKey is required')
  })

  it('signIn throws plan_required when allowCustomBranding is false', async () => {
    mockConfigResponse({ allow_custom_branding: false })
    const auth = new OneloAuth({ publishableKey: 'pk_test', apiUrl: 'https://api.test' })
    await auth.whenReady()
    await expect(auth.signIn('user@test.com', 'password')).rejects.toThrow('plan_required')
  })

  it('getSession returns null when no tokens stored', async () => {
    mockConfigResponse()
    const auth = new OneloAuth({ publishableKey: 'pk_test', apiUrl: 'https://api.test' })
    await auth.whenReady()
    const session = await auth.getSession()
    expect(session).toBeNull()
  })

  it('onAuthStateChange listener is called on sign out', async () => {
    mockConfigResponse()
    const auth = new OneloAuth({ publishableKey: 'pk_test', apiUrl: 'https://api.test' })
    await auth.whenReady()
    const listener = vi.fn()
    auth.onAuthStateChange(listener)
    await auth.signOut()
    expect(listener).toHaveBeenCalledWith(null)
  })

  it('signOut server-revokes (POSTs /signout with Authorization) AND still clears locally', async () => {
    mockConfigResponse()
    const auth = new OneloAuth({ publishableKey: 'pk_test', apiUrl: 'https://api.test' })
    await auth.whenReady()
    const listener = vi.fn()
    auth.onAuthStateChange(listener)
    // Inject a stored access token AFTER init (so restore stays sessionless) so the
    // revoke path runs, and make /signout resolve 200.
    const keychain = await import('react-native-keychain')
    ;(keychain.getInternetCredentials as unknown as { mockResolvedValue: (v: unknown) => void })
      .mockResolvedValue({ password: 'tok_access', username: 'x' })
    mockFetch.mockResolvedValue({ status: 200, json: async () => ({ ok: true }) })

    await auth.signOut()

    // Local sign-out happened regardless of the network (listener notified null).
    expect(listener).toHaveBeenCalledWith(null)
    // Server revoke was attempted with the right endpoint + auth headers.
    const call = mockFetch.mock.calls.find((c: unknown[]) => String(c[0]).includes('/api/sdk/auth/signout'))
    expect(call).toBeTruthy()
    const opts = call![1] as { headers: Record<string, string> }
    expect(opts.headers['Authorization']).toBe('Bearer tok_access')
    expect(opts.headers['X-Publishable-Key']).toBe('pk_test')
  })

  it('signOut still clears locally when /signout rejects (offline)', async () => {
    mockConfigResponse()
    const auth = new OneloAuth({ publishableKey: 'pk_test', apiUrl: 'https://api.test' })
    await auth.whenReady()
    const listener = vi.fn()
    auth.onAuthStateChange(listener)
    const keychain = await import('react-native-keychain')
    ;(keychain.getInternetCredentials as unknown as { mockResolvedValue: (v: unknown) => void })
      .mockResolvedValue({ password: 'tok_access', username: 'x' })
    mockFetch.mockRejectedValue(new Error('offline'))

    await expect(auth.signOut()).resolves.toBeUndefined() // never throws / hangs
    expect(listener).toHaveBeenCalledWith(null)
  })
})
