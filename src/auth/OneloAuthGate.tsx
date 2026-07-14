import React, { useState, useEffect, useRef, useCallback } from 'react'
import { OneloError } from '@onelo/core'
import type { Onelo } from '../onelo'
import { AuthModal } from './auth-modal'
import { useModalState } from './hooks'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const require: (id: string) => any

export interface OneloAuthGateProps {
  onelo: Onelo
  /** Protected app UI — revealed ONLY once the user is signed in and (for
   *  paywall apps) entitled. Never rendered before that resolves. */
  children: React.ReactNode
  /**
   * Optional custom UI for the pre-auth loading state (while sign-in / the
   * entitlement check is resolving, before the hosted WebView is presented).
   * Defaults to a plain neutral background with a spinner — no branded pre-auth
   * screen, per the SDK auth design rules. The hosted sign-in / store page is
   * ALWAYS rendered by the built-in <AuthModal>; this only styles the gap before it.
   */
  fallback?: React.ReactNode
}

/** Derived gate state. `resolved` gates the first paint so `children` never
 *  flash before we know whether the user is allowed in. */
interface GateState {
  resolved: boolean
  allowedIn: boolean
}

function errorMessage(e: unknown): string | undefined {
  if (e instanceof OneloError) return e.message
  if (e instanceof Error) return e.message
  return undefined
}

/**
 * Entitlement content-gate — the React Native analogue of Swift's `OneloAuthView`.
 *
 *   <OneloAuthGate onelo={onelo}>
 *     <App />
 *   </OneloAuthGate>
 *
 * Reveals `children` ONLY when `signedIn && (!paywallEnabled || entitled)` — the
 * `inApp = isAuthenticated && !needsPaywall` model from `OneloAuthView`
 * (`needsPaywall = session != null && paywallEnabled && entitlement != 'active'`).
 * Until then it never paints `children`; it shows a neutral loading background and
 * drives the CENTRALISED hosted flow via `auth.loadAuthView()` — which routes,
 * server-side (`/api/sdk/flow/init` → `resolveFlow`), to sign-in for a signed-out
 * user or the hosted STORE for a signed-in-but-unentitled one, and returns a
 * session (or `authorized`, no WebView) when access is already granted. The
 * hosted page renders inside the built-in <AuthModal> mounted here.
 *
 * Ordering mirrors Swift: auth → entitlement → then the legal-consent gate
 * presents OVER content (via `onelo.consent`, wired in `onelo.ts`; mount
 * `<ConsentGateModal onelo={onelo} />` near your root to render it). This gate
 * does not render consent and does not reveal `children` in a way that bypasses a
 * blocking consent modal — the consent modal draws on top of the app.
 *
 * Non-paywall apps gate on the session alone (their `entitlement` is always
 * `'none'`, so we must not block them on it — hence `isPaywallEnabled()`).
 */
export function OneloAuthGate({ onelo, children, fallback }: OneloAuthGateProps) {
  // React Native peer deps — loaded lazily at runtime (mirrors the other components).
  const RN = require('react-native')
  const { View, StyleSheet, ActivityIndicator, TouchableOpacity, Text, AppState } = RN

  const [state, setState] = useState<GateState>({ resolved: false, allowedIn: false })
  // Non-null while the last hosted flow ended without a session (cancel/error):
  // surfaces a retry affordance instead of immediately re-opening the WebView
  // (parity with the Swift retry state). Cleared by the user tapping "Sign In".
  const [retry, setRetry] = useState<{ message?: string } | null>(null)

  // Modal state for the hosted sign-in / store WebView, driven by loadAuthView().
  const modal = useModalState(onelo.auth)

  // Single-flight guard: loadAuthView()'s promise stays pending for the WHOLE
  // WebView lifetime (until code exchange or cancel), so this ref also prevents
  // re-triggering the flow while the modal is up.
  const flowInFlight = useRef(false)
  const mountedRef = useRef(true)

  /** Recompute the gate from the current session. `entitled` reads the session's
   *  cached entitlement (revalidateEntitlement republishes it on change). */
  const recompute = useCallback(async () => {
    await onelo.auth.whenReady()
    const session = await onelo.auth.getSession()
    const signedIn = session != null
    const paywallEnabled = onelo.auth.isPaywallEnabled()
    const entitled = session?.user.entitlement === 'active'
    const allowedIn = signedIn && (!paywallEnabled || entitled)
    if (!mountedRef.current) return
    setState({ resolved: true, allowedIn })
  }, [onelo])

  /** Open the centralised hosted flow (sign-in or store). loadAuthView resolves
   *  with a session (signed in / already-authorized) or null (cancelled). */
  const driveFlow = useCallback(async () => {
    if (flowInFlight.current) return
    flowInFlight.current = true
    try {
      const session = await onelo.auth.loadAuthView()
      // Cancelled without completing → show a retry button rather than looping
      // straight back into the WebView. A completed flow leaves a session; the
      // recompute() in `finally` (and the onAuthStateChange bridge) reveals content.
      if (mountedRef.current && session == null) setRetry({})
    } catch (e) {
      if (mountedRef.current) setRetry({ message: errorMessage(e) })
    } finally {
      flowInFlight.current = false
      await recompute()
    }
  }, [onelo, recompute])

  // Mount: resolve initial state, subscribe to auth changes, and revalidate the
  // entitlement (on mount + on every foreground) so a purchase completed OUTSIDE
  // the app — an external-browser upgrade, a web checkout — flips the gate.
  useEffect(() => {
    mountedRef.current = true

    void recompute()
    // A just-completed external purchase may have landed while the app was
    // backgrounded / before this mounted — pull the fresh entitlement now.
    void onelo.auth.revalidateEntitlement().then(recompute).catch(() => {})

    // Reveal / re-gate on sign-in, sign-out, and entitlement republish.
    const unsubAuth = onelo.auth.onAuthStateChange(() => {
      void recompute()
    })

    // Foreground → revalidate entitlement (parity with Swift's app-resume check).
    const handleAppState = (next: string) => {
      if (next === 'active') {
        void onelo.auth.revalidateEntitlement().then(recompute).catch(() => {})
      }
    }
    // RN >=0.65 returns a subscription with .remove(); older returns void and
    // needs removeEventListener. Support both (mirrors consent-modal's BackHandler).
    const appSub =
      AppState && typeof AppState.addEventListener === 'function'
        ? AppState.addEventListener('change', handleAppState)
        : undefined

    return () => {
      mountedRef.current = false
      unsubAuth()
      if (appSub && typeof appSub.remove === 'function') appSub.remove()
      else if (AppState && typeof AppState.removeEventListener === 'function') {
        AppState.removeEventListener('change', handleAppState)
      }
    }
    // AppState comes from the lazily-required RN module (stable across renders);
    // recompute is the only reactive dependency.
  }, [onelo, recompute]) // eslint-disable-line react-hooks/exhaustive-deps

  // Drive the hosted flow whenever we're resolved, not allowed in, and not
  // resting on a retry prompt. onAuthStateChange → recompute flips `allowedIn`
  // and unwinds this. driveFlow's own guard prevents concurrent opens.
  useEffect(() => {
    if (!state.resolved) return
    if (state.allowedIn) return
    if (retry) return
    void driveFlow()
  }, [state.resolved, state.allowedIn, retry, driveFlow])

  const styles = StyleSheet.create({
    fill: { flex: 1, backgroundColor: '#000000', justifyContent: 'center', alignItems: 'center' },
    retryContainer: { flex: 1, backgroundColor: '#000000', justifyContent: 'center', alignItems: 'center', gap: 16, padding: 32 },
    errorText: { color: '#ff6b6b', fontSize: 13, textAlign: 'center' },
    retryButton: { backgroundColor: '#ffffff', paddingHorizontal: 32, paddingVertical: 14, borderRadius: 8 },
    retryText: { color: '#000000', fontSize: 16, fontWeight: '600' },
  })

  const handleRetry = useCallback(() => setRetry(null), [])

  // Pre-auth surface: retry prompt after a cancel/error, otherwise the neutral
  // loading background (custom `fallback` or a plain spinner). Never `children`.
  const preAuth = retry
    ? React.createElement(View, { style: styles.retryContainer },
        retry.message
          ? React.createElement(Text, { style: styles.errorText }, retry.message)
          : null,
        React.createElement(TouchableOpacity, { style: styles.retryButton, onPress: handleRetry },
          React.createElement(Text, { style: styles.retryText }, 'Sign In')
        )
      )
    : (fallback ??
        React.createElement(View, { style: styles.fill },
          React.createElement(ActivityIndicator, { size: 'large', color: '#ffffff' })
        ))

  // AuthModal is always mounted so the hosted WebView can appear the instant
  // loadAuthView() opens it; it renders nothing while `modal.visible` is false.
  return React.createElement(React.Fragment, null,
    state.allowedIn ? children : preAuth,
    React.createElement(AuthModal, {
      visible: modal.visible,
      hostedUrl: modal.url,
      onResult: modal.onResult ?? (() => {}),
      // Enables the native_oauth{provider,token} message-relay hand-off (builds the
      // system-browser OAuth URL from the backend base). Nav-diversion works without
      // it, but this activates the full OAuth path inside the gate.
      apiUrl: onelo.auth.baseUrl,
      // Branding page background — the hosted auth page paints this behind its card,
      // so the WebView shows it (not white) while loading. Resolved from config,
      // which is ready before loadAuthView() opens the modal.
      backgroundColor: onelo.auth.pageBackgroundColor(),
      // Deep-link scheme (config.callbackScheme, default 'onelorn') so OAuth returns
      // from the system browser reopen the app and complete sign-in.
      callbackScheme: onelo.auth.callbackScheme,
    })
  )
}
