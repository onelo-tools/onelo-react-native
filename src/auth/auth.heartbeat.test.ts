import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@onelo/core', async () => {
  const actual = await vi.importActual<typeof import('@onelo/core')>('@onelo/core')
  return {
    ...actual,
    httpGet: vi.fn().mockResolvedValue({ status: 200, json: {
      supabase_url: 'https://x.supabase.co',
      supabase_anon_key: 'anon',
      tenant_id: 'tenant-1',
      allow_custom_branding: true,
    }}),
    httpPost: vi.fn().mockResolvedValue({ status: 200, json: {
      access_token: 'tok',
      refresh_token: 'rtok',
      expires_at: Math.floor(Date.now() / 1000) + 900,
      user: { id: 'u1', email: 'a@b.com', role: 'member', tenant_id: null },
    }}),
  }
})

vi.mock('../core/storage', () => ({
  KeychainStorage: vi.fn().mockImplementation(() => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
  })),
}))

vi.mock('../core/pkce', () => ({
  generateCodeVerifier: vi.fn().mockReturnValue('verifier'),
  generateCodeChallenge: vi.fn().mockReturnValue('challenge'),
}))

import { OneloAuth } from './auth'

describe('OneloAuth heartbeat (React Native)', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('starts timer on saveSession and stops on signOut', async () => {
    const auth = new OneloAuth({ apiUrl: 'https://api.example.com', publishableKey: 'pk_test' })
    await auth.whenReady()

    // @ts-ignore
    const startSpy = vi.spyOn(auth as any, 'startHeartbeat')
    // @ts-ignore
    const stopSpy = vi.spyOn(auth as any, 'stopHeartbeat')

    await auth.signIn('a@b.com', 'password')

    expect(startSpy).toHaveBeenCalledWith('tok')
    await auth.signOut()
    expect(stopSpy).toHaveBeenCalled()
  })
})
