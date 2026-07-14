/**
 * Per-install instance identifier — the React Native port of Swift's
 * `OneloInstanceId` (`KeychainStorage.swift:127`).
 *
 * A single lowercased UUID v4 created once on first use and persisted in the
 * Keychain. It survives app restarts and is lost only on reinstall (Keychain
 * wipe), giving the backend a stable per-install identity for the TOFU device
 * binding (`X-Onelo-Instance-Id`) used by feature discovery + monitor sessions.
 *
 * It is deliberately stored under its OWN Keychain key (`onelo.instance_id`),
 * NOT among the auth token keys that `KeychainStorage.clear()` removes — so it
 * persists across sign-out, exactly like the Swift reference.
 *
 * `./storage` (and therefore `react-native-keychain`) is imported LAZILY inside
 * `getInstanceId` so that merely importing `sdk-headers` never pulls the native
 * module into environments that can't load it (unit tests, SSR). Any failure —
 * Keychain unavailable, no CSPRNG — degrades to a freshly generated id; this
 * function NEVER throws, so every request always carries an instance id.
 */
const INSTANCE_ID_KEY = 'onelo.instance_id'

/** In-memory cache after first read/create — avoids a Keychain hit per request. */
let _cachedInstanceId: string | null = null
/** Single-flight guard so concurrent first calls don't create two UUIDs. */
let _inflight: Promise<string> | null = null

/**
 * Generate a lowercased UUID v4. Prefers a CSPRNG (`crypto.getRandomValues`,
 * available in Node's webcrypto and in RN when `react-native-get-random-values`
 * is installed — mirrors `monitor.ts`), falling back to `Math.random()` only
 * when no CSPRNG exists so id generation itself can never throw.
 */
function _uuidv4(): string {
  const bytes = new Uint8Array(16)
  try {
    ;(globalThis as unknown as { crypto: Crypto }).crypto.getRandomValues(bytes)
  } catch {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40 // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * Returns this install's stable instance id, creating + persisting it on first
 * call. Cached in memory afterwards. Never throws — Keychain/CSPRNG failures
 * degrade to a freshly generated (non-persisted) id so headers always carry a
 * value.
 */
export async function getInstanceId(): Promise<string> {
  if (_cachedInstanceId) return _cachedInstanceId
  if (_inflight) return _inflight

  _inflight = (async () => {
    let id: string | null = null
    try {
      // Lazy so importing sdk-headers doesn't statically pull react-native-keychain.
      const { KeychainStorage } = await import('./storage')
      const storage = new KeychainStorage()
      const existing = (await storage.get(INSTANCE_ID_KEY))?.toLowerCase() ?? null
      id = existing || _uuidv4()
      if (!existing) {
        // KeychainStorage.set is already best-effort (swallows failures).
        await storage.set(INSTANCE_ID_KEY, id)
      }
    } catch {
      // Keychain module unavailable / native call failed → degrade to a fresh,
      // non-persisted id. Never throws (the "never-throws" contract callers rely on).
      id = id ?? _uuidv4()
    }
    _cachedInstanceId = id
    return id
  })()

  try {
    return await _inflight
  } finally {
    _inflight = null
  }
}
