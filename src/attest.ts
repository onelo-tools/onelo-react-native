import { sha256 } from 'js-sha256'
import { httpGet, httpPost } from '@onelo/core'
import { getInstanceId } from './core/instance-id'

/**
 * iOS App Attest token lifecycle — the React Native port of Swift's
 * `OneloAppAttest` (`OneloAppAttest.swift`).
 *
 * The native module (`ios/OneloAttest.swift`, exposed as
 * `NativeModules.OneloAttest`) owns the three device-bound primitives that can't
 * run in JS — `isSupported`, `generateKey`, `attestKey` — plus `getBundleId`.
 * This module orchestrates everything else: fetch a server challenge, hand the
 * key + challenge to native, POST the attestation, and cache the returned
 * `attest_token` JWT so every transport can attach it as `X-Attest-Token`.
 *
 * ## How the token reaches requests
 * `sdk-headers.ts` reads {@link getCachedAttestToken} — a SYNCHRONOUS in-memory
 * read — and attaches `X-Attest-Token` when a token is present. Because every
 * transport (auth, event-stream/monitor, store, customer-portal, features,
 * consent, forms, waitlist, feedback) builds its headers through `sdkHeaders()`,
 * the token flows everywhere once cached. This mirrors Swift's model where the
 * HTTP client / monitor hold a cached `attestToken` property that requests read.
 *
 * ## iOS App Attest + Android Play Integrity
 * `start()` branches on `Platform.OS`: iOS runs App Attest (above); Android runs
 * Google Play Integrity (Standard API) — the native module exposes
 * `prepareIntegrityToken`/`requestIntegrityToken` there instead of
 * `generateKey`/`attestKey`, and the resulting token is cached separately and
 * sent as `X-Integrity-Token` (see `sdk-headers.ts`), matching the native
 * `onelo-android` SDK and the backend's `/api/sdk/auth/play-integrity`. Both
 * paths no-op in any non-RN / Simulator-or-emulator-without-Play environment.
 * `react-native` and `react-native-keychain` are required LAZILY (never at
 * module top) so importing `sdk-headers` — and therefore this file — never
 * pulls a native module into unit tests / SSR.
 *
 * ## Best-effort
 * Nothing here throws to the caller. A failure (unsupported device, missing App
 * Attest capability, Apple/backend rejection) is logged and leaves the cached
 * token null; the request simply goes out without `X-Attest-Token`, exactly as a
 * device that never attested. The backend decides whether that is acceptable.
 */

const TOKEN_KEY = 'onelo.attest_token'
const EXPIRY_KEY = 'onelo.attest_token_expiry'
const KEY_ID_KEY = 'onelo.attest_key_id'

/** Android (Play Integrity) token cache keys — separate from the iOS App Attest
 *  keys above so the two never collide (they never run on the same device, but
 *  distinct names keep Keychain contents self-describing). */
const INTEGRITY_TOKEN_KEY = 'onelo.integrity_token'
const INTEGRITY_EXPIRY_KEY = 'onelo.integrity_token_expiry'

/** Refresh when the token is within this window of expiry (parity: Swift 5 min). */
const REFRESH_SKEW_MS = 5 * 60 * 1000

/** F1 — bound the attestation HTTP calls (parity with Swift's 10s
 *  `URLRequest.timeoutInterval`). `fetch()` has no timeout, so a stalled socket
 *  (established TCP, no response) would hang the single-flight attestation and
 *  pin it (`_inflight` never clears until the OS TCP timeout — minutes), so the
 *  SDK never retries. A timeout turns a stall into a retryable failure. */
const ATTEST_HTTP_TIMEOUT_MS = 10000

/** In-memory token read synchronously by `sdk-headers`. `null` until the first
 *  successful attestation (or a cache-warm from Keychain on relaunch). */
let _cachedAttestToken: string | null = null

/**
 * The current attest token, or `null`. Synchronous + side-effect-free so the
 * shared header builder can call it on every request without awaiting. Populated
 * by {@link OneloAttest.start} / `refreshIfNeeded`.
 */
export function getCachedAttestToken(): string | null {
  return _cachedAttestToken
}

/** In-memory Play Integrity token (Android), read synchronously by
 *  `sdk-headers` as `X-Integrity-Token` — the Android twin of
 *  {@link getCachedAttestToken}. `null` until the first successful exchange (or
 *  a cache-warm from Keychain on relaunch). */
let _cachedIntegrityToken: string | null = null

/** The current Play Integrity token, or `null`. Synchronous + side-effect-free,
 *  same contract as {@link getCachedAttestToken}. */
export function getCachedIntegrityToken(): string | null {
  return _cachedIntegrityToken
}

/** The active OneloAttest, set at SDK init so the shared header builder can reach
 *  per-request assertions without threading the instance through every module. */
let _activeAttest: OneloAttest | null = null
export function _setActiveAttest(a: OneloAttest | null): void { _activeAttest = a }

/** Per-request assertion headers for `sdkHeaders`, or null (no active attest /
 *  no key / not iOS) → legacy bearer. FAZA 3. */
export async function getAssertionHeaders(
  method: string, path: string, query: string, body: string,
): Promise<Record<string, string> | null> {
  return _activeAttest ? _activeAttest.assertionHeaders(method, path, query, body) : null
}

/** Fire-and-forget self-heal after a hard attestation 403 (drops key → re-attest,
 *  single-flight). Safe no-op when there's no active attest. */
export function selfHealAttest(): void { void _activeAttest?.resetForSelfHeal() }

/** If a non-2xx response body carries a HARD attestation/integrity reject
 *  code, fire the self-heal (drop the cached credential, re-attest).
 *
 *  iOS App Attest: attest_key_unknown/attest_key_revoked/invalid_assertion.
 *
 *  Android Play Integrity: bundle_id_mismatch/package_not_registered/
 *  integrity_token_required/integrity_invalid/integrity_token_stale — the
 *  Play Integrity JWT is cached up to 30 days (`attest.ts`'s
 *  `_loadCachedIntegrity`), so a backend-side change made OUT-OF-BAND (a
 *  bundle manually removed/re-added in the dashboard during testing, a cert
 *  rotation) leaves the cached token looking locally "valid" while the
 *  backend has already stopped honoring it — the client would otherwise keep
 *  presenting the same stale credential until the cache naturally expires or
 *  is manually cleared (`pm clear` / reinstall). These codes are exactly the
 *  backend's signal that what the client is presenting no longer matches its
 *  current registration, so re-attesting (not just retrying) is the fix.
 *
 *  NOT included: counter_stale (retryable — just re-sign, no cache to drop),
 *  attest_store_unavailable (transient 503), cert_digest_mismatch/
 *  cert_digest_missing/integrity_not_configured/rate_limit_exceeded (re-
 *  attesting with the SAME build/config can't change any of these — the
 *  windowed cap in `resetForSelfHeal` still bounds a misfire either way).
 *  Call from a request's non-2xx branch. */
export function maybeSelfHealFromError(json: unknown): void {
  const detail = (json as { detail?: unknown } | null)?.detail
  const code = detail && typeof detail === 'object'
    ? (detail as { error?: string }).error : undefined
  const hardRejectCodes = [
    'attest_key_unknown', 'attest_key_revoked', 'invalid_assertion',
    'bundle_id_mismatch', 'package_not_registered', 'integrity_token_required',
    'integrity_invalid', 'integrity_token_stale',
  ]
  if (code && hardRejectCodes.includes(code)) {
    selfHealAttest()
  }
}

/** Shape of the native module exposed as `NativeModules.OneloAttest`. */
export interface AttestNativeModule {
  isSupported(): Promise<boolean>
  generateKey(): Promise<string>
  attestKey(keyId: string, challenge: string): Promise<{ keyId: string; attestation: string }>
  /** FAZA 3 — sign `clientData` (the full "METHOD\npath\nchallenge\nbody" preimage;
   *  native SHA-256s it) with the attested key. Returns base64 CBOR assertion. */
  generateAssertion(keyId: string, clientData: string): Promise<string>
  getBundleId(): Promise<string>
  /** Android only (Play Integrity). Prepares/caches the Standard API token
   *  provider for `cloudProjectNumber`; rejects `integrity_not_configured` when
   *  the number is missing. */
  prepareIntegrityToken?(cloudProjectNumber: number): Promise<boolean>
  /** Android only. Requests a fresh Standard Integrity token bound to
   *  `requestHash`; must follow a successful `prepareIntegrityToken`. */
  requestIntegrityToken?(requestHash: string): Promise<string>
}

/** Log-safe diagnostic. A silently-failing security mechanism is worse than none
 *  — the developer must be able to see WHY the token is missing. */
function log(message: string): void {
  // eslint-disable-next-line no-console
  console.warn(`[Onelo][attest] ${message}`)
}

interface CachedToken {
  token: string
  expiresAt: Date
}

export class OneloAttest {
  private started = false
  /** Single-flight guard so a foreground refresh can't race the initial attest
   *  (or two foregrounds) into two concurrent fresh-key attestations. */
  private _inflight: Promise<void> | null = null

  constructor(
    private readonly apiUrl: string,
    private readonly publishableKey: string,
    private readonly bundleId?: string,
    private readonly cloudProjectNumber?: number | null,
  ) { _setActiveAttest(this) }

  /**
   * Warm the cache from Keychain and attest if needed. Call once after config
   * resolves and `attest_required` is true. No-op on non-iOS/Android or
   * unsupported devices. Never throws.
   */
  async start(): Promise<void> {
    if (this.started) return
    if (this._isAndroid()) { await this._startAndroid(); return }
    if (!this._isIOS()) return

    const native = this._native()
    if (!native) {
      log('native module OneloAttest is not linked — did you run `pod install`? Skipping attestation.')
      return
    }

    let supported = false
    try {
      supported = await native.isSupported()
    } catch (e) {
      log(`isSupported() threw: ${String(e)}`)
    }
    if (!supported) {
      log('DCAppAttestService.isSupported == false (Simulator, or the App Attest capability is not enabled). Skipping attestation.')
      return
    }

    this.started = true

    // A relaunch should carry a token on its FIRST request, not only after a
    // fresh network attestation — warm the in-memory cache from Keychain, then
    // refresh only if it's missing / near expiry (mirrors Swift getAttestToken).
    const cached = await this._loadCached()
    if (cached && !this._isNearExpiry(cached.expiresAt)) {
      _cachedAttestToken = cached.token
      return
    }
    await this._attestSingleFlight(native)
  }

  /**
   * Re-attest if the cached token is missing or within {@link REFRESH_SKEW_MS} of
   * expiry. Wired to the SDK's app-foreground hook (see `onelo.ts`) — the
   * reliable moment to refresh a ~30-day token without a long-lived timer that a
   * backgrounded/killed app would drop. No-op until `start()` has run.
   */
  async refreshIfNeeded(): Promise<void> {
    if (!this.started) return
    if (this._isAndroid()) { await this._refreshIntegrityIfNeeded(); return }
    const native = this._native()
    if (!native) return
    const current = _cachedAttestToken ? await this._loadCached() : null
    if (current && !this._isNearExpiry(current.expiresAt)) return
    await this._attestSingleFlight(native)
  }

  // ── Android (Play Integrity) ────────────────────────────────────────────────

  /** Single-flight guard for the Android exchange — same rationale as
   *  `_inflight` above (a foreground refresh must not race the initial call). */
  private _integrityInflight: Promise<void> | null = null

  private async _startAndroid(): Promise<void> {
    const native = this._native()
    if (!native?.prepareIntegrityToken || !native?.requestIntegrityToken) {
      log('native module OneloAttest (Android) is not linked — did you rebuild the app after upgrading the SDK? Skipping Play Integrity.')
      return
    }
    if (!this.cloudProjectNumber) {
      log('no cloudProjectNumber in config — upload a Play Integrity service account for this app in the Onelo dashboard. Skipping Play Integrity.')
      return
    }

    this.started = true

    // Same relaunch-warm-cache behaviour as iOS.
    const cached = await this._loadCachedIntegrity()
    if (cached && !this._isNearExpiry(cached.expiresAt)) {
      _cachedIntegrityToken = cached.token
      return
    }
    await this._integritySingleFlight(native)
  }

  private async _refreshIntegrityIfNeeded(): Promise<void> {
    const native = this._native()
    if (!native?.prepareIntegrityToken || !native?.requestIntegrityToken) return
    const current = _cachedIntegrityToken ? await this._loadCachedIntegrity() : null
    if (current && !this._isNearExpiry(current.expiresAt)) return
    await this._integritySingleFlight(native)
  }

  private _integritySingleFlight(native: AttestNativeModule): Promise<void> {
    if (this._integrityInflight) return this._integrityInflight
    this._integrityInflight = (async () => {
      try {
        await this._performIntegrityExchange(native)
      } catch (e) {
        log(`Play Integrity exchange failed: ${String(e)}`)
      } finally {
        this._integrityInflight = null
      }
    })()
    return this._integrityInflight
  }

  /**
   * `requestHash` binds the Google-signed verdict to this app's identity
   * (publishable key + package), mirroring `onelo-android`'s
   * `OneloPlayIntegrity.fetchAndVerify` exactly (`sha256Hex("$publishableKey|$packageName")`)
   * so the backend can validate it identically regardless of which SDK sent it.
   */
  private async _performIntegrityExchange(native: AttestNativeModule): Promise<void> {
    await native.prepareIntegrityToken!(this.cloudProjectNumber!)
    const packageName = this.bundleId || (await native.getBundleId())
    const requestHash = sha256(`${this.publishableKey}|${packageName}`)
    const googleToken = await native.requestIntegrityToken!(requestHash)

    const { token, expiresAt } = await this._sendIntegrityToken({ googleToken, packageName })
    _cachedIntegrityToken = token
    await this._saveCachedIntegrity(token, expiresAt)
  }

  /** `POST /api/sdk/auth/play-integrity` — the SAME endpoint the native
   *  `onelo-android` SDK calls, so backend verification (package binding, cert
   *  digest, freshness) is identical regardless of which SDK sent the token. */
  private async _sendIntegrityToken(args: {
    googleToken: string
    packageName: string
  }): Promise<{ token: string; expiresAt: Date }> {
    const { status, json } = await _withTimeout(
      httpPost(
        `${this.apiUrl}/api/sdk/auth/play-integrity`,
        {
          integrity_token: args.googleToken,
          package_name: args.packageName,
          publishable_key: this.publishableKey,
        },
        { 'X-Onelo-Instance-Id': await getInstanceId() },
      ),
      ATTEST_HTTP_TIMEOUT_MS, 'play-integrity',
    )
    if (status !== 200) {
      const detail = _truncate(JSON.stringify(json ?? ''), 300)
      throw new Error(`play-integrity endpoint rejected (HTTP ${status}): ${detail}`)
    }
    const obj = (json ?? {}) as Record<string, unknown>
    const token = obj['integrity_token']
    if (typeof token !== 'string' || !token) throw new Error('play-integrity endpoint returned 200 but no integrity_token')
    const expiresAt = this._parseExpiry(obj['expires_at'], token)
    return { token, expiresAt }
  }

  private async _loadCachedIntegrity(): Promise<CachedToken | null> {
    try {
      const { KeychainStorage } = await import('./core/storage')
      const storage = new KeychainStorage()
      const token = await storage.get(INTEGRITY_TOKEN_KEY)
      const expiryStr = await storage.get(INTEGRITY_EXPIRY_KEY)
      if (!token || !expiryStr) return null
      const expiresAt = new Date(expiryStr)
      if (Number.isNaN(expiresAt.getTime())) return null
      return { token, expiresAt }
    } catch {
      return null
    }
  }

  private async _saveCachedIntegrity(token: string, expiresAt: Date): Promise<void> {
    try {
      const { KeychainStorage } = await import('./core/storage')
      const storage = new KeychainStorage()
      await storage.set(INTEGRITY_TOKEN_KEY, token)
      await storage.set(INTEGRITY_EXPIRY_KEY, expiresAt.toISOString())
    } catch {
      // Keychain best-effort — the in-memory token still serves this session.
    }
  }

  // ── Attestation ───────────────────────────────────────────────────────────

  private _attestSingleFlight(native: AttestNativeModule): Promise<void> {
    if (this._inflight) return this._inflight
    this._inflight = (async () => {
      try {
        await this._performAttestation(native)
      } catch (e) {
        log(`attestation failed: ${String(e)}`)
      } finally {
        this._inflight = null
      }
    })()
    return this._inflight
  }

  // ── Assertions (FAZA 3 — per-request device proof) ─────────────────────────

  /** Mirror of the backend REPLAY_GUARD_PATHS (app/lib/attest_gate.py) — these
   *  need a single-use challenge; everything else reuses the stateless nonce.
   *  A path added on the server MUST be added here or the SDK sends the wrong
   *  (reusable) challenge and 403s. */
  private static readonly REPLAY_GUARD_PATHS = new Set<string>([
    '/api/sdk/auth/signin', '/api/sdk/auth/signup', '/api/sdk/auth/magic-link',
    '/api/sdk/auth/hosted-callback', '/api/sdk/paywall/switch/apply',
    '/api/sdk/waitlist/join', '/api/sdk/waitlist/redeem', '/api/sdk/forms/submit',
  ])
  private static readonly STATELESS_MAX_AGE_MS = 240_000  // 4 min < 5-min server TTL
  private _statelessChallenge: { value: string; fetchedAt: number } | null = null

  /**
   * Per-request App Attest assertion headers, or null (no attested key / not iOS
   * / offline) → the caller keeps the legacy `X-Attest-Token` bearer (backward
   * compatible). The signed preimage is
   * `${METHOD}\n${path?query}\n${challenge}\n${body}` — byte-identical to the
   * backend `compute_client_data_hash` (native SHA-256s it). `body` MUST be the
   * exact JSON string sent on the wire (parity is the whole point).
   */
  async assertionHeaders(
    method: string, path: string, query: string, body: string,
  ): Promise<Record<string, string> | null> {
    if (!this._isIOS()) return null
    const native = this._native()
    if (!native?.generateAssertion) return null
    const keyId = await this._loadKeyId()
    if (!keyId) return null

    let challenge: string
    try {
      challenge = OneloAttest.REPLAY_GUARD_PATHS.has(path)
        ? await this._fetchSingleUseChallenge()
        : await this._cachedOrFreshStatelessChallenge()
    } catch (e) {
      log(`assertion challenge fetch failed: ${String(e)}`)
      return null
    }

    const pathWithQuery = query ? `${path}?${query}` : path
    const clientData = `${method.toUpperCase()}\n${pathWithQuery}\n${challenge}\n${body}`
    try {
      const assertion = await native.generateAssertion(keyId, clientData)
      return {
        'X-Attest-Key-Id': keyId,
        'X-Attest-Assertion': assertion,
        'X-Attest-Challenge': challenge,
      }
    } catch (e) {
      log(`generateAssertion failed: ${String(e)}`)
      return null
    }
  }

  /** Windowed self-heal loop guard (#34, parity with Swift): the single-flight
   *  stops CONCURRENT storms but not SEQUENTIAL ones (403 → re-attest → 403 → …).
   *  Cap re-attests per window then back off — a systematic reject can't be fixed
   *  by re-attesting and only DDoSes Apple's rate-limited attestKey + the backend. */
  private _selfHealCount = 0
  private _selfHealWindowStart = 0
  private static readonly SELF_HEAL_MAX_PER_WINDOW = 3
  private static readonly SELF_HEAL_WINDOW_MS = 300_000  // 5 min

  /** Self-heal after a HARD attestation reject (#24 P4): drop key+token, re-attest
   *  via the single-flight + windowed cap. NOT for counter_stale (retryable) nor
   *  the session path (Filar 5). In monitor-mode this is dormant anyway — the
   *  backend degrades a failed assertion to the bearer, so the reject codes that
   *  trigger this never come back on enforced endpoints (#34 root fix). */
  async resetForSelfHeal(): Promise<void> {
    const native = this._native()
    if (!native) return
    const now = Date.now()
    if (now - this._selfHealWindowStart > OneloAttest.SELF_HEAL_WINDOW_MS) {
      this._selfHealWindowStart = now
      this._selfHealCount = 0
    }
    if (this._selfHealCount >= OneloAttest.SELF_HEAL_MAX_PER_WINDOW) {
      log('self-heal cap reached — a persistent reject won\'t be fixed by re-attesting; backing off')
      return
    }
    this._selfHealCount++

    if (this._isAndroid()) {
      _cachedIntegrityToken = null
      try {
        const { KeychainStorage } = await import('./core/storage')
        const storage = new KeychainStorage()
        await storage.delete(INTEGRITY_TOKEN_KEY)
        await storage.delete(INTEGRITY_EXPIRY_KEY)
      } catch {
        // best-effort — the re-exchange below still requests a fresh token.
      }
      await this._integritySingleFlight(native)
      return
    }

    _cachedAttestToken = null
    this._statelessChallenge = null
    try {
      const { KeychainStorage } = await import('./core/storage')
      const storage = new KeychainStorage()
      await storage.delete(KEY_ID_KEY)
      await storage.delete(TOKEN_KEY)
      await storage.delete(EXPIRY_KEY)
    } catch {
      // best-effort — the re-attest below still generates a fresh key.
    }
    await this._attestSingleFlight(native)
  }

  private async _loadKeyId(): Promise<string | null> {
    try {
      const { KeychainStorage } = await import('./core/storage')
      return (await new KeychainStorage().get(KEY_ID_KEY)) || null
    } catch {
      return null
    }
  }

  private async _fetchSingleUseChallenge(): Promise<string> {
    const url = `${this.apiUrl}/api/sdk/auth/assert-challenge?key=${encodeURIComponent(this.publishableKey)}`
    const { status, json } = await _withTimeout(
      httpGet(url, { 'X-Onelo-Instance-Id': await getInstanceId() }),
      ATTEST_HTTP_TIMEOUT_MS, 'assert-challenge',
    )
    if (status !== 200) throw new Error(`assert-challenge failed: HTTP ${status}`)
    const ch = (json as Record<string, unknown>)?.['challenge']
    if (typeof ch !== 'string' || !ch) throw new Error('assert-challenge: no challenge in response')
    return ch
  }

  private async _cachedOrFreshStatelessChallenge(): Promise<string> {
    const c = this._statelessChallenge
    if (c && Date.now() - c.fetchedAt < OneloAttest.STATELESS_MAX_AGE_MS) return c.value
    const value = await this._fetchChallenge()  // GET /attest-challenge
    this._statelessChallenge = { value, fetchedAt: Date.now() }
    return value
  }

  private async _performAttestation(native: AttestNativeModule): Promise<void> {
    // A FRESH key EVERY time — an App Attest key is attestable exactly once, so a
    // refresh must never reuse the previously-attested key (Swift's ~30-day
    // time-bomb note). We persist the key id only AFTER the server accepts it.
    const keyId = await native.generateKey()
    const challenge = await this._fetchChallenge()
    const { attestation } = await native.attestKey(keyId, challenge)
    const bundleId = this.bundleId || (await native.getBundleId())

    const { token, expiresAt } = await this._sendAttestation({ attestation, keyId, bundleId, challenge })
    _cachedAttestToken = token
    await this._saveCached(token, expiresAt, keyId)
  }

  // ── Network ───────────────────────────────────────────────────────────────

  /** `GET /api/sdk/auth/attest-challenge` with `X-Onelo-Instance-Id` (parity with
   *  Swift `fetchChallenge`). */
  private async _fetchChallenge(): Promise<string> {
    const { status, json } = await _withTimeout(
      httpGet(
        `${this.apiUrl}/api/sdk/auth/attest-challenge`,
        { 'X-Onelo-Instance-Id': await getInstanceId() },
      ),
      ATTEST_HTTP_TIMEOUT_MS, 'attest-challenge',
    )
    if (status !== 200) throw new Error(`attest-challenge failed: HTTP ${status}`)
    const challenge = (json as Record<string, unknown>)?.['challenge']
    if (typeof challenge !== 'string' || !challenge) throw new Error('attest-challenge: no challenge in response')
    return challenge
  }

  /**
   * `POST /api/sdk/auth/attest` with `X-Onelo-Instance-Id`, JSON body matching the
   * fixed backend contract (`platform: "ios"`). Returns the `attest_token` plus
   * its expiry (from the response's `expires_at`, so we never have to decode the
   * JWT to know when to refresh).
   */
  private async _sendAttestation(args: {
    attestation: string
    keyId: string
    bundleId: string
    challenge: string
  }): Promise<{ token: string; expiresAt: Date }> {
    const { status, json } = await _withTimeout(
      httpPost(
        `${this.apiUrl}/api/sdk/auth/attest`,
        {
          attestation: args.attestation,
          key_id: args.keyId,
          bundle_id: args.bundleId,
          challenge: args.challenge,
          platform: 'ios',
          publishable_key: this.publishableKey,
        },
        { 'X-Onelo-Instance-Id': await getInstanceId() },
      ),
      ATTEST_HTTP_TIMEOUT_MS, 'attest',
    )
    if (status !== 200) {
      // Preserve the backend's reason (e.g. {"error":"invalid_attestation"}) so
      // the developer sees WHY /attest rejected it — never a silent null token.
      const detail = _truncate(JSON.stringify(json ?? ''), 300)
      throw new Error(`attest endpoint rejected (HTTP ${status}): ${detail}`)
    }
    const obj = (json ?? {}) as Record<string, unknown>
    const token = obj['attest_token']
    if (typeof token !== 'string' || !token) throw new Error('attest endpoint returned 200 but no attest_token')
    const expiresAt = this._parseExpiry(obj['expires_at'], token)
    return { token, expiresAt }
  }

  /** Prefer the response's `expires_at`; fall back to the JWT `exp`; last-resort a
   *  short 15-min window so a missing expiry can't pin a stale token forever. */
  private _parseExpiry(expiresAtField: unknown, token: string): Date {
    if (typeof expiresAtField === 'string') {
      const d = new Date(expiresAtField)
      if (!Number.isNaN(d.getTime())) return d
    }
    const jwtExp = _decodeJwtExp(token)
    if (jwtExp) return new Date(jwtExp * 1000)
    return new Date(Date.now() + 15 * 60 * 1000)
  }

  // ── Token cache (Keychain) ────────────────────────────────────────────────

  private _isNearExpiry(expiresAt: Date): boolean {
    return Date.now() + REFRESH_SKEW_MS >= expiresAt.getTime()
  }

  private async _loadCached(): Promise<CachedToken | null> {
    try {
      const { KeychainStorage } = await import('./core/storage')
      const storage = new KeychainStorage()
      const token = await storage.get(TOKEN_KEY)
      const expiryStr = await storage.get(EXPIRY_KEY)
      if (!token || !expiryStr) return null
      const expiresAt = new Date(expiryStr)
      if (Number.isNaN(expiresAt.getTime())) return null
      return { token, expiresAt }
    } catch {
      return null
    }
  }

  private async _saveCached(token: string, expiresAt: Date, keyId: string): Promise<void> {
    try {
      const { KeychainStorage } = await import('./core/storage')
      const storage = new KeychainStorage()
      await storage.set(TOKEN_KEY, token)
      await storage.set(EXPIRY_KEY, expiresAt.toISOString())
      // Persist the key id only now that the server ACCEPTED this attestation, so
      // the stored id always names an attested key (a future assertion flow would
      // sign with it) — a generate-but-fail never overwrites a good one.
      await storage.set(KEY_ID_KEY, keyId)
    } catch {
      // Keychain best-effort — the in-memory token still serves this session.
    }
  }

  // ── Environment ───────────────────────────────────────────────────────────

  // `protected` (not private) so tests can subclass and inject a fake platform /
  // native module — `require('react-native')` can't run under a plain Node test
  // runner (it loads RN's untransformed source), the same reason `monitor.ts`'s
  // lazy require isn't unit-tested through the require path.
  protected _isIOS(): boolean {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Platform = (require('react-native') as { Platform?: { OS?: string } }).Platform
      return Platform?.OS === 'ios'
    } catch {
      return false
    }
  }

  protected _isAndroid(): boolean {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Platform = (require('react-native') as { Platform?: { OS?: string } }).Platform
      return Platform?.OS === 'android'
    } catch {
      return false
    }
  }

  protected _native(): AttestNativeModule | null {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const NativeModules = (require('react-native') as { NativeModules?: Record<string, unknown> }).NativeModules
      const mod = NativeModules?.['OneloAttest']
      return mod ? (mod as unknown as AttestNativeModule) : null
    } catch {
      return null
    }
  }
}

// ── Standalone helpers ────────────────────────────────────────────────────────

function _truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s
}

/** Reject if `p` doesn't settle within `ms`. Does NOT abort the underlying fetch
 *  (it keeps running, harmlessly ignored) — it just unblocks the attestation
 *  flow so the single-flight guard clears and a later call can retry (F1). */
function _withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
  })
  return Promise.race([p, timeout]).finally(() => { if (timer !== undefined) clearTimeout(timer) })
}

/** Decode a JWT's `exp` (seconds since epoch) without a crypto dependency.
 *  Base64url → JSON. Returns null on any malformed input. */
function _decodeJwtExp(token: string): number | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    let payload = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    while (payload.length % 4 !== 0) payload += '='
    const decoded = _base64Decode(payload)
    const json = JSON.parse(decoded) as Record<string, unknown>
    const exp = json['exp']
    return typeof exp === 'number' ? exp : null
  } catch {
    return null
  }
}

/** Minimal base64 → utf-8 decode that works in RN (no guaranteed `atob`) and in
 *  Node (tests). */
function _base64Decode(b64: string): string {
  const g = globalThis as unknown as {
    atob?: (s: string) => string
    Buffer?: { from(s: string, enc: string): { toString(enc: string): string } }
  }
  if (typeof g.atob === 'function') return g.atob(b64)
  if (g.Buffer) return g.Buffer.from(b64, 'base64').toString('utf-8')
  // Last-resort pure-JS decoder (used only if neither atob nor Buffer exists).
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let out = ''
  const clean = b64.replace(/=+$/, '')
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (chars.indexOf(clean[i]) << 18) |
      (chars.indexOf(clean[i + 1]) << 12) |
      ((chars.indexOf(clean[i + 2]) & 0x3f) << 6) |
      (chars.indexOf(clean[i + 3]) & 0x3f)
    out += String.fromCharCode((n >> 16) & 0xff)
    if (clean[i + 2] !== undefined) out += String.fromCharCode((n >> 8) & 0xff)
    if (clean[i + 3] !== undefined) out += String.fromCharCode(n & 0xff)
  }
  return out
}
