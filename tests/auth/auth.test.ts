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
})
