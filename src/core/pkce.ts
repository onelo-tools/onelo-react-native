import { sha256 } from 'js-sha256'

/**
 * PKCE helpers for React Native. Same interface as `@onelo/core` pkce.ts.
 *
 * SECURITY — the `code_verifier` MUST come from a cryptographically-secure RNG
 * (RFC 7636 §7.1). We use `crypto.getRandomValues`, which on React Native is
 * backed by the platform CSPRNG (iOS `SecRandomCopyBytes` / Android
 * `SecureRandom`) via the `react-native-get-random-values` polyfill — matching
 * the Swift / JS / Electron / Android / Flutter SDKs, which all use their
 * platform CSPRNG. We NEVER fall back to `Math.random()` (a predictable,
 * non-cryptographic PRNG would let an attacker guess the verifier and defeat
 * PKCE's protection against auth-code interception). If secure random is
 * unavailable we throw a clear, actionable error rather than silently
 * downgrading security.
 *
 * SETUP (host app): install `react-native-get-random-values` and add
 *   `import 'react-native-get-random-values'`
 * as the FIRST line of your entry file (index.js), before creating the Onelo
 * client. (In Node / tests, `globalThis.crypto` is already present, so no
 * polyfill is needed there.)
 *
 * SHA-256 (the challenge) stays on pure-JS `js-sha256`: it's deterministic, needs
 * no secure RNG, and the polyfill does not provide `crypto.subtle`.
 */
export function generateCodeVerifier(): string {
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto
  if (!cryptoObj?.getRandomValues) {
    throw new Error(
      "[Onelo] Secure random is unavailable for PKCE. Install `react-native-get-random-values` " +
        "and add `import 'react-native-get-random-values'` as the FIRST line of your app entry " +
        '(index.js), before creating the Onelo client. See the Onelo SDK install snippet.',
    )
  }
  const bytes = new Uint8Array(32)
  cryptoObj.getRandomValues(bytes)
  return base64urlEncode(bytes)
}

export function generateCodeChallenge(verifier: string): string {
  const hash = sha256.arrayBuffer(verifier)
  return base64urlEncode(new Uint8Array(hash))
}

function base64urlEncode(bytes: Uint8Array): string {
  let str = ''
  for (const byte of bytes) {
    str += String.fromCharCode(byte)
  }
  return btoa(str)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}
