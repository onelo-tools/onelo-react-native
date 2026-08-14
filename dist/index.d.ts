import { OneloConfig, OneloSession, OneloEntitlement } from '@onelo/core';
export { OneloConfig, OneloEntitlement, OneloError, OneloSession, OneloUser, REASON_LABELS, RESPONSE_REASON_CODES, ResponseReasonCode, UserRole } from '@onelo/core';
import React from 'react';

/**
 * OneloEventStream — ONE persistent SSE connection to
 * `GET /api/sdk/features/stream`, multiplexed for every module that needs
 * server-pushed events (auth `session.revoked`, `legal.consent_required`,
 * feature deploys, …). Mirrors the Swift `OneloEventStream`: a single
 * connection per app, a name→handlers registry, bounded-backoff reconnection,
 * and a refusal to downgrade a user-bound stream back to anonymous.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY XMLHttpRequest, NOT fetch/EventSource
 * ─────────────────────────────────────────────────────────────────────────
 * React Native has no `EventSource`, and its `fetch` does NOT expose
 * `response.body.getReader()` (no WHATWG `ReadableStream`) — so the
 * chunk-reader pattern used by the browser JS SDK (`onelo-js`) is impossible
 * here. Instead we drive an `XMLHttpRequest` and parse its INCREMENTALLY
 * growing `responseText`: on every `onprogress` / `readyState===LOADING`
 * callback RN hands us the bytes received so far, we parse only the delta
 * since the last offset, split on newlines, run the WHATWG `event:`/`data:`
 * accumulation, and dispatch on the blank line.
 *
 * This flushes PER TCP PACKET — the same guarantee Swift gets from its
 * `URLSessionDataDelegate.didReceive(data:)` loop. We deliberately do NOT
 * pull in `react-native-sse` or any line-buffering helper: those buffer until
 * an internal threshold and swallow small events (heartbeats, `session.revoked`
 * ~120 B) for tens of seconds — the exact trap the Swift/JS clients avoid.
 * Zero new dependencies.
 *
 * Unlike a browser `EventSource`, an RN `XMLHttpRequest` CAN set request
 * headers, so we apply `sdkHeaders()` (X-SDK-Version / X-Bundle-Id / …) to the
 * stream request just like Swift's `applySecurityHeaders`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * OWNERSHIP
 * ─────────────────────────────────────────────────────────────────────────
 * Lifecycle is owned by ONE module (auth — it knows sign-in/sign-out).
 * Other modules (features) are INJECTED the same instance and only `on()` +
 * `updateSinceVersion()`; they never `start()`/`stop()`. Only the owner
 * reconnects, so nothing races `session.revoked`.
 */
type SseHandler = (data: Record<string, unknown>) => void;
/** Optional overrides for {@link OneloEventStream.start}. Any omitted field keeps its current value. */
interface OneloEventStreamStartParams {
    /** Authenticated user id (camelCase on the wire). `null`/omitted = anonymous. */
    userId?: string | null;
    /** `since_version` cursor for the features snapshot. Omitted = keep current. */
    sinceVersion?: number;
    /** Host app version (`app_version`). Omitted = keep current. */
    appVersion?: string;
    /** Host-supplied HMAC of the user id for secure-mode features (camelCase `userIdHash`). */
    userIdHash?: string;
}
declare class OneloEventStream {
    private readonly apiUrl;
    private readonly publishableKey;
    private readonly sdkVersion?;
    private readonly bundleId?;
    private readonly handlers;
    private xhr;
    private started;
    /** epoch-ms the current XHR was opened; used to decide if a dropped connection
     *  was stable (alive long enough) before resetting the reconnect counter. */
    private connOpenedAt;
    private destroyed;
    private reconnectAttempts;
    private reconnectTimer;
    private userId;
    private userIdHash;
    private sinceVersion;
    private appVersion;
    /**
     * Explicit feature environment ('test' | 'live') forwarded as the
     * `environment` query param. Set once by OneloFeatures; constant for the
     * stream's lifetime, so it is intentionally NOT part of start()'s idempotency
     * comparison (parity with Swift's `featureEnvironment`).
     */
    featureEnvironment: string | undefined;
    /**
     * Epoch-ms timestamp of the last byte received from the server (named event
     * OR `:keepalive` comment). A liveness signal — a consumer can compare it to
     * `Date.now()` to detect a silently dead connection. `null` until first byte.
     */
    lastEventReceived: number | null;
    private offset;
    private currentEvent;
    private dataLines;
    /**
     * Monotonic connection generation. Bumped on every close/(re)connect so an
     * async connection-open that was awaiting `getInstanceId()`/`sdkHeaders()` can
     * detect it was superseded (or the stream stopped) and bail before opening a
     * now-orphaned socket.
     */
    private connGen;
    /**
     * @param apiUrl          Base API URL (no trailing slash), e.g. `https://st.backend.onelo.tools`.
     * @param publishableKey  `onelo_pk_...` — authenticates the stream via the `key` query param.
     * @param sdkVersion      SDK version string, forwarded as `sdk_version`.
     * @param bundleId        Host app bundle id, forwarded via `sdkHeaders()` as `X-Bundle-Id`.
     *
     * The `instance_id` query param + `X-Onelo-Instance-Id` header are sourced
     * internally from `getInstanceId()` (Keychain-backed, cached) — no wiring
     * needed from the caller.
     */
    constructor(apiUrl: string, publishableKey: string, sdkVersion?: string | undefined, bundleId?: string | undefined);
    /**
     * Register a handler for a named server event (`connected`, `features_updated`,
     * `session.revoked`, `legal.consent_required`, …). Multiple handlers per name
     * are supported; all fire. Survives reconnects. Register BEFORE `start()` (in a
     * module constructor) so no event is missed between connect and sign-in.
     */
    on(event: string, handler: SseHandler): void;
    /**
     * Open (or re-open) the connection.
     *
     * Idempotent: a repeat call with identical params while already connected is a
     * no-op (no needless reconnect). A changed userId / userIdHash / sinceVersion /
     * appVersion reconnects so per-user routing stays correct.
     *
     * Downgrade refusal: once bound to a non-null userId, a `start({userId: null})`
     * is IGNORED. An anonymous-mode reload (e.g. features bootstrap) must not evict
     * the auth-bound subscription — otherwise an in-flight `session.revoked` during
     * the reconnect window vanishes and the user stays logged in until the heartbeat
     * fallback (~13 min). Explicit teardown still works via `stop()`.
     */
    start(params?: OneloEventStreamStartParams): void;
    /**
     * Update the `since_version` cursor used on the NEXT reconnect. Does NOT force
     * a reconnect — the live connection keeps serving; if it drops, the reconnect
     * picks up the new value (parity with Swift `updateSinceVersion`).
     */
    updateSinceVersion(version: number): void;
    /**
     * Close the connection and cancel any pending reconnect. Intentional stop:
     * NO reconnect follows (the in-flight XHR's callbacks are detached first, so
     * its abort cannot re-arm the backoff). Handlers stay registered — `start()`
     * resumes delivery.
     */
    stop(): void;
    /**
     * Permanent teardown — detaches the connection and forbids restart. Use from
     * `Onelo.destroy()`. After `destroy()`, `start()` is a no-op.
     */
    destroy(): void;
    private _connect;
    private _openXhr;
    /**
     * Drain complete lines from the cumulative responseText, advancing `offset` to
     * the start of the trailing incomplete line so the next chunk continues cleanly.
     *
     * NOTE (memory): `responseText` grows for the life of ONE connection — RN gives
     * no way to truncate it. `:keepalive` comments are tiny, so growth is slow, and
     * every reconnect starts a fresh XHR with an empty responseText (offset reset).
     * A very long-lived, chatty connection is the only case that accumulates; the
     * backend's periodic connection recycling bounds it in practice.
     */
    private _consume;
    /** WHATWG SSE line parser (event/data accumulation; dispatch on blank line). */
    private _processLine;
    /** Decode the JSON payload and fan out to every handler registered for the event name. */
    private _dispatch;
    private _buildUrl;
    private _scheduleReconnect;
    private _clearReconnect;
    /**
     * Intentional close. Detaching `this.xhr` BEFORE `abort()` means the abort's
     * `onreadystatechange(DONE)` / `onerror` see `this.xhr !== xhr` and bail — so a
     * user-driven stop never re-arms the reconnect backoff.
     */
    private _closeXhr;
}

type ModalResult = {
    type: 'code';
    code: string;
} | {
    type: 'cancelled';
} | {
    type: 'error';
    message: string;
};
interface AuthModalProps {
    visible: boolean;
    hostedUrl: string;
    onResult: (result: ModalResult) => void;
    /** Backend base URL — pass `onelo.auth.baseUrl` to enable the `native_oauth`
     *  message-relay path (builds `{apiUrl}/api/sdk/auth/oauth/hosted-init?provider=…&token=…`
     *  via `buildHostedInitUrl`). Optional: OAuth still works without it via the
     *  navigation-diversion path. */
    apiUrl?: string;
    /** Branding "Page background" color (from `onelo.auth.pageBackgroundColor()`).
     *  Painted on the container + WebView + loading overlay so there is no white
     *  flash before the hosted page renders. Defaults to #111111. */
    backgroundColor?: string;
    /** Deep-link callback scheme (from `onelo.auth.callbackScheme`, config-driven,
     *  default 'onelorn'). Used to catch `<scheme>://callback?…` returns in the
     *  WebView + from the system browser. Must match the natively-registered scheme. */
    callbackScheme?: string;
    /** #26 part B — social-pill count for the loading skeleton (from
     *  `onelo.auth.oauthProviders`), so it matches what the hosted form renders. */
    socialCount?: number;
}
declare function AuthModal({ visible, hostedUrl, onResult, apiUrl, backgroundColor, callbackScheme, socialCount }: AuthModalProps): React.CElement<{
    visible: boolean;
    animationType: string;
    presentationStyle: string;
    onRequestClose: () => void;
}, React.Component<{
    visible: boolean;
    animationType: string;
    presentationStyle: string;
    onRequestClose: () => void;
}, any, any>>;

/**
 * The single next step the backend's centralised router (`/api/sdk/flow/init`)
 * tells the SDK to take. `authorized` = already signed in + entitled (show
 * content, no WebView). `present` = open `url` in the hosted WebView (sign-in,
 * and — once Round 2 store lands — store), which ends by postMessaging one final
 * code we exchange for a session. Mirrors Swift `FlowDecision` / JS `resolveFlow`.
 */
type FlowDecision = {
    action: 'authorized';
} | {
    action: 'present';
    surface: string;
    url: string;
    appName?: string;
    appLogo?: string;
};

declare class OneloAuth {
    private storage;
    private apiUrl;
    private publishableKey;
    private bundleId?;
    /** Deep-link callback scheme (config.callbackScheme, default 'onelorn'). Sent to
     *  the backend on initiate/flow-init and used by AuthModal to catch the return. */
    private readonly _callbackScheme;
    private pkceVerifier;
    private resolvedConfig;
    private heartbeatTimer;
    private refreshTimer;
    private static readonly HEARTBEAT_MS;
    /** Refresh this many seconds before the access token expires. */
    private static readonly REFRESH_LEAD_SECONDS;
    private signOutEpoch;
    /** In-flight refresh promise — single-flight dedupe so concurrent getSession()
     *  callers share ONE POST /auth/refresh. Two concurrent refreshes would POST the
     *  SAME rotating refresh_token → the backend's reuse-detection revokes the whole
     *  family → a routine foreground silently logs the user out. */
    private _refreshInFlight;
    private initPromise;
    private authStateListeners;
    private modalStateListeners;
    private _modalVisible;
    private _modalUrl;
    private _modalResolve;
    isReady: boolean;
    isRevoked: boolean;
    /** #29 — non-null when `initialize()` threw (e.g. the `react-native-get-random-values`
     *  polyfill is missing, so `generateCodeVerifier()` throws). Previously that error
     *  was swallowed silently, leaving `isReady=false` forever with NO trace. Surfaced
     *  here (and logged) so the failure is diagnosable instead of a mystery. */
    initError: string | null;
    /** True once the CURRENT user's session was revoked server-side (a
     *  `session.revoked` SSE push, or — future — a heartbeat 401 / refresh
     *  user_revoked). Distinct from `isRevoked` (the whole app key was revoked).
     *  Parity with Swift/JS `isUserRevoked`. */
    isUserRevoked: boolean;
    allowCustomBranding: boolean;
    appName: string;
    appLogoUrl: string | null;
    /** True when the backend requires device attestation for this app (at least
     *  one registered bundle id has `attest_enabled=true`) — App Attest on iOS,
     *  Play Integrity on Android. Read from `/api/sdk/config` (`attest_required`);
     *  the composition root (`Onelo`) uses it to decide whether to kick off
     *  attestation. Parity with Swift `OneloAuth.attestRequired`. */
    attestRequired: boolean;
    /** Android Play Integrity: the developer's Google Cloud project NUMBER
     *  (`/api/sdk/config`'s `cloud_project_number`), sourced from the Play
     *  Integrity credential uploaded in the Onelo dashboard. Required by the
     *  Standard Integrity API's `setCloudProjectNumber`; `null` when unconfigured
     *  (the composition root then skips Play Integrity). Ignored on iOS. */
    cloudProjectNumber: number | null;
    /** Injected by the composition root (`Onelo`): resolves when background App
     *  Attest has produced its token (or settled). Gated entry points await it so
     *  a cold-start request doesn't race ahead of the token → spurious 403 (#25).
     *  Undefined when the SDK is used without the root (e.g. auth-only tests). */
    private readonly _attestReady?;
    constructor(config: OneloConfig, attestReady?: () => Promise<void>);
    /** Deep-link callback scheme this app returns through (config.callbackScheme,
     *  default 'onelorn'). Register it natively (Android intent-filter + iOS
     *  CFBundleURLSchemes); AuthModal/StoreModal/PortalModal catch `<scheme>://…`. */
    get callbackScheme(): string;
    /**
     * Common security headers for every auth request — `X-SDK-Version`,
     * `X-Bundle-Id`, `X-Onelo-Instance-Id`, `X-Onelo-Sdk-Platform` (via
     * `sdkHeaders`) plus per-request extras (`Authorization` / `X-Publishable-Key`).
     * Threading the bundle id is what lets a LIVE React Native app pass the
     * backend's `validate_sdk_request_security` gate (which enforces `X-Bundle-Id`
     * for native app types once a bundle is registered) — without it, `flow/init`
     * and `initiate` are rejected and sign-in throws.
     */
    private _secHeaders;
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
    private _awaitAttestReady;
    private initialize;
    whenReady(): Promise<void>;
    loadAuthView(): Promise<OneloSession | null>;
    /**
     * Exchange a hosted-flow one-time code (sign-in OR store checkout) for a
     * session and persist it, leaving the user signed in and firing
     * onAuthStateChange. Shared by `loadAuthView` and the store flow (OneloStore)
     * so the exchange lives in exactly one place. `POST /api/sdk/auth/hosted-callback`
     * body `{publishableKey, code, code_verifier}` (PKCE snake even in a camel body).
     */
    exchangeHostedCode(code: string): Promise<OneloSession>;
    /** Returns modal state for rendering — use with <AuthModal> component */
    getModalState(): {
        visible: boolean;
        url: string;
        onResult: ((result: ModalResult) => void) | null;
    };
    /** Subscribe to modal state changes. Returns an unsubscribe function. */
    onModalStateChange(callback: () => void): () => void;
    private getHostedUrl;
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
    resolveFlow(lang?: string): Promise<FlowDecision>;
    /** Raw `/flow/init` request — returns status + body so `loadAuthView` can tell
     *  "endpoint unavailable" (404/405 → legacy fallback) apart from a real error
     *  (surfaced by `_decisionFromFlow`). */
    private _flowInit;
    /** Map a `/flow/init` response to a FlowDecision, throwing on any non-200. */
    private _decisionFromFlow;
    signIn(email: string, password: string): Promise<OneloSession>;
    signUp(email: string, password: string): Promise<OneloSession>;
    signOut(): Promise<void>;
    /**
     * Wire the shared event stream (called once by Onelo, BEFORE the stream is
     * started). Registers a `session.revoked` listener so a server-side revoke
     * (refund lapse, admin force-logout, account deletion, ban) signs the user out
     * in ~sub-second — the real-time complement to the ≤13-min heartbeat fallback.
     * Registered once and survives sign-in/sign-out cycles, exactly like Swift's
     * `_handleSessionRevoked` wiring. Does NOT start the stream — Onelo owns the
     * connection lifecycle.
     */
    attachEventStream(stream: OneloEventStream): void;
    /**
     * Handle a `session.revoked` push. One app can multiplex multiple buyers on the
     * shared connection, so filter to the current user: a `app_user_id` that
     * targets a DIFFERENT user is ignored; a missing `app_user_id` is treated as
     * "current user" (forward-compat — the backend may omit it for account-wide
     * revokes). No active session → nothing to revoke. Teardown mirrors `signOut()`
     * exactly (and bumps `signOutEpoch` first) so an in-flight refresh/entitlement
     * revalidation can't resurrect the just-cleared session.
     */
    private _handleSessionRevoked;
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
    hasStoredSession(): Promise<boolean>;
    getSession(): Promise<OneloSession | null>;
    refreshSession(): Promise<OneloSession | null>;
    private _doRefresh;
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
    restoreSession(): Promise<OneloSession | null>;
    /**
     * Best-effort backend session check (`GET /api/sdk/auth/verify`, sdk_auth.py:2911)
     * — catches an account revoked/deleted/suspended while the app was OFFLINE, which
     * the SSE push can't deliver. 403 with a revoke reason → clear + `isUserRevoked`;
     * any other status / network failure fails OPEN (keep the cached session). Epoch-
     * guarded so a concurrent sign-out isn't clobbered.
     */
    private _verifySession;
    /**
     * True when the current session's user has an active paid entitlement.
     * Snapshot read of the persisted session (no network) — mirrors Swift's
     * `hasActiveAccess`. Returns false when there is no session.
     */
    hasActiveAccess(): Promise<boolean>;
    /**
     * Re-fetch the user's entitlement from the backend and, if it changed, rebuild
     * + persist + republish the session so `hasActiveAccess()` and auth-state
     * listeners see the new value. Call after an external checkout or on app
     * resume. Best-effort: returns the currently-cached entitlement on any
     * non-200/network failure and never throws (mirrors Swift/JS
     * `revalidateEntitlement`). Epoch-guarded: a sign-out that races this request
     * cancels the write-back so a stale entitlement can't resurrect the session.
     */
    revalidateEntitlement(): Promise<OneloEntitlement>;
    /** True when the app has the paywall enabled (from `/api/sdk/config`). Gate
     *  callers use this so non-paywall apps enter on a session alone (their
     *  `entitlement` is always `'none'`). Mirrors Electron `isPaywallEnabled`. */
    isPaywallEnabled(): boolean;
    /** Branding "Page background" color (`checkout_bg_color`, --onelo-page-bg) from
     *  `/api/sdk/config`. Native modals paint their WebView + container with this so
     *  there is no white flash before the hosted page's own background renders.
     *  Defaults to #111111 (the hosted-page default) before config resolves. */
    pageBackgroundColor(): string;
    /** Plan-gated enabled OAuth providers (google/github/apple) from
     *  `/api/sdk/config`; empty when social is disabled. Consumed by the Round 2
     *  OAuth entry point. */
    get oauthProviders(): string[];
    /** Backend base URL. `AuthModal` uses it to build the OAuth system-browser
     *  hand-off URL (`{baseUrl}/api/sdk/auth/oauth/hosted-init?provider=…&token=…`)
     *  when the hosted page relays a `native_oauth{provider,token}` message. Optional for
     *  the primary OAuth path (a hosted-page `window.location.href` navigation to
     *  the full provider/oauth-init URL is diverted to the system browser without
     *  it) — thread it only to enable the message-relay path. */
    get baseUrl(): string;
    onAuthStateChange(callback: (session: OneloSession | null) => void): () => void;
    private startHeartbeat;
    private stopHeartbeat;
    /**
     * Schedule a background refresh of the access token to fire `REFRESH_LEAD_SECONDS`
     * before it expires. Idempotent — cancels any pending refresh first. Without this,
     * an idle app would carry a stale token past its TTL and the next request would 401.
     */
    private scheduleRefresh;
    private clearRefreshTimer;
    private saveSession;
    private notifyListeners;
    private notifyModalListeners;
    sendMagicLink(email: string): Promise<void>;
    sendPasswordReset(email: string): Promise<void>;
}

type FeatureStatus = 'enabled' | 'disabled' | 'greyed' | 'hidden' | 'upsell' | 'new' | 'beta' | 'coming_soon';
/** Why a feature is in its current state. Forward-compatible: an unrecognized
 * reason from a newer backend normalizes to 'unknown' (mirrors Swift, where a
 * present-but-unknown reason once dropped the whole feature). */
type FeatureReason = 'user_override' | 'plan' | 'default' | 'static' | 'paywall_no_plan' | 'paywall_off' | 'suspended' | 'unknown';
/** Upgrade affordance derived from reason + requiredPlan; null when the feature
 * is available or not plan-gated. */
interface UpgradeHint {
    requiredPlan: string;
    currentStatus: FeatureStatus;
}
declare class FeatureState {
    readonly name: string;
    readonly status: FeatureStatus;
    /** Why the feature is in this state (plan-gated, user override, …). */
    readonly reason?: FeatureReason;
    /** Machine key of the plan that unlocks this feature — render the label. */
    readonly requiredPlan?: string;
    /** Human display name of `requiredPlan` — render this, not the raw key. */
    readonly requiredPlanLabel?: string;
    /** The developer enabled "tap to upgrade" for this feature. */
    readonly upgradeCta: boolean;
    constructor(name: string, status: FeatureStatus, reason?: FeatureReason, requiredPlan?: string, requiredPlanLabel?: string, upgradeCta?: boolean);
    get isEnabled(): boolean;
    get isDisabled(): boolean;
    get isVisible(): boolean;
    get isGreyed(): boolean;
    get isUpsell(): boolean;
    get isNew(): boolean;
    get isBeta(): boolean;
    get isComingSoon(): boolean;
    /** Promo/lock badge (parity with Swift): New/Beta/Coming Soon, 🔒 for greyed
     *  (locked — never hide it), and "Available in <plan>" for upsell. */
    get badgeLabel(): string | null;
    /** Non-null when the feature is plan-blocked AND the backend named the
     *  unlocking plan — surface in upgrade-prompt UI. */
    get upgradeHint(): UpgradeHint | null;
}
/** Error thrown by {@link OneloFeatures.moduleToken}. `code` mirrors the Swift
 *  `OneloFeaturesError` cases and the JS SDK's `OneloFeaturesError` so
 *  cross-platform handling/docs line up 1:1. RN core's `OneloError` has no
 *  feature-specific codes (not_entitled / secure_mode_required / …), so — like
 *  the JS SDK — we define a module-scoped error class rather than overloading
 *  the shared `OneloError` with codes only Features uses. */
type OneloFeaturesErrorCode = 'not_authenticated' | 'not_entitled' | 'secure_mode_required' | 'invalid_user_hash' | 'network_error';
declare class OneloFeaturesError extends Error {
    readonly code: OneloFeaturesErrorCode;
    constructor(code: OneloFeaturesErrorCode, message?: string);
}
interface OneloFeaturesOptions {
    /** Suppress the anonymous-mode identify() warning. See OneloConfig.suppressIdentifyWarning. */
    suppressIdentifyWarning?: boolean;
    /** Explicit feature environment ('test'|'live'), forwarded on resolve/batch-ping/poll. See OneloConfig.featureEnvironment. */
    featureEnvironment?: string;
    /** Status returned by feature() for a slug not (yet) in the snapshot. Fail-closed
     *  'hidden' by default; 'enabled' in dev previews new gates. 1:1 with Swift
     *  `featureDefaultStatus`. See OneloConfig.featureDefaultStatus. */
    featureDefaultStatus?: FeatureStatus;
}
/** Minimal monitor surface OneloFeatures depends on. `recordFlag` is optional —
 *  present once Monitor gains flag↔error correlation (parity task 3.2); called
 *  defensively so this module works against a monitor that doesn't yet have it. */
interface FeaturesMonitor {
    _trackFeatureCall: (name: string) => void;
    recordFlag?: (key: string, value: string) => void;
}
declare class OneloFeatures {
    private readonly apiUrl;
    private readonly publishableKey;
    private readonly bundleId?;
    private readonly featureEnvironment?;
    private cache;
    private readonly changeListeners;
    private discoveredNames;
    private configVersion;
    private pollTimer;
    private pingDebounce;
    private monitor;
    private suppressIdentifyWarning;
    private anonymousWarningLogged;
    private readonly defaultStatus;
    private currentUserId;
    private currentUserIdHash;
    private stream;
    private firstEventReceived;
    private readonly readyWaiters;
    private lastRefreshAt;
    constructor(apiUrl: string, publishableKey: string, monitor?: FeaturesMonitor | null, bundleId?: string, options?: OneloFeaturesOptions);
    /**
     * Wire the shared multiplexed SSE stream (called once by Onelo). Registers the
     * four feature-side handlers; handlers survive reconnects and receive the
     * already-parsed event `data`. Does NOT start the stream — auth owns its
     * lifecycle (parity with Swift `ownsEventStream = false`).
     */
    attachEventStream(stream: OneloEventStream): void;
    /** Declare feature names upfront — triggers a batch-ping immediately. */
    declare(names: string[]): void;
    /** Returns the current state for a feature. Auto-registers on first call. */
    feature(name: string): FeatureState;
    /** Convenience: `true` when the feature resolves to an active status
     *  (enabled / new / beta). Equivalent to `feature(name).isEnabled`. */
    isEnabled(name: string): boolean;
    /**
     * Subscribe to feature-cache changes so the UI can re-render the instant a fresh
     * snapshot lands — an admin's Deploy (SSE), a foreground/identity resync, or
     * `invalidateCache()`. The callback fires AFTER the in-memory cache is updated;
     * re-read `feature(name)` inside it. Purely local: NO network request, NO DB, NO
     * extra SSE connection — it reuses the single shared stream you already have.
     * Returns an unsubscribe function; call it on unmount. Powers the reactive
     * `useFeature` hook shown in the SDK snippet.
     */
    subscribe(listener: () => void): () => void;
    /** Notify subscribers after a cache mutation. A throwing listener never breaks
     *  cache application (parity with the modal-state / monitor listener guards). */
    private _emitChange;
    /**
     * Load features for a user (or anonymous). Called by the Onelo orchestrator on
     * construction, identity change, and app-foreground. Restores the disk cache
     * for instant UI, sends a (sampled) batch-ping, then either relies on the
     * shared SSE stream (signed-in) or falls back to a one-shot REST resolve + 60s
     * poll (anonymous / standalone).
     */
    load(userId: string | null, userIdHash?: string | null): Promise<void>;
    /** Returns names of all features with an active status (enabled, new, or beta). */
    getActiveFeatures(): string[];
    /**
     * Resolves once the first live snapshot has been applied (SSE `connected` /
     * `up_to_date`, or a REST resolve), or after `timeoutMs` — whichever first.
     * Never rejects. Lets a host await a settled state before first paint to avoid
     * a cache→SSE flicker. Parity with Swift `ready(timeout:)`. Multiple callers
     * resolve together on the first event (or each on its own timeout).
     */
    ready(timeoutMs?: number): Promise<void>;
    /**
     * Force-reconcile the snapshot from the server via REST (does NOT touch the SSE
     * stream). Debounced to one call/sec unless `force` (use force from a
     * user-initiated "Refresh" action). Never throws — a network error leaves the
     * cached state intact and SSE catches up later. Parity with Swift
     * `refresh(force:)`.
     */
    refresh(force?: boolean): Promise<void>;
    /**
     * Requests a short-lived (60s) per-feature JWT from
     * `POST /api/sdk/features/module-token` — proof the current user is entitled to
     * `slug`, which the host forwards to its OWN backend/CDN to gate code download.
     * The backend re-verifies entitlement on every request. Parity with Swift
     * `moduleToken(for:)`.
     *
     * Throws {@link OneloFeaturesError}:
     * - `not_authenticated` — no user identified yet (NO network call is made)
     * - `not_entitled` (403) — the user lacks access to `slug`
     * - `secure_mode_required` (401) — app requires `userIdHash`, none supplied
     * - `invalid_user_hash` (401) — supplied `userIdHash` failed backend HMAC
     * - `network_error` — transport failure or malformed response
     *
     * @param slug        Feature/module slug to mint a token for.
     * @param userIdHash  Optional secure-mode HMAC; overrides the one from load().
     */
    moduleToken(slug: string, userIdHash?: string): Promise<string>;
    /** Stop the fallback poll + pending batch-ping. The shared SSE stream is owned
     *  and torn down by Onelo (Onelo.destroy → stream.destroy), NOT here — closing
     *  it from features would also drop auth's session.revoked subscription. */
    stopPolling(): void;
    /** Clears the local feature cache and resets the config version. The next
     *  resolve / SSE snapshot re-fills it. */
    invalidateCache(): void;
    /** Signals all pending ready() callers that the first snapshot arrived.
     *  Idempotent (parity with Swift `_signalFirstEvent`). */
    private _signalFirstEvent;
    private _scheduleBatchPing;
    /**
     * Decide whether to send a batch-ping on LOAD (parity with Swift
     * `_shouldBatchPingOnLoad`). Test env ALWAYS pings (reliable discovery of new
     * slugs); live env samples at 1% to avoid fleet-scale write amplification —
     * on live, batch-ping only bumps `last_seen_at` (registration is test-env only
     * server-side), so 1/100 is ample staleness resolution.
     *
     * "test" = explicit featureEnvironment OR a `_test_` key prefix — the latter
     * mirrors the backend's effective-env key-prefix fallback, so a test-keyed app
     * WITHOUT the env var still discovers.
     */
    private _shouldBatchPingOnLoad;
    private _batchPing;
    private _resolve;
    /**
     * Logs a one-time warning when the backend reports anonymous mode (no userId)
     * AND at least one targeted feature was hidden purely because of it. Helps
     * developers using their own auth system catch missing identify() calls.
     */
    private _maybeWarnAnonymous;
    private _poll;
    private _startPolling;
    private _stopPollTimer;
    private _applySnapshot;
    private _cacheKey;
    /** v2 disk shape (snake_case, mirrors Swift) — persists the FULL entry so a
     *  cold-start `up_to_date` still renders upgrade badges. */
    private _snapshotForDisk;
    private _loadCache;
}

interface MonitorEventOptions {
    ok: boolean;
    durationMs?: number;
    error?: string;
    meta?: Record<string, unknown>;
}
/**
 * The React Native Monitor SDK — captures errors, performance, breadcrumbs, and
 * feature-flag context and forwards them to the Onelo backend.
 *
 * All event data passes through `MonitorScrubber` BEFORE it leaves the device —
 * secrets in error strings and meta are redacted. Flush is always best-effort:
 * a failed send is dropped, never thrown (monitoring must never break the app).
 */
declare class OneloMonitor {
    private readonly publishableKey;
    private readonly apiUrl;
    private readonly bundleId?;
    private buffer;
    private readonly summaryBuffer;
    private readonly flags;
    private readonly breadcrumbs;
    private flushTimer;
    private currentUserId;
    /** Serialises all drains so a timer flush and an error flush can't overlap. */
    private flushChain;
    /** Epoch ms until which we hold off sending (set from a 429 `Retry-After`). */
    private retryAfterUntil;
    /** Set by destroy(); stops any further sends after teardown. */
    private _destroyed;
    /** Pre-built static meta merged into every event (sdk + app). Computed once. */
    private readonly staticMeta;
    private readonly environment?;
    private readonly sessionId;
    /** True only on the instance that actually installed the global ErrorUtils
     *  handler — gates handler restoration in `destroy()`. */
    private _registeredGlobalHandler;
    /**
     * Append a breadcrumb — a step in the trail leading to an error. Snapshotted
     * into `meta.breadcrumbs` on the next error capture. Ring-buffered (cap 100).
     * The message is scrubbed of secrets on the way in. Parity with Swift.
     * Convenience: `breadcrumb.info(msg)` and `breadcrumb.navigationTo(view)`.
     */
    readonly breadcrumb: {
        (message: string, opts?: {
            category?: string;
            data?: Record<string, string>;
        }): void;
        info: (message: string, data?: Record<string, string>) => void;
        navigationTo: (view: string) => void;
    };
    constructor(publishableKey: string, apiUrl: string, bundleId?: string, appVersion?: string, appBuild?: string, environment?: string);
    /** Sets the current user ID attached to all subsequent monitor events. Call after login/logout if not using Onelo Auth. */
    setUserId(userId: string | null): void;
    /**
     * Internal hook — used by `OneloFeatures` on the first lookup of each name.
     * High-volume path: aggregated into a per-feature counter and emitted as one
     * `feature_call_summary` event at flush (parity with Swift).
     */
    _trackFeatureCall(featureName: string): void;
    /**
     * Record the current value of a feature flag for flag↔error correlation.
     * Intended to be wired from `OneloFeatures` on every evaluation. LRU:
     * re-recording a key moves it to most-recent; capped at MAX_FLAGS. Not an
     * event — just updates the snapshot attached to future error captures.
     */
    recordFlag(key: string, value: string): void;
    track<T>(featureName: string, fn: () => Promise<T> | T, options?: {
        meta?: Record<string, unknown>;
    }): Promise<T>;
    event(featureName: string, opts: MonitorEventOptions): void;
    /**
     * Manually capture an error/exception with its stack + the active breadcrumbs
     * and feature flags (parity with Swift's `capture`). Use for caught errors you
     * still want reported. Never throws.
     */
    capture(error: unknown, opts?: {
        featureName?: string;
        meta?: Record<string, unknown>;
    }): void;
    /**
     * Drains are SERIALISED through one promise chain: the 15s timer, an error
     * auto-flush and an explicit `flush()` must never drain concurrently, because
     * two overlapping drains would interleave batches (and the second would see an
     * empty buffer and report "sent").
     */
    flush(): Promise<void>;
    private _drain;
    /** One POST. Never throws — classifies the result instead. */
    private _sendOnce;
    /**
     * Put an undelivered batch back at the FRONT of the buffer so the next flush
     * retries it, then re-apply the cap.
     *
     * Priority policy under a sustained outage: NEWEST EVENTS WIN. The buffer is
     * trimmed from the front, so the oldest re-queued events go first. This matches
     * `_push`'s newest-wins eviction, keeps memory bounded at MAX_BUFFER_SIZE no
     * matter how long the device is offline, and stops a wedged batch from starving
     * live telemetry. Drops are reported, never silent.
     */
    private _requeue;
    destroy(): void;
    private _addBreadcrumb;
    /** Fold stack/errorType into a caller's meta without mutating it. */
    private _withError;
    /**
     * Returns a NEW meta object with always-on context merged in (parity with
     * Swift's enrichMeta): `sdk` + `app` (authoritative, override caller keys),
     * `environment` (only when the caller didn't set it per-event), and a light
     * `device` block. On error/crash the device block carries heavier fields.
     * Never mutates the caller's meta.
     */
    private _enrich;
    /** Trim error meta to the ~16KB soft cap: drop oldest breadcrumbs, then flags. Best-effort, never throws. */
    private _capMeta;
    private _push;
    private _registerGlobalHandlers;
    /**
     * Restore the ErrorUtils handler that was installed before this monitor
     * registered, and reset the module registration state so a freshly-constructed
     * monitor re-registers (rather than being stuck behind a `true` flag pointing
     * at a torn-down instance). Only the instance that actually installed the
     * handler acts; only restores if OUR handler is still the current one (never
     * clobber a handler someone installed on top of ours). Never throws.
     */
    private _unregisterGlobalHandlers;
}

interface FeedbackOptions {
    type?: 'bug' | 'feature_request' | 'general';
    area?: string;
    userId?: string;
}
declare class OneloFeedback {
    private readonly apiUrl;
    private readonly publishableKey;
    private readonly getActiveFeatures;
    private readonly bundleId?;
    private readonly pageBackgroundColor;
    private _url;
    private _visible;
    private _listeners;
    constructor(apiUrl: string, publishableKey: string, getActiveFeatures: () => string[], bundleId?: string | undefined, pageBackgroundColor?: () => string);
    open(options?: FeedbackOptions): void;
    close(): void;
    private _fetchAndLoad;
    private _notify;
    subscribe(listener: (url: string | null, visible: boolean) => void): () => void;
    getCurrentUrl(): string | null;
    isVisible(): boolean;
    /** Branding page background (--onelo-page-bg) so the feedback WebView never
     *  flashes white before the hosted feedback page paints. */
    getPageBackgroundColor(): string;
}

declare class OneloForms {
    private readonly apiUrl;
    private readonly publishableKey;
    private readonly bundleId?;
    constructor(apiUrl: string, publishableKey: string, bundleId?: string | undefined);
    submit(formSlug: string, data: Record<string, unknown>, submitterEmail?: string): Promise<{
        success: boolean;
        message?: string;
    }>;
}

declare class OneloWaitlist {
    private readonly apiUrl;
    private readonly publishableKey;
    private readonly bundleId?;
    constructor(apiUrl: string, publishableKey: string, bundleId?: string | undefined);
    join(slug: string | undefined, email: string): Promise<{
        success: boolean;
        position?: number;
        alreadyJoined: boolean;
        message?: string;
    }>;
}

type PortalResult = {
    type: 'done';
    event?: string;
} | {
    type: 'cancelled';
};
interface PortalModalViewProps {
    visible: boolean;
    hostedUrl: string;
    callbackScheme: string;
    /** Backend base URL — enables the `native_oauth{provider,token}` message-relay
     *  hand-off (builds `{apiUrl}/api/sdk/auth/oauth/hosted-init?…`). Optional:
     *  OAuth still works via the navigation-diversion path without it. */
    apiUrl?: string;
    /** Branding page background so the portal WebView never flashes white. */
    backgroundColor?: string;
    onResult: (result: PortalResult) => void;
}
/**
 * Reactive hook for rendering the portal modal manually via <CustomerPortalModalView>.
 * Re-renders automatically when customerPortal.open() opens or closes the modal.
 */
declare function usePortalModalState(portal: OneloCustomerPortal): PortalModalState;
interface CustomerPortalModalProps {
    onelo: {
        customerPortal: OneloCustomerPortal;
    };
}
/**
 * Connected customer portal modal — mount once near the root of your app:
 *
 *   <CustomerPortalModal onelo={onelo} />
 *
 * It subscribes to onelo.customerPortal state, shows the hosted portal WebView
 * when customerPortal.open() is called, and resolves open()'s promise when the
 * user finishes or cancels.
 */
declare function CustomerPortalModal({ onelo }: CustomerPortalModalProps): React.FunctionComponentElement<PortalModalViewProps> | null;
/**
 * Presentational portal modal (advanced use) — render it yourself with state
 * from usePortalModalState() if you need custom mounting behaviour.
 */
declare function CustomerPortalModalView({ visible, hostedUrl, callbackScheme, apiUrl, onResult, backgroundColor }: PortalModalViewProps): React.CElement<{
    visible: boolean;
    animationType: string;
    presentationStyle: string;
    onRequestClose: () => void;
}, React.Component<{
    visible: boolean;
    animationType: string;
    presentationStyle: string;
    onRequestClose: () => void;
}, any, any>>;

type PortalModalState = {
    visible: boolean;
    hostedUrl: string;
    callbackScheme: string;
    /** Backend base URL — threaded into the modal so it can build the `native_oauth`
     *  system-browser hand-off URL (`{apiUrl}/api/sdk/auth/oauth/hosted-init?…`). */
    apiUrl: string;
    /** Branding page background (--onelo-page-bg) so the portal WebView never
     *  flashes white before the hosted portal page paints. */
    backgroundColor: string;
    onResult: ((result: PortalResult) => void) | null;
};
declare class OneloCustomerPortal {
    private apiUrl;
    private publishableKey;
    private bundleId?;
    private getAccessToken;
    private signOut;
    private onRevoked?;
    private pageBg;
    private readonly callbackScheme;
    private _modalVisible;
    private _modalUrl;
    private _modalResolve;
    private portalStateListeners;
    /**
     * @param bundleId Threaded into `sdkHeaders` so portal-initiate sends
     *   `X-Bundle-Id`. A LIVE native app with a registered bundle is 403'd by the
     *   backend's `validate_sdk_request_security` without it.
     * @param onRevoked Injected by `Onelo` — invoked (in addition to `signOut`)
     *   when the portal returns a session-invalidating event (account deletion,
     *   account revoked, session compromised) so `auth.isUserRevoked` is set.
     *   Parity with Swift `portalRevokeEvents` + guard #9.
     */
    constructor(apiUrl: string, publishableKey: string, bundleId: string | undefined, getAccessToken: () => Promise<string | null>, signOut: () => Promise<void>, onRevoked?: () => void, pageBackgroundColor?: () => string, callbackScheme?: string);
    /** Open the hosted customer portal in a fullscreen WebView modal. */
    open(): Promise<void>;
    /** Returns current modal state for rendering <CustomerPortalModal>. */
    getModalState(): PortalModalState;
    /** Subscribe to portal modal state changes. Returns an unsubscribe function. */
    onPortalStateChange(callback: () => void): () => void;
    private notifyPortalListeners;
}

/** Result relayed from the hosted gate page: the user's action. Only `accept`
 *  records consent; anything else (e.g. `decline`) signs the user out. */
type ConsentResult = {
    action: string;
};
type ParsedConsentMessage = {
    action: string;
} | null;
/** Parse a WebView message into a consent action. Accepts the shape the hosted
 *  gate posts: `{type:'onelo:consent', action:'accept'|'decline'|...}`. */
declare function parseConsentMessage(data: string): ParsedConsentMessage;
interface ConsentGateModalViewProps {
    visible: boolean;
    hostedUrl: string;
    onResult: (result: ConsentResult) => void;
    /** Branding page background — painted on the container + WebView + overlay so
     *  the gate never flashes white before the hosted legal page renders. */
    backgroundColor?: string;
}
/**
 * Reactive hook for rendering the consent gate modal manually via
 * <ConsentGateModalView>. Re-renders when presentGateIfNeeded() opens or closes
 * the gate.
 */
declare function useConsentModalState(consent: OneloConsent): ConsentModalState;
interface ConsentGateModalProps {
    onelo: {
        consent: OneloConsent;
    };
}
/**
 * Connected consent gate modal — mount once near the root of your app:
 *
 *   <ConsentGateModal onelo={onelo} />
 *
 * It subscribes to onelo.consent state and shows the hosted, non-dismissible
 * gate WebView whenever a blocking legal document is outstanding. Accept records
 * consent (and re-checks — documents stack); decline signs the user out.
 */
declare function ConsentGateModal({ onelo }: ConsentGateModalProps): React.FunctionComponentElement<ConsentGateModalViewProps> | null;
/**
 * Presentational gate modal (advanced use) — render it yourself with state from
 * useConsentModalState() if you need custom mounting behaviour.
 *
 * Hard block: there is NO cancel/close button, and the Android hardware back
 * button is swallowed while the gate is visible. The only exits are Accept
 * (→ record consent) or Decline (→ sign out), both relayed from the hosted page.
 */
declare function ConsentGateModalView({ visible, hostedUrl, onResult, backgroundColor }: ConsentGateModalViewProps): React.CElement<{
    visible: boolean;
    animationType: string;
    presentationStyle: string;
}, React.Component<{
    visible: boolean;
    animationType: string;
    presentationStyle: string;
}, any, any>>;

/**
 * Legal-consent enforcement level. `block` gates the app until accepted;
 * `notify` is informational. Unknown future values decode to `unknown`
 * (forward-compat — never throws), mirroring Swift/Electron.
 */
type OneloConsentEnforcement = 'block' | 'notify' | 'unknown';
/**
 * One legal document the signed-in user has not yet accepted. Wire keys are
 * snake_case (see `_mapRequirement`); this is the camelCase SDK shape.
 */
interface OneloConsentRequirement {
    /** Document type: "terms" | "privacy" | "dpa" | "cookies" (open set). */
    docType: string;
    /** The version id to POST back on accept (`document_version_id`). */
    versionId: string;
    /** Human version label, e.g. "2026-06-01-v2". */
    version: string;
    /** `block` | `notify` | `unknown`. */
    enforcement: OneloConsentEnforcement;
    /** True iff this document HARD-blocks the app right now (server-computed:
     *  enforcement=block AND effective_at<=now). The single gate signal. */
    blocking: boolean;
    /** Read-only document URL (may be null for platform-scope docs). */
    url: string | null;
    /** Gate-mode URL (document + accept/decline buttons); loaded in the gate
     *  modal. Null for platform-scope docs. */
    consentUrl: string | null;
}
/** Modal state consumed by <ConsentGateModal> / useConsentModalState. */
type ConsentModalState = {
    visible: boolean;
    hostedUrl: string;
    onResult: ((result: ConsentResult) => void) | null;
    /** Branding page background (--onelo-page-bg) so the gate WebView never flashes
     *  white before the hosted legal page paints. */
    backgroundColor: string;
};
/**
 * Legal-consent gate for signed-in users — the React Native port of Swift's
 * `OneloAuth.requiredConsents()`/`acceptConsent()` + Electron's `OneloConsent`.
 *
 * At sign-in, consent is enforced server-side inside the hosted sign-in page.
 * This class covers the OTHER moment: a user who is ALREADY signed in when you
 * publish a new blocking legal version (Terms update). The gate is triggered
 * (a) on sign-in via the auth-state bridge in onelo.ts, (b) in real time over the
 * shared SSE stream (`legal.consent_required`, see attachEventStream), and
 * (c) whenever the app calls `presentGateIfNeeded()` (e.g. on foreground). If a
 * blocking document is outstanding it presents the hosted gate
 * in a fullscreen, non-dismissible WebView modal. Accept records consent (and
 * re-checks, since documents stack); decline signs the user out. Fail-open on
 * network errors — the gate surfaces real blocking updates, not network blips.
 *
 * Rendering: mount <ConsentGateModal onelo={onelo} /> once near the app root.
 */
declare class OneloConsent {
    private readonly apiUrl;
    private readonly publishableKey;
    private readonly auth;
    private readonly bundleId?;
    /** When false, a `legal.consent_required` push (and the sign-in bridge) will
     *  NOT auto-open the gate — the dev drives their own UI via `requiredConsents()`
     *  + `onConsentRequired()`. From `config.autoPresentConsentGate` (default true). */
    private readonly autoPresent;
    private _modalVisible;
    private _modalUrl;
    private _modalResolve;
    private modalStateListeners;
    /** Bumped on each `legal.consent_required` push (parity with Swift's
     *  @Published consentRevision). Observe via `onConsentRequired`. */
    private _consentRevision;
    private readonly revisionListeners;
    /** Set synchronously at the top of presentGateIfNeeded and held across its
     *  `await requiredConsents()` round-trip — serializes concurrent callers (e.g.
     *  a sign-in bridge trigger + an app foreground call) so only one gate opens.
     *  JS is single-threaded, so a boolean is enough. */
    private _presenting;
    constructor(apiUrl: string, publishableKey: string, auth: OneloAuth, bundleId?: string, autoPresent?: boolean);
    /** Current consent revision — bumped on each `legal.consent_required` push
     *  (parity with Swift @Published consentRevision). */
    get consentRevision(): number;
    /**
     * Subscribe to `legal.consent_required` pushes (revision bumps). Returns an
     * unsubscribe fn. Use this when you build your own consent UI (with
     * `autoPresentConsentGate:false`) instead of the auto-presented gate.
     */
    onConsentRequired(listener: (revision: number) => void): () => void;
    /**
     * Register the `legal.consent_required` listener on the shared stream (called
     * once by Onelo). The event is a signal only (payload ignored): on receipt we
     * bump the revision, notify `onConsentRequired` observers, and — unless
     * `autoPresent` is false — re-run the gate. Keeps the existing
     * `presentGateIfNeeded` concurrency guard, so a push that races the sign-in
     * bridge can't stack a second gate.
     */
    attachEventStream(stream: OneloEventStream): void;
    /**
     * Fetch the signed-in user's outstanding legal documents. Requires a session;
     * returns `[]` when signed out. Fail-open: any network/non-200/parse failure
     * returns `[]` (never throws).
     */
    requiredConsents(): Promise<OneloConsentRequirement[]>;
    /**
     * Record acceptance of a legal document version. Requires a session. Throws
     * `OneloError` on no-session or a non-2xx response. Server-side idempotent.
     */
    acceptConsent(versionId: string): Promise<void>;
    /**
     * Check for an outstanding BLOCKING consent and, if present, open the hosted
     * gate modal. Resolves `true` if a gate was shown. No-op (returns `false`)
     * when: no session, no blocking document with a gate URL, a gate is already
     * open, or another call is mid-flight. Call this on app foreground; it is also
     * wired to fire automatically on sign-in.
     */
    presentGateIfNeeded(): Promise<boolean>;
    /** Alias for `presentGateIfNeeded()`. */
    checkConsent(): Promise<boolean>;
    private _openGate;
    /** Returns current modal state for rendering <ConsentGateModal>. */
    getModalState(): ConsentModalState;
    /** Subscribe to consent modal state changes. Returns an unsubscribe function. */
    onModalStateChange(callback: () => void): () => void;
    private notifyModalListeners;
    /** Release listeners and hide any open gate. Call on SDK teardown. */
    dispose(): void;
}

/** Result of the hosted store WebView. `success` carries the one-time code the
 *  store redirected with (`<scheme>://callback?code=…`), which `store.open()`
 *  exchanges for a session. `cancelled` = the buyer closed the modal. */
type StoreResult = {
    type: 'success';
    code: string;
} | {
    type: 'cancelled';
};
interface StoreModalViewProps {
    visible: boolean;
    hostedUrl: string;
    callbackScheme: string;
    /** Backend base URL — enables the `native_oauth{provider,token}` message-relay
     *  hand-off (builds `{apiUrl}/api/sdk/auth/oauth/hosted-init?…`). Optional:
     *  OAuth still works via the navigation-diversion path without it. */
    apiUrl?: string;
    /** Branding page background so the checkout WebView never flashes white. */
    backgroundColor?: string;
    onResult: (result: StoreResult) => void;
}
/**
 * Reactive hook for rendering the store modal manually via <StoreModalView>.
 * Re-renders automatically when store.open() opens or closes the modal.
 */
declare function useStoreModalState(store: OneloStore): StoreModalState;
interface StoreModalProps {
    onelo: {
        store: OneloStore;
    };
}
/**
 * Connected store modal — mount once near the root of your app:
 *
 *   <StoreModal onelo={onelo} />
 *
 * It subscribes to onelo.store state, shows the hosted checkout WebView when
 * store.open() is called, and resolves open()'s promise (with the resulting
 * OneloSession, or null if cancelled) when the buyer finishes or closes it.
 */
declare function StoreModal({ onelo }: StoreModalProps): React.FunctionComponentElement<StoreModalViewProps> | null;
/**
 * Presentational store modal (advanced use) — render it yourself with state from
 * useStoreModalState() if you need custom mounting behaviour.
 */
declare function StoreModalView({ visible, hostedUrl, callbackScheme, apiUrl, onResult, backgroundColor }: StoreModalViewProps): React.CElement<{
    visible: boolean;
    animationType: string;
    presentationStyle: string;
    onRequestClose: () => void;
}, React.Component<{
    visible: boolean;
    animationType: string;
    presentationStyle: string;
    onRequestClose: () => void;
}, any, any>>;

type StoreModalState = {
    visible: boolean;
    hostedUrl: string;
    callbackScheme: string;
    /** Backend base URL — threaded into the modal so it can build the `native_oauth`
     *  system-browser hand-off URL (`{apiUrl}/api/sdk/auth/oauth/hosted-init?…`). */
    apiUrl: string;
    /** Branding page background (--onelo-page-bg) so the checkout WebView never
     *  flashes white before the hosted store page paints. */
    backgroundColor: string;
    onResult: ((result: StoreResult) => void) | null;
};
/**
 * Monetization entry points — the Onelo hosted store (checkout / plan selection)
 * and the upgrade flow. Ports Swift's `OneloAuth.initiateStoreFlow()` +
 * `Onelo.openUpgrade(forPlan:)`; mirrors the Electron `OneloStore`.
 *
 * The AUTOMATIC "you must buy to proceed" store (sign-up → store when the paywall
 * is on) is handled server-side by the hosted auth page — you get that for free
 * via `auth.loadAuthView()`. THIS class is the EXPLICIT surface: a re-purchase, an
 * "Upgrade" button, or acting on a feature's `upgradeCta`/`upgradeHint` upsell.
 *
 * Backend: `GET /api/sdk/paywall/store-initiate` + `GET /api/sdk/paywall/upgrade-initiate`.
 *
 * Usage:
 *   const session = await onelo.store.open()        // buyer ends up signed in
 *   await onelo.store.openUpgrade('pro')            // upgrade in system browser
 */
declare class OneloStore {
    private apiUrl;
    private publishableKey;
    private bundleId?;
    private getAccessToken;
    private exchangeCode?;
    private pageBg;
    private readonly callbackScheme;
    private _modalVisible;
    private _modalUrl;
    private _modalResolve;
    private storeStateListeners;
    /**
     * @param exchangeCode Injected by `Onelo` — exchanges the hosted-flow one-time
     *   code for a session AND persists it (so the buyer is left signed in and
     *   auth-state listeners fire). Delegates to the auth module's hosted-callback
     *   exchange. Required for `open()` to complete a purchase.
     */
    constructor(apiUrl: string, publishableKey: string, bundleId: string | undefined, getAccessToken: () => Promise<string | null>, exchangeCode?: (code: string) => Promise<OneloSession>, pageBackgroundColor?: () => string, callbackScheme?: string);
    /** Security headers for every store request (`sdkHeaders`) plus per-request extras. */
    private _secHeaders;
    /**
     * Mint a tokenized hosted-store URL (plan selection + payment + registration in
     * one page). When a session exists its access token is attached (`Authorization:
     * Bearer`) so the store binds to the existing user and skips signup (re-purchase);
     * cold-start omits it. Mirrors Swift `initiateStoreFlow(lang:)`. Use for a custom
     * presentation; `open()` wraps it.
     *
     * @throws OneloError('server_error') on `store_not_configured` (409) /
     *   `paywall_not_enabled` (403) — DO NOT open a WebView in that case — or any
     *   other non-200. `OneloError('invalid_publishable_key')` on 401.
     */
    initiateStoreFlow(lang?: string): Promise<string>;
    /**
     * Open the hosted store in a fullscreen WebView modal and complete checkout. The
     * store completes with a `onelorn://callback?code=` deep-link that is exchanged
     * for a session — the buyer ends up signed in. Resolves with that session, or
     * `null` if the modal was closed without completing a purchase.
     *
     * Requires `<StoreModal onelo={onelo} />` mounted near your app root.
     */
    open(lang?: string): Promise<OneloSession | null>;
    /**
     * Act on an upsell (a feature's `upgradeCta`/`upgradeHint`, an "Available in
     * <plan>" tap). Requires a signed-in session. The backend is the single source
     * of truth for billing: an active subscriber is routed to a hosted plan-switch
     * checkout, a user with no subscription to the hosted store. The resulting URL
     * opens in the SYSTEM BROWSER via `Linking.openURL` (mirrors Swift
     * `openUpgrade(forPlan:)` / `NSWorkspace.open`) — never an in-app WebView.
     *
     * @throws OneloError('not_authenticated') when signed out (401) or
     *   `OneloError('server_error')` on `plan_not_purchasable` (404) /
     *   `callback_scheme_required` (400) / any other non-200.
     */
    openUpgrade(plan: string, lang?: string): Promise<void>;
    /** Returns current modal state for rendering <StoreModal>. */
    getModalState(): StoreModalState;
    /** Subscribe to store modal state changes. Returns an unsubscribe function. */
    onStoreStateChange(callback: () => void): () => void;
    private notifyStoreListeners;
}

declare class Onelo {
    readonly auth: OneloAuth;
    readonly features: OneloFeatures;
    readonly monitor: OneloMonitor;
    readonly feedback: OneloFeedback;
    readonly forms: OneloForms;
    readonly waitlist: OneloWaitlist;
    readonly customerPortal: OneloCustomerPortal;
    readonly consent: OneloConsent;
    readonly store: OneloStore;
    private authUnsubscribe;
    private readonly eventStream;
    /** Whether the auth-state bridge + foreground re-check auto-open the consent
     *  gate (config.autoPresentConsentGate, default true). */
    private readonly autoPresentConsent;
    /** Whether app-foreground force-refreshes the feature snapshot
     *  (config.autoLifecycleRefresh, default true). 1:1 with Swift. */
    private readonly autoLifecycleRefresh;
    /** RN AppState 'change' subscription, removed in destroy() so a torn-down SDK
     *  can't leak a foreground callback that fires against dead state. */
    private appStateSubscription;
    /** iOS App Attest lifecycle. Created lazily in `_initAttest` ONLY when the app
     *  is iOS AND config reports `attest_required`; null otherwise (Android, or
     *  attest not required). Its token rides every request via `sdkHeaders`. */
    private attest;
    /** Resolves when the background attestation kicked off in the constructor has
     *  produced its token (or settled as not-required / failed). Gated auth entry
     *  points await this so a cold-start request never races AHEAD of the token
     *  and gets a spurious 403 (#25). Defaults to a resolved promise so it's
     *  always awaitable even before `_initAttest` is assigned below. */
    private _attestReady;
    constructor(config: OneloConfig);
    /**
     * Start device attestation when the backend requires it — App Attest on iOS,
     * Play Integrity on Android. Awaits config resolution (`auth.whenReady`) to
     * read `attest_required` (+ `cloudProjectNumber` for Android), then hands off
     * to the platform-guarded `OneloAttest` (no-op on Simulator/emulator-without-
     * Play or unlinked native). Never throws — attestation is best-effort and
     * independent of sign-in.
     *
     * NEVER swallow the catch silently (CLAUDE.md "No silent swallows" /
     * `feedback_no_silent_swallows`) — everything on the happy path below this
     * point (the dynamic `import('./attest')`, the constructor, `attest.start()`)
     * already logs its own failures via `attest.ts`'s `log()`, but anything that
     * throws BEFORE reaching that internal logging (e.g. the dynamic import
     * itself failing to resolve under a given Metro/bundler config) used to
     * vanish here with zero trace — exactly the diagnosability gap flagged for
     * the Swift SDK (`OneloAuth.swift` `_refreshAttestToken`, `try?`). Attestation
     * staying best-effort (never breaking SDK init) is preserved; only the
     * silence is fixed.
     */
    private _initAttest;
    /**
     * Re-check consent (and resync features) when the app returns to the
     * foreground — RN has no built-in foreground hook, so we subscribe to
     * AppState 'change' → 'active'. Mirrors Swift's foreground resync. `AppState`
     * is required LAZILY so a pure-Node import of this module (tests) never pulls
     * `react-native`; any failure (unusual RN polyfill) degrades to "no foreground
     * re-check" rather than throwing at construction.
     */
    private _wireForeground;
    /** Only needed when NOT using Onelo Auth (own auth system). `userIdHash` is the
     *  host-supplied HMAC for Features secure mode (threaded into resolve / batch-ping
     *  / module-token); omit it when not using secure mode. */
    identify(userId: string, userIdHash?: string): Promise<void>;
    /**
     * Opens the hosted upgrade flow for `plan` in the SYSTEM BROWSER and returns.
     * The backend decides the destination: an active subscriber lands on "Change
     * plan" (target pinned; one click to confirm), a non-subscriber on the store.
     * Requires a signed-in session (throws `OneloError('not_authenticated')` otherwise).
     *
     * Wire it to a plan-gated tile whose `upgradeCta` is on:
     *   `if (f.upgradeCta && f.requiredPlan) onelo.openUpgrade(f.requiredPlan)`
     *
     * Thin delegate to {@link OneloStore.openUpgrade} for cross-platform parity with
     * Swift `Onelo.openUpgrade(forPlan:)` / Android / Flutter `onelo.openUpgrade`.
     */
    openUpgrade(plan: string, lang?: string): Promise<void>;
    /** Release background timers. Call when the SDK instance is no longer needed. */
    destroy(): void;
}

interface OneloAuthGateProps {
    onelo: Onelo;
    /** Protected app UI — revealed ONLY once the user is signed in and (for
     *  paywall apps) entitled. Never rendered before that resolves. */
    children: React.ReactNode;
    /**
     * Optional custom UI for the pre-auth loading state (while sign-in / the
     * entitlement check is resolving, before the hosted WebView is presented).
     * Defaults to a plain neutral background with a spinner — no branded pre-auth
     * screen, per the SDK auth design rules. The hosted sign-in / store page is
     * ALWAYS rendered by the built-in <AuthModal>; this only styles the gap before it.
     */
    fallback?: React.ReactNode;
}
/**
 * Entitlement content-gate — the React Native analogue of Swift's `OneloAuthView`.
 *
 *   <OneloAuthGate onelo={onelo}>
 *     <App />
 *   </OneloAuthGate>
 *
 * Reveals `children` ONLY when `signedIn && (!paywallEnabled || entitled)` — the
 * `inApp = isAuthenticated && !needsPaywall` model from `OneloAuthView`
 * (`needsPaywall = session != null && paywallEnabled && entitlement != 'active'`).
 * Until then it never paints `children`; it shows a neutral loading background and
 * drives the CENTRALISED hosted flow via `auth.loadAuthView()` — which routes,
 * server-side (`/api/sdk/flow/init` → `resolveFlow`), to sign-in for a signed-out
 * user or the hosted STORE for a signed-in-but-unentitled one, and returns a
 * session (or `authorized`, no WebView) when access is already granted. The
 * hosted page renders inside the built-in <AuthModal> mounted here.
 *
 * Ordering mirrors Swift: auth → entitlement → then the legal-consent gate
 * presents OVER content (via `onelo.consent`, wired in `onelo.ts`; mount
 * `<ConsentGateModal onelo={onelo} />` near your root to render it). This gate
 * does not render consent and does not reveal `children` in a way that bypasses a
 * blocking consent modal — the consent modal draws on top of the app.
 *
 * Non-paywall apps gate on the session alone (their `entitlement` is always
 * `'none'`, so we must not block them on it — hence `isPaywallEnabled()`).
 */
declare function OneloAuthGate({ onelo, children, fallback }: OneloAuthGateProps): React.FunctionComponentElement<{
    children?: React.ReactNode | undefined;
}>;

interface ModalState {
    visible: boolean;
    url: string;
    onResult: ((result: ModalResult) => void) | null;
}
/**
 * Reactive hook for rendering <AuthModal>.
 * Re-renders automatically when loadAuthView() opens or closes the modal.
 *
 * @example
 * const modal = useModalState(onelo.auth)
 * return <AuthModal visible={modal.visible} hostedUrl={modal.url} onResult={modal.onResult!} />
 */
declare function useModalState(auth: OneloAuth): ModalState;

interface FeedbackModalProps {
    feedback: OneloFeedback;
}
declare function FeedbackModal({ feedback }: FeedbackModalProps): React.CElement<{
    visible: boolean;
    animationType: string;
    presentationStyle: string;
    onRequestClose: () => void;
}, React.Component<{
    visible: boolean;
    animationType: string;
    presentationStyle: string;
    onRequestClose: () => void;
}, any, any>>;

export { AuthModal, ConsentGateModal, type ConsentGateModalProps, ConsentGateModalView, type ConsentGateModalViewProps, type ConsentModalState, type ConsentResult, CustomerPortalModal, type CustomerPortalModalProps, CustomerPortalModalView, type FeatureReason, FeatureState, type FeatureStatus, FeedbackModal, type FeedbackOptions, type FlowDecision, type ModalState, type MonitorEventOptions, Onelo, OneloAuthGate, type OneloAuthGateProps, OneloConsent, type OneloConsentEnforcement, type OneloConsentRequirement, OneloCustomerPortal, OneloFeatures, OneloFeaturesError, type OneloFeaturesErrorCode, OneloFeedback, OneloForms, OneloMonitor, OneloStore, OneloWaitlist, type PortalModalState, type PortalModalViewProps, type PortalResult, StoreModal, type StoreModalProps, type StoreModalState, StoreModalView, type StoreModalViewProps, type StoreResult, type UpgradeHint, parseConsentMessage, useConsentModalState, useModalState, usePortalModalState, useStoreModalState };
