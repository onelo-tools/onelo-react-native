import React, { useState, useEffect, useCallback, useRef } from 'react'
import type { OneloStore, StoreModalState } from './store'
import {
  type ParsedOAuthMessage,
  parseOAuthMessage,
  isOAuthNavigation,
  withOAuthPreauth,
  buildHostedInitUrl,
  openInSystemBrowser as openBrowser,
  OAUTH_RELAY_SCRIPT,
} from '../auth/webview-oauth'
import { classifyHandBack, classifyHandBackMessage } from '../core/hand-back'
import { skeletonCss, type BrandTokens } from '@onelo/core'
import { chromeStyles, resolveModalTokens } from '../core/brand'
import { oneloText } from '../core/texts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const require: (id: string) => any

/**
 * Pre-connect loading skeleton, shown in-app while the hosted store/checkout page
 * is still being fetched (before the WebView paints) — instead of a bare spinner.
 * The layout MIRRORS the hosted StoreSkeleton (frontend/app/store/hosted/
 * StoreSkeleton.tsx): logo 64, heading 220×22, subheading 140×13, then a 3-card
 * product grid (name/price/2 desc lines/CTA), and a footer bar — so the cross-fade
 * skeleton → hosted StoreSkeleton → loaded checkout has zero layout shift. Painted
 * from the brand tokens (#681) so there's no white flash. SDK-local (per-SDK).
 */
export const storeSkeletonHtml = (t: BrandTokens) => `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:${t.page_bg};font-family:${t.body_font};overflow:hidden}
${skeletonCss(t)}
.wrap{width:100%;max-width:896px;margin:0 auto;padding:48px 24px;display:flex;flex-direction:column;align-items:center}
.head{width:100%;display:flex;flex-direction:column;align-items:center;margin-bottom:32px}
.logo{width:64px;height:64px;border-radius:${t.card_radius}px;margin-bottom:14px;border:1.5px solid ${t.border}}
.h{width:220px;height:22px;margin-bottom:10px}
.sub{width:140px;height:13px;opacity:0.7}
.grid{width:100%;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}
.card{border-radius:${t.card_radius}px;padding:18px;min-height:180px;display:flex;flex-direction:column;gap:12px;background:${t.card_bg};border:1px solid ${t.border}}
.name{width:60%;height:14px}
.price{width:40%;height:22px}
.desc{width:90%;height:10px;opacity:0.7}
.desc2{width:75%;height:10px;opacity:0.7}
.spacer{flex:1}
.cta{width:100%;height:40px;border-radius:${t.button_radius}px}
.foot{width:110px;height:14px;opacity:0.5;margin-top:36px}
</style></head><body>
<div class="wrap">
<div class="head"><div class="sk logo"></div><div class="sk h"></div><div class="sk sub"></div></div>
<div class="grid">
<div class="card"><div class="sk name"></div><div class="sk price"></div><div class="sk desc"></div><div class="sk desc2"></div><div class="spacer"></div><div class="sk cta"></div></div>
<div class="card"><div class="sk name"></div><div class="sk price"></div><div class="sk desc"></div><div class="sk desc2"></div><div class="spacer"></div><div class="sk cta"></div></div>
<div class="card"><div class="sk name"></div><div class="sk price"></div><div class="sk desc"></div><div class="sk desc2"></div><div class="spacer"></div><div class="sk cta"></div></div>
</div>
<div class="sk foot"></div>
</div>
</body></html>`

/** Result of the hosted store WebView. `success` carries the one-time code the
 *  store redirected with (`<scheme>://callback?code=…`), which `store.open()`
 *  exchanges for a session. `cancelled` = the buyer closed the modal. */
export type StoreResult =
  | { type: 'success'; code: string }
  | { type: 'cancelled' }
  /** A plan switch finished with no checkout (#599) — `source=store&event=…`.
   *  No code; `store.open()` resolves the current session. */
  | { type: 'done'; reason: string }
  /** The store's link died (#619). `store.open()` mints a fresh one and keeps
   *  the modal up on it. */
  | { type: 'expired' }

export interface StoreModalViewProps {
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
  onResult: (result: StoreResult) => void
}

/**
 * Reactive hook for rendering the store modal manually via <StoreModalView>.
 * Re-renders automatically when store.open() opens or closes the modal.
 */
export function useStoreModalState(store: OneloStore): StoreModalState {
  const [state, setState] = useState<StoreModalState>(() => store.getModalState())

  useEffect(() => {
    // Re-sync on mount in case open() fired between the initial render and effect setup.
    setState(store.getModalState())
    const unsubscribe = store.onStoreStateChange(() => {
      setState(store.getModalState())
    })
    return unsubscribe
  }, [store])

  return state
}

export interface StoreModalProps {
  onelo: { store: OneloStore }
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
export function StoreModal({ onelo }: StoreModalProps) {
  const state = useStoreModalState(onelo.store)

  const handleResult = useCallback((result: StoreResult) => {
    // state.onResult is the resolver installed by open(); it exchanges the code
    // for a session (or resolves null on cancel), clears modal state, and notifies.
    state.onResult?.(result)
  }, [state.onResult])

  if (!state.visible || !state.hostedUrl) return null

  return React.createElement(StoreModalView, {
    visible: state.visible,
    hostedUrl: state.hostedUrl,
    callbackScheme: state.callbackScheme,
    apiUrl: state.apiUrl,
    tokens: state.tokens,
    onResult: handleResult,
  })
}

/**
 * Presentational store modal (advanced use) — render it yourself with state from
 * useStoreModalState() if you need custom mounting behaviour.
 */
export function StoreModalView({ visible, hostedUrl, callbackScheme, apiUrl, onResult, tokens, backgroundColor }: StoreModalViewProps) {
  // Brand tokens (#681) — ground matches the hosted store page so no white
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
  // The URL actually loaded. Starts at hostedUrl; a paid-product `preauth` callback
  // reloads it with ?oauth_preauth= to drive the Stripe step.
  const [currentUrl, setCurrentUrl] = useState(hostedUrl)
  // Whether the WebView can navigate back within the store flow (a deeper step
  // open, e.g. a payment sub-page). Drives the leading "‹ Back" control.
  const [canGoBack, setCanGoBack] = useState(false)
  // Guard against a code/cancel being delivered twice (nav interception +
  // onNavigationStateChange + the Linking listener can all observe the callback).
  const resolvedRef = useRef(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const webviewRef = useRef<any>(null)

  // Reset per-open state whenever a new hosted flow is presented.
  useEffect(() => {
    setCurrentUrl(hostedUrl)
    resolvedRef.current = false
    setCanGoBack(false)
  }, [hostedUrl, visible])

  const resolveOnce = useCallback(
    (result: StoreResult) => {
      if (resolvedRef.current) return
      resolvedRef.current = true
      onResult(result)
    },
    [onResult],
  )

  /**
   * Handle a `<scheme>://callback?…` deep link (from either an in-WebView
   * navigation or the system-browser Linking event). REQUIRE host `callback`
   * (guard #6) — without it a stored XSS on the hosted page could navigate to
   * `onelorn://anything?code=X` and smuggle an arbitrary code into the exchange.
   * A non-callback host is treated as a cancel, never exchanged. Returns true
   * when the URL was a callback we consumed.
   */
  const handleCallbackUrl = useCallback(
    (url: string): boolean => {
      // The one Store Hand-back decoder (#615).
      const hb = classifyHandBack(url, callbackScheme)
      if (!hb) return false
      if (hb.kind === 'purchase') {
        resolveOnce({ type: 'success', code: hb.code })
      } else if (hb.kind === 'switched') {
        resolveOnce({ type: 'done', reason: hb.reason })
      } else if (hb.kind === 'preauth') {
        // Paid-product store flow: OAuth succeeded + account provisioned, but the
        // buyer still owes payment. Reload the hosted store page with
        // ?oauth_preauth=… (StoreClient drives Stripe from there). Does NOT
        // resolve the modal — the flow continues.
        setCurrentUrl((prev) => withOAuthPreauth(prev || hostedUrl, hb.preauth))
      } else if (hb.kind === 'expired') {
        resolveOnce({ type: 'expired' })
      } else {
        // Foreign host, portal/✕ return, error or no code → a cancel/abort,
        // never an exchange.
        resolveOnce({ type: 'cancelled' })
      }
      return true
    },
    [callbackScheme, hostedUrl, resolveOnce],
  )

  // Open a provider URL in the SYSTEM BROWSER (never the embedded WebView). The
  // provider redirects back to onelorn://callback?code=… (or ?preauth=), captured
  // by the Linking listener below. On failure to open, cancel (StoreResult has no
  // error variant).
  const openInSystemBrowser = useCallback(
    (url: string) => {
      openBrowser(Linking, url, () => resolveOnce({ type: 'cancelled' }))
    },
    [Linking, resolveOnce],
  )

  // target="_blank" links (Stripe receipt / "powered by Stripe" / terms) —
  // react-native-webview won't open a new window on its own, so route them to the
  // system browser (Swift parity). A failed open must NOT cancel the checkout, so
  // this uses a no-op fail handler (unlike openInSystemBrowser above).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleOpenWindow = useCallback(
    (event: any) => {
      const url: string = event?.nativeEvent?.targetUrl ?? ''
      if (url) openBrowser(Linking, url, () => {})
    },
    [Linking],
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
      openInSystemBrowser(buildHostedInitUrl(apiUrl, msg.provider, msg.token, msg.intent))
    },
    [apiUrl, openInSystemBrowser],
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleMessage = useCallback(
    (event: any) => {
      const data: string = event.nativeEvent.data
      // The store's hand-back relayed as a postMessage by OAUTH_RELAY_SCRIPT,
      // decoded by the one Store Hand-back decoder (#615 / #627) — the same
      // outcomes as the deep-link path above: a purchase is exchanged for a
      // session (auto-login), a code-less plan switch is a success, and
      // "Return to app" on a spent link cancels.
      const hb = classifyHandBackMessage(data)
      if (hb) {
        if (hb.kind === 'purchase') resolveOnce({ type: 'success', code: hb.code })
        else if (hb.kind === 'switched') resolveOnce({ type: 'done', reason: hb.reason })
        else if (hb.kind === 'expired') resolveOnce({ type: 'expired' })
        else resolveOnce({ type: 'cancelled' })
        return
      }
      const oauth = parseOAuthMessage(data)
      if (oauth) openOAuth(oauth)
    },
    [resolveOnce, openOAuth],
  )

  // Intercept top-level navigations BEFORE the WebView loads them:
  //   • onelorn://callback?… → consume in-app (code / preauth), block load
  //   • provider host / oauth-init path → divert to system browser, block load
  // Everything else (the hosted store's own same-origin navigation) loads normally.
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

  // "‹ Back" — step back within the store WebView (e.g. out of a payment sub-step)
  // instead of abandoning the whole checkout.
  const goBack = useCallback(() => {
    webviewRef.current?.goBack?.()
  }, [])

  // Capture the OAuth callback when it comes back via the SYSTEM BROWSER as a
  // deep link (onelorn://callback?…). Active only while the modal is visible.
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
    setCurrentUrl(hostedUrl)
    setRetryKey((k) => k + 1)
  }, [hostedUrl])

  const handleCancel = useCallback(() => {
    resolveOnce({ type: 'cancelled' })
  }, [resolveOnce])

  // Android hardware Back (Modal.onRequestClose): step back inside the store flow
  // first if we can, otherwise abandon checkout → return to the app.
  const handleRequestClose = useCallback(() => {
    if (canGoBack) goBack()
    else handleCancel()
  }, [canGoBack, goBack, handleCancel])

  // Top inset so the header controls clear the status bar (Android fullScreen Modal
  // paints under it; iOS needs a small pad). Same formula as the portal/feedback.
  const topInset = Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 8
  const headerHeight = 48 + topInset

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: bg },
    // Always-present navigation chrome — a fullScreen Modal has NO swipe-to-dismiss
    // (iOS) and NO on-screen Back (Android), so without this the buyer is trapped in
    // checkout (hardware Back also did nothing). "‹ Back" steps within the flow;
    // "✕" abandons checkout → returns to the app.
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
      // Stay above the absolute loading overlay so "✕" is tappable even while the
      // checkout is loading (or if a load hangs) — the exit must never be covered.
      zIndex: 1,
      elevation: 1,
    },
    headerBtn: { minWidth: 44, height: 44, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' },
    backText: { color: c.headerText.color, fontSize: 17, fontWeight: '400' },
    // Close (✕) — the brand text colour, like every other Onelo modal + SDK.
    closeText: { color: c.headerText.color, fontSize: 22, fontWeight: '400', lineHeight: 24 },
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
      // Persistent navigation chrome: leading "‹ Back" (only when the checkout has a
      // deeper step open) + trailing "✕" (always) so the buyer can step back or
      // abandon and return to the app. Rendered above the WebView + overlay.
      React.createElement(View, { style: styles.header },
        (!error && canGoBack)
          ? React.createElement(TouchableOpacity, {
              onPress: goBack,
              style: styles.headerBtn,
              accessibilityRole: 'button',
              accessibilityLabel: oneloText('goBack'),
              hitSlop: { top: 8, bottom: 8, left: 8, right: 8 },
            }, React.createElement(Text, { style: styles.backText, allowFontScaling: false }, oneloText('backButton')))
          // Empty leading spacer keeps "✕" pinned right when Back is hidden.
          : React.createElement(View, { style: styles.headerBtn }),
        React.createElement(TouchableOpacity, {
          onPress: handleCancel,
          style: styles.headerBtn,
          accessibilityRole: 'button',
          accessibilityLabel: oneloText('closeCheckout'),
          hitSlop: { top: 8, bottom: 8, left: 8, right: 8 },
        }, React.createElement(Text, { style: styles.closeText, allowFontScaling: false }, '✕'))
      ),
      !error && React.createElement(WebView, {
        ref: webviewRef,
        // Whitelist the callback scheme so `onelorn://callback?code=…` routes through
        // onShouldStartLoadWithRequest (code extraction) instead of being shunted to
        // Linking.openURL by react-native-webview. Without it, store checkout can't
        // complete. http/https keep normal page loads.
        originWhitelist: ['http://*', 'https://*', `${callbackScheme}://*`],
        // Ephemeral session (Swift .nonPersistent() parity) — no stale checkout
        // flow-state survives the modal / app restart.
        incognito: true,
        key: retryKey,
        source: { uri: currentUrl },
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
      // StoreSkeleton) instead of a bare spinner, shown until the real page paints.
      // Purely visual — no message/nav/callback handlers, so it can't interfere with
      // the deep-link / OAuth interception on the real WebView above.
      loading && !error && React.createElement(View, { style: styles.skeletonOverlay, pointerEvents: 'none' },
        React.createElement(WebView, {
          source: { html: storeSkeletonHtml(t) },
          style: styles.webview,
          backgroundColor: bg,
          scrollEnabled: false,
          pointerEvents: 'none',
        })
      ),
      error && React.createElement(View, { style: styles.errorContainer },
        React.createElement(TouchableOpacity, { style: styles.retryButton, onPress: handleRetry },
          React.createElement(Text, { style: styles.retryText }, oneloText('retry'))
        ),
        React.createElement(TouchableOpacity, { style: styles.cancelButton, onPress: handleCancel },
          React.createElement(Text, { style: styles.cancelText }, oneloText('cancel'))
        )
      )
    )
  )
}
