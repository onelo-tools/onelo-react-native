/**
 * Disk cache for feature snapshots — the React Native port of Swift's
 * `OneloFeatures` UserDefaults persistence (`OneloFeatures.swift:584`).
 *
 * WHY KEYCHAIN (and not AsyncStorage)
 * ───────────────────────────────────
 * Swift persists snapshots in `UserDefaults` because they are non-sensitive
 * (anyone with the SDK reads the same data from the server) and survive app
 * restarts, giving an instant cold-start: cached badges paint immediately, then
 * SSE reconciles. React Native's closest always-present analogue is AsyncStorage
 * (`@react-native-async-storage/async-storage`) — but that is NOT a dependency
 * of this SDK and adding a new required peer dep for a best-effort cache is not
 * worth it. `react-native-keychain` IS already a hard peer dependency (used by
 * auth token storage + `core/instance-id`), so we reuse it here through the same
 * lazily-imported `KeychainStorage` wrapper. The blob is non-secret, but storing
 * it in the Keychain is harmless and buys zero-new-deps persistence.
 *
 * Like `core/instance-id`, `../core/storage` (and therefore
 * `react-native-keychain`) is imported LAZILY so merely importing this module
 * never pulls the native module into environments that can't load it (unit
 * tests, SSR). Every operation degrades SILENTLY on failure and NEVER throws —
 * a missing/broken store just means badges don't survive a cold start; SSE /
 * `/resolve` refill the cache on next launch.
 *
 * The cache key is deliberately NOT among the auth keys `KeychainStorage.clear()`
 * removes, so a cached snapshot survives sign-out — matching Swift, where the
 * snapshot lives in UserDefaults untouched by token teardown.
 */

/** Load and JSON-parse a cached value. Returns `null` on miss, parse error, or
 *  any storage failure. Never throws. */
export async function loadFeatureCache(key: string): Promise<unknown | null> {
  try {
    const { KeychainStorage } = await import('../core/storage')
    const raw = await new KeychainStorage().get(key)
    if (!raw) return null
    return JSON.parse(raw) as unknown
  } catch {
    // Native module unavailable / corrupt JSON — degrade to "no cache".
    return null
  }
}

/** JSON-serialize and persist a value. Silently no-ops on any failure. Never
 *  throws (mirrors `instance-id`'s never-throw contract). */
export async function saveFeatureCache(key: string, value: unknown): Promise<void> {
  try {
    const { KeychainStorage } = await import('../core/storage')
    await new KeychainStorage().set(key, JSON.stringify(value))
  } catch {
    // best-effort — cache is a cold-start optimization, not a source of truth.
  }
}
