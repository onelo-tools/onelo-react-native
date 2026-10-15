import { httpGet, OneloError, BrandSource, type BrandTokens } from '@onelo/core'
import { sdkHeaders } from '../sdk-headers'
import type { PortalResult } from './customer-portal-modal'
import type { PlanChange } from '../core/plan-change'
import type { RenewReply } from './portal-renewal'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SDK_VERSION: string = (require('../../package.json') as any).version

/** Callback scheme used by this SDK — must match auth.ts. */
const CALLBACK_SCHEME = 'onelorn'

/**
 * Portal deep-link `event` values that instantly invalidate the current session.
 * Parity with Swift `OneloAuth.portalRevokeEvents` and guard #9 — on any of these
 * the SDK must sign out locally AND flag the auth session revoked, not just on the
 * account-deletion case.
 */
const PORTAL_REVOKE_EVENTS = new Set<string>([
  'account_deletion_scheduled',
  'account_revoked',
  'session_compromised',
])

/** Where a portal opens. `'change_plan'` lands straight in the plan picker —
 *  the hosted portal asks the backend where the upgrade goes (#587). */
export type PortalIntent = 'change_plan'

/**
 * The hosted portal URL with `intent` as a query param (#606) — the same param
 * `@onelo/js` `customerPortal.open({ intent })` sets. No intent → unchanged.
 */
export function withPortalIntent(hostedUrl: string, intent?: PortalIntent): string {
  if (!intent) return hostedUrl
  try {
    const u = new URL(hostedUrl)
    u.searchParams.set('intent', intent)
    return u.toString()
  } catch {
    return hostedUrl
  }
}

export type PortalModalState = {
  visible: boolean
  hostedUrl: string
  callbackScheme: string
  /** Backend base URL — threaded into the modal so it can build the `native_oauth`
   *  system-browser hand-off URL (`{apiUrl}/api/sdk/auth/oauth/hosted-init?…`). */
  apiUrl: string
  /** The app's brand tokens (#681): the modal's chrome is painted from them. */
  tokens: BrandTokens
  /** @deprecated Use `tokens.page_bg`. */
  backgroundColor: string
  onResult: ((result: PortalResult) => void) | null
  /** Answers the hosted page's renew request with a fresh portal (#614). */
  onRenewRequest: (requestId: string) => Promise<RenewReply>
}

export class OneloCustomerPortal {
  private apiUrl: string
  private publishableKey: string
  private bundleId?: string
  private getAccessToken: () => Promise<string | null>
  private signOut: () => Promise<void>
  private onRevoked?: () => void

  private brand: BrandSource
  private readonly callbackScheme: string
  private readonly onClosed?: () => Promise<unknown>

  private _modalVisible = false
  private _modalUrl = ''
  private _modalResolve: ((result: PortalResult) => void) | null = null
  /** Told when the store opened in the portal modal ended in a purchase or a
   *  plan switch (#659). Set by `Onelo` to its plan-change refresher. */
  private onPlanChange: ((change: PlanChange) => void) | null = null
  setPlanChangeHandler(fn: ((change: PlanChange) => void) | null): void {
    this.onPlanChange = fn
  }
  private portalStateListeners: Array<() => void> = []

  /**
   * @param bundleId Threaded into `sdkHeaders` so portal-initiate sends
   *   `X-Bundle-Id`. A LIVE native app with a registered bundle is 403'd by the
   *   backend's `validate_sdk_request_security` without it.
   * @param onRevoked Injected by `Onelo` — invoked (in addition to `signOut`)
   *   when the portal returns a session-invalidating event (account deletion,
   *   account revoked, session compromised) so `auth.isUserRevoked` is set.
   *   Parity with Swift `portalRevokeEvents` + guard #9.
   */
  constructor(
    apiUrl: string,
    publishableKey: string,
    bundleId: string | undefined,
    getAccessToken: () => Promise<string | null>,
    signOut: () => Promise<void>,
    onRevoked?: () => void,
    /** The SDK's one brand-token model (#681) — `Onelo` passes the auth's. */
    brand: BrandSource = new BrandSource(),
    callbackScheme: string = CALLBACK_SCHEME,
    /** Injected by `Onelo` — re-reads the entitlement once the modal closes, so
     *  `hasActiveAccess()` reflects a plan bought or changed there (#606). */
    onClosed?: () => Promise<unknown>,
  ) {
    if (!apiUrl) throw new Error('[Onelo] apiUrl is required')
    this.apiUrl = apiUrl
    this.publishableKey = publishableKey
    this.bundleId = bundleId
    this.getAccessToken = getAccessToken
    this.signOut = signOut
    this.onRevoked = onRevoked
    this.brand = brand
    this.callbackScheme = callbackScheme
    this.onClosed = onClosed
  }

  /**
   * Open the hosted customer portal in a fullscreen WebView modal. Requires
   * `<CustomerPortalModal onelo={onelo} />` mounted near your app root.
   *
   * @param opts.intent `'change_plan'` opens the portal straight into the plan
   *   picker (parity with `@onelo/js` `customerPortal.open({ intent })`). The
   *   hosted portal asks the backend where the change goes.
   */
  async open(opts?: { intent?: PortalIntent }): Promise<void> {
    const hostedUrl = await this.initiate()
    return this.presentUrl(withPortalIntent(hostedUrl, opts?.intent))
  }

  /** True while a `<CustomerPortalModal>` is mounted to present the portal. */
  get hasModalHost(): boolean {
    return this.portalStateListeners.length > 0
  }

  /**
   * Present an already-minted hosted URL (portal, or a store / plan-switch URL
   * from `/upgrade-initiate`) in the portal modal. Handles every hand-back the
   * portal does and re-reads the entitlement when the modal closes.
   * @internal Used by `OneloStore.openUpgrade`.
   */
  async presentUrl(url: string): Promise<void> {
    await this.presentModal(url)
    if (this.onClosed) await this.onClosed().catch(() => { /* best-effort */ })
  }

  /**
   * Answer the hosted portal's `onelo:renew_request` (#613 / #614): mint a fresh
   * portal with the signed-in user's access token. Signed out or revoked →
   * `renew_failed` with `not_authenticated`, and the page shows its branded
   * "signed out" screen.
   */
  async renewReply(requestId: string): Promise<RenewReply> {
    try {
      const hostedUrl = await this.initiate()
      return { type: 'onelo:renewed', request_id: requestId, hosted_url: hostedUrl }
    } catch (e) {
      const reason = e instanceof OneloError && e.code === 'not_authenticated' ? 'not_authenticated' : 'renew_failed'
      return { type: 'onelo:renew_failed', request_id: requestId, reason }
    }
  }

  /** GET portal-initiate with the user's access token → the hosted URL. */
  private async initiate(): Promise<string> {
    const token = await this.getAccessToken()
    if (!token) throw new OneloError('not_authenticated', 'Sign in before opening the customer portal')

    const url =
      `${this.apiUrl}/api/sdk/paywall/portal-initiate` +
      `?key=${encodeURIComponent(this.publishableKey)}` +
      `&callback_scheme=${encodeURIComponent(this.callbackScheme)}`

    // Full security headers (X-Bundle-Id / instance id / platform) — matches
    // store.ts. The publishable key travels in the query (`key=`) which the
    // portal-initiate contract authenticates on, so it is NOT sent as a header;
    // identity is the Bearer token. Keep the token in the header, never the URL.
    const { status, json } = await httpGet(url, {
      ...(await sdkHeaders(this.bundleId)),
      'X-SDK-Version': SDK_VERSION,
      Authorization: `Bearer ${token}`,
    })

    if (status === 401) throw new OneloError('not_authenticated', 'The session can no longer open the customer portal')
    if (status !== 200) throw OneloError.server('Failed to initiate customer portal')
    const j = json as Record<string, unknown>
    this.brand.adopt(j) // #681: portal-initiate carries brand_tokens
    const hostedUrl = j['hosted_url'] as string | undefined
    if (!hostedUrl) throw OneloError.server('Invalid portal-initiate response')
    return hostedUrl
  }

  private presentModal(hostedUrl: string): Promise<void> {
    return new Promise((resolve) => {
      this._modalUrl = hostedUrl
      this._modalResolve = async (result: PortalResult) => {
        this._modalVisible = false
        this._modalResolve = null
        this.notifyPortalListeners()

        if (result.type === 'cancelled') {
          resolve()
          return
        }
        if (result.planChange) this.onPlanChange?.(result.planChange)

        // done — instantly invalidate the session on any revoke event (account
        // deletion scheduled, account revoked, session compromised). Sign out
        // locally AND flag auth revoked (onRevoked → auth.isUserRevoked), parity
        // with Swift portalRevokeEvents + guard #9.
        if (result.event && PORTAL_REVOKE_EVENTS.has(result.event)) {
          try {
            this.onRevoked?.()
          } catch {
            // best-effort — don't block caller
          }
          try {
            await this.signOut()
          } catch {
            // best-effort — don't block caller
          }
        }
        resolve()
      }
      this._modalVisible = true
      this.notifyPortalListeners()
    })
  }

  /** Returns current modal state for rendering <CustomerPortalModal>. */
  getModalState(): PortalModalState {
    return {
      visible: this._modalVisible,
      hostedUrl: this._modalUrl,
      callbackScheme: this.callbackScheme,
      apiUrl: this.apiUrl,
      tokens: this.brand.current(),
      backgroundColor: this.brand.current().page_bg,
      onResult: this._modalResolve,
      onRenewRequest: (requestId: string) => this.renewReply(requestId),
    }
  }

  /** Subscribe to portal modal state changes. Returns an unsubscribe function. */
  onPortalStateChange(callback: () => void): () => void {
    this.portalStateListeners.push(callback)
    return () => {
      this.portalStateListeners = this.portalStateListeners.filter(l => l !== callback)
    }
  }

  private notifyPortalListeners(): void {
    for (const cb of this.portalStateListeners) cb()
  }
}
