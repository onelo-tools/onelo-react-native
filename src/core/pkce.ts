import { sha256 } from 'js-sha256'

/**
 * PKCE helpers using js-sha256 (pure JS).
 * React Native does not have Web Crypto API.
 * Exposes the same interface as @onelo/core pkce.ts.
 */

export function generateCodeVerifier(): string {
  const bytes = new Uint8Array(32)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Math.floor(Math.random() * 256)
  }
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
