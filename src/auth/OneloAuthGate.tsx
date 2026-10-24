import React, { useState, useEffect, useRef, useCallback } from 'react'
import { OneloError } from '@onelo/core'
import type { Onelo } from '../onelo'
import { AuthModal } from './auth-modal'
import { AuthSkeleton } from './auth-skeleton'
import { chromeStyles } from '../core/brand'
import { useModalState } from './hooks'
import { completeLaunchUrl } from './launch-url'
import { resolveGateState } from './gate-state'

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
  /** Signed in but not allowed in — a session exists, entitlement does not.
   *  Whatever the hosted flow shows such a caller (store, "no active plan") is
   *  never the sign-in form, so the pre-auth surface must not promise one. */
  signedIn: boolean
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
  const { View, StyleSheet, TouchableOpacity, Text, AppState, Linking } = RN

  const [state, setState] = useState<GateState>({ resolved: false, allowedIn: false, signedIn: false })
  // #36 — true while a stored session MIGHT still be restoring on cold start.
  // Seeded true so the VERY FIRST paint is a neutral branded background, never
  // the sign-in skeleton. A fast `hasStoredSession()` probe flips it false the
  // instant we know there is NO stored session (→ genuine cold start shows the
  // skeleton immediately, parity with Swift's synchronous `hasStoredSessionSync`
  // 3-state gate); otherwise `recompute()` clears it when the gate resolves. The
  // net effect: an auto-login shows branded-bg → content with NO skeleton flash.
  const [restoring, setRestoring] = useState(true)
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

  /** Recompute the gate from the current session. `allowedIn` is the session's
   *  stored server answer (revalidateEntitlement republishes it on change). */
  const recompute = useCallback(async () => {
    // The server's answer (`allowed_in`), never a local copy of the rule — see
    // gate-state.ts for the user the local copy let in (#819).
    const { signedIn, allowedIn } = await resolveGateState(onelo.auth)
    if (!mountedRef.current) return
    setState({ resolved: true, allowedIn, signedIn })
    // #36 — the gate has resolved; the branded restore splash is done in every
    // case (allowed-in → content; not allowed → the driveFlow effect below opens
    // the hosted flow behind the skeleton/retry surface).
    setRestoring(false)
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

    // #36 — probe for a stored session WITHOUT the full recompute cost (config
    // wait + possible token refresh). A definite "no stored session" flips the
    // branded restore splash off immediately so a genuine cold start shows the
    // sign-in skeleton right away; a present (or slow) session stays on the
    // branded background until recompute resolves → no sign-in skeleton flash on
    // auto-login. recompute() clears `restoring` on every other path.
    onelo.auth
      .hasStoredSession()
      .then((has) => { if (mountedRef.current && !has) setRestoring(false) })
      .catch(() => { if (mountedRef.current) setRestoring(false) })

    // #542 — complete a launch URL (a same-device magic link after the app
    // was killed) BEFORE the gate resolves; see `completeLaunchUrl`.
    const launchHandled = completeLaunchUrl(onelo.auth, Linking, (e) => {
      if (mountedRef.current) setRetry({ message: errorMessage(e) })
    })

    void launchHandled.then(recompute)
    // A just-completed external purchase may have landed while the app was
    // backgrounded / before this mounted — pull the fresh entitlement now.
    void launchHandled.then(() => onelo.auth.revalidateEntitlement()).then(recompute).catch(() => {})

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

    // A hosted flow that finishes OUTSIDE the built-in <AuthModal> — a magic
    // link opened in the system browser — has to land somewhere even while
    // that modal is unmounted/invisible: its OWN `Linking` listener only runs
    // `if (visible)` (auth-modal.tsx), so before this the refusal/code was
    // silently dropped unless the developer wired `onelo.auth.handleAuthCallback`
    // themselves at their own app root (2026-08-20 — the SAME failure already
    // fixed on Swift/Electron/Android/Flutter). `OneloAuthGate` is the flagship,
    // "nothing else to wire" entry point, so it owns this instead of leaving it
    // to be documented as a manual step.
    //
    // Runs for the gate's WHOLE lifetime, independent of `modal.visible` —
    // deliberately NOT scoped like AuthModal's own listener. When the modal IS
    // visible and the SAME url also reaches AuthModal's listener (a normal
    // OAuth return), `handleAuthCallback` finds nothing parked (AuthModal's own
    // handler already consumed it via `_modalResolve`, which nulls itself out
    // synchronously before its first await) and its fallback direct-exchange
    // attempt fails on the now-already-used one-time code — caught here and
    // dropped, never surfaced as an unhandled rejection.
    const onUrl = (event: { url: string }) => {
      if (event?.url) void onelo.auth.handleAuthCallback(event.url).catch(() => {})
    }
    const linkingSub =
      Linking && typeof Linking.addEventListener === 'function'
        ? Linking.addEventListener('url', onUrl)
        : undefined

    return () => {
      mountedRef.current = false
      unsubAuth()
      if (appSub && typeof appSub.remove === 'function') appSub.remove()
      else if (AppState && typeof AppState.removeEventListener === 'function') {
        AppState.removeEventListener('change', handleAppState)
      }
      if (linkingSub && typeof linkingSub.remove === 'function') linkingSub.remove()
      else if (Linking && typeof Linking.removeEventListener === 'function') {
        Linking.removeEventListener('url', onUrl)
      }
    }
    // AppState/Linking come from the lazily-required RN module (stable across
    // renders); recompute is the only reactive dependency.
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

  // #26/#681 — the pre-auth restore / retry surface is painted from the brand
  // tokens (page ground, retry button, error colour), matching the hosted page +
  // the AuthModal. Neutral before config resolves.
  const t = onelo.auth.brandTokens()
  const bg = t.page_bg
  const c = chromeStyles(t)
  const styles = StyleSheet.create({
    // #36 — the cold-start restore splash: the branding page background ONLY, no
    // form, no skeleton, no spinner. Reads as "opening…" for an auto-login rather
    // than flashing the sign-in form. Mirrors Swift's neutral branded background.
    restoringContainer: { flex: 1, backgroundColor: bg },
    retryContainer: { flex: 1, backgroundColor: bg, justifyContent: 'center', alignItems: 'center', gap: 16, padding: 32 },
    errorText: c.errorText,
    retryButton: c.retryButton,
    retryText: c.retryText,
  })

  const handleRetry = useCallback(() => setRetry(null), [])

  // Pre-auth surface. #36 — while a stored session may still be restoring on cold
  // start (before the gate resolves and before a definite no-session is known),
  // show ONLY the neutral branded background: no sign-in skeleton, no form, no
  // spinner. This is what stops the auto-login skeleton flash. Once restore
  // settles (`recompute` resolves) or a definite no-session is probed, we fall
  // through to the retry prompt / loading skeleton (custom `fallback` or the
  // auth-shaped skeleton). Never `children`.
  const preAuth = (restoring && !state.resolved) || (state.signedIn && !state.allowedIn && !retry)
    ? React.createElement(View, { style: styles.restoringContainer })
    : retry
    ? React.createElement(View, { style: styles.retryContainer },
        retry.message
          ? React.createElement(Text, { style: styles.errorText }, retry.message)
          : null,
        React.createElement(TouchableOpacity, { style: styles.retryButton, onPress: handleRetry },
          React.createElement(Text, { style: styles.retryText }, 'Sign In')
        )
      )
    : (fallback ??
        // #26 part B — auth-shaped loading skeleton (was a bare spinner), matching
        // the hosted page's own skeleton so the transition has no jump. social-aware.
        React.createElement(AuthSkeleton, {
          socialCount: onelo.auth.oauthProviders.length,
          magicLink: onelo.auth.magicLinkEnabled,
          tokens: t,
        }))

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
      // Brand tokens (#681) — the modal's ground, skeleton and ✕ chip. Resolved
      // from config, which is ready before loadAuthView() opens the modal.
      tokens: onelo.auth.brandTokens(),
      // #26 part B — social-pill count for the loading skeleton so it matches
      // what the hosted form will render.
      socialCount: onelo.auth.oauthProviders.length,
      magicLink: onelo.auth.magicLinkEnabled,
      // Deep-link scheme (config.callbackScheme, default 'onelorn') so OAuth returns
      // from the system browser reopen the app and complete sign-in.
      callbackScheme: onelo.auth.callbackScheme,
    })
  )
}
