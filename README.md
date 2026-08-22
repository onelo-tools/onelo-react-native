# @onelo/react-native

The Onelo SDK for React Native — iOS and Android.

Part of [Onelo](https://onelo.tools): hosted sign-in, a paywall on **your own Stripe** account, plan-gated feature flags, uptime monitoring, in-app feedback, a public roadmap and a waitlist — one SDK, wired together.

## Install

```bash
npm install github:onelo-tools/onelo-react-native react-native-keychain react-native-webview react-native-get-random-values
```

```bash
cd ios && pod install
```

The native module is picked up by React Native autolinking — no Podfile or Gradle edit needed.

### One required line

Add this as the **first line** of your `index.js`. Sign-in uses PKCE, which needs a secure random source, and React Native does not provide one out of the box:

```js
import 'react-native-get-random-values'
```

## Quick start

```ts
import { Onelo } from '@onelo/react-native'

const onelo = new Onelo({
  publishableKey: 'onelo_pk_live_YOUR_KEY',
  apiUrl: 'https://api.onelo.tools',
  bundleId: 'com.company.app',
  callbackScheme: 'myapp',
})
```

`publishableKey` and `apiUrl` are both required. Your Onelo dashboard shows the snippet with your values already filled in.

### Gate your app with one component

`OneloAuthGate` drives the whole flow for you — it opens the hosted sign-in page, sends users who haven't paid to your store, and renders your app only once they're signed in and entitled:

```tsx
import { OneloAuthGate } from '@onelo/react-native'

export default function App() {
  return (
    <OneloAuthGate onelo={onelo}>
      <YourApp />
    </OneloAuthGate>
  )
}
```

Prefer to drive it yourself? The imperative API is there too:

```ts
await onelo.auth.loadAuthView()

const unsubscribe = onelo.auth.onAuthStateChange((session) => {
  console.log(session ? 'signed in' : 'signed out')
})

if (await onelo.auth.isAllowedIn()) showApp()

await onelo.auth.signOut()
```

### Deep links (required for most flows)

Social sign-in and Stripe redirects leave your app and come back through a custom URL scheme. It must match `callbackScheme`.

**Android** — `android/app/src/main/AndroidManifest.xml`:

```xml
<intent-filter>
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data android:scheme="myapp" />
</intent-filter>
```

**iOS** — add the scheme under URL Types (`CFBundleURLSchemes`) in `Info.plist`.

## Modules

Everything below hangs off the one `onelo` instance.

| Accessor | What it does | Key methods |
|---|---|---|
| `onelo.auth` | Hosted sign-in and sessions | `loadAuthView()`, `isAllowedIn()`, `onAuthStateChange()`, `getSession()`, `signOut()` |
| `onelo.features` | Plan-gated feature flags, pushed live | `isEnabled()`, `feature()`, `subscribe()`, `refresh()` |
| `onelo.monitor` | Error and event reporting | `track()`, `capture()`, `event()` |
| `onelo.store` | Your hosted store, on your own Stripe | `open()`, `openUpgrade()` |
| `onelo.customerPortal` | Cancel, change plan, refunds, invoices | `open()` |
| `onelo.feedback` | In-app bug reports and feature requests | `open()`, `close()` |
| `onelo.forms` | Form submissions | `submit()` |
| `onelo.waitlist` | Pre-launch signups | `join()` |
| `onelo.consent` | Versioned terms / privacy consent gate | `requiredConsents()`, `acceptConsent()`, `onConsentRequired()` |

Each surface also ships a ready-made component and a state hook if you'd rather render it yourself — `StoreModal` / `useStoreModalState`, `CustomerPortalModal` / `usePortalModalState`, `ConsentGateModal` / `useConsentModalState`, `FeedbackModal`, `AuthModal`.

## Device attestation

The SDK proves requests come from a genuine, unmodified build of your app — **App Attest** on iOS and **Play Integrity** on Android. It is automatic: there is no API to call, and it only runs when your Onelo app is configured to require it.

What you need to do:

- **iOS:** enable the **App Attest** capability in Xcode → your target → Signing & Capabilities, and test on a **real device** — App Attest is unavailable in the Simulator, where it is skipped silently.
- **Android:** nothing — Play Integrity is wired up by the SDK.

If attestation can't run, requests still go out without the token rather than failing. Filter your logs for `[Onelo][attest]` to see exactly why.

## Requirements

- React **18+**, React Native **0.71+**
- iOS **14+**, Android **minSdk 24**
- Peer dependencies: `react-native-keychain`, `react-native-webview`, `react-native-get-random-values` (tokens are stored in the Keychain / Android keystore)
- TypeScript declarations included

## Links

- **Docs:** [onelo.tools/docs](https://onelo.tools/docs)
- **Dashboard:** [onelo.tools](https://onelo.tools) — your app's snippet comes pre-filled with your keys
- **Issues:** please report them on this repository

## License

MIT
