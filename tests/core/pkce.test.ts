import { describe, it, expect, vi } from 'vitest'
import { generateCodeVerifier, generateCodeChallenge } from '../../src/core/pkce'

describe('PKCE (React Native / js-sha256)', () => {
  it('generateCodeVerifier returns a base64url string', () => {
    const v = generateCodeVerifier()
    expect(v).toMatch(/^[A-Za-z0-9\-_]+$/)
    expect(v.length).toBeGreaterThanOrEqual(43)
  })

  it('produces a distinct verifier each call (secure random via crypto.getRandomValues, not Math.random)', () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateCodeVerifier()))
    expect(seen.size).toBe(50) // 32 secure-random bytes → collisions are effectively impossible
  })

  it('throws a clear, actionable error when secure random is unavailable — NEVER silently downgrades to Math.random', () => {
    vi.stubGlobal('crypto', undefined)
    try {
      expect(() => generateCodeVerifier()).toThrow(/react-native-get-random-values/)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('generateCodeChallenge returns a base64url string', () => {
    const v = generateCodeVerifier()
    const c = generateCodeChallenge(v)
    expect(c).toMatch(/^[A-Za-z0-9\-_]+$/)
    expect(c).not.toBe(v)
  })

  it('same verifier always produces same challenge', () => {
    const v = 'test-verifier-string'
    expect(generateCodeChallenge(v)).toBe(generateCodeChallenge(v))
  })
})
