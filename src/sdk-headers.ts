import { version as SDK_VERSION } from '../package.json'
import { getInstanceId } from './core/instance-id'
import { getCachedAttestToken, getCachedIntegrityToken, getAssertionHeaders } from './attest'

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
 * - `X-Onelo-Sdk-Name`         — always `onelo-react-native` (WHICH SDK, registry key; #122)
 * - `X-Onelo-Sdk-Platform`     — always `react-native` (discovery language tag)
 * - `X-Onelo-OS`               — `ios` | `android` (WHICH OS, resolved at
 *                                runtime). Distinct from the header above on
 *                                purpose: one React Native codebase ships to
 *                                both stores, and Apple's App Review rules
 *                                apply to exactly one of them.
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
 * - `X-Integrity-Token` — Android Google Play Integrity JWT, ONCE a device has
 *                        completed the exchange (see `attest.ts`). Same
 *                        synchronous in-memory read as the attest token above.
 *                        Null on iOS and before the first successful exchange.
 *
 * Async because the instance id is Keychain-backed. Every caller already runs
 * inside an async function — `await sdkHeaders(...)`.
 */
let _nativeBundleId: string | null | undefined = undefined
/**
 * The app's bundle id from the native module — `Bundle.main.bundleIdentifier` on
 * iOS, `Context.getPackageName()` on Android (both via `NativeModules.OneloAttest`)
 * — or null when the native module isn't linked. Memoized. Lets `X-Bundle-Id`
 * auto-derive on both platforms so a developer needn't set `bundleId` in config —
 * parity with the Flutter SDK (which reads it from PackageInfo). Without this,
 * omitting `bundleId` silently 403s every request (bundle_id_mismatch) once
 * enforcement is active.
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

/**
 * The OS this bundle is actually running on — `ios` | `android`, or `unknown`
 * outside React Native (plain-Node tests).
 *
 * Needed because `X-Onelo-Sdk-Platform: react-native` says nothing about the
 * store the app ships through, and App Review guideline 3.1.1 governs iOS only.
 * `/api/sdk/config` reads this to decide whether the "Require plan on sign-up"
 * gate applies (applications.paywall_gate_on_apple). Without it, an RN developer
 * could set "sign-in only on Apple" in the dashboard and have it silently do
 * nothing on their iOS build.
 */
function currentOS(): string {
  try {
    // Lazy require — same reason as getNativeBundleId above.
    const rn = require('react-native') as { Platform?: { OS?: string } }
    return rn.Platform?.OS ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

export async function sdkHeaders(
  bundleId?: string,
  publishableKey?: string,
  assertion?: AssertionContext,
): Promise<Record<string, string>> {
  const instanceId = await getInstanceId()
  const attestToken = getCachedAttestToken()
  const integrityToken = getCachedIntegrityToken()
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
    // WHICH SDK, by registry key (#122): the dashboard compares X-SDK-Version
    // against LATEST_SDK_VERSIONS[this] instead of guessing from app_type.
    'X-Onelo-Sdk-Name': 'onelo-react-native',
    'X-Onelo-Instance-Id': instanceId,
    'X-Onelo-Sdk-Platform': 'react-native',
    'X-Onelo-OS': currentOS(),
    ...(resolvedBundleId ? { 'X-Bundle-Id': resolvedBundleId } : {}),
    ...(publishableKey ? { 'X-Publishable-Key': publishableKey } : {}),
    ...(attestToken ? { 'X-Attest-Token': attestToken } : {}),
    ...(integrityToken ? { 'X-Integrity-Token': integrityToken } : {}),
    ...(assertionHeaders ?? {}),
  }
}
