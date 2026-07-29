import { version as SDK_VERSION } from '../package.json'
import { getInstanceId } from './core/instance-id'
import { getCachedAttestToken, getAssertionHeaders } from './attest'

/**
 * Request context for a per-request App Attest assertion (FAZA 3). When passed,
 * `sdkHeaders` attaches X-Attest-Key-Id/Assertion/Challenge bound to THIS exact
 * request (method+path+query+body). `body` MUST be the exact JSON string sent on
 * the wire. Omit for endpoints that don't carry an assertion (the legacy
 * X-Attest-Token bearer still applies). See app/lib/attest_gate.py.
 */
export interface AssertionContext {
  method: string
  path: string       // "/api/sdk/..." (absolute, leading slash — matches server request.url.path)
  query?: string     // raw query string, no leading "?"
  body?: string      // exact request body bytes as a string ("" for GET/no-body)
}

/**
 * Returns the common security headers to include in every SDK HTTP request —
 * the React Native port of Swift's `applySecurityHeaders` (`OneloHTTPClient.swift:24`).
 *
 * Always sent:
 * - `X-SDK-Version`             — SDK version string
 * - `X-Onelo-Instance-Id`      — per-install UUID (TOFU device binding)
 * - `X-Onelo-Sdk-Platform`     — always `react-native`
 *
 * Conditionally sent:
 * - `X-Bundle-Id`      — when `bundleId` is configured (backend
 *                        `validate_sdk_request_security` requires it)
 * - `X-Publishable-Key`— ONLY when `publishableKey` is passed. Header duality
 *                        (Subtle guard #16): shared-module calls omit the key
 *                        (it travels in the request body); auth/consent calls
 *                        that need bearer-scoped identity pass it here.
 * - `X-Attest-Token`   — iOS App Attest JWT, ONCE a device has attested (see
 *                        `attest.ts`). Read synchronously from the in-memory
 *                        cache — no await, no network — so it costs nothing on
 *                        platforms/requests without a token. Because EVERY
 *                        transport builds its headers here, wiring it in one
 *                        place makes it ride every request (the Swift/macOS
 *                        lesson was a token that was computed but never sent).
 *                        Null on Android and before the first attestation.
 *
 * Async because the instance id is Keychain-backed. Every caller already runs
 * inside an async function — `await sdkHeaders(...)`.
 */
let _nativeBundleId: string | null | undefined = undefined
/**
 * The app's bundle id from the native module (iOS: `Bundle.main.bundleIdentifier`
 * via `NativeModules.OneloAttest`), or null on Android / when the native module
 * isn't linked. Memoized. Lets `X-Bundle-Id` auto-derive so a developer needn't
 * set `bundleId` in config on iOS — parity with the Flutter SDK (which reads it
 * from PackageInfo). Without this, omitting `bundleId` silently 403s every
 * request (bundle_id_mismatch) once enforcement is active.
 */
export async function getNativeBundleId(): Promise<string | null> {
  if (_nativeBundleId !== undefined) return _nativeBundleId
  try {
    // Lazy require so plain-Node tests (no react-native) don't crash — same
    // pattern as attest.ts's native-module access.
    const rn = require('react-native') as {
      NativeModules?: Record<string, { getBundleId?: () => Promise<string> }>
    }
    const mod = rn.NativeModules?.['OneloAttest']
    _nativeBundleId = mod?.getBundleId ? ((await mod.getBundleId()) || null) : null
  } catch {
    _nativeBundleId = null
  }
  return _nativeBundleId
}

export async function sdkHeaders(
  bundleId?: string,
  publishableKey?: string,
  assertion?: AssertionContext,
): Promise<Record<string, string>> {
  const instanceId = await getInstanceId()
  const attestToken = getCachedAttestToken()
  // Prefer the explicit config value; fall back to the native bundle id (iOS) so
  // X-Bundle-Id is sent even when the dev didn't configure `bundleId`.
  const resolvedBundleId = bundleId ?? (await getNativeBundleId())
  // FAZA 3 — per-request assertion (iOS App Attest). When present it SUPERSEDES
  // the bearer server-side; nil (no key / Android / offline) → the bearer below
  // still applies. Sent alongside the bearer — the backend prefers the assertion.
  const assertionHeaders = assertion
    ? await getAssertionHeaders(assertion.method, assertion.path, assertion.query ?? '', assertion.body ?? '')
    : null
  return {
    'X-SDK-Version': SDK_VERSION,
    'X-Onelo-Instance-Id': instanceId,
    'X-Onelo-Sdk-Platform': 'react-native',
    ...(resolvedBundleId ? { 'X-Bundle-Id': resolvedBundleId } : {}),
    ...(publishableKey ? { 'X-Publishable-Key': publishableKey } : {}),
    ...(attestToken ? { 'X-Attest-Token': attestToken } : {}),
    ...(assertionHeaders ?? {}),
  }
}
