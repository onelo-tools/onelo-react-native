import React, { useState, useCallback } from 'react'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const require: (id: string) => any

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
}

export function AuthModal({ visible, hostedUrl, onResult }: AuthModalProps) {
  // React Native imports — peer dependencies, loaded lazily at runtime
  const RN = require('react-native')
  const { WebView } = require('react-native-webview')
  const { Modal, View, StyleSheet, ActivityIndicator, TouchableOpacity, Text } = RN

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const handleMessage = useCallback((event: any) => {
    const parsed = parseModalMessage(event.nativeEvent.data)
    if (!parsed) return
    if (parsed.type === 'code') {
      onResult({ type: 'code', code: parsed.code })
    } else {
      onResult({ type: 'cancelled' })
    }
  }, [onResult])

  const handleError = useCallback(() => {
    setLoading(false)
    setError(true)
  }, [])

  const handleRetry = useCallback(() => {
    setError(false)
    setLoading(true)
  }, [])

  const handleCancel = useCallback(() => {
    onResult({ type: 'cancelled' })
  }, [onResult])

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#000000' },
    webview: { flex: 1 },
    overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000000', justifyContent: 'center', alignItems: 'center' },
    errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16 },
    retryButton: { backgroundColor: '#ffffff', paddingHorizontal: 32, paddingVertical: 14, borderRadius: 8 },
    retryText: { color: '#000000', fontSize: 16, fontWeight: '600' },
    cancelButton: { paddingHorizontal: 32, paddingVertical: 14 },
    cancelText: { color: '#ffffff', fontSize: 16 },
  })

  return React.createElement(Modal, { visible, animationType: 'slide', presentationStyle: 'fullScreen' },
    React.createElement(View, { style: styles.container },
      !error && React.createElement(WebView, {
        source: { uri: hostedUrl },
        onLoadEnd: () => setLoading(false),
        onError: handleError,
        onMessage: handleMessage,
        style: styles.webview,
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
