import React, { useState, useEffect, useCallback, useRef } from 'react'
import type { OneloCustomerPortal, PortalModalState } from './customer-portal'
import {
  type ParsedOAuthMessage,
  parseOAuthMessage,
  isOAuthNavigation,
  buildHostedInitUrl,
  openInSystemBrowser as openBrowser,
  OAUTH_RELAY_SCRIPT,
} from '../auth/webview-oauth'
import { classifyHandBack, classifyHandBackMessage } from '../core/hand-back'
import { portalSkeletonHtml, type BrandTokens } from '@onelo/core'
import { chromeStyles, resolveModalTokens } from '../core/brand'
import { planChangeOf, type PlanChange } from '../core/plan-change'
import { parseRenewRequest, renewReplyScript, sameOrigin, type RenewReply } from './portal-renewal'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const require: (id: string) => any

// Pre-connect loading skeleton: the shared `portalSkeletonHtml` (@onelo/core),
// mirroring the hosted PortalSkeleton 1:1 and painted from the brand tokens (#681).

export type PortalResult =
  /** `planChange`: the store opened in the portal finished a purchase or a
   *  plan switch — the SDK reconciles the plan at once (#659). */
  | { type: 'done'; event?: string; planChange?: PlanChange }
  | { type: 'cancelled' }

export interface PortalModalViewProps {
  visible: boolean
  hostedUrl: string
  callbackScheme: string
  /** Backend base URL — enables the `native_oauth{provider,token}` message-relay
   *  hand-off (builds `{apiUrl}/api/sdk/auth/oauth/hosted-init?…`). Optional:
   *  OAuth still works via the navigation-diversion path without it. */
  apiUrl?: string
  /** The app's brand tokens (#681) — every piece of chrome is painted from them.
   *  Pass `onelo.auth.brandTokens()`; neutral when absent. */
  tokens?: BrandTokens
  /** @deprecated Pass `tokens`. Page ground only, for pre-#681 callers. */
  backgroundColor?: string
  onResult: (result: PortalResult) => void
  /** Answers the hosted page's renew request (#613 / #614). Without it the page
   *  cannot renew and shows its expiry screen when its token dies. */
  onRenewRequest?: (requestId: string) => Promise<RenewReply>
}

/**
 * Reactive hook for rendering the portal modal manually via <CustomerPortalModalView>.
 * Re-renders automatically when customerPortal.open() opens or closes the modal.
 */
export function usePortalModalState(portal: OneloCustomerPortal): PortalModalState {
  const [state, setState] = useState<PortalModalState>(() => portal.getModalState())

  useEffect(() => {
    // Re-sync on mount in case open() fired between the initial render and effect setup.
    setState(portal.getModalState())
    const unsubscribe = portal.onPortalStateChange(() => {
      setState(portal.getModalState())
    })
    return unsubscribe
  }, [portal])

  return state
}

export interface CustomerPortalModalProps {
  onelo: { customerPortal: OneloCustomerPortal }
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
export function CustomerPortalModal({ onelo }: CustomerPortalModalProps) {
  const state = usePortalModalState(onelo.customerPortal)

  const handleResult = useCallback((result: PortalResult) => {
    // state.onResult is the resolver installed by open(); it resolves the
    // open() promise, clears modal state, and notifies listeners.
    state.onResult?.(result)
  }, [state.onResult])

  if (!state.visible || !state.hostedUrl) return null

  return React.createElement(CustomerPortalModalView, {
    visible: state.visible,
    hostedUrl: state.hostedUrl,
    callbackScheme: state.callbackScheme,
    apiUrl: state.apiUrl,
    tokens: state.tokens,
    onResult: handleResult,
    onRenewRequest: state.onRenewRequest,
  })
}

/**
 * Presentational portal modal (advanced use) — render it yourself with state
 * from usePortalModalState() if you need custom mounting behaviour.
 */
export function CustomerPortalModalView({ visible, hostedUrl, callbackScheme, apiUrl, onResult, tokens, backgroundColor, onRenewRequest }: PortalModalViewProps) {
  // Brand tokens (#681) — ground matches the hosted portal page so no white
  // flash; header, ✕, retry and skeleton all from the same tokens.
  const t = resolveModalTokens(tokens, backgroundColor)
  const bg = t.page_bg
  const c = chromeStyles(t)
  const RN = require('react-native')
  const { WebView } = require('react-native-webview')
  const { Modal, View, StyleSheet, TouchableOpacity, Text, Linking, Platform, StatusBar } = RN

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  // Bumped on retry so the WebView key changes → guaranteed fresh remount+reload.
  const [retryKey, setRetryKey] = useState(0)
  // Whether the WebView can navigate back within the portal (deeper page open,
  // e.g. cancel confirmation / a receipt). Drives the leading "‹ Back" control.
  const [canGoBack, setCanGoBack] = useState(false)
  // #40 Phase 2 — true once the hosted portal posts `onelo:ready`. While false the
  // native ✕ acts as a FAIL-SAFE (pre-load / error window); once true the hosted
  // page's canonical ✕ owns the affordance and the native one hides.
  const [hostedReady, setHostedReady] = useState(false)
  // #44 — arm the fail-safe ✕ only after a ~3.5s grace. A normal fast load posts
  // `onelo:ready` first, so it flips `hostedReady` before this and the ✕ never flashes.
  const [failSafeArmed, setFailSafeArmed] = useState(false)
  // Guard against a done/cancel being delivered twice (nav interception +
  // onNavigationStateChange + the Linking listener can all observe the callback).
  const resolvedRef = useRef(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const webviewRef = useRef<any>(null)

  // Reset per-open state whenever a new hosted flow is presented.
  useEffect(() => {
    resolvedRef.current = false
    setCanGoBack(false)
  }, [hostedUrl, visible])

  // #44 — reset ready/fail-safe state on each open (and retry) and arm the grace
  // timer. A fast load posts `onelo:ready` well before this fires → no ✕ flash.
  useEffect(() => {
    if (!visible) return
    setHostedReady(false)
    setFailSafeArmed(false)
    const t = setTimeout(() => setFailSafeArmed(true), 3500)
    return () => clearTimeout(t)
  }, [visible, hostedUrl, retryKey])

  const resolveOnce = useCallback(
    (result: PortalResult) => {
      if (resolvedRef.current) return
      resolvedRef.current = true
      onResult(result)
    },
    [onResult],
  )

  /**
   * Handle a `<scheme>://callback?source=portal[&event=…]` deep link (from either
   * an in-WebView navigation or the system-browser Linking event). REQUIRE host
   * `callback` (guard #6) AND `source === 'portal'` — without the host guard a
   * stored XSS could navigate to `onelorn://anything?…`, and without the source
   * guard a non-portal callback would previously set `resolvedRef` and return
   * WITHOUT resolving, wedging the modal open forever. Any mismatch is now a
   * clean cancel. Returns true when the URL was a callback we consumed.
   */
  const handleCallbackUrl = useCallback(
    (url: string): boolean => {
      // The one Store Hand-back decoder (#615). A purchase (#592) or a plan
      // switch (#599) started from the portal closes it as done, like the
      // portal's own Done, and names the plan change so the SDK reconciles it
      // at once (#659).
      const hb = classifyHandBack(url, callbackScheme)
      if (!hb) return false
      if (hb.kind === 'portal_closed') resolveOnce({ type: 'done', event: hb.event })
      else if (hb.kind === 'purchase' || hb.kind === 'switched') resolveOnce({ type: 'done', planChange: planChangeOf(hb) })
      else resolveOnce({ type: 'cancelled' })
      return true
    },
    [callbackScheme, resolveOnce],
  )

  // Open a provider URL in the SYSTEM BROWSER (never the embedded WebView). The
  // provider redirects back to onelorn://callback?source=portal, captured by the
  // Linking listener below. On failure to open, cancel (PortalResult has no error
  // variant).
  const openInSystemBrowser = useCallback(
    (url: string) => {
      openBrowser(Linking, url, () => resolveOnce({ type: 'cancelled' }))
    },
    [Linking, resolveOnce],
  )

  // Relayed OAuth message → hand off to the system browser.
  const openOAuth = useCallback(
    (msg: NonNullable<ParsedOAuthMessage>) => {
      if (msg.type === 'native_oauth_url') {
        openInSystemBrowser(msg.url)
        return
      }
      // native_oauth: build the token-authenticated hosted-init URL. Needs apiUrl;
      // if the host didn't thread it, the navigation-diversion path handles the
      // hosted page's location.href fallback.
      if (!apiUrl) return
      openInSystemBrowser(buildHostedInitUrl(apiUrl, msg.provider, msg.token))
    },
    [apiUrl, openInSystemBrowser],
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleMessage = useCallback(
    (event: any) => {
      const data: string = event.nativeEvent.data
      // #614 — the portal (or the store it opened) asks for a fresh portal token.
      const renewId = parseRenewRequest(data)
      if (renewId) {
        if (!onRenewRequest) return
        // Only a page still on the portal's origin may receive a fresh portal.
        if (!sameOrigin(event.nativeEvent.url, hostedUrl)) return
        void onRenewRequest(renewId).then((reply) => {
          webviewRef.current?.injectJavaScript?.(renewReplyScript(reply))
        })
        return
      }
      // The store (opened from the portal, or by openUpgrade) handing back as a
      // postMessage (#627): the same outcomes as the deep-link path — a purchase
      // or a plan switch closes as done, "Return to app" on a spent link cancels.
      const hb = classifyHandBackMessage(data)
      if (hb) {
        if (hb.kind === 'purchase' || hb.kind === 'switched') resolveOnce({ type: 'done', planChange: planChangeOf(hb) })
        else resolveOnce({ type: 'cancelled' })
        return
      }
      // #40 Phase 2 — hosted page mounted → hide the native fail-safe ✕.
      try {
        const m = JSON.parse(data) as Record<string, unknown>
        if (m && m['type'] === 'onelo:ready') {
          setHostedReady(true)
          return
        }
      } catch { /* non-JSON page message — fall through to OAuth parse */ }
      const oauth = parseOAuthMessage(data)
      if (oauth) openOAuth(oauth)
    },
    [openOAuth, onRenewRequest, hostedUrl, resolveOnce],
  )

  // Intercept top-level navigations BEFORE the WebView loads them:
  //   • onelorn://callback?… → consume in-app (done / cancel), block load
  //   • provider host / oauth-init path → divert to system browser, block load
  // Everything else (the hosted portal's own same-origin navigation) loads normally.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleShouldStartLoad = useCallback(
    (request: any): boolean => {
      const url: string = request.url ?? ''
      if (url.toLowerCase().startsWith(`${callbackScheme}://`)) {
        handleCallbackUrl(url)
        return false
      }
      if (isOAuthNavigation(url)) {
        openInSystemBrowser(url)
        return false
      }
      return true
    },
    [callbackScheme, handleCallbackUrl, openInSystemBrowser],
  )

  // target="_blank" links (Stripe invoice PDF / hosted receipt in the portal's
  // Receipts list) — react-native-webview won't open a new window on its own, so
  // they'd silently do nothing. Route them to the system browser (Swift parity:
  // WKUIDelegate createWebViewWith → NSWorkspace/UIApplication.open). A failed
  // receipt open must NOT close the portal, so this uses a no-op fail handler
  // (unlike openInSystemBrowser above, which cancels the modal on failure).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleOpenWindow = useCallback(
    (event: any) => {
      const url: string = event?.nativeEvent?.targetUrl ?? ''
      if (url) openBrowser(Linking, url, () => {})
    },
    [Linking],
  )

  // Belt-and-braces: some Android navigations surface via onNavigationStateChange
  // rather than onShouldStartLoadWithRequest. Only act on the callback scheme.
  // Also mirror the WebView's back-history depth so the header can offer "‹ Back".
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleNavChange = useCallback(
    (navState: any) => {
      const url: string = navState.url ?? ''
      if (url.toLowerCase().startsWith(`${callbackScheme}://`)) handleCallbackUrl(url)
      setCanGoBack(!!navState.canGoBack)
    },
    [callbackScheme, handleCallbackUrl],
  )

  // "‹ Back" — step back within the portal WebView (e.g. out of a receipt or a
  // cancel-confirmation page) instead of exiting the whole modal.
  const goBack = useCallback(() => {
    webviewRef.current?.goBack?.()
  }, [])

  // Capture the OAuth callback when it comes back via the SYSTEM BROWSER as a
  // deep link (onelorn://callback?source=portal). Active only while visible.
  useEffect(() => {
    if (!visible || !Linking?.addEventListener) return
    const onUrl = (event: { url: string }) => {
      if (event?.url) handleCallbackUrl(event.url)
    }
    const sub = Linking.addEventListener('url', onUrl)
    return () => {
      if (sub && typeof sub.remove === 'function') sub.remove()
      else if (Linking.removeEventListener) Linking.removeEventListener('url', onUrl)
    }
  }, [visible, Linking, handleCallbackUrl])

  const handleError = useCallback(() => {
    setLoading(false)
    setError(true)
  }, [])

  const handleRetry = useCallback(() => {
    setError(false)
    setLoading(true)
    setRetryKey((k) => k + 1)
  }, [])

  const handleCancel = useCallback(() => {
    resolveOnce({ type: 'cancelled' })
  }, [resolveOnce])

  // Android hardware Back (Modal.onRequestClose): step back inside the portal
  // first if we can, otherwise treat it as an explicit exit → return to the app.
  const handleRequestClose = useCallback(() => {
    if (canGoBack) goBack()
    else handleCancel()
  }, [canGoBack, goBack, handleCancel])

  // Top inset so the header controls clear the status bar. On Android the
  // fullScreen Modal paints UNDER the status bar, so we pad by its height;
  // on iOS 8px below the top edge is enough. (Same formula as FeedbackModal.)
  const topInset = Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 8
  const headerHeight = 48 + topInset

  // #40 Phase 2 / #44 — the native fail-safe ✕ shows ONLY while the hosted page
  // hasn't confirmed it's ready AND either the grace elapsed or the load errored
  // (the error screen has no hosted ✕, so the native one must stay to allow exit).
  // Once the hosted page is ready, its canonical ✕ owns the affordance. The header
  // (and "‹ Back") is unchanged — only the ✕'s visibility changes.
  const showNativeClose = !hostedReady && (failSafeArmed || error)

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: bg },
    // Always-present navigation chrome — a fullScreen Modal has NO swipe-to-dismiss
    // (iOS) and NO system Back affordance beyond the hardware key (Android), so
    // without this the WebView traps the user unless the hosted page happens to
    // offer its own exit. "‹ Back" steps within the portal; "Done" exits to the app.
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingTop: topInset,
      paddingHorizontal: 8,
      height: headerHeight,
      backgroundColor: bg,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.header.borderBottomColor,
      // Stay above the absolute loading overlay so "Done" is tappable even while
      // the portal is loading (or if a load hangs) — the exit must never be covered.
      zIndex: 1,
      elevation: 1,
    },
    headerBtn: { minWidth: 44, height: 44, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' },
    backText: { color: c.headerText.color, fontSize: 17, fontWeight: '400' },
    // Close (✕) — the brand text colour (22px/400) as the Feedback modal, so the
    // close control is identical across every Onelo modal + SDK.
    doneText: { color: c.headerText.color, fontSize: 22, fontWeight: '400', lineHeight: 24 },
    webview: { flex: 1, backgroundColor: bg },
    // Skeleton sits BELOW the header (top: headerHeight) so its 48px top padding
    // aligns with where the real hosted content paints — zero shift on cross-fade.
    skeletonOverlay: { position: 'absolute', top: headerHeight, left: 0, right: 0, bottom: 0, backgroundColor: bg },
    errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16 },
    retryButton: c.retryButton,
    retryText: c.retryText,
    cancelButton: { paddingHorizontal: 32, paddingVertical: 14 },
    cancelText: c.cancelText,
  })

  return React.createElement(Modal, { visible, animationType: 'slide', presentationStyle: 'fullScreen', onRequestClose: handleRequestClose },
    React.createElement(View, { style: styles.container },
      // Persistent navigation chrome: leading "‹ Back" (only when the portal has a
      // deeper page open) + trailing "Done" (always) so the user can exit back to
      // the app. Rendered above the WebView so it's never covered by page content.
      React.createElement(View, { style: styles.header },
        (!error && canGoBack)
          ? React.createElement(TouchableOpacity, {
              onPress: goBack,
              style: styles.headerBtn,
              accessibilityRole: 'button',
              accessibilityLabel: 'Go back',
              hitSlop: { top: 8, bottom: 8, left: 8, right: 8 },
            }, React.createElement(Text, { style: styles.backText, allowFontScaling: false }, '‹ Back'))
          // Empty leading spacer keeps "Done" pinned right when Back is hidden.
          : React.createElement(View, { style: styles.headerBtn }),
        // #40 Phase 2 — native ✕ is a fail-safe: shown only pre-ready (grace/error),
        // hidden once the hosted page's canonical ✕ takes over. Spacer holds its slot.
        showNativeClose
          ? React.createElement(TouchableOpacity, {
              onPress: handleCancel,
              style: styles.headerBtn,
              accessibilityRole: 'button',
              accessibilityLabel: 'Close customer portal',
              hitSlop: { top: 8, bottom: 8, left: 8, right: 8 },
            }, React.createElement(Text, { style: styles.doneText, allowFontScaling: false }, '✕'))
          : React.createElement(View, { style: styles.headerBtn })
      ),
      !error && React.createElement(WebView, {
        ref: webviewRef,
        // Whitelist the callback scheme so `onelorn://callback?source=portal…` routes
        // through onShouldStartLoadWithRequest (revoke/close handling) instead of being
        // shunted to Linking.openURL by react-native-webview. http/https keep normal loads.
        originWhitelist: ['http://*', 'https://*', `${callbackScheme}://*`],
        // Ephemeral session (Swift .nonPersistent() parity) — no stale portal
        // state survives the modal / app restart.
        incognito: true,
        key: retryKey,
        source: { uri: hostedUrl },
        onLoadEnd: () => setLoading(false),
        onError: handleError,
        onMessage: handleMessage,
        injectedJavaScript: OAUTH_RELAY_SCRIPT,
        onNavigationStateChange: handleNavChange,
        onShouldStartLoadWithRequest: handleShouldStartLoad,
        onOpenWindow: handleOpenWindow,
        style: styles.webview,
        backgroundColor: bg,
      }),
      // Loading placeholder: a baked shimmer skeleton (matches the hosted
      // PortalSkeleton) instead of a bare spinner, shown until the real page paints.
      // Purely visual — no message/nav/callback handlers, so it can't interfere with
      // the deep-link / OAuth interception on the real WebView above.
      loading && !error && React.createElement(View, { style: styles.skeletonOverlay, pointerEvents: 'none' },
        React.createElement(WebView, {
          source: { html: portalSkeletonHtml(t) },
          style: styles.webview,
          backgroundColor: bg,
          scrollEnabled: false,
          pointerEvents: 'none',
        })
      ),
      error && React.createElement(View, { style: styles.errorContainer },
        React.createElement(TouchableOpacity, { style: styles.retryButton, onPress: handleRetry },
          React.createElement(Text, { style: styles.retryText }, 'Manage Subscription')
        ),
        React.createElement(TouchableOpacity, { style: styles.cancelButton, onPress: handleCancel },
          React.createElement(Text, { style: styles.cancelText }, 'Cancel')
        )
      )
    )
  )
}
