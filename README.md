# @onelo/react-native

Onelo React Native SDK — auth, features, monitor, store, paywall, feedback, waitlist, forms, consent.

## iOS App Attest

On iOS, the SDK performs Apple **App Attest** and attaches an `X-Attest-Token`
header to **every** request (auth, event-stream/monitor, store, customer-portal,
features, consent, forms, waitlist, feedback). This proves requests come from a
genuine, unmodified build of your app. It runs automatically — there is no API to
call — and only when the backend reports the app requires it
(`attest_required` from `GET /api/sdk/config`).

Android does nothing here (Play Integrity is a separate future task).

### 1. Link the native module

The SDK ships a native iOS module (`OneloAttest`). It is picked up by React
Native **autolinking** — no manual Podfile edit:

```sh
cd ios && pod install
```

If your app uses `use_frameworks!`, App Attest still works, but ensure your
Podfile settings allow static Swift pods with a bridging header (the default
setup does).

### 2. Enable the App Attest capability

App Attest requires the **App Attest** entitlement on the host app:

- Xcode → your app target → **Signing & Capabilities** → **+ Capability** →
  **App Attest**.
- This adds `com.apple.developer.devicecheck.appattest-environment` to your
  entitlements. Use `development` for debug builds and `production` for
  TestFlight / App Store (Xcode manages this automatically for managed signing).

Without this capability, `DCAppAttestService` reports unsupported / rejects key
generation, the SDK logs the reason (search the console for `[Onelo][attest]`)
and requests simply go out without `X-Attest-Token`.

### 3. Requires a REAL device

App Attest is **not available on the iOS Simulator**. `isSupported` returns
`false` there, so attestation is skipped silently. You must smoke-test on a
physical iPhone/iPad running iOS 14+.

### 4. Smoke test

1. Run the app on a real device (Debug is fine).
2. Ensure your Onelo app has App Attest required (a registered bundle id with
   `attest_enabled = true`) so `/api/sdk/config` returns `attest_required: true`.
3. Trigger any SDK call (e.g. open the auth view, or let monitor/features run).
4. In a proxy (Charles/Proxyman) or your backend logs, confirm outgoing Onelo
   requests carry an `X-Attest-Token: <JWT>` header. The **first** couple of
   requests (the config fetch itself, and the challenge/attest round-trip) will
   NOT have it yet — the token is attached once attestation completes, then rides
   every subsequent request.
5. If the header never appears, check the Xcode console for `[Onelo][attest]`
   lines — they state exactly why (Simulator, missing capability, Apple server
   error, or a backend rejection with the HTTP status + reason).

### How it works

- `ios/OneloAttest.swift` (bridged via `ios/OneloAttest.m`) owns the DeviceCheck
  calls: `isSupported`, `generateKey`, `attestKey(keyId, challenge)`
  (`clientDataHash = SHA256(challenge)`), and `getBundleId`.
- `src/attest.ts` orchestrates the HTTP flow — `GET /api/sdk/auth/attest-challenge`
  → native `attestKey` → `POST /api/sdk/auth/attest` (`platform: "ios"`) — and
  caches the returned `attest_token` JWT in the Keychain, refreshing when it is
  within 5 minutes of expiry (on app foreground).
- `src/sdk-headers.ts` reads the cached token synchronously and adds
  `X-Attest-Token` to the shared header set, so it is sent on every transport.
- A **fresh** App Attest key is generated for each attestation (an App Attest key
  can be attested only once).
