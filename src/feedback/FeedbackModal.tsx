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

const RELAY_JS = `
(function() {
  window.addEventListener('message', function(e) {
    if (window.ReactNativeWebView && e.data && e.data.type === 'onelo:feedback_submitted') {
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

  useEffect(() => {
    const unsub = feedback.subscribe((nextUrl, nextVisible) => {
      setUrl(nextUrl)
      setVisible(nextVisible)
    })
    return unsub
  }, [feedback])

  const handleMessage = useCallback((event: any) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data) as Record<string, unknown>
      if (msg['type'] === 'onelo:feedback_submitted') feedback.close()
    } catch { /* ignore */ }
  }, [feedback])

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
      // Header with a visible close (✕), trailing (top-right) — the single unified
      // close position across every Onelo modal + SDK. Same control on iOS + Android.
      React.createElement(View, { style: styles.header },
        React.createElement(TouchableOpacity, {
          onPress: () => feedback.close(),
          style: styles.closeBtn,
          accessibilityRole: 'button',
          accessibilityLabel: 'Close feedback',
          hitSlop: { top: 8, bottom: 8, left: 8, right: 8 },
        },
          React.createElement(Text, { style: styles.closeIcon, allowFontScaling: false }, '✕')
        )
      ),
      // Always render WebView: shows skeleton HTML until real URL loads
      React.createElement(WebView, {
        source: url ? { uri: url } : { html: SKELETON_HTML },
        onMessage: handleMessage,
        injectedJavaScript: RELAY_JS,
        style: styles.webview,
        backgroundColor: bg,
      })
    )
  )
}
