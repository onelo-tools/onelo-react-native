import * as Keychain from 'react-native-keychain'

/**
 * Bound every native Keychain bridge call. `react-native-keychain` wraps
 * Android's EncryptedSharedPreferences / Keystore, and a corrupted or
 * orphaned Keystore alias (a real, documented failure mode — most often after
 * repeated install/uninstall cycles of the SAME package name under DIFFERENT
 * signing keys, e.g. alternating debug sideloads and Play Store release
 * builds during testing) can leave the native promise NEVER resolving or
 * rejecting. Without a timeout, that hangs the calling `await` forever with
 * zero trace — no thrown error, so no `catch` ever logs anything, which is
 * exactly what made a real on-device hang here indistinguishable from
 * `_initAttest` never running at all (found via a live device comparison:
 * sideload attested in ~1s, a real Play Store install hung silently past
 * 30s with the same code). `fetch()` calls already get this via `_withTimeout`
 * in `attest.ts`; Keychain never did.
 */
const KEYCHAIN_TIMEOUT_MS = 5000

function _withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Keychain call timed out after ${ms}ms`)), ms)
  })
  return Promise.race([p, timeout]).finally(() => { if (timer !== undefined) clearTimeout(timer) })
}

export class KeychainStorage {
  async get(key: string): Promise<string | null> {
    try {
      const result = await _withTimeout(Keychain.getInternetCredentials(key), KEYCHAIN_TIMEOUT_MS)
      if (!result) return null
      return result.password
    } catch {
      return null
    }
  }

  async set(key: string, value: string): Promise<void> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await _withTimeout((Keychain as any).setInternetCredentials(key, key, value), KEYCHAIN_TIMEOUT_MS)
    } catch {
      // silent failure
    }
  }

  async delete(key: string): Promise<void> {
    try {
      // react-native-keychain v9+ takes an OPTIONS OBJECT here (`{ server }`), NOT a
      // bare string (the v8 signature). Passing a string is silently ignored by the
      // native `resetInternetCredentialsForOptions` (options.server === undefined),
      // so the credential is NEVER deleted — which made storage.clear() a no-op and
      // broke EVERY session-clearing path (signOut, session.revoked, refresh-fail,
      // heartbeat-401, verifySession). `set`/`get` kept accepting positional strings
      // in v10, which masked this until sign-out silently left the tokens in place.
      await _withTimeout(Keychain.resetInternetCredentials({ server: key }), KEYCHAIN_TIMEOUT_MS)
    } catch {
      // already gone
    }
  }

  async clear(): Promise<void> {
    const keys = ['onelo_access_token', 'onelo_refresh_token', 'onelo_expires_at', 'onelo_user']
    await Promise.all(keys.map(k => this.delete(k)))
  }
}
