import { httpGet, OneloError } from '@onelo/core'
import { sdkHeaders } from '../sdk-headers'
import type { PortalResult } from './customer-portal-modal'

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

export type PortalModalState = {
  visible: boolean
  hostedUrl: string
  callbackScheme: string
  /** Backend base URL — threaded into the modal so it can build the `native_oauth`
   *  system-browser hand-off URL (`{apiUrl}/api/sdk/auth/oauth/hosted-init?…`). */
  apiUrl: string
  /** Branding page background (--onelo-page-bg) so the portal WebView never
   *  flashes white before the hosted portal page paints. */
  backgroundColor: string
  onResult: ((result: PortalResult) => void) | null
}

export class OneloCustomerPortal {
  private apiUrl: string
  private publishableKey: string
  private bundleId?: string
  private getAccessToken: () => Promise<string | null>
  private signOut: () => Promise<void>
  private onRevoked?: () => void

  private pageBg: () => string
  private readonly callbackScheme: string

  private _modalVisible = false
  private _modalUrl = ''
  private _modalResolve: ((result: PortalResult) => void) | null = null
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
    pageBackgroundColor: () => string = () => '#111111',
    callbackScheme: string = CALLBACK_SCHEME,
  ) {
    if (!apiUrl) throw new Error('[Onelo] apiUrl is required')
    this.apiUrl = apiUrl
    this.publishableKey = publishableKey
    this.bundleId = bundleId
    this.getAccessToken = getAccessToken
    this.signOut = signOut
    this.onRevoked = onRevoked
    this.pageBg = pageBackgroundColor
    this.callbackScheme = callbackScheme
  }

  /** Open the hosted customer portal in a fullscreen WebView modal. */
  async open(): Promise<void> {
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

    if (status !== 200) throw OneloError.server('Failed to initiate customer portal')
    const j = json as Record<string, unknown>
    const hostedUrl = j['hosted_url'] as string | undefined
    if (!hostedUrl) throw OneloError.server('Invalid portal-initiate response')

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
      backgroundColor: this.pageBg(),
      onResult: this._modalResolve,
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
