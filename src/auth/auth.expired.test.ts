import { describe, it, expect } from 'vitest'
import { isExpiredAuthError } from './auth-modal'

/**
 * `?error=invalid_token` must be classified as EXPIRED, never as an error.
 *
 * It is what "Use a different account" on the no-plan page sends after signing
 * the user out, and what an idle expiry sends. Treating it as an error closed
 * the modal and showed the user the literal string "invalid_token" instead of a
 * fresh sign-in form. Parity with Swift's `onSessionExpired`.
 *
 * This calls the SDK's own function. The first version of this file defined its
 * own copy of the rule and asserted against that — it stayed green no matter
 * what the SDK did, which is worse than having no test.
 */
describe('isExpiredAuthError', () => {
  it.each(['invalid_token', 'expired_token', 'token_expired'])(
    'treats %s as expired',
    (code) => expect(isExpiredAuthError(code)).toBe(true),
  )

  it('leaves a genuine failure as an error', () => {
    // Not a catch-all — reloading on every error would loop on a real failure.
    expect(isExpiredAuthError('attest_invalid')).toBe(false)
    expect(isExpiredAuthError('access_denied')).toBe(false)
  })

  it('handles absent values without claiming expiry', () => {
    expect(isExpiredAuthError(null)).toBe(false)
    expect(isExpiredAuthError(undefined)).toBe(false)
    expect(isExpiredAuthError('')).toBe(false)
  })
})
