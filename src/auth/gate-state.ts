/**
 * What `OneloAuthGate` shows: the app, or the hosted flow.
 *
 * Kept out of the component so it can be tested without a renderer, and so the
 * gate cannot grow its own copy of the Access Gate rule again. It used to
 * compute `signedIn && (!paywallEnabled || entitled)` itself — the derivation
 * the server took over in 2026-08 — and so it let a user the server withholds
 * (Email Verification required and not verified yet, #819) straight into a
 * free app. The answer is now the server's `allowed_in`, through
 * `isAllowedIn()` (which keeps its older-backend fallback).
 */
import type { OneloSession } from '@onelo/core'

export interface GateAuth {
  whenReady(): Promise<unknown>
  getSession(): Promise<OneloSession | null>
  isAllowedIn(): Promise<boolean>
}

export interface GateState {
  signedIn: boolean
  allowedIn: boolean
}

export async function resolveGateState(auth: GateAuth): Promise<GateState> {
  await auth.whenReady()
  const session = await auth.getSession()
  const signedIn = session != null
  const allowedIn = signedIn && (await auth.isAllowedIn())
  return { signedIn, allowedIn }
}
