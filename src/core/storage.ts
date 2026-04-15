import * as Keychain from 'react-native-keychain'

export class KeychainStorage {
  async get(key: string): Promise<string | null> {
    try {
      const result = await Keychain.getInternetCredentials(key)
      if (!result) return null
      return result.password
    } catch {
      return null
    }
  }

  async set(key: string, value: string): Promise<void> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (Keychain as any).setInternetCredentials(key, key, value)
    } catch {
      // silent failure
    }
  }

  async delete(key: string): Promise<void> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (Keychain as any).resetInternetCredentials(key)
    } catch {
      // already gone
    }
  }

  async clear(): Promise<void> {
    const keys = ['onelo_access_token', 'onelo_refresh_token', 'onelo_expires_at', 'onelo_user']
    await Promise.all(keys.map(k => this.delete(k)))
  }
}
