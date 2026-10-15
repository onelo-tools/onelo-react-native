import React, { useState, useCallback, useEffect, useRef } from 'react'
import {
  type ParsedOAuthMessage,
  parseOAuthMessage,
  parseCallbackDeepLink,
  isOAuthNavigation,
  isOneloHostedSurface,
  withOAuthPreauth,
  buildHostedInitUrl,
  openInSystemBrowser as openBrowser,
  OAUTH_RELAY_SCRIPT,
} from './webview-oauth'
import { authSkeletonHtml } from './auth-skeleton'
import { classifyHandBackMessage } from '../core/hand-back'
import type { BrandTokens } from '@onelo/core'
import { chromeStyles, resolveModalTokens } from '../core/brand'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const require: (id: string) => any

/**
 * Deep-link callback scheme for OAuth + hosted redirects. Kept as a LOCAL const
 * (mirrors `store.ts` / `customer-portal.ts`) to avoid an import cycle with
 * `auth.ts`, which already imports `type ModalResult` from this file. MUST equal
 * `CALLBACK_SCHEME` in `auth.ts` / `store.ts` / `customer-portal.ts`.
 */
const CALLBACK_SCHEME = 'onelorn'

/**
 * Is this `?error=` value the hosted page saying its addressing token is spent?
 *
 * Exported so it can be tested against the REAL rule rather than a copy: the
 * classification used to live inline inside `handleCallbackUrl`, which is bound
 * to a React component, so a test could only re-implement it — and a test that
 * re-implements the thing it is testing passes even after the behaviour is
 * deleted.
 *
 * NOT a catch-all: a genuine failure (e.g. `attest_invalid`) must still reach
 * the caller as an error. Reloading on every error would loop forever on one.
 */
export function isExpiredAuthError(err: string | null | undefined): boolean {
  return err === 'invalid_token' || err === 'expired_token' || err === 'token_expired'
}

export type ModalResult =
  | { type: 'code'; code: string }
  | { type: 'cancelled' }
  | { type: 'error'; message: string }
  /**
   * The hosted page handed control back saying its addressing token is spent
   * (`?error=invalid_token`). NOT an error: it is what "Use a different account"
   * on the no-plan page sends after signing the user out, and what an idle
   * expiry sends. Treating it as an error closed the modal and showed the user
   * the literal string "invalid_token"; the correct response is to re-resolve
   * the flow and reopen on a clean sign-in page. Parity with Swift's
   * `onSessionExpired`.
   */
  | { type: 'expired' }

/**
 * The store's native fail-safe ✕ shows ONLY while the hosted page hasn't
 * confirmed it's ready AND the grace period elapsed — pulled out as a pure
 * function so the rule is unit-testable without rendering the component (no
 * RN render-testing infra in this package). Parity with Feedback/Portal's
 * `showNativeClose`, minus their `loadError` branch: a store load error here
 * swaps in a whole different retry screen with its own Cancel button, so
 * `error` never belongs in this formula (the render site's `!error &&` guard
 * keeps this out of that state already).
 */
export function shouldShowNativeStoreClose(opts: {
  onStore: boolean
  hostedReady: boolean
  failSafeArmed: boolean
}): boolean {
  return opts.onStore && !opts.hostedReady && opts.failSafeArmed
}

interface AuthModalProps {
  visible: boolean
  hostedUrl: string
  onResult: (result: ModalResult) => void
  /** Backend base URL — pass `onelo.auth.baseUrl` to enable the `native_oauth`
   *  message-relay path (builds `{apiUrl}/api/sdk/auth/oauth/hosted-init?provider=…&token=…`
   *  via `buildHostedInitUrl`). Optional: OAuth still works without it via the
   *  navigation-diversion path. */
  apiUrl?: string
  /** The app's brand tokens (#681, from `onelo.auth.brandTokens()`): ground,
   *  skeleton, ✕ chip and retry are painted from them. Neutral when absent. */
  tokens?: BrandTokens
  /** @deprecated Pass `tokens`. Page ground only, for pre-#681 callers. */
  backgroundColor?: string
  /** Deep-link callback scheme (from `onelo.auth.callbackScheme`, config-driven,
   *  default 'onelorn'). Used to catch `<scheme>://callback?…` returns in the
   *  WebView + from the system browser. Must match the natively-registered scheme. */
  callbackScheme?: string
  /** #26 part B — social-pill count for the loading skeleton (from
   *  `onelo.auth.oauthProviders`), so it matches what the hosted form renders. */
  socialCount?: number
}

export function AuthModal({ visible, hostedUrl, onResult, apiUrl, tokens, backgroundColor, callbackScheme, socialCount = 0 }: AuthModalProps) {
  // Config-driven deep-link scheme (default 'onelorn'). Register it natively so a
  // system-browser return (OAuth) can reopen the app; in-WebView returns are caught
  // by handleShouldStartLoad regardless.
  const scheme = callbackScheme || CALLBACK_SCHEME
  // React Native imports — peer dependencies, loaded lazily at runtime
  const RN = require('react-native')
  const { WebView } = require('react-native-webview')
  const { Modal, View, StyleSheet, TouchableOpacity, Text, Linking, Platform, StatusBar } = RN

  const [error, setError] = useState(false)
  // Bumped on retry so the WebView key changes → guaranteed fresh remount+reload.
  const [retryKey, setRetryKey] = useState(0)
  // The URL actually loaded. Starts at hostedUrl; a paid-store `preauth` callback
  // reloads it with ?oauth_preauth= to drive the Stripe step.
  const [currentUrl, setCurrentUrl] = useState(hostedUrl)
  // Guard against a code/error being delivered twice (nav interception +
  // onNavigationStateChange + the Linking listener can all observe the callback).
  const resolvedRef = useRef(false)
  // #27 — WebView handle for goBack() + whether the hosted flow has navigated
  // DEEPER than the entry page (e.g. sign-up → the "Choose your plan" store). The
  // close ✕ only appears then, and returns the user to the previous page (the
  // sign-in form) instead of trapping them or cancelling the whole flow.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const webViewRef = useRef<any>(null)
  const [canGoBack, setCanGoBack] = useState(false)
  // Whether the hosted flow is currently on the STORE ("Choose your plan") — the
  // surface where the user was trapped. The ✕ shows ONLY here (never on the entry
  // sign-in form). Detected by URL so it works both when the store is reached via
  // Sign-Up (has back history → ✕ returns to the form) AND when it IS the entry
  // page (signed-in-but-unentitled → no history → ✕ cancels out).
  const isStoreUrl = (u: string) => u.toLowerCase().includes('/store/')
  const [onStore, setOnStore] = useState(isStoreUrl(hostedUrl))
  // #40 Phase 2 parity (FeedbackModal / CustomerPortalModal) — true once the
  // hosted store page posts `onelo:ready`. While false, this ✕ is a FAIL-SAFE
  // for the pre-load/error window; once the hosted page is up, ITS canonical
  // ✕ (StoreExitX) owns the affordance and this one hides. Before this fix
  // BOTH stayed on screen for the whole store visit — two overlapping circles
  // (reported 2026-08-20). Only the store gets a native ✕ at all (`onStore`),
  // so this only needs to matter there.
  const [hostedReady, setHostedReady] = useState(false)
  // #44 parity — arm the fail-safe only after a short grace so a normal fast
  // load (which posts `onelo:ready` first) never flashes the native ✕.
  const [failSafeArmed, setFailSafeArmed] = useState(false)

  // Reset per-open state whenever a new hosted flow is presented.
  useEffect(() => {
    setCurrentUrl(hostedUrl)
    resolvedRef.current = false
    setCanGoBack(false)
    setOnStore(isStoreUrl(hostedUrl))
    setHostedReady(false)
    setFailSafeArmed(false)
  }, [hostedUrl, visible])

  // #44 parity — grace timer for the fail-safe ✕, reset on every new open.
  useEffect(() => {
    if (!visible) return
    const t = setTimeout(() => setFailSafeArmed(true), 3500)
    return () => clearTimeout(t)
  }, [visible, hostedUrl])

  const showNativeStoreClose = shouldShowNativeStoreClose({ onStore, hostedReady, failSafeArmed })

  const resolveOnce = useCallback(
    (result: ModalResult) => {
      if (resolvedRef.current) return
      resolvedRef.current = true
      onResult(result)
    },
    [onResult],
  )

  /**
   * Handle a `<scheme>://callback?…` deep link (from either an in-WebView
   * navigation or the system-browser Linking event). REQUIRE host `callback` —
   * without it a stored XSS on the hosted page could navigate to
   * `onelorn://anything?code=X` and smuggle an arbitrary code into the exchange
   * (Swift parity). Returns true when the URL was a callback we consumed.
   */
  const handleCallbackUrl = useCallback(
    (url: string): boolean => {
      const parsed = parseCallbackDeepLink(url, scheme)
      if (!parsed) return false
      if (parsed.host !== 'callback') {
        resolveOnce({ type: 'error', message: 'Auth callback URL has unexpected host' })
        return true
      }
      const { code, preauth, gate, error: errParam } = parsed.params
      if (gate) {
        // An Access Gate REFUSAL, not a sign-in: there is deliberately no code.
        // WHICH screen is owed — the store or "No active plan" — was decided
        // server-side; this SDK only carries the URL and shows it.
        //
        // Without this branch the refusal died here (no code, no error, so it
        // fell through to "missing code parameter") while the browser tab held
        // the real answer and the app waited on "Check your inbox" forever —
        // the exact failure fixed in Swift and Flutter on 2026-08-19.
        //
        // Navigated IN PLACE like the preauth path above: changing the React
        // `source` would re-flash the skeleton.
        if (isOneloHostedSurface(gate, hostedUrl)) {
          webViewRef.current?.injectJavaScript(
            `window.location.replace(${JSON.stringify(gate)}); true;`,
          )
        } else {
          resolveOnce({ type: 'error', message: 'Refused a sign-in surface from an unknown origin' })
        }
      } else if (code) {
        resolveOnce({ type: 'code', code })
      } else if (preauth) {
        // Paid-product store flow: OAuth succeeded + account provisioned, but the
        // buyer still owes payment. Reload the hosted page with ?oauth_preauth=…
        // (StoreClient drives Stripe from there). Does NOT resolve the modal — the
        // flow continues.
        //
        // #28 — navigate the WebView IN PLACE (location.replace on the current
        // page) rather than changing the React `source`: since the source is now
        // the skeleton-HTML, a source change would re-flash the skeleton mid-
        // checkout. In-place keeps the current page visible until the new one
        // paints, and (replace, not push) keeps `goBack` history clean (#27).
        const preauthUrl = withOAuthPreauth(hostedUrl, preauth)
        webViewRef.current?.injectJavaScript(
          `window.location.replace(${JSON.stringify(preauthUrl)}); true;`,
        )
      } else if (isExpiredAuthError(errParam)) {
        resolveOnce({ type: 'expired' })
      } else if (errParam) {
        resolveOnce({ type: 'error', message: errParam })
      } else {
        resolveOnce({ type: 'error', message: 'Auth callback missing code parameter' })
      }
      return true
    },
    [resolveOnce, hostedUrl, scheme],
  )

  // Open a provider URL in the SYSTEM BROWSER (never the embedded WebView). The
  // provider redirects back to onelorn://callback?code=… (or ?preauth=), captured
  // by the Linking listener below.
  const openInSystemBrowser = useCallback(
    (url: string) => {
      openBrowser(Linking, url, () => {
        resolveOnce({ type: 'error', message: 'Could not open the sign-in browser' })
      })
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
      // native_oauth: build the token-authenticated hosted-init URL. Needs
      // baseUrl; if the host didn't thread it, we can't build the URL — the
      // navigation-diversion path handles the hosted page's location.href fallback.
      if (!apiUrl) return
      openInSystemBrowser(buildHostedInitUrl(apiUrl, msg.provider, msg.token, msg.intent))
    },
    [apiUrl, openInSystemBrowser],
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleMessage = useCallback(
    (event: any) => {
      const data: string = event.nativeEvent.data
      // The one Store Hand-back decoder (#615 / #627). A code-less plan switch
      // cannot start from sign-in, so only a purchase or a cancel ends it here.
      const hb = classifyHandBackMessage(data)
      if (hb?.kind === 'purchase') { resolveOnce({ type: 'code', code: hb.code }); return }
      if (hb?.kind === 'cancelled') { resolveOnce({ type: 'cancelled' }); return }
      // A dead gate-store link (#619): restart the flow, as a dead deep link does.
      if (hb?.kind === 'expired') { resolveOnce({ type: 'expired' }); return }
      // #40 Phase 2 — hosted page mounted → hide the native fail-safe store ✕
      // (its own canonical StoreExitX takes over). Not a hand-back, so it is
      // read directly.
      try {
        if ((JSON.parse(data) as { type?: unknown })?.type === 'onelo:ready') {
          setHostedReady(true)
          return
        }
      } catch { /* not JSON — fall through */ }
      const oauth = parseOAuthMessage(data)
      if (oauth) openOAuth(oauth)
    },
    [resolveOnce, openOAuth],
  )

  // Intercept top-level navigations BEFORE the WebView loads them:
  //   • onelorn://callback?… → consume in-app (sign-in code / preauth), block load
  //   • provider host / oauth-init path → divert to system browser, block load
  // Everything else (the hosted page's own same-origin navigation) loads normally.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleShouldStartLoad = useCallback(
    (request: any): boolean => {
      const url: string = request.url ?? ''
      if (url.toLowerCase().startsWith(`${scheme}://`)) {
        handleCallbackUrl(url)
        return false
      }
      if (isOAuthNavigation(url)) {
        openInSystemBrowser(url)
        return false
      }
      return true
    },
    [handleCallbackUrl, openInSystemBrowser, scheme],
  )

  // Belt-and-braces: some Android navigations surface via onNavigationStateChange
  // rather than onShouldStartLoadWithRequest. Only act on the callback scheme.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleNavChange = useCallback(
    (navState: any) => {
      const url: string = navState.url ?? ''
      if (url.toLowerCase().startsWith(`${scheme}://`)) handleCallbackUrl(url)
      // #27 — track back-history + whether we're on the store, so the ✕ shows on
      // the store (and returns to the sign-in form when there's history).
      setCanGoBack(!!navState.canGoBack)
      setOnStore(isStoreUrl(url))
    },
    [handleCallbackUrl, scheme],
  )

  // Capture the OAuth callback when it comes back via the SYSTEM BROWSER as a
  // deep link (onelorn://callback?…). Active only while the modal is visible;
  // added + removed cleanly (supporting both the RN >=0.65 subscription API and
  // the legacy removeEventListener).
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
    setError(true)
  }, [])

  const handleRetry = useCallback(() => {
    setError(false)
    setCurrentUrl(hostedUrl)
    setRetryKey((k) => k + 1)
  }, [hostedUrl])

  const handleCancel = useCallback(() => {
    resolveOnce({ type: 'cancelled' })
  }, [resolveOnce])

  // #27 — the ✕ (on the store) and Android hardware back: return to the previous
  // hosted page (store → sign-in form) when there's back history; otherwise (the
  // store IS the entry page, or the entry sign-in form on Android) cancel the
  // flow. Never leaves the user trapped, and prefers "back" over "cancel-to-retry".
  const handleBackOrCancel = useCallback(() => {
    // Only step back when we ENTERED on the sign-in form (so there's a form to
    // return to). If the modal opened directly on the store (store-as-entry,
    // signed-in-but-unentitled), always cancel/exit — never goBack, even if the
    // store page later pushes its own in-WebView history (which would otherwise
    // re-trap the user on iOS). `hostedUrl` is the entry URL for this open.
    if (!isStoreUrl(hostedUrl) && canGoBack) webViewRef.current?.goBack()
    else handleCancel()
  }, [hostedUrl, canGoBack, handleCancel])

  // Brand tokens (#681) — the ground matches what the hosted auth page paints
  // behind its card (--onelo-page-bg), so the native WebView/overlay never flashes
  // white; skeleton, ✕ chip and retry come from the same tokens.
  const t = resolveModalTokens(tokens, backgroundColor)
  const bg = t.page_bg
  const c = chromeStyles(t)

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: bg },
    webview: { flex: 1, backgroundColor: bg },
    errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16 },
    retryButton: c.retryButton,
    retryText: c.retryText,
    cancelButton: { paddingHorizontal: 32, paddingVertical: 14 },
    cancelText: c.cancelText,
    // #27 — persistent close affordance in the NORMAL flow (the hosted page,
    // e.g. the store, may not render its own cancel → user was trapped and had
    // to kill the app). Top-trailing, cleared past the notch/status bar.
    closeButton: {
      position: 'absolute',
      top: Platform.OS === 'ios' ? 52 : (StatusBar.currentHeight ?? 24) + 8,
      right: 16,
      ...c.closeChip,
      zIndex: 10,
    },
    closeText: c.closeText,
  })

  return React.createElement(Modal, {
      visible,
      // #28 — 'none' (not 'slide'): the modal's loading skeleton is PIXEL-IDENTICAL
      // to the gate's skeleton it appears over (same HTML, bg, socialCount), so a
      // slide-in reads as a jarring "second load / jump". Swapping in place makes
      // the gate→modal skeleton hand-off seamless (one continuous surface).
      animationType: 'none',
      presentationStyle: 'fullScreen',
      // #27 — Android hardware back: step back in the hosted flow, else cancel.
      onRequestClose: handleBackOrCancel,
    },
    React.createElement(View, { style: styles.container },
      !error && React.createElement(WebView, {
        // Route the custom callback scheme THROUGH onShouldStartLoadWithRequest
        // (where handleShouldStartLoad extracts the one-time code + returns false).
        // Without the scheme whitelisted, react-native-webview shunts
        // `onelorn://callback?code=…` to Linking.openURL ("Can't open url" when the
        // scheme isn't registered) and the in-WebView interceptor is bypassed — the
        // code is lost and sign-in never completes. http/https keep normal page loads.
        originWhitelist: ['http://*', 'https://*', `${scheme}://*`],
        // Ephemeral session — RN analogue of Swift's `websiteDataStore =
        // .nonPersistent()`. Auth cookies/localStorage/cache must NOT survive the
        // modal or the app restart: otherwise a half-finished or expired hosted
        // flow leaves stale state the page reloads into ("session expired" on a
        // supposedly-fresh start, requiring a manual data clear).
        incognito: true,
        ref: webViewRef,
        key: retryKey,
        // #28 single-WebView: load the skeleton HTML, which `location.replace()`s
        // to the hosted URL after it paints. ONE WebView shows the skeleton then
        // the page — no separate overlay instance, no slide, no jump. The skeleton
        // stays visible during the network load until the hosted page paints.
        source: { html: authSkeletonHtml(socialCount, t, currentUrl) },
        onError: handleError,
        onMessage: handleMessage,
        injectedJavaScript: OAUTH_RELAY_SCRIPT,
        onShouldStartLoadWithRequest: handleShouldStartLoad,
        onNavigationStateChange: handleNavChange,
        style: styles.webview,
        // Native WebView bg (separate from style) — react-native-webview paints
        // white by default before first paint; set it to the branding bg to kill
        // the flash on both iOS and Android.
        backgroundColor: bg,
      }),
      // #27 — ✕ shown ONLY on the store ("Choose your plan"), never on the entry
      // sign-in form. Reached via "Sign Up" → it steps BACK to the sign-in form
      // (has history); reached as the entry page (signed-in-but-unentitled) → it
      // cancels out (no history). Either way the user is never trapped. Rendered
      // LAST so it sits on top of the WebView + skeleton overlay (pointerEvents:none).
      // #40 Phase 2 — FAIL-SAFE only: once the hosted store page posts
      // `onelo:ready`, ITS canonical ✕ (StoreExitX) takes over and this hides,
      // so the two stop overlapping (reported 2026-08-20).
      !error && showNativeStoreClose && React.createElement(TouchableOpacity, {
        style: styles.closeButton,
        onPress: handleBackOrCancel,
        accessibilityRole: 'button',
        accessibilityLabel: canGoBack ? 'Back' : 'Close',
        hitSlop: { top: 8, bottom: 8, left: 8, right: 8 },
      },
        React.createElement(Text, { style: styles.closeText }, '✕')
      ),
      error && React.createElement(View, { style: styles.errorContainer },
        React.createElement(TouchableOpacity, { style: styles.retryButton, onPress: handleRetry },
          React.createElement(Text, { style: styles.retryText }, 'Sign In')
        ),
        React.createElement(TouchableOpacity, { style: styles.cancelButton, onPress: handleCancel },
          React.createElement(Text, { style: styles.cancelText }, 'Cancel')
        )
      )
    )
  )
}
