import React, { useState, useEffect, useCallback } from 'react'
import type { OneloFeedback } from './feedback'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const require: (id: string) => any

interface FeedbackModalProps {
  feedback: OneloFeedback
}

const SKELETON_HTML = `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#111;font-family:-apple-system,sans-serif;padding:40px 36px 32px;overflow:hidden}
@keyframes shimmer{0%{background-position:-600px 0}100%{background-position:600px 0}}
.sk{border-radius:10px;background:linear-gradient(90deg,#1e1e1e 25%,#2a2a2a 50%,#1e1e1e 75%);background-size:600px 100%;animation:shimmer 1.4s infinite linear}
.icon{width:64px;height:64px;border-radius:14px;margin:0 auto 16px}
.title{width:220px;height:22px;margin:0 auto 40px;border-radius:6px}
.cards{display:flex;gap:12px;margin-bottom:32px}
.card{flex:1;height:76px;border-radius:12px}
.label{width:60px;height:13px;border-radius:4px;margin-bottom:8px}
.input{width:100%;height:44px;border-radius:10px;margin-bottom:24px}
.textarea{width:100%;height:110px;border-radius:10px;margin-bottom:32px}
.btn{width:100%;height:48px;border-radius:12px}
</style></head><body>
<div class="sk icon"></div><div class="sk title"></div>
<div class="cards"><div class="sk card"></div><div class="sk card"></div><div class="sk card"></div></div>
<div class="sk label"></div><div class="sk input"></div>
<div class="sk label"></div><div class="sk textarea"></div>
<div class="sk btn"></div>
</body></html>`

// #40 Phase 2 — relay the hosted feedback page's postMessages to the RN bridge:
//   • onelo:feedback_submitted — submit auto-closed (existing).
//   • onelo:feedback_close     — user tapped the hosted (canonical) ✕ → dismiss.
//   • onelo:ready              — hosted page mounted → hide the native fail-safe ✕.
// Mirrors Swift's OneloFeedback relayScript (3.71.7).
const RELAY_JS = `
(function() {
  window.addEventListener('message', function(e) {
    if (!window.ReactNativeWebView || !e.data || !e.data.type) return;
    if (e.data.type === 'onelo:feedback_submitted' ||
        e.data.type === 'onelo:feedback_close' ||
        e.data.type === 'onelo:ready') {
      window.ReactNativeWebView.postMessage(JSON.stringify(e.data));
    }
  });
})();
true;
`

export function FeedbackModal({ feedback }: FeedbackModalProps) {
  const RN = require('react-native')
  const { WebView } = require('react-native-webview')
  const { Modal, View, StyleSheet, Platform, StatusBar, TouchableOpacity, Text } = RN

  const [url, setUrl] = useState<string | null>(feedback.getCurrentUrl())
  const [visible, setVisible] = useState(feedback.isVisible())
  // #40 Phase 2 — true once the hosted page posts `onelo:ready`. While false, the
  // native ✕ acts as a FAIL-SAFE for the pre-load / error window; once true the
  // hosted page's canonical ✕ owns the affordance and the native one hides.
  const [hostedReady, setHostedReady] = useState(false)
  // #44 — arm the native fail-safe ✕ only after a ~3.5s grace (or on a load error).
  // A normal fast load posts `onelo:ready` first, so `hostedReady` flips before this
  // and the native ✕ never flashes.
  const [failSafeArmed, setFailSafeArmed] = useState(false)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    const unsub = feedback.subscribe((nextUrl, nextVisible) => {
      setUrl(nextUrl)
      setVisible(nextVisible)
    })
    return unsub
  }, [feedback])

  // #44 — reset the ready/fail-safe state on each open (and when the real URL
  // replaces the skeleton) and arm the grace timer. Cleared on unmount / re-open.
  useEffect(() => {
    if (!visible) return
    setHostedReady(false)
    setFailSafeArmed(false)
    setLoadError(false)
    const t = setTimeout(() => setFailSafeArmed(true), 3500)
    return () => clearTimeout(t)
  }, [visible, url])

  const handleMessage = useCallback((event: any) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data) as Record<string, unknown>
      const type = msg['type']
      // Both submit (auto-close) and the canonical hosted ✕ (Phase 2) dismiss.
      if (type === 'onelo:feedback_submitted' || type === 'onelo:feedback_close') feedback.close()
      // Hosted page mounted → hide the native fail-safe ✕.
      else if (type === 'onelo:ready') setHostedReady(true)
    } catch { /* ignore */ }
  }, [feedback])

  // #40 Phase 2 / #44 — the native fail-safe ✕ shows ONLY while the hosted page
  // hasn't confirmed it's ready AND either the grace elapsed or the load errored.
  const showNativeClose = !hostedReady && (failSafeArmed || loadError)

  // Top inset so the close control clears the status bar. On Android the
  // pageSheet Modal is full-screen and paints UNDER the status bar, so we pad by
  // its height; on iOS the sheet is a card already inset below the status bar,
  // so a small pad below the grab handle is enough.
  const topInset = Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 8

  // Branding page background (--onelo-page-bg) — matches the hosted feedback page
  // so the WebView never flashes white before it paints. Default #111111.
  const bg = feedback.getPageBackgroundColor()

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: bg },
    // Visible, always-present close affordance — parity with Swift's toolbar
    // "Close" button (OneloFeedback.swift). Works IDENTICALLY on iOS + Android;
    // no reliance on the Android Back gesture or the iOS swipe-to-dismiss (which
    // is absent on Android's full-screen pageSheet — the UX gap this closes).
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      // Close (✕) trailing / top-right — the single unified close position across
      // every Onelo modal + SDK (coexists with the portal's leading "‹ Back").
      justifyContent: 'flex-end',
      paddingTop: topInset,
      paddingHorizontal: 8,
      height: 48 + topInset,
      backgroundColor: bg,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: '#262626',
    },
    closeBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    closeIcon: { color: '#ffffff', fontSize: 22, fontWeight: '400', lineHeight: 24 },
    webview: { flex: 1, backgroundColor: bg },
  })

  return React.createElement(Modal, {
    visible,
    animationType: 'slide',
    presentationStyle: 'pageSheet',
    onRequestClose: () => feedback.close(),
  },
    React.createElement(View, { style: styles.container },
      // Header with a close (✕), trailing (top-right) — the single unified close
      // position across every Onelo modal + SDK. Same control on iOS + Android.
      // #40 Phase 2 — the native ✕ is now a FAIL-SAFE: shown only during the
      // pre-load / error window (see `showNativeClose`). Once the hosted page posts
      // `onelo:ready`, its canonical ✕ takes over and this hides. The bar itself is
      // kept (preserves the status-bar top inset + avoids layout shift); an empty
      // spacer holds its place when the ✕ is hidden.
      React.createElement(View, { style: styles.header },
        showNativeClose
          ? React.createElement(TouchableOpacity, {
              onPress: () => feedback.close(),
              style: styles.closeBtn,
              accessibilityRole: 'button',
              accessibilityLabel: 'Close feedback',
              hitSlop: { top: 8, bottom: 8, left: 8, right: 8 },
            },
              React.createElement(Text, { style: styles.closeIcon, allowFontScaling: false }, '✕')
            )
          : React.createElement(View, { style: styles.closeBtn })
      ),
      // Always render WebView: shows skeleton HTML until real URL loads
      React.createElement(WebView, {
        source: url ? { uri: url } : { html: SKELETON_HTML },
        onMessage: handleMessage,
        // #44 — a load error reveals the native fail-safe ✕ immediately (no grace
        // wait) so the user is never trapped with no way out on a failed hosted page.
        onError: () => setLoadError(true),
        injectedJavaScript: RELAY_JS,
        style: styles.webview,
        backgroundColor: bg,
      })
    )
  )
}
