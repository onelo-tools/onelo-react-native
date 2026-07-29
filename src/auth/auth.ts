import {
  httpGet, httpPost, checkHostedFlowRequired,
  mapSession, TOKEN_KEYS,
  type OneloConfig, type OneloSession, type OneloUser, type OneloEntitlement, OneloError, type ResolvedSDKConfig,
} from '@onelo/core'

/**
 * The single next step the backend's centralised router (`/api/sdk/flow/init`)
 * tells the SDK to take. `authorized` = already signed in + entitled (show
 * content, no WebView). `present` = open `url` in the hosted WebView (sign-in,
 * and — once Round 2 store lands — store), which ends by postMessaging one final
 * code we exchange for a session. Mirrors Swift `FlowDecision` / JS `resolveFlow`.
 */
export type FlowDecision =
  | { action: 'authorized' }
  | { action: 'present'; surface: string; url: string; appName?: string; appLogo?: string }
import { generateCodeVerifier, generateCodeChallenge } from '../core/pkce'
import { KeychainStorage } from '../core/storage'
import { sdkHeaders, getNativeBundleId } from '../sdk-headers'
import type { OneloEventStream } from '../core/event-stream'
import type { ModalResult } from './auth-modal'

const SDK_VERSION: string = require('../../package.json').version

/**
 * Deep-link callback scheme for OAuth + hosted redirects on React Native. The
 * backend is told about it via the `callback_scheme` query param on
 * `/flow/init` + `/auth/initiate`; the hosted page then redirects to
 * `onelorn://callback?code=…` (sign-in / store completion) or
 * `onelorn://callback?preauth=…` (paid-store OAuth step), which `AuthModal`
 * captures. MUST stay in sync with the `CALLBACK_SCHEME` local const in
 * `store.ts`, `customer-portal.ts`, and `auth-modal.tsx`.
 */
export const CALLBACK_SCHEME = 'onelorn'

/** Max time a gated entry point waits for background App Attest before proceeding
 *  tokenless (#25). Covers a slow-but-working handshake (~3-4 round trips) while
 *  capping a stalled network so the auth UI never hangs. */
const ATTEST_WAIT_CAP_MS = 5000

export class OneloAuth {
  private storage: KeychainStorage
  private apiUrl: string
  private publishableKey: string
  private bundleId?: string
  /** Deep-link callback scheme (config.callbackScheme, default 'onelorn'). Sent to
   *  the backend on initiate/flow-init and used by AuthModal to catch the return. */
  private readonly _callbackScheme: string
  private pkceVerifier: string | null = null
  private resolvedConfig: ResolvedSDKConfig | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private refreshTimer: ReturnType<typeof setTimeout> | null = null
  private static readonly HEARTBEAT_MS = 13 * 60 * 1000
  /** Refresh this many seconds before the access token expires. */
  private static readonly REFRESH_LEAD_SECONDS = 60
  // Monotonic sign-out counter. signOut() bumps it; any in-flight entitlement
  // revalidation captures it BEFORE its network await and refuses to write tokens
  // back if it moved — prevents a proactive revalidate completing just after
  // sign-out from resurrecting the just-cleared session. Parity with Swift's
  // `_signOutEpoch` and the JS SDK.
  private signOutEpoch = 0
  /** In-flight refresh promise — single-flight dedupe so concurrent getSession()
   *  callers share ONE POST /auth/refresh. Two concurrent refreshes would POST the
   *  SAME rotating refresh_token → the backend's reuse-detection revokes the whole
   *  family → a routine foreground silently logs the user out. */
  private _refreshInFlight: Promise<OneloSession | null> | null = null
  private initPromise: Promise<void>
  private authStateListeners: Array<(session: OneloSession | null) => void> = []
  private modalStateListeners: Array<() => void> = []
  private _modalVisible = false
  private _modalUrl = ''
  private _modalResolve: ((result: ModalResult) => void) | null = null

  isReady = false
  isRevoked = false
  /** #29 — non-null when `initialize()` threw (e.g. the `react-native-get-random-values`
   *  polyfill is missing, so `generateCodeVerifier()` throws). Previously that error
   *  was swallowed silently, leaving `isReady=false` forever with NO trace. Surfaced
   *  here (and logged) so the failure is diagnosable instead of a mystery. */
  initError: string | null = null
  /** True once the CURRENT user's session was revoked server-side (a
   *  `session.revoked` SSE push, or — future — a heartbeat 401 / refresh
   *  user_revoked). Distinct from `isRevoked` (the whole app key was revoked).
   *  Parity with Swift/JS `isUserRevoked`. */
  isUserRevoked = false
  allowCustomBranding = false
  appName = 'App'
  appLogoUrl: string | null = null
  /** True when the backend requires iOS App Attest for this app (at least one
   *  registered bundle id has `attest_enabled=true`). Read from `/api/sdk/config`
   *  (`attest_required`); the composition root (`Onelo`) uses it to decide whether
   *  to kick off attestation. Parity with Swift `OneloAuth.attestRequired`. */
  attestRequired = false

  /** Injected by the composition root (`Onelo`): resolves when background App
   *  Attest has produced its token (or settled). Gated entry points await it so
   *  a cold-start request doesn't race ahead of the token → spurious 403 (#25).
   *  Undefined when the SDK is used without the root (e.g. auth-only tests). */
  private readonly _attestReady?: () => Promise<void>

  constructor(config: OneloConfig, attestReady?: () => Promise<void>) {
    if (!config.apiUrl) throw new Error('[Onelo] apiUrl is required')
    if (!config.publishableKey) throw new Error('[Onelo] publishableKey is required')
    this._attestReady = attestReady
    this.apiUrl = config.apiUrl
    this.publishableKey = config.publishableKey
    this.bundleId = config.bundleId
    this._callbackScheme = config.callbackScheme || CALLBACK_SCHEME
    this.storage = new KeychainStorage()
    // #18 DX: X-Bundle-Id auto-derives from the native module on iOS, but Android
    // has no native bundle-id source (and iOS needs the module linked). If NEITHER
    // config nor native can provide it, requests are rejected (bundle_id_mismatch
    // 403) once enforcement is active — warn LOUDLY at init instead of a silent
    // 403 much later. Fire-and-forget so it never blocks construction.
    if (!config.bundleId) {
      void getNativeBundleId().then((nb) => {
        if (!nb) {
          console.warn(
            '[Onelo] No `bundleId` in config and none could be derived natively ' +
            '(Android has no native source; on iOS the native module must be linked). ' +
            'Set `bundleId` to your app id (e.g. "com.company.app") — it is REQUIRED for ' +
            'bundle attestation. Without it, requests are rejected with bundle_id_mismatch (403) ' +
            'once enforcement is active.',
          )
        }
      })
    }
    this.initPromise = this.initialize()
  }

  /** Deep-link callback scheme this app returns through (config.callbackScheme,
   *  default 'onelorn'). Register it natively (Android intent-filter + iOS
   *  CFBundleURLSchemes); AuthModal/StoreModal/PortalModal catch `<scheme>://…`. */
  get callbackScheme(): string {
    return this._callbackScheme
  }

  /**
   * Common security headers for every auth request — `X-SDK-Version`,
   * `X-Bundle-Id`, `X-Onelo-Instance-Id`, `X-Onelo-Sdk-Platform` (via
   * `sdkHeaders`) plus per-request extras (`Authorization` / `X-Publishable-Key`).
   * Threading the bundle id is what lets a LIVE React Native app pass the
   * backend's `validate_sdk_request_security` gate (which enforces `X-Bundle-Id`
   * for native app types once a bundle is registered) — without it, `flow/init`
   * and `initiate` are rejected and sign-in throws.
   */
  private async _secHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
    return { ...(await sdkHeaders(this.bundleId)), ...extra }
  }

  /**
   * Block until iOS App Attest has produced its token (or settled as
   * not-required / failed) BEFORE the first gated request. The composition root
   * kicks attestation off in the background (fire-and-forget) so it never blocks
   * construction; without this gate a cold-start `loadAuthView` / `signIn` races
   * AHEAD of the ~3-4-round-trip attestation and the backend rejects the
   * tokenless request with 403 — which then "works" a couple seconds later once
   * the cached token exists (#25). Attestation is best-effort, so the wait only
   * costs the sub-second–2s it takes and never throws. No-op (resolves after
   * config) when attestation isn't required, or when used without the root.
   *
   * MUST NOT be called from `_secHeaders` / `initialize`: attestation awaits
   * `whenReady()` (initPromise), so gating header-building on it would deadlock.
   * Only call it at gated ENTRY points, after config is available.
   *
   * The wait is BOUNDED (`ATTEST_WAIT_CAP_MS`): attestation is best-effort and
   * its `fetch` calls have no timeout, so a stalled network handshake (captive
   * portal, dead socket) must never hang the auth UI. On the cap we proceed
   * tokenless — the same outcome as before this gate existed (a possible 403 the
   * app already handles) — while the background attestation keeps running so its
   * token rides later requests. `catch` alone is NOT enough: the risk is
   * non-settlement, not rejection.
   */
  private async _awaitAttestReady(): Promise<void> {
    await this.initPromise            // ensure `attestRequired` is resolved
    if (!this.attestRequired || !this._attestReady) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const cap = new Promise<void>((resolve) => { timer = setTimeout(resolve, ATTEST_WAIT_CAP_MS) })
    try {
      await Promise.race([this._attestReady(), cap])
    } catch {
      /* best-effort — proceed tokenless */
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  private async initialize(): Promise<void> {
    try {
      const verifier = generateCodeVerifier()
      this.pkceVerifier = verifier
      const challenge = generateCodeChallenge(verifier)
      const url = `${this.apiUrl}/api/sdk/config?key=${encodeURIComponent(this.publishableKey)}&code_challenge=${encodeURIComponent(challenge)}`
      const { status, json } = await httpGet(url, await this._secHeaders())
      if (status === 401 || status === 404) throw OneloError.invalidKey('Server rejected the key')
      if (status !== 200) throw OneloError.server(`Config request failed: HTTP ${status}`)
      const j = json as Record<string, unknown>
      this.resolvedConfig = {
        supabaseUrl: j['supabase_url'] as string,
        supabaseAnonKey: j['supabase_anon_key'] as string,
        tenantId: j['tenant_id'] as string,
        allowCustomBranding: (j['allow_custom_branding'] as boolean) ?? false,
        appName: (j['app_name'] as string | null) ?? null,
        appLogoUrl: (j['app_logo_url'] as string | null) ?? null,
        paywallEnabled: (j['paywall_enabled'] as boolean) ?? false,
        waitlistMode: (j['waitlist_mode'] as boolean) ?? false,
        sdkRedirectUrl: (j['sdk_redirect_url'] as string | null) ?? null,
        storeUrl: (j['store_url'] as string | null) ?? null,
        manageUrl: (j['manage_url'] as string | null) ?? null,
        // Branding page background (--onelo-page-bg). Native WebViews paint this so
        // there is no white flash before the hosted page renders. Default #111111.
        pageBackgroundColor: (j['checkout_bg_color'] as string) || '#111111',
        // Plan-gated enabled OAuth providers (google/github/apple). Previously
        // unmapped — the field is surfaced via the `oauthProviders` getter and
        // consumed by the Round 2 OAuth entry point.
        oauthProviders: Array.isArray(j['oauth_providers']) ? (j['oauth_providers'] as string[]) : undefined,
      }
      // App Attest requirement is not part of the typed ResolvedSDKConfig
      // (`@onelo/core`), so read it straight off the raw config JSON.
      this.attestRequired = (j['attest_required'] as boolean) ?? false
      const resolved = this.resolvedConfig
      this.allowCustomBranding = resolved.allowCustomBranding
      if (resolved.appName) this.appName = resolved.appName
      this.appLogoUrl = resolved.appLogoUrl
      this.isReady = true
    } catch (e) {
      // #29 — NEVER swallow silently (CLAUDE.md "No silent swallows"). A failed
      // init used to vanish here, so a missing `react-native-get-random-values`
      // polyfill (generateCodeVerifier throws with a fix-it message) killed
      // attestation + everything /config-gated (branding, paywall, waitlist,
      // attestRequired…) with ZERO trace, leaving isReady=false forever. Always
      // surface it — this is what makes the pkce.ts fix-it message reach the dev.
      const msg = e instanceof Error ? e.message : String(e)
      this.initError = msg
      console.warn(
        '[Onelo] SDK initialization failed — auth, attestation and config-gated ' +
        'features are disabled until this is fixed: ' + msg,
      )
      if (e instanceof OneloError && e.code === 'invalid_publishable_key') {
        this.isRevoked = true
      }
    }
  }

  async whenReady(): Promise<void> {
    await this.initPromise
  }

  // ── Hosted flow ─────────────────────────────────────────────────────────────

  async loadAuthView(): Promise<OneloSession | null> {
    await this.initPromise
    if (this.isRevoked) throw OneloError.invalidKey('Application key has been revoked')

    // Routing is CENTRALISED on the backend (`/api/sdk/flow/init`) so every SDK
    // decides sign-in vs store vs already-authorized identically — no per-SDK
    // paywall logic to drift. We fall back to the legacy `/auth/initiate` ONLY
    // when flow/init is genuinely unavailable (endpoint not deployed → 404/405,
    // or a transport failure); a real routing error (store_not_configured, bad
    // key) MUST surface, never be masked by the fallback.
    // Fall back to the legacy `/auth/initiate` ONLY when flow/init is genuinely
    // not deployed (404/405). A real routing error (store_not_configured, bad
    // key) OR a transport/parse failure is surfaced by _decisionFromFlow /
    // _flowInit and MUST NOT be masked by the fallback — mirrors the JS SDK,
    // which propagates the error with no fallback at all. (A previous version
    // also fell back on network_error, which could silently swallow a non-JSON
    // 5xx as "endpoint unavailable".)
    let decision: FlowDecision | null = null
    const { status, json } = await this._flowInit()
    if (status !== 404 && status !== 405) decision = this._decisionFromFlow(status, json)

    if (decision?.action === 'authorized') {
      // Backend confirmed access via a LIVE entitlement check. Sync our cached
      // entitlement so hasActiveAccess() agrees, then return the session with NO
      // WebView. Only paywall apps carry an entitlement worth revalidating.
      if (this.isPaywallEnabled()) await this.revalidateEntitlement().catch(() => {})
      return await this.getSession()
    }

    // present → open the hosted flow; fallback → open the legacy initiate URL.
    // Either way we wait for exactly ONE final code and exchange it (as today).
    const hostedUrl = decision ? decision.url : await this.getHostedUrl()

    return new Promise((resolve, reject) => {
      // Assign the resolver BEFORE notifying listeners. getModalState() returns
      // `onResult: this._modalResolve`, so if we notify FIRST the gate renders
      // <AuthModal onResult={no-op}> and there is NO second notify — the WebView
      // callback then hits the no-op, exchangeHostedCode never runs, and sign-in
      // fails silently. Set all modal state, THEN notify exactly once.
      this._modalResolve = async (result: ModalResult) => {
        this._modalVisible = false
        this._modalResolve = null
        this.notifyModalListeners()
        if (result.type === 'cancelled') { resolve(null); return }
        if (result.type === 'error') { reject(OneloError.server(result.message)); return }
        try {
          resolve(await this.exchangeHostedCode(result.code))
        } catch (e) {
          reject(e)
        }
      }
      this._modalUrl = hostedUrl
      this._modalVisible = true
      this.notifyModalListeners()
    })
  }

  /**
   * Exchange a hosted-flow one-time code (sign-in OR store checkout) for a
   * session and persist it, leaving the user signed in and firing
   * onAuthStateChange. Shared by `loadAuthView` and the store flow (OneloStore)
   * so the exchange lives in exactly one place. `POST /api/sdk/auth/hosted-callback`
   * body `{publishableKey, code, code_verifier}` (PKCE snake even in a camel body).
   */
  async exchangeHostedCode(code: string): Promise<OneloSession> {
    const { status, json } = await httpPost(
      `${this.apiUrl}/api/sdk/auth/hosted-callback`,
      { publishableKey: this.publishableKey, code, code_verifier: this.pkceVerifier },
      await this._secHeaders(),
    )
    if (status !== 200) throw OneloError.server('Hosted callback failed')
    const session = mapSession(json as Record<string, unknown>)
    await this.saveSession(session)
    return session
  }

  /** Returns modal state for rendering — use with <AuthModal> component */
  getModalState(): { visible: boolean; url: string; onResult: ((result: ModalResult) => void) | null } {
    return {
      visible: this._modalVisible,
      url: this._modalUrl,
      onResult: this._modalResolve,
    }
  }

  /** Subscribe to modal state changes. Returns an unsubscribe function. */
  onModalStateChange(callback: () => void): () => void {
    this.modalStateListeners.push(callback)
    return () => {
      this.modalStateListeners = this.modalStateListeners.filter(l => l !== callback)
    }
  }

  private async getHostedUrl(): Promise<string> {
    const { status, json } = await httpGet(
      `${this.apiUrl}/api/sdk/auth/initiate?key=${encodeURIComponent(this.publishableKey)}&callback_scheme=${this._callbackScheme}`,
      await this._secHeaders()
    )
    if (status !== 200) throw OneloError.server('Failed to initiate hosted auth flow')
    const j = json as Record<string, unknown>
    const hostedUrl = j['hosted_url'] as string | undefined
    if (!hostedUrl) throw OneloError.server('Invalid initiate response')
    if (j['app_name']) this.appName = j['app_name'] as string
    if (j['app_logo_url']) this.appLogoUrl = j['app_logo_url'] as string
    return hostedUrl
  }

  /**
   * Ask the backend for the single next flow step (`GET /api/sdk/flow/init`).
   * Sends the current access token as a Bearer when signed in so the backend can
   * decide authorized-vs-sign-in-vs-store bound to this user. Returns
   * `{action:'authorized'}` (show content, no UI) or `{action:'present', url,…}`
   * (open `url` in the hosted WebView). Throws `OneloError.server` on any non-200
   * — including `store_not_configured`, which this SDK's error taxonomy has no
   * dedicated code for (mirrors the JS SDK). Public so a Round 2 content-gate /
   * accessory WebView can reuse the same centralised decision. Parity with Swift
   * `resolveFlow` and JS `resolveFlow`.
   */
  async resolveFlow(lang?: string): Promise<FlowDecision> {
    const { status, json } = await this._flowInit(lang)
    return this._decisionFromFlow(status, json)
  }

  /** Raw `/flow/init` request — returns status + body so `loadAuthView` can tell
   *  "endpoint unavailable" (404/405 → legacy fallback) apart from a real error
   *  (surfaced by `_decisionFromFlow`). */
  private async _flowInit(lang?: string): Promise<{ status: number; json: Record<string, unknown> }> {
    // #25: don't fire the gated flow request until App Attest has produced its
    // token — otherwise the tokenless cold-start request 403s (loadAuthView +
    // resolveFlow both route through here).
    await this._awaitAttestReady()
    const existing = await this.getSession()
    const headers: Record<string, string> = await this._secHeaders()
    // Same Bearer pattern as GET /api/sdk/auth/user (revalidateEntitlement).
    if (existing?.accessToken) headers['Authorization'] = `Bearer ${existing.accessToken}`
    const langParam = lang ? `&lang=${encodeURIComponent(lang)}` : ''
    const { status, json } = await httpGet(
      `${this.apiUrl}/api/sdk/flow/init?key=${encodeURIComponent(this.publishableKey)}&callback_scheme=${this._callbackScheme}${langParam}`,
      headers,
    )
    return { status, json: (json as Record<string, unknown> | null) ?? {} }
  }

  /** Map a `/flow/init` response to a FlowDecision, throwing on any non-200. */
  private _decisionFromFlow(status: number, j: Record<string, unknown>): FlowDecision {
    if (status !== 200) {
      // Surface the backend's reason (e.g. "store_not_configured", "Invalid
      // publishable key") instead of a bare status — a dev with a paywall on but
      // no store configured needs to see WHY the flow failed. store_not_configured
      // has no dedicated OneloError code here, so it maps to server_error (JS parity).
      const detail = j['detail']
      const reason = typeof detail === 'string' ? detail : (j['error'] as string | undefined) ?? `HTTP ${status}`
      throw OneloError.server(`Failed to resolve auth flow: ${reason}`)
    }
    if (j['action'] === 'authorized') return { action: 'authorized' }
    if (j['action'] === 'present' && typeof j['url'] === 'string') {
      const appName = typeof j['app_name'] === 'string' ? (j['app_name'] as string) : undefined
      const appLogo = typeof j['app_logo_url'] === 'string' ? (j['app_logo_url'] as string) : undefined
      if (appName) this.appName = appName
      if (appLogo) this.appLogoUrl = appLogo
      return { action: 'present', surface: String(j['surface'] ?? ''), url: j['url'] as string, appName, appLogo }
    }
    throw OneloError.server('Invalid flow response')
  }

  // ── Custom UI (paid plans only) ─────────────────────────────────────────────

  async signIn(email: string, password: string): Promise<OneloSession> {
    await this.initPromise
    await this._awaitAttestReady()  // #25: gated POST — wait for the attest token
    if (!this.allowCustomBranding) throw OneloError.planRequired()
    if (!this.pkceVerifier) this.pkceVerifier = generateCodeVerifier()
    const { status, json } = await httpPost(
      `${this.apiUrl}/api/sdk/auth/signin`,
      { email, password, publishableKey: this.publishableKey, code_verifier: this.pkceVerifier },
      await this._secHeaders()
    )
    checkHostedFlowRequired(json)
    const j = json as Record<string, unknown>
    if (status === 403) {
      const detail = j['detail'] as Record<string, unknown> | undefined
      if (detail?.['error'] === 'user_revoked') throw OneloError.userRevoked()
      throw OneloError.server((detail?.['message'] ?? j['error']) as string)
    }
    if (status !== 200) throw OneloError.server(`Sign in failed: HTTP ${status}`)
    this.pkceVerifier = null
    const session = mapSession(j)
    await this.saveSession(session)
    return session
  }

  async signUp(email: string, password: string): Promise<OneloSession> {
    await this.initPromise
    await this._awaitAttestReady()  // #25: gated POST — wait for the attest token
    if (!this.allowCustomBranding) throw OneloError.planRequired()
    if (!this.pkceVerifier) this.pkceVerifier = generateCodeVerifier()
    const { status, json } = await httpPost(
      `${this.apiUrl}/api/sdk/auth/signup`,
      { email, password, publishableKey: this.publishableKey, code_verifier: this.pkceVerifier },
      await this._secHeaders()
    )
    checkHostedFlowRequired(json)
    const j = json as Record<string, unknown>
    if (status !== 200) throw OneloError.server(`Sign up failed: HTTP ${status}`)
    this.pkceVerifier = null
    const session = mapSession(j)
    await this.saveSession(session)
    return session
  }

  // ── Session management ──────────────────────────────────────────────────────

  async signOut(): Promise<void> {
    // Invalidate any in-flight entitlement revalidation BEFORE the await below,
    // so it can't write the just-cleared tokens back after we sign out.
    this.signOutEpoch++
    this.stopHeartbeat()
    this.clearRefreshTimer()
    // Capture the token before wiping storage so we can still revoke afterwards.
    const accessToken = await this.storage.get(TOKEN_KEYS.ACCESS_TOKEN)
    // Tear down LOCAL state FIRST, then revoke server-side — exactly like Swift
    // (`OneloAuth.signOut`), which does the network call LAST so a stalled/hung
    // `/signout` can never delay the user's local sign-out.
    await this.storage.clear()
    this.notifyListeners(null)
    // Best-effort SERVER-side revoke (soft-revokes ALL of this user's sessions for
    // the app, so a leaked refresh token elsewhere dies too). Fire-and-forget: the
    // user is already signed out locally, so offline / a hang never blocks.
    if (accessToken) {
      const headers = await this._secHeaders({
        Authorization: `Bearer ${accessToken}`,
        'X-Publishable-Key': this.publishableKey,
      })
      void httpPost(`${this.apiUrl}/api/sdk/auth/signout`, {}, headers).catch(() => {
        // offline / server error — the local sign-out above already happened
      })
    }
  }

  // ── Real-time revocation (shared SSE stream) ─────────────────────────────────

  /**
   * Wire the shared event stream (called once by Onelo, BEFORE the stream is
   * started). Registers a `session.revoked` listener so a server-side revoke
   * (refund lapse, admin force-logout, account deletion, ban) signs the user out
   * in ~sub-second — the real-time complement to the ≤13-min heartbeat fallback.
   * Registered once and survives sign-in/sign-out cycles, exactly like Swift's
   * `_handleSessionRevoked` wiring. Does NOT start the stream — Onelo owns the
   * connection lifecycle.
   */
  attachEventStream(stream: OneloEventStream): void {
    stream.on('session.revoked', (data) => { void this._handleSessionRevoked(data) })
  }

  /**
   * Handle a `session.revoked` push. One app can multiplex multiple buyers on the
   * shared connection, so filter to the current user: a `app_user_id` that
   * targets a DIFFERENT user is ignored; a missing `app_user_id` is treated as
   * "current user" (forward-compat — the backend may omit it for account-wide
   * revokes). No active session → nothing to revoke. Teardown mirrors `signOut()`
   * exactly (and bumps `signOutEpoch` first) so an in-flight refresh/entitlement
   * revalidation can't resurrect the just-cleared session.
   */
  private async _handleSessionRevoked(data: Record<string, unknown>): Promise<void> {
    const userJson = await this.storage.get(TOKEN_KEYS.USER_JSON)
    if (!userJson) return // no active session — nothing to revoke
    let currentUserId: string | undefined
    try { currentUserId = (JSON.parse(userJson) as OneloUser).id } catch { /* treat as current user */ }
    const eventUserId = data['app_user_id']
    if (typeof eventUserId === 'string' && currentUserId && eventUserId !== currentUserId) {
      return // targets a different buyer on this shared connection
    }
    // Invalidate any in-flight refresh/revalidation BEFORE the storage await, so
    // it can't write the just-cleared tokens back (parity with signOut()).
    this.signOutEpoch++
    this.stopHeartbeat()
    this.clearRefreshTimer()
    await this.storage.clear()
    this.isUserRevoked = true
    this.notifyListeners(null)
  }

  /**
   * Fast presence probe for a stored session — reads the token keys ONLY, with
   * NO refresh and NO network. The React Native analogue of Swift's SYNCHRONOUS
   * `hasStoredSessionSync()` (#36): RN's Keychain storage is async-only, so this
   * is a Promise, but it is far cheaper than `getSession()` (no near-expiry
   * refresh) / `whenReady()` (no config wait). `OneloAuthGate` uses it to tell
   * "restoring an existing session on cold start" (→ show a neutral branded
   * background, never the sign-in skeleton) apart from a "genuine no-session cold
   * start" (→ show the sign-in skeleton immediately) — so an auto-login never
   * flashes the sign-in form before content. Returns true only when access +
   * refresh tokens AND a decodable user (with an id) are all present; never throws.
   */
  async hasStoredSession(): Promise<boolean> {
    try {
      const [accessToken, refreshToken, userJson] = await Promise.all([
        this.storage.get(TOKEN_KEYS.ACCESS_TOKEN),
        this.storage.get(TOKEN_KEYS.REFRESH_TOKEN),
        this.storage.get(TOKEN_KEYS.USER_JSON),
      ])
      if (!accessToken || !refreshToken || !userJson) return false
      const user = JSON.parse(userJson) as OneloUser
      return typeof user?.id === 'string' && user.id.length > 0
    } catch {
      return false
    }
  }

  async getSession(): Promise<OneloSession | null> {
    const [accessToken, refreshToken, expiresAtStr, userJson] = await Promise.all([
      this.storage.get(TOKEN_KEYS.ACCESS_TOKEN),
      this.storage.get(TOKEN_KEYS.REFRESH_TOKEN),
      this.storage.get(TOKEN_KEYS.EXPIRES_AT),
      this.storage.get(TOKEN_KEYS.USER_JSON),
    ])
    if (!accessToken || !refreshToken || !userJson) return null
    const expiresAt = parseInt(expiresAtStr ?? '0', 10)
    if (Date.now() / 1000 > expiresAt - 60) {
      return this.refreshSession()
    }
    const user = JSON.parse(userJson) as OneloUser
    if (!user.id) {
      await this.storage.clear()
      return null
    }
    const session: OneloSession = { accessToken, refreshToken, expiresAt, user }
    // Arm background refresh on first read after process start.
    this.scheduleRefresh(session)
    return session
  }

  async refreshSession(): Promise<OneloSession | null> {
    // Single-flight: getSession() fires refreshSession() from many concurrent
    // callers (gate mount + foreground + scheduled timer). Sharing ONE promise
    // ensures a single /auth/refresh with a single use of the rotating token.
    if (this._refreshInFlight) return this._refreshInFlight
    this._refreshInFlight = this._doRefresh()
    try {
      return await this._refreshInFlight
    } finally {
      this._refreshInFlight = null
    }
  }

  private async _doRefresh(): Promise<OneloSession | null> {
    // Capture the sign-out epoch BEFORE the network await: if signOut() (or a
    // session.revoked teardown) runs while this refresh is in flight, we must NOT
    // write the fresh tokens back NOR clear a newer session. Parity with Swift.
    const epoch = this.signOutEpoch
    const refreshToken = await this.storage.get(TOKEN_KEYS.REFRESH_TOKEN)
    if (!refreshToken) return null
    const { status, json } = await httpPost(
      `${this.apiUrl}/api/sdk/auth/refresh`,
      // Wire key MUST be snake_case `refresh_token`: the backend
      // RefreshRequest model (sdk_auth.py) requires it and rejects a
      // camelCase `refreshToken` with a hard 422 (the handler never runs).
      // Matches every response payload + the Swift SDK request.
      { publishableKey: this.publishableKey, refresh_token: refreshToken },
      await this._secHeaders()
    )
    checkHostedFlowRequired(json)
    const j = json as Record<string, unknown>
    // Only tear down when THIS refresh's epoch is still current — a signOut() or a
    // sign-in that superseded us mid-flight must not have its state clobbered by a
    // stale failed refresh (defence-in-depth on top of single-flight).
    const teardown = async (): Promise<void> => {
      if (epoch !== this.signOutEpoch) return
      this.clearRefreshTimer(); await this.storage.clear(); this.notifyListeners(null)
    }
    // Set the revoked flags only when this epoch is still current (like teardown) —
    // a concurrent sign-in that superseded this stale refresh must not be re-flagged.
    if (j['error'] === 'user_revoked') { if (epoch === this.signOutEpoch) this.isUserRevoked = true; await teardown(); throw OneloError.userRevoked() }
    if (j['error'] === 'app_revoked') { if (epoch === this.signOutEpoch) this.isRevoked = true; await teardown(); throw OneloError.revoked() }
    if (status !== 200) { await teardown(); return null }
    if (epoch !== this.signOutEpoch) return null
    const session = mapSession(j)
    await this.saveSession(session)
    return session
  }

  /**
   * One-time cold-start restore: if a valid session sits in the keychain, PUBLISH
   * it (so the Onelo bridge starts the SSE stream — incl. `session.revoked` — plus
   * features/monitor/consent and arms the heartbeat) and best-effort verify it
   * against the backend. Without this a returning signed-in user gets NONE of those
   * on launch: `notifyListeners` only fires from `saveSession` (a fresh sign-in or
   * refresh), so real-time revocation, per-user features, and the consent gate would
   * silently not run until a token refresh eventually happened. Parity with Swift
   * `restoreSession`. Call once from the Onelo composition root.
   */
  async restoreSession(): Promise<OneloSession | null> {
    await this.initPromise
    let session: OneloSession | null
    try {
      // May refresh if near-expiry — and _doRefresh THROWS on user_revoked/app_revoked
      // (it has already torn down + notified null). Swallow so this cold-start call
      // honours its "best-effort, never throws" contract (no unhandled rejection).
      session = await this.getSession()
    } catch {
      return null
    }
    if (!session) return null
    // If getSession took the refresh path, saveSession ALREADY emitted the session +
    // armed the heartbeat + ran the onAuthStateChange bridge. Only emit here when the
    // cached token was still valid (heartbeat not yet armed) — avoids a duplicate,
    // concurrent bridge run (double features.load) on the near-expiry cold-start path.
    if (this.heartbeatTimer === null) {
      this.startHeartbeat(session.accessToken)
      this.notifyListeners(session)
    }
    if (this.isPaywallEnabled()) void this.revalidateEntitlement().catch(() => {})
    void this._verifySession(session.accessToken).catch(() => {})
    return session
  }

  /**
   * Best-effort backend session check (`GET /api/sdk/auth/verify`, sdk_auth.py:2911)
   * — catches an account revoked/deleted/suspended while the app was OFFLINE, which
   * the SSE push can't deliver. 403 with a revoke reason → clear + `isUserRevoked`;
   * any other status / network failure fails OPEN (keep the cached session). Epoch-
   * guarded so a concurrent sign-out isn't clobbered.
   */
  private async _verifySession(accessToken: string): Promise<void> {
    const epoch = this.signOutEpoch
    try {
      const { status, json } = await httpGet(
        `${this.apiUrl}/api/sdk/auth/verify`,
        await this._secHeaders({ Authorization: `Bearer ${accessToken}` }),
      )
      if (status !== 403) return
      const j = json as Record<string, unknown>
      const detail = j['detail'] as Record<string, unknown> | undefined
      const reason = String((detail?.['error'] ?? j['error'] ?? '') as string)
      const revokeReasons = ['revoked', 'deleted', 'suspended', 'banned',
        'account_revoked', 'account_deleted', 'account_suspended', 'session_compromised']
      if (revokeReasons.includes(reason) && epoch === this.signOutEpoch) {
        this.stopHeartbeat(); this.clearRefreshTimer(); this.signOutEpoch++
        await this.storage.clear(); this.isUserRevoked = true; this.notifyListeners(null)
      }
    } catch {
      // network / endpoint unreachable → fail-open (keep cached session)
    }
  }

  // ── Entitlement ─────────────────────────────────────────────────────────────

  /**
   * True when the current session's user has an active paid entitlement.
   * Snapshot read of the persisted session (no network) — mirrors Swift's
   * `hasActiveAccess`. Returns false when there is no session.
   */
  async hasActiveAccess(): Promise<boolean> {
    const session = await this.getSession()
    return session?.user.entitlement === 'active'
  }

  /**
   * Re-fetch the user's entitlement from the backend and, if it changed, rebuild
   * + persist + republish the session so `hasActiveAccess()` and auth-state
   * listeners see the new value. Call after an external checkout or on app
   * resume. Best-effort: returns the currently-cached entitlement on any
   * non-200/network failure and never throws (mirrors Swift/JS
   * `revalidateEntitlement`). Epoch-guarded: a sign-out that races this request
   * cancels the write-back so a stale entitlement can't resurrect the session.
   */
  async revalidateEntitlement(): Promise<OneloEntitlement> {
    const epoch = this.signOutEpoch
    const session = await this.getSession()
    if (!session) return 'none'
    try {
      const { status, json } = await httpGet(
        `${this.apiUrl}/api/sdk/auth/user`,
        await this._secHeaders({
          Authorization: `Bearer ${session.accessToken}`,
          'X-Publishable-Key': this.publishableKey,
        }),
      )
      if (status !== 200) return session.user.entitlement
      const next: OneloEntitlement =
        (json as Record<string, unknown>)['entitlement'] === 'active' ? 'active' : 'none'
      // Don't resurrect a session that was signed out while this request was in
      // flight (epoch guard, parity with Swift).
      if (next !== session.user.entitlement && epoch === this.signOutEpoch) {
        await this.saveSession({ ...session, user: { ...session.user, entitlement: next } })
      }
      return next
    } catch {
      // Best-effort — never throw; keep the cached value.
      return session.user.entitlement
    }
  }

  /** True when the app has the paywall enabled (from `/api/sdk/config`). Gate
   *  callers use this so non-paywall apps enter on a session alone (their
   *  `entitlement` is always `'none'`). Mirrors Electron `isPaywallEnabled`. */
  isPaywallEnabled(): boolean {
    return this.resolvedConfig?.paywallEnabled ?? false
  }

  /** Branding "Page background" color (`checkout_bg_color`, --onelo-page-bg) from
   *  `/api/sdk/config`. Native modals paint their WebView + container with this so
   *  there is no white flash before the hosted page's own background renders.
   *  Defaults to #111111 (the hosted-page default) before config resolves. */
  pageBackgroundColor(): string {
    return this.resolvedConfig?.pageBackgroundColor ?? '#111111'
  }

  /** Plan-gated enabled OAuth providers (google/github/apple) from
   *  `/api/sdk/config`; empty when social is disabled. Consumed by the Round 2
   *  OAuth entry point. */
  get oauthProviders(): string[] {
    return this.resolvedConfig?.oauthProviders ?? []
  }

  /** Backend base URL. `AuthModal` uses it to build the OAuth system-browser
   *  hand-off URL (`{baseUrl}/api/sdk/auth/oauth/hosted-init?provider=…&token=…`)
   *  when the hosted page relays a `native_oauth{provider,token}` message. Optional for
   *  the primary OAuth path (a hosted-page `window.location.href` navigation to
   *  the full provider/oauth-init URL is diverted to the system browser without
   *  it) — thread it only to enable the message-relay path. */
  get baseUrl(): string {
    return this.apiUrl
  }

  onAuthStateChange(callback: (session: OneloSession | null) => void): () => void {
    this.authStateListeners.push(callback)
    return () => {
      this.authStateListeners = this.authStateListeners.filter(l => l !== callback)
    }
  }

  private startHeartbeat(accessToken: string): void {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(async () => {
      const epoch = this.signOutEpoch
      try {
        // getSession() is INSIDE the try: it may refresh a near-expiry token, and
        // _doRefresh throws on user_revoked/app_revoked (already torn down) — must
        // not surface as an unhandled rejection in this detached interval callback.
        const session = await this.getSession()
        if (!session) { this.stopHeartbeat(); return }
        const res = await fetch(`${this.apiUrl}/api/sdk/presence/heartbeat`, {
          method: 'POST',
          headers: await this._secHeaders({ Authorization: `Bearer ${session.accessToken}` }),
        })
        // 401 = server revoked / banned / zero active sessions. This is the ≤13-min
        // fallback to the real-time SSE session.revoked push. Epoch-guarded so a
        // concurrent sign-out isn't double-handled.
        if (res.status === 401 && epoch === this.signOutEpoch) {
          this.stopHeartbeat(); this.clearRefreshTimer(); this.signOutEpoch++
          await this.storage.clear(); this.isUserRevoked = true; this.notifyListeners(null)
        }
      } catch {
        // fire-and-forget (network blip — keep the session)
      }
    }, OneloAuth.HEARTBEAT_MS)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  /**
   * Schedule a background refresh of the access token to fire `REFRESH_LEAD_SECONDS`
   * before it expires. Idempotent — cancels any pending refresh first. Without this,
   * an idle app would carry a stale token past its TTL and the next request would 401.
   */
  private scheduleRefresh(session: OneloSession): void {
    this.clearRefreshTimer()
    const nowSec = Date.now() / 1000
    const delaySec = session.expiresAt - nowSec - OneloAuth.REFRESH_LEAD_SECONDS
    const delayMs = delaySec > 0 ? delaySec * 1000 : 0
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null
      void this.refreshSession().catch(() => {
        // Errors already handled inside refreshSession.
      })
    }, delayMs)
  }

  private clearRefreshTimer(): void {
    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer)
      this.refreshTimer = null
    }
  }

  private async saveSession(session: OneloSession): Promise<void> {
    await Promise.all([
      this.storage.set(TOKEN_KEYS.ACCESS_TOKEN, session.accessToken),
      this.storage.set(TOKEN_KEYS.REFRESH_TOKEN, session.refreshToken),
      this.storage.set(TOKEN_KEYS.EXPIRES_AT, String(session.expiresAt)),
      this.storage.set(TOKEN_KEYS.USER_JSON, JSON.stringify(session.user)),
    ])
    // A fresh session write means the user is valid again — clear a stale revoked
    // flag left by a prior session.revoked / heartbeat-401 / verify teardown.
    this.isUserRevoked = false
    this.notifyListeners(session)
    this.startHeartbeat(session.accessToken)
    this.scheduleRefresh(session)
  }

  private notifyListeners(session: OneloSession | null): void {
    for (const cb of this.authStateListeners) cb(session)
  }

  private notifyModalListeners(): void {
    for (const cb of this.modalStateListeners) cb()
  }

  // ── Magic link & password reset ─────────────────────────────────────────────

  async sendMagicLink(email: string): Promise<void> {
    await this.initPromise
    const { status } = await httpPost(
      `${this.apiUrl}/api/sdk/auth/magic-link`,
      { email, publishableKey: this.publishableKey },
      await this._secHeaders()
    )
    if (status !== 200) throw OneloError.server(`sendMagicLink failed: HTTP ${status}`)
  }

  async sendPasswordReset(email: string): Promise<void> {
    await this.initPromise
    const { status } = await httpPost(
      `${this.apiUrl}/api/sdk/auth/reset-password/request`,
      { email, publishableKey: this.publishableKey },
      await this._secHeaders()
    )
    if (status !== 200) throw OneloError.server(`sendPasswordReset failed: HTTP ${status}`)
  }
}
