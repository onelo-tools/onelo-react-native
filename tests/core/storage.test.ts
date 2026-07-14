import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('react-native-keychain', () => ({
  setInternetCredentials: vi.fn().mockResolvedValue(true),
  getInternetCredentials: vi.fn().mockResolvedValue({ password: 'value' }),
  resetInternetCredentials: vi.fn().mockResolvedValue(true),
}))

import { KeychainStorage } from '../../src/core/storage'
import * as Keychain from 'react-native-keychain'

describe('KeychainStorage', () => {
  let storage: KeychainStorage

  beforeEach(() => {
    storage = new KeychainStorage()
    vi.clearAllMocks()
  })

  it('stores and retrieves a value', async () => {
    vi.mocked(Keychain.getInternetCredentials).mockResolvedValueOnce({ password: 'test-token' } as any)
    await storage.set('onelo_access_token', 'test-token')
    const result = await storage.get('onelo_access_token')
    expect(result).toBe('test-token')
  })

  it('returns null for missing key', async () => {
    vi.mocked(Keychain.getInternetCredentials).mockResolvedValueOnce(false as any)
    const result = await storage.get('onelo_access_token')
    expect(result).toBeNull()
  })

  it('deletes a key with the v9+ OPTIONS-OBJECT signature (not a bare string)', async () => {
    // react-native-keychain v9+ ignores a string arg here — passing one silently
    // deletes nothing, which broke storage.clear() and every session-clearing path
    // (signOut / session.revoked / refresh-fail / heartbeat-401 / verifySession).
    await storage.delete('onelo_access_token')
    expect(vi.mocked(Keychain.resetInternetCredentials)).toHaveBeenCalledWith({ server: 'onelo_access_token' })
    expect(vi.mocked(Keychain.resetInternetCredentials)).not.toHaveBeenCalledWith('onelo_access_token')
  })

  it('clear() resets all four token keys (so signOut actually clears the session)', async () => {
    await storage.clear()
    for (const k of ['onelo_access_token', 'onelo_refresh_token', 'onelo_expires_at', 'onelo_user']) {
      expect(vi.mocked(Keychain.resetInternetCredentials)).toHaveBeenCalledWith({ server: k })
    }
  })
})
