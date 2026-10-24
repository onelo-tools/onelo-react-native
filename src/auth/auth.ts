import {
  httpGet, httpPost, checkHostedFlowRequired,
  mapSession, mergeAccessAnswer, resendVerificationEmail as postResendVerification, confirmEmail as postConfirmEmail, type ResendVerificationResult, TOKEN_KEYS, isSessionEndError, BrandSource, brandTokensFromResponse, NEUTRAL_BRAND_TOKENS, type BrandTokens,
  type OneloConfig, type OneloSession, type OneloUser, type OneloEntitlement, OneloError, type ResolvedSDKConfig,
  configLanguageParam, signUpConsentFields, signupMarketingConsentFromConfig, NO_SIGNUP_MARKETING_CONSENT,
  type SignUpOptions, type SignupMarketingConsent,
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
import type { PlanChange } from '../core/plan-change'
import { generateCodeVerifier, generateCodeChallenge } from '../core/pkce'
import { KeychainStorage } from '../core/storage'
import { sdkHeaders, getNativeBundleId } from '../sdk-headers'
import { maybeSelfHealFromError } from '../attest'
import type { OneloEventStream } from '../core/event-stream'
import type { ModalResult } from './auth-modal'
import { isExpiredAuthError } from './auth-modal'
import { parseCallbackDeepLink, isOneloHostedSurface } from './webview-oauth'

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
  /**
   * PKCE verifier of the latest hosted flow (#542). Its challenge goes to
   * `/flow/init`, which binds every code that flow hands out, including one
   * from a magic link opened on another device (#540). Kept separate from
   * `pkceVerifier`, which belongs to the custom-UI `signIn`/`signUp` and is
   * nulled after each of them. Persisted in the Keychain as well, because a
   * link opened on THIS device returns through the OS, often after the app was
   * killed while the user was in Mail.
   */
  private flowVerifier: string | null = null
  /** The launch URL is handed over once per instance: `getInitialURL()`
   *  keeps returning it for the whole process. */
  private _launchUrlHandled = false
  private resolvedConfig: ResolvedSDKConfig | null = null
  /** The SDK's one brand-token model (#681), shared with every module. */
  readonly brand = new BrandSource()
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private refreshTimer: ReturnType<typeof setTimeout> | null = null
  private static readonly HEARTBEAT_MS = 13 * 60 * 1000
  /** Refresh this many seconds before the access token expires. */
  private static readonly REFRESH_LEAD_SECONDS = 60
  /** Retry a TRANSIENT refresh failure (offline, a lost response, 429, 5xx —
   *  incl. `503 refresh_unavailable`) with backoff: 5 s, 10 s, 20 s, 40 s,
   *  then every 60 s, keeping the session. The first retry lands inside the
   *  server's 30 s refresh-token grace window. Parity with onelo-js. */
  private static readonly REFRESH_RETRY_BASE_MS = 5000
  private static readonly REFRESH_RETRY_MAX_MS = 60_000
  private refreshRetryAttempt = 0
  /** Until this time (ms) getSession() does not start a refresh on its own. */
  private refreshBackoffUntil = 0
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
  /** True when the backend requires device attestation for this app (at least
   *  one registered bundle id has `attest_enabled=true`) — App Attest on iOS,
   *  Play Integrity on Android. Read from `/api/sdk/config` (`attest_required`);
   *  the composition root (`Onelo`) uses it to decide whether to kick off
   *  attestation. Parity with Swift `OneloAuth.attestRequired`. */
  attestRequired = false
  /** Android Play Integrity: the developer's Google Cloud project NUMBER
   *  (`/api/sdk/config`'s `cloud_project_number`), sourced from the Play
   *  Integrity credential uploaded in the Onelo dashboard. Required by the
   *  Standard Integrity API's `setCloudProjectNumber`; `null` when unconfigured
   *  (the composition root then skips Play Integrity). Ignored on iOS. */
  cloudProjectNumber: number | null = null

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
    // #18 DX: X-Bundle-Id auto-derives from the native module on both platforms
    // (iOS `Bundle.main.bundleIdentifier`, Android `Context.getPackageName()`),
    // but only once the native module is linked (pod install / Gradle sync). If
    // NEITHER config nor native can provide it, requests are rejected
    // (bundle_id_mismatch 403) once enforcement is active — warn LOUDLY at init
    // instead of a silent 403 much later. Fire-and-forget so it never blocks
    // construction.
    if (!config.bundleId) {
      void getNativeBundleId().then((nb) => {
        if (!nb) {
          console.warn(
            '[Onelo] No `bundleId` in config and none could be derived natively ' +
            '(the OneloAttest native module is not linked — rebuild after pod install / Gradle sync). ' +
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
      // #818: `lang` puts the sign-up Marketing Consent text in the device language.
      const url = `${this.apiUrl}/api/sdk/config?key=${encodeURIComponent(this.publishableKey)}&code_challenge=${encodeURIComponent(challenge)}${configLanguageParam()}`
      const { status, json } = await httpGet(url, await this._secHeaders())
      if (status === 401 || status === 404) throw OneloError.invalidKey('Server rejected the key')
      if (status !== 200) throw OneloError.server(`Config request failed: HTTP ${status}`)
      const j = json as Record<string, unknown>
      // #681: `brand_tokens`, or the shape the legacy colours imply.
      const brandTokens = brandTokensFromResponse(j) ?? NEUTRAL_BRAND_TOKENS
      this.brand.set(brandTokens)
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
        // Branding page background — the token's page_bg (#681).
        pageBackgroundColor: brandTokens.page_bg,
        brandTokens,
        // Plan-gated enabled OAuth providers (google/github/apple). Previously
        // unmapped — the field is surfaced via the `oauthProviders` getter and
        // consumed by the Round 2 OAuth entry point.
        oauthProviders: Array.isArray(j['oauth_providers']) ? (j['oauth_providers'] as string[]) : undefined,
        // #948: the sign-in skeleton draws the magic-link row from this.
        magicLinkEnabled: j['magic_link_enabled'] === true,
        signupMarketingConsent: signupMarketingConsentFromConfig(j),
      }
      // App Attest requirement is not part of the typed ResolvedSDKConfig
      // (`@onelo/core`), so read it straight off the raw config JSON.
      this.attestRequired = (j['attest_required'] as boolean) ?? false
      const cpn = j['cloud_project_number']
      this.cloudProjectNumber = typeof cpn === 'number' && cpn > 0 ? cpn : null
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
        if (result.type === 'expired') {
          // The addressing token is spent. Re-resolve and reopen rather than
          // failing: /flow/init now answers `sign_in` (the session was just
          // revoked), so the user lands on a clean form instead of an error.
          // The modal was already hidden above, so this reopens it.
          try {
            resolve(await this.loadAuthView())
          } catch (e) {
            reject(e)
          }
          return
        }
        try {
          const session = await this.exchangeHostedCode(result.code)
          // The hosted flow can chain sign-in → store, so the code may carry
          // a purchase: reconcile the plan at once (#659). A plain sign-in
          // costs one extra resolve.
          this.onPlanChange?.({ kind: 'purchase' })
          resolve(session)
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
    // The verifier of the flow this code came from: in memory while that flow
    // is live, from the Keychain after a relaunch. A code from a flow without
    // a challenge (the store's own initiate, the legacy /auth/initiate) is
    // not checked against it, so sending it there is harmless.
    const verifier = this.flowVerifier ?? (await this.storage.get(TOKEN_KEYS.MAGIC_LINK_VERIFIER))
    const { status, json } = await httpPost(
      `${this.apiUrl}/api/sdk/auth/hosted-callback`,
      { publishableKey: this.publishableKey, code, code_verifier: verifier },
      await this._secHeaders(),
    )
    if (status !== 200) {
      // One attempt, never retried. A failure leaves the stored verifier in
      // place: it may belong to a newer flow that is still open, and the
      // backend does not spend the link on a failed exchange.
      const detail = (json as Record<string, unknown> | null)?.['detail']
      if (detail === 'code_verifier required' || detail === 'PKCE verification failed') {
        throw OneloError.server(
          'This sign-in link belongs to a different sign-in on this device. ' +
          'Open the sign-in again and request a new link.',
        )
      }
      throw OneloError.server(`Hosted callback failed: ${typeof detail === 'string' ? detail : `HTTP ${status}`}`)
    }
    // The flow is finished; its verifier is single use. Cleared BEFORE the
    // session is saved: saving notifies auth listeners, which may start a new
    // flow, and clearing afterwards would erase that flow's fresh verifier.
    this.flowVerifier = null
    await this.storage.delete(TOKEN_KEYS.MAGIC_LINK_VERIFIER)
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
    const challenge = await this._beginFlowPkce()
    const { status, json } = await httpGet(
      `${this.apiUrl}/api/sdk/flow/init?key=${encodeURIComponent(this.publishableKey)}&callback_scheme=${this._callbackScheme}&code_challenge=${encodeURIComponent(challenge)}${langParam}`,
      headers,
    )
    // A stale, still-"valid" cached attest/integrity token can silently drift
    // from a backend registration that changed underneath it (bundle
    // unregistered/re-registered, cert rotated) — the cache doesn't expire for
    // up to 30 days, so without this the SDK would keep presenting the same
    // stale credential forever. flow/init is the first gated request on every
    // cold start, so checking here catches the drift as early as possible.
    if (status !== 200) maybeSelfHealFromError(json)
    return { status, json: (json as Record<string, unknown> | null) ?? {} }
  }

  /**
   * Start a hosted flow's PKCE pair (#542): a fresh verifier, kept in memory
   * and in the Keychain, and its S256 challenge for `/flow/init`. With the
   * challenge on the flow token, the hosted page pairs a magic link opened on
   * another device with a code, and every code the flow hands out can only be
   * exchanged by this install. One slot, as in onelo-js (#535): a newer flow
   * overwrites it, and a link from the older one then fails with a clear error
   * without being spent. A failed Keychain write leaves the in-memory verifier,
   * which still covers every return while the app keeps running.
   */
  private async _beginFlowPkce(): Promise<string> {
    const verifier = generateCodeVerifier()
    this.flowVerifier = verifier
    await this.storage.set(TOKEN_KEYS.MAGIC_LINK_VERIFIER, verifier)
    return generateCodeChallenge(verifier)
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

  /**
   * #818 — should your own sign-up screen show the optional Marketing Consent
   * checkbox, and with what text? Set on the parent App in Auth → Sign-up; an
   * App that sells asks at Checkout instead (`asked` false). Show `text`
   * unticked and pass the person's choice to `signUp(..., { marketingConsent })`.
   */
  getSignupMarketingConsent(): SignupMarketingConsent {
    return this.resolvedConfig?.signupMarketingConsent ?? NO_SIGNUP_MARKETING_CONSENT
  }

  async signUp(email: string, password: string, options?: SignUpOptions): Promise<OneloSession> {
    await this.initPromise
    await this._awaitAttestReady()  // #25: gated POST — wait for the attest token
    if (!this.allowCustomBranding) throw OneloError.planRequired()
    if (!this.pkceVerifier) this.pkceVerifier = generateCodeVerifier()
    const { status, json } = await httpPost(
      `${this.apiUrl}/api/sdk/auth/signup`,
      {
        email, password, publishableKey: this.publishableKey, code_verifier: this.pkceVerifier,
        // #818: only when the person ticked it, in the language of the text shown.
        ...signUpConsentFields(options, this.getSignupMarketingConsent()),
      },
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
    // #635: the user's grant changed (purchase, switch, refund, pause…). The
    // backend sends it only to this user's streams, right after the fresh
    // `features_updated`; re-read the entitlement so hasActiveAccess() follows.
    stream.on('paywall.access_changed', () => { void this.revalidateEntitlement().catch(() => {}) })
  }

  /** Told when the hosted flow this class presented ended in a code — which
   *  can carry a purchase (#659). Set by `Onelo` to its plan-change refresher. */
  private onPlanChange: ((change: PlanChange) => void) | null = null
  setPlanChangeHandler(fn: ((change: PlanChange) => void) | null): void {
    this.onPlanChange = fn
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
      // A transient failure already scheduled a retry: don't start another
      // refresh per read. The access token may still be good for a moment.
      if (Date.now() < this.refreshBackoffUntil) return this._storedSession()
      // A refused refresh is an expected state change: the session is already
      // cleared and announced (onAuthStateChange(null)). Answer "no session" —
      // getSession() runs from the gate, timers and background work, where a
      // throw surfaced to Monitor as an `unhandled` error. refreshSession()
      // says why the session ended.
      // A TRANSIENT failure (offline, 429, 5xx) is not a sign-out either: the
      // session is kept and a retry is scheduled, so the read answers with the
      // stored session instead of throwing into the gate or a caller.
      return this.refreshSession().catch((e: unknown) => {
        if (isSessionEndError(e)) return null
        return this._storedSession()
      })
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
    let res: Awaited<ReturnType<typeof httpPost>>
    try {
      res = await httpPost(
        `${this.apiUrl}/api/sdk/auth/refresh`,
        // Wire key MUST be snake_case `refresh_token`: the backend
        // RefreshRequest model (sdk_auth.py) requires it and rejects a
        // camelCase `refreshToken` with a hard 422 (the handler never runs).
        // Matches every response payload + the Swift SDK request.
        { publishableKey: this.publishableKey, refresh_token: refreshToken },
        await this._secHeaders()
      )
    } catch (e) {
      // Offline, or the response was lost after the server rotated the token.
      // Keep the session; the retry re-reads storage and lands inside the
      // server's grace window.
      if (epoch === this.signOutEpoch) this._scheduleRefreshRetry()
      throw e
    }
    const { status, json } = res
    checkHostedFlowRequired(json)
    if (status === 429 || status >= 500) {
      // Transient — incl. 503 `refresh_unavailable`: the presented token is
      // STILL VALID. Never clear the session for it; retry with backoff.
      if (epoch === this.signOutEpoch) this._scheduleRefreshRetry()
      throw OneloError.server(`Session refresh is temporarily unavailable (HTTP ${status})`)
    }
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
    if (status !== 200) {
      // A sign-out / newer sign-in superseded this refresh: its refusal is stale.
      if (epoch !== this.signOutEpoch) return null
      // The backend's reason sits in the HTTPException body:
      // { detail: { error | error_code } } (sdk_auth.py refresh).
      const detail = j['detail'] as Record<string, unknown> | undefined
      const reason = (detail?.['error'] ?? detail?.['error_code']) as string | undefined
      // Only a real ban says "suspended".
      if (reason === 'banned') { this.isUserRevoked = true; await teardown(); throw OneloError.userRevoked() }
      await teardown()
      // A lapsed plan is plan-accurate, never "suspended".
      if (reason === 'no_plan_available') throw OneloError.noActivePlan()
      // session_compromised (token reused outside the server's grace window) /
      // session_expired / session_invalid / any other refusal: neutral.
      throw OneloError.sessionEnded()
    }
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
   * May this person see the app?
   *
   * READ from the server, never computed here. The rule
   * `!paywallEnabled || entitlement === 'active'` once lived in this SDK, in the
   * JS SDK and in Swift — three copies, each found wrong on a different day. The
   * JS copy answered `true` while its config was still loading, so a plan-less
   * user walked into a paid app on every page load (2026-08-18).
   * `/api/sdk/auth/user` now ships the conclusion so it cannot recur.
   *
   * The fallback is COMPATIBILITY, not a second source of truth: an older
   * backend simply does not send `allowed_in`, and treating absent as `false`
   * would lock every user out of an app running this SDK ahead of the backend.
   * Delete it once the field is everywhere. Note `=== false`: the config flag is
   * only trustworthy once resolved, so anything else must deny.
   *
   * Contract: docs/sdk-access-gate-wiring.md
   */
  async isAllowedIn(): Promise<boolean> {
    const session = await this.getSession()
    if (!session) return false
    const answer = session.user.allowedIn
    if (typeof answer === 'boolean') return answer
    return this.isPaywallEnabled() === false || session.user.entitlement === 'active'
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
      const body = json as Record<string, unknown>
      const next: OneloEntitlement = body['entitlement'] === 'active' ? 'active' : 'none'
      // Persist the ANSWER too, not only the ingredient. Refreshing entitlement
      // alone left a paying customer holding a stored "not allowed" — locked out
      // by the very call meant to let them in (found in JS/Swift/Flutter/
      // Electron, 2026-08-19). Absent stays undefined so the fallback applies.
      // #819: allowedIn, emailVerified and accessReason move together — a
      // just-verified user must not keep a stored "not allowed".
      const nextUser = mergeAccessAnswer({ ...session.user, entitlement: next }, body)
      // Don't resurrect a session that was signed out while this request was in
      // flight (epoch guard, parity with Swift).
      const changed = next !== session.user.entitlement
        || nextUser.allowedIn !== session.user.allowedIn
        || nextUser.emailVerified !== session.user.emailVerified
        || nextUser.accessReason !== session.user.accessReason
      if (changed && epoch === this.signOutEpoch) {
        await this.saveSession({ ...session, user: nextUser })
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

  /** The app's brand tokens (#681) from `/api/sdk/config` (refreshed by store /
   *  portal / upgrade initiate responses). Every native modal paints its chrome
   *  from these; the NEUTRAL set before config resolves — never Onelo orange. */
  brandTokens(): BrandTokens {
    return this.brand.current()
  }

  /** Branding "Page background" color — `brandTokens().page_bg`. Native modals
   *  paint their WebView + container with it so there is no white flash. */
  pageBackgroundColor(): string {
    return this.brand.current().page_bg
  }

  /** Plan-gated enabled OAuth providers (google/github/apple) from
   *  `/api/sdk/config`; empty when social is disabled. Consumed by the Round 2
   *  OAuth entry point. */
  get oauthProviders(): string[] {
    return this.resolvedConfig?.oauthProviders ?? []
  }

  /** #948: passwordless sign-in on (`/api/sdk/config` `magic_link_enabled`). */
  get magicLinkEnabled(): boolean {
    return this.resolvedConfig?.magicLinkEnabled === true
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
    // A retry after a transient failure is pending: it owns the timer.
    if (Date.now() < this.refreshBackoffUntil) return
    this.clearRefreshTimer()
    const nowSec = Date.now() / 1000
    const delaySec = session.expiresAt - nowSec - OneloAuth.REFRESH_LEAD_SECONDS
    const delayMs = delaySec > 0 ? delaySec * 1000 : 0
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null
      void this.refreshSession().catch(() => {
        // Expected: an ended session is already cleared + announced; a
        // transient failure keeps the session. Never escapes the timer.
      })
    }, delayMs)
  }

  private clearRefreshTimer(): void {
    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer)
      this.refreshTimer = null
    }
  }
  /** The complete session in storage (read fresh — a sign-out may have
   *  cleared it meanwhile), or null. */
  private async _storedSession(): Promise<OneloSession | null> {
    const [accessToken, refreshToken, expiresAtStr, userJson] = await Promise.all([
      this.storage.get(TOKEN_KEYS.ACCESS_TOKEN),
      this.storage.get(TOKEN_KEYS.REFRESH_TOKEN),
      this.storage.get(TOKEN_KEYS.EXPIRES_AT),
      this.storage.get(TOKEN_KEYS.USER_JSON),
    ])
    if (!accessToken || !refreshToken || !userJson) return null
    try {
      const user = JSON.parse(userJson) as OneloUser
      if (!user.id) return null
      return { accessToken, refreshToken, expiresAt: parseInt(expiresAtStr ?? '0', 10), user }
    } catch {
      return null
    }
  }

  /** Re-arm the refresh after a transient failure, with backoff. Reset by the
   *  next saved session. */
  private _scheduleRefreshRetry(): void {
    const delay = Math.min(
      OneloAuth.REFRESH_RETRY_BASE_MS * 2 ** this.refreshRetryAttempt,
      OneloAuth.REFRESH_RETRY_MAX_MS,
    )
    this.refreshRetryAttempt++
    this.refreshBackoffUntil = Date.now() + delay
    this.clearRefreshTimer()
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null
      this.refreshBackoffUntil = 0
      void this.refreshSession().catch(() => {
        // A further transient failure re-arms itself; an ended session is
        // already cleared + announced. Never escapes the timer.
      })
    }, delay)
  }


  private async saveSession(session: OneloSession): Promise<void> {
    this.refreshRetryAttempt = 0
    this.refreshBackoffUntil = 0
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
    // NOTE — no `code_challenge` here, deliberately. This is the custom-UI
    // link and stays unpaired: it must be opened on this device (#540, #542).
    // The hosted sign-in's magic link is paired through the flow's own
    // challenge (`_beginFlowPkce`), not through this call.
    const { status } = await httpPost(
      `${this.apiUrl}/api/sdk/auth/magic-link`,
      {
        email,
        publishableKey: this.publishableKey,
      },
      await this._secHeaders()
    )
    if (status !== 200) throw OneloError.server(`sendMagicLink failed: HTTP ${status}`)
  }

  /**
   * Send the signed-in user a fresh Email Verification link (#819).
   *
   * Only for Apps with their own screen: when the parent App requires Email
   * Verification, Onelo's hosted flow already shows "check your inbox" with a
   * resend button and hands the session back by itself. The previous link
   * stops working; at most 3 e-mails an hour (`verification_rate_limited`).
   * Throws `email_verification_off` when the App has Email verification Off.
   *
   * `redirectTo` — your own landing page (an allowed web origin) or
   * `<your-scheme>://…`; the link then carries `onelo_verify_token` for
   * `confirmEmail`. Omitted, the link opens Onelo's hosted page.
   */
  async resendVerificationEmail(options: { redirectTo?: string } = {}): Promise<ResendVerificationResult> {
    await this.initPromise
    const session = await this.getSession()
    if (!session) throw OneloError.notAuthenticated()
    return postResendVerification({
      apiUrl: this.apiUrl,
      publishableKey: this.publishableKey,
      post: httpPost,
      accessToken: session.accessToken,
      headers: await this._secHeaders(),
      redirectTo: options.redirectTo,
    })
  }

  /**
   * Confirm the user's address with the `onelo_verify_token` your own landing
   * page received from the verification link (#819). Single use. When a
   * session is signed in on this device, it is refreshed so `isAllowedIn()`
   * opens the app without waiting for the next scheduled refresh.
   */
  async confirmEmail(token: string): Promise<void> {
    await this.initPromise
    await postConfirmEmail({
      apiUrl: this.apiUrl,
      publishableKey: this.publishableKey,
      post: httpPost,
      token,
      headers: await this._secHeaders(),
    })
    // Refresh, not revalidateEntitlement: /api/sdk/auth/user caches its answer
    // per access token for 30 s, so a read right after confirming could still
    // say "not allowed". /refresh builds the access answer fresh and rotates
    // the token. Best-effort: the address IS confirmed; on failure the next
    // scheduled refresh or foreground revalidation carries the new answer.
    if (await this.getSession()) {
      try {
        await this.refreshSession()
      } catch (e) {
        console.warn('[onelo] confirmEmail: session refresh after confirming failed', e)
      }
    }
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

  /**
   * Complete a hosted-auth flow that finished OUTSIDE this app's own UI — a
   * magic link opened in the system browser is the reason this exists. Call it
   * from your app ROOT's own `Linking.addEventListener('url', …)` (in addition
   * to, not instead of, rendering `<AuthModal>` off `getModalState()`).
   *
   * `<AuthModal>`'s OWN `Linking` listener only runs while it is visible/mounted
   * (`auth-modal.tsx:298-308`, guarded `if (!visible …) return`) — a flow that
   * finishes while the modal happens to be unmounted (navigated away, or the
   * developer's own "Check your inbox" screen is shown via `sendMagicLink()`
   * instead of the hosted modal) had nowhere to land: the code/gate value was
   * silently dropped. React Native was the only Onelo SDK without a public,
   * modal-lifetime-independent entry point for this — Swift's
   * `handleAuthCallback`, Electron's `handleDeepLink`, Android's
   * `Onelo.handleRedirect` and Flutter's internal `app_links` listener all
   * already work regardless of whether their own presenting UI is on-screen.
   *
   * Two cases:
   *  - A `loadAuthView()` call is still pending (`_modalResolve` set): hand the
   *    outcome to the SAME parked resolver `<AuthModal>` would have used —
   *    `code`/`expired`/`error` settle it directly; a `gate` refusal (origin-
   *    checked against the flow's own hosted URL, exactly like `<AuthModal>`)
   *    re-presents the modal on the refusal surface instead of the sign-in page.
   *  - No flow is pending — the code came from a `sendMagicLink()` flow using a
   *    developer-built "Check your inbox" screen, not the hosted modal.
   *    Exchanges the code directly and returns the session.
   *
   * After a relaunch there is no pending flow, so the code is exchanged
   * directly with the hosted flow's verifier kept in the Keychain (#542). For
   * the URL that LAUNCHED the app, use `handleLaunchUrl`.
   *
   * Returns the session when this call itself completed the exchange (the
   * no-pending-flow case); `null` when the URL wasn't ours, or when a pending
   * `loadAuthView()` flow was handed the outcome and will resolve on its own.
   */
  async handleAuthCallback(url: string): Promise<OneloSession | null> {
    await this.initPromise
    const parsed = parseCallbackDeepLink(url, this._callbackScheme)
    if (!parsed || parsed.host !== 'callback') return null
    const { code, gate, error: errParam } = parsed.params

    if (this._modalResolve) {
      if (gate) {
        if (isOneloHostedSurface(gate, this._modalUrl)) {
          this._modalUrl = gate
          this._modalVisible = true
          this.notifyModalListeners()
        } else {
          this._modalResolve({ type: 'error', message: 'Refused a sign-in surface from an unknown origin' })
        }
      } else if (code) {
        this._modalResolve({ type: 'code', code })
      } else if (isExpiredAuthError(errParam)) {
        this._modalResolve({ type: 'expired' })
      } else if (errParam) {
        this._modalResolve({ type: 'error', message: errParam })
      }
      return null
    }

    if (code) return this.exchangeHostedCode(code)
    return null
  }

  /**
   * Complete a sign-in from the URL that launched the app, i.e.
   * `await Linking.getInitialURL()` (#542). A magic link opened on this device
   * after the app was killed arrives only there, never as a `'url'` event.
   * `OneloAuthGate` calls this on mount; a host app with its own root should
   * call it BEFORE `loadAuthView()`, because a new hosted flow replaces the
   * stored verifier the link needs.
   *
   * Handled once per instance, since `getInitialURL()` keeps returning the
   * same URL for the whole process. Same result as `handleAuthCallback`.
   */
  async handleLaunchUrl(url: string | null | undefined): Promise<OneloSession | null> {
    if (this._launchUrlHandled || !url) return null
    this._launchUrlHandled = true
    return this.handleAuthCallback(url)
  }
}
