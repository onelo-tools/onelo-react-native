import React, { useState, useEffect, useCallback } from 'react'
import type { OneloFeedback } from './feedback'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const require: (id: string) => any

interface FeedbackModalProps {
  feedback: OneloFeedback
}

export function FeedbackModal({ feedback }: FeedbackModalProps) {
  const RN = require('react-native')
  const { WebView } = require('react-native-webview')
  const { Modal, View, StyleSheet, ActivityIndicator } = RN

  const [url, setUrl] = useState<string | null>(feedback.getCurrentUrl())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = feedback.subscribe((next) => {
      setUrl(next)
      if (next !== null) setLoading(true)
    })
    return unsub
  }, [feedback])

  const handleMessage = useCallback((event: any) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data) as Record<string, unknown>
      if (msg['type'] === 'onelo:feedback_submitted') {
        feedback.close()
      }
    } catch {
      // ignore unparseable messages
    }
  }, [feedback])

  // Injected JS: relay postMessage from the hosted page to React Native
  const injectedJavaScript = `
    (function() {
      var original = window.postMessage.bind(window);
      window.addEventListener('message', function(e) {
        if (window.ReactNativeWebView && e.data && e.data.type === 'onelo:feedback_submitted') {
          window.ReactNativeWebView.postMessage(JSON.stringify(e.data));
        }
      });
    })();
    true;
  `

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#000000' },
    webview: { flex: 1 },
    overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000000', justifyContent: 'center', alignItems: 'center' },
  })

  return React.createElement(Modal, { visible: url !== null, animationType: 'slide', presentationStyle: 'pageSheet', onRequestClose: () => feedback.close() },
    React.createElement(View, { style: styles.container },
      url !== null && React.createElement(WebView, {
        source: { uri: url },
        onLoadEnd: () => setLoading(false),
        onMessage: handleMessage,
        injectedJavaScript,
        style: styles.webview,
      }),
      loading && url !== null && React.createElement(View, { style: styles.overlay },
        React.createElement(ActivityIndicator, { size: 'large', color: '#ffffff' })
      )
    )
  )
}
