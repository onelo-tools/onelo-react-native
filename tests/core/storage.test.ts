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

  it('deletes a key', async () => {
    await storage.delete('onelo_access_token')
    expect(vi.mocked(Keychain.resetInternetCredentials)).toHaveBeenCalledWith('onelo_access_token')
  })
})
