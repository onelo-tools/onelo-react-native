import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock @onelo/core before importing auth
vi.mock('@onelo/core', async () => {
  const actual = await vi.importActual<typeof import('@onelo/core')>('@onelo/core')
  return {
    ...actual,
    httpGet: vi.fn().mockResolvedValue({ status: 200, json: { supabase_url: 'https://x.supabase.co', supabase_anon_key: 'anon', tenant_id: 'tenant', allow_custom_branding: false } }),
    httpPost: vi.fn().mockResolvedValue({ status: 200, json: {} }),
  }
})

// Mock storage
vi.mock('../core/storage', () => ({
  KeychainStorage: vi.fn().mockImplementation(() => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
  })),
}))

// Mock pkce
vi.mock('../core/pkce', () => ({
  generateCodeVerifier: vi.fn().mockReturnValue('verifier'),
  generateCodeChallenge: vi.fn().mockReturnValue('challenge'),
}))

import { httpPost } from '@onelo/core'
import { OneloAuth } from './auth'

describe('OneloAuth — sendMagicLink & sendPasswordReset', () => {
  let auth: OneloAuth

  beforeEach(() => {
    vi.mocked(httpPost).mockResolvedValue({ status: 200, json: {} })
    auth = new OneloAuth({ apiUrl: 'https://api.onelo.tools', publishableKey: 'onelo_pk_test' })
  })

  it('calls /api/sdk/auth/magic-link with email and publishableKey', async () => {
    await auth.sendMagicLink('ada@example.com')
    const calls = vi.mocked(httpPost).mock.calls
    const magicLinkCall = calls.find(c => (c[0] as string).includes('magic-link'))
    expect(magicLinkCall).toBeDefined()
    expect(magicLinkCall![1]).toMatchObject({ email: 'ada@example.com', publishableKey: 'onelo_pk_test' })
  })

  it('calls /api/sdk/auth/reset-password with email and publishableKey', async () => {
    await auth.sendPasswordReset('ada@example.com')
    const calls = vi.mocked(httpPost).mock.calls
    const resetCall = calls.find(c => (c[0] as string).includes('reset-password'))
    expect(resetCall).toBeDefined()
    expect(resetCall![1]).toMatchObject({ email: 'ada@example.com', publishableKey: 'onelo_pk_test' })
  })
})
