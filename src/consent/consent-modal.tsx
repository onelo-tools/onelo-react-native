import React, { useState, useEffect, useCallback } from 'react'
import type { OneloConsent, ConsentModalState } from './consent'
import type { BrandTokens } from '@onelo/core'
import { chromeStyles, resolveModalTokens } from '../core/brand'
import { oneloText } from '../core/texts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const require: (id: string) => any

/** Result relayed from the hosted gate page: the user's action. Only `accept`
 *  records consent; anything else (e.g. `decline`) signs the user out. */
export type ConsentResult = { action: string }

export type ParsedConsentMessage = { action: string } | null

/** Parse a WebView message into a consent action. Accepts the shape the hosted
 *  gate posts: `{type:'onelo:consent', action:'accept'|'decline'|...}`. */
export function parseConsentMessage(data: string): ParsedConsentMessage {
  try {
    const msg = JSON.parse(data) as Record<string, unknown>
    if (msg['type'] === 'onelo:consent' && typeof msg['action'] === 'string') {
      return { action: msg['action'] as string }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Injected after the gate page loads. The hosted page posts its accept/decline
 * signal to `window.parent` / `window.postMessage` / native bridges — NOT
 * necessarily to `window.ReactNativeWebView` directly — so this relay listens
 * for the `message` event and forwards a matching `onelo:consent` payload to the
 * React Native bridge, where `onMessage` picks it up. Mirrors the Electron relay.
 */
const POSTMESSAGE_RELAY_SCRIPT = `
(function () {
  window.addEventListener('message', function (e) {
    try {
      var d = e.data;
      if (typeof d === 'string') { d = JSON.parse(d); }
      if (d && d.type === 'onelo:consent' && d.action) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'onelo:consent', action: d.action }));
      }
    } catch (err) { /* ignore non-JSON page messages */ }
  });
  true;
})();
`

export interface ConsentGateModalViewProps {
  visible: boolean
  hostedUrl: string
  onResult: (result: ConsentResult) => void
  /** The app's brand tokens (#681) — ground, spinner and retry are painted from
   *  them. Pass `onelo.auth.brandTokens()`; neutral when absent. */
  tokens?: BrandTokens
  /** @deprecated Pass `tokens`. Page ground only, for pre-#681 callers. */
  backgroundColor?: string
}

/**
 * Reactive hook for rendering the consent gate modal manually via
 * <ConsentGateModalView>. Re-renders when presentGateIfNeeded() opens or closes
 * the gate.
 */
export function useConsentModalState(consent: OneloConsent): ConsentModalState {
  const [state, setState] = useState<ConsentModalState>(() => consent.getModalState())

  useEffect(() => {
    // Re-sync on mount in case the gate opened between the initial render and
    // effect setup.
    setState(consent.getModalState())
    const unsubscribe = consent.onModalStateChange(() => {
      setState(consent.getModalState())
    })
    return unsubscribe
  }, [consent])

  return state
}

export interface ConsentGateModalProps {
  onelo: { consent: OneloConsent }
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
export function ConsentGateModal({ onelo }: ConsentGateModalProps) {
  const state = useConsentModalState(onelo.consent)

  const handleResult = useCallback((result: ConsentResult) => {
    // state.onResult is the resolver installed by the gate; it clears modal
    // state, notifies listeners, and runs the accept/decline follow-up.
    state.onResult?.(result)
  }, [state.onResult])

  if (!state.visible || !state.hostedUrl) return null

  return React.createElement(ConsentGateModalView, {
    visible: state.visible,
    hostedUrl: state.hostedUrl,
    onResult: handleResult,
    tokens: state.tokens,
  })
}

/**
 * Presentational gate modal (advanced use) — render it yourself with state from
 * useConsentModalState() if you need custom mounting behaviour.
 *
 * Hard block: there is NO cancel/close button, and the Android hardware back
 * button is swallowed while the gate is visible. The only exits are Accept
 * (→ record consent) or Decline (→ sign out), both relayed from the hosted page.
 */
export function ConsentGateModalView({ visible, hostedUrl, onResult, tokens, backgroundColor }: ConsentGateModalViewProps) {
  // Brand tokens (#681) — ground matches the hosted legal page so no white
  // flash; spinner and retry from the same tokens.
  const t = resolveModalTokens(tokens, backgroundColor)
  const bg = t.page_bg
  const c = chromeStyles(t)
  const RN = require('react-native')
  const { WebView } = require('react-native-webview')
  const { Modal, View, StyleSheet, ActivityIndicator, TouchableOpacity, Text, BackHandler } = RN

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  // Bumped on retry so the WebView key changes → fresh remount+reload.
  const [retryKey, setRetryKey] = useState(0)

  // Swallow the Android hardware back button while the gate is up — a blocking
  // legal document must not be dismissible. Returning true marks the event
  // handled so RN doesn't pop the screen / background the app.
  useEffect(() => {
    if (!visible || !BackHandler?.addEventListener) return
    // Hoist the handler so add + remove use the SAME reference — the legacy
    // removeEventListener path needs identity, so a fresh `() => true` would
    // leak the swallow handler (back stays blocked app-wide after the gate).
    const swallow = () => true
    const sub = BackHandler.addEventListener('hardwareBackPress', swallow)
    // RN >=0.65 returns a subscription with .remove(); older returns void and
    // requires removeEventListener. Support both.
    return () => {
      if (sub && typeof sub.remove === 'function') sub.remove()
      else if (BackHandler.removeEventListener) BackHandler.removeEventListener('hardwareBackPress', swallow)
    }
  }, [visible, BackHandler])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleMessage = useCallback((event: any) => {
    const parsed = parseConsentMessage(event.nativeEvent.data)
    if (!parsed) return
    onResult({ action: parsed.action })
  }, [onResult])

  const handleError = useCallback(() => {
    setLoading(false)
    setError(true)
  }, [])

  const handleRetry = useCallback(() => {
    setError(false)
    setLoading(true)
    setRetryKey((k) => k + 1)
  }, [])

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: bg },
    webview: { flex: 1, backgroundColor: bg },
    overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: bg, justifyContent: 'center', alignItems: 'center' },
    errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16 },
    retryButton: c.retryButton,
    retryText: c.retryText,
  })

  return React.createElement(Modal, { visible, animationType: 'slide', presentationStyle: 'fullScreen' },
    React.createElement(View, { style: styles.container },
      !error && React.createElement(WebView, {
        key: retryKey,
        source: { uri: hostedUrl },
        onLoadEnd: () => setLoading(false),
        onError: handleError,
        onMessage: handleMessage,
        injectedJavaScript: POSTMESSAGE_RELAY_SCRIPT,
        style: styles.webview,
        backgroundColor: bg,
      }),
      loading && !error && React.createElement(View, { style: styles.overlay },
        React.createElement(ActivityIndicator, { size: 'large', color: c.spinnerColor })
      ),
      // On a load failure allow a Retry (still no Cancel — the gate stays a hard
      // block, but a network blip must not trap the user behind a blank screen).
      error && React.createElement(View, { style: styles.errorContainer },
        React.createElement(TouchableOpacity, { style: styles.retryButton, onPress: handleRetry },
          React.createElement(Text, { style: styles.retryText }, oneloText('retry'))
        )
      )
    )
  )
}
