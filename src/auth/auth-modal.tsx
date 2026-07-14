import React, { useState, useCallback, useEffect, useRef } from 'react'
import {
  type ParsedOAuthMessage,
  parseOAuthMessage,
  parseCallbackDeepLink,
  isOAuthNavigation,
  withOAuthPreauth,
  buildHostedInitUrl,
  openInSystemBrowser as openBrowser,
  OAUTH_RELAY_SCRIPT,
} from './webview-oauth'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const require: (id: string) => any

/**
 * Deep-link callback scheme for OAuth + hosted redirects. Kept as a LOCAL const
 * (mirrors `store.ts` / `customer-portal.ts`) to avoid an import cycle with
 * `auth.ts`, which already imports `type ModalResult` from this file. MUST equal
 * `CALLBACK_SCHEME` in `auth.ts` / `store.ts` / `customer-portal.ts`.
 */
const CALLBACK_SCHEME = 'onelorn'

export type ModalResult =
  | { type: 'code'; code: string }
  | { type: 'cancelled' }
  | { type: 'error'; message: string }

export type ParsedMessage =
  | { type: 'code'; code: string }
  | { type: 'cancelled' }
  | null

export function parseModalMessage(data: string): ParsedMessage {
  try {
    const msg = JSON.parse(data) as Record<string, unknown>
    if (msg['type'] === 'onelo:code' && typeof msg['code'] === 'string') {
      return { type: 'code', code: msg['code'] as string }
    }
    if (msg['type'] === 'onelo:cancelled') {
      return { type: 'cancelled' }
    }
    return null
  } catch {
    return null
  }
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
  /** Branding "Page background" color (from `onelo.auth.pageBackgroundColor()`).
   *  Painted on the container + WebView + loading overlay so there is no white
   *  flash before the hosted page renders. Defaults to #111111. */
  backgroundColor?: string
  /** Deep-link callback scheme (from `onelo.auth.callbackScheme`, config-driven,
   *  default 'onelorn'). Used to catch `<scheme>://callback?…` returns in the
   *  WebView + from the system browser. Must match the natively-registered scheme. */
  callbackScheme?: string
}

export function AuthModal({ visible, hostedUrl, onResult, apiUrl, backgroundColor, callbackScheme }: AuthModalProps) {
  // Config-driven deep-link scheme (default 'onelorn'). Register it natively so a
  // system-browser return (OAuth) can reopen the app; in-WebView returns are caught
  // by handleShouldStartLoad regardless.
  const scheme = callbackScheme || CALLBACK_SCHEME
  // React Native imports — peer dependencies, loaded lazily at runtime
  const RN = require('react-native')
  const { WebView } = require('react-native-webview')
  const { Modal, View, StyleSheet, ActivityIndicator, TouchableOpacity, Text, Linking } = RN

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  // Bumped on retry so the WebView key changes → guaranteed fresh remount+reload.
  const [retryKey, setRetryKey] = useState(0)
  // The URL actually loaded. Starts at hostedUrl; a paid-store `preauth` callback
  // reloads it with ?oauth_preauth= to drive the Stripe step.
  const [currentUrl, setCurrentUrl] = useState(hostedUrl)
  // Guard against a code/error being delivered twice (nav interception +
  // onNavigationStateChange + the Linking listener can all observe the callback).
  const resolvedRef = useRef(false)

  // Reset per-open state whenever a new hosted flow is presented.
  useEffect(() => {
    setCurrentUrl(hostedUrl)
    resolvedRef.current = false
  }, [hostedUrl, visible])

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
      const { code, preauth, error: errParam } = parsed.params
      if (code) {
        resolveOnce({ type: 'code', code })
      } else if (preauth) {
        // Paid-product store flow: OAuth succeeded + account provisioned, but the
        // buyer still owes payment. Reload the hosted store page with
        // ?oauth_preauth=… (StoreClient drives Stripe from there). Does NOT
        // resolve the modal — the flow continues.
        setCurrentUrl((prev) => withOAuthPreauth(prev || hostedUrl, preauth))
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
      openInSystemBrowser(buildHostedInitUrl(apiUrl, msg.provider, msg.token))
    },
    [apiUrl, openInSystemBrowser],
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleMessage = useCallback(
    (event: any) => {
      const data: string = event.nativeEvent.data
      const parsed = parseModalMessage(data)
      if (parsed) {
        if (parsed.type === 'code') resolveOnce({ type: 'code', code: parsed.code })
        else resolveOnce({ type: 'cancelled' })
        return
      }
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

  // Branding page background — matches what the hosted auth page paints behind its
  // card (--onelo-page-bg), so the native WebView/overlay never flashes white in the
  // gap before the hosted page's own background renders. Default #111111.
  const bg = backgroundColor || '#111111'

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: bg },
    webview: { flex: 1, backgroundColor: bg },
    overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: bg, justifyContent: 'center', alignItems: 'center' },
    errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16 },
    retryButton: { backgroundColor: '#ffffff', paddingHorizontal: 32, paddingVertical: 14, borderRadius: 8 },
    retryText: { color: '#000000', fontSize: 16, fontWeight: '600' },
    cancelButton: { paddingHorizontal: 32, paddingVertical: 14 },
    cancelText: { color: '#ffffff', fontSize: 16 },
  })

  return React.createElement(Modal, { visible, animationType: 'slide', presentationStyle: 'fullScreen' },
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
        key: retryKey,
        source: { uri: currentUrl },
        onLoadEnd: () => setLoading(false),
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
      loading && !error && React.createElement(View, { style: styles.overlay },
        React.createElement(ActivityIndicator, { size: 'large', color: '#ffffff' })
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
