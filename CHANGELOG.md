# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.55.0] — 2026-10-24

### Added

- `onelo.auth.magicLinkEnabled`; the sign-in loading skeleton draws the magic-link row when passwordless sign-in is on.

### Fixed

- On a light page the skeletons' soft blocks are visible (they were painted white on white).

## [0.54.0-staging] — 2026-10-23

### Added

- `onelo.affiliates.capture(url, { consent })` captures an Affiliate referral from the link that opened your app
  (#929). It reads `?ref=<code>` or `?onelo_click=<id>`. Without consent nothing
  is stored on the device. With consent the click is kept and tied to the user
  who signs in, so their purchase is attributed whichever checkout opens.

## [0.53.1-staging] — 2026-10-07

### Fixed

- Feature snapshots are bound to the identity that asked for them (#736, parity with Swift, JS and Electron). A late answer for a previous user or for the anonymous state is dropped; a signed-in user whose token is refused keeps their last confirmed snapshot instead of an anonymous one; a stream connection that fell back to anonymous never replaces a signed-in user's snapshot. `features.ready()` resets on every sign-in, sign-out and user switch and resolves only once the server confirms the current user's snapshot. Features start after the stored session is restored, so a returning user never sees an anonymous snapshot first. Switching users no longer shows the previous user's snapshot when the new one has no cache. `since_version` stays 0 until the current user confirms a version.

## [0.53.0-staging] — 2026-10-03

### Added

- Marketing Consent for your own screens (#818). `auth.getSignupMarketingConsent()` (`asked`, `text`, `language`) tells a custom sign-up screen whether to show the optional checkbox and with what text, from `/api/sdk/config` asked in the device language. `signUp(email, password, { marketingConsent })` sends the consent (and its language) only when ticked. `waitlist.join(slug, email, { consent: { marketing, custom } })`.

## [0.52.0-staging] — 2026-10-03

### Added

- Email Verification (#819). `OneloUser` carries `emailVerified` and `accessReason` (`'email_unverified'` when the app is withheld for it). `OneloAuthGate` now decides from the server's answer (`isAllowedIn()`) instead of re-deriving `signedIn && (!paywall || entitled)`, which let a user the server withholds for Email Verification into a free app. New `onelo.auth.resendVerificationEmail({ redirectTo? })` and `onelo.auth.confirmEmail(token)` for apps with their own screen; new error codes `verification_rate_limited`, `email_verification_off`, `invalid_verification_token`, `invalid_verify_redirect`. `confirmEmail()` refreshes the signed-in session so the app opens at once; `revalidateEntitlement()` refreshes `allowedIn`, `emailVerified` and `accessReason` together.

## [0.51.0-staging] — 2026-10-03

### Added

- A signed-in user's feedback report names a verified reporter (#820). With an Onelo Auth session, `feedback.open()` sends the user's access token (`Authorization: Bearer`) on `/api/sdk/feedback/initiate`; Onelo stores the report with that user and `reporter_verified=true`, so no `userId` is needed. A refused token is refreshed and retried once; refused again, the form still opens without it. Signed out, the report stays anonymous; an explicit `userId` without a session is still an unverified label.

## [0.50.0-staging] — 2026-10-01

### Added

- A magic link from the hosted sign-in can be opened on another device (#542, server side #540). The hosted flow now sends a PKCE `code_challenge` on `/api/sdk/flow/init`, with its verifier kept in the Keychain. Opened on another device, the link shows a code there; once it is typed, the sign-in completes in this app's modal. Opened on this device, it opens the app signed in, also after the app was killed: the code is exchanged with the stored verifier. The verifier is single use and is cleared on sign-out.
- `onelo.auth.handleLaunchUrl(url)` completes a sign-in from the URL that launched the app (`Linking.getInitialURL()`). `OneloAuthGate` calls it on mount, before it opens a new sign-in. Apps with their own root call it before `loadAuthView()`.

### Changed

- A hosted code that fails to exchange now says why. A link that belongs to a different sign-in on this device says so. Any other failure carries the backend reason. There is one attempt and no retry.
- Custom-UI `sendMagicLink()` is unchanged and unpaired: open that link on the same device.

## [0.49.0-staging] — 2026-09-29

### Changed

- SDK chrome is painted from the app's Branding (#681): retry buttons, the store ✕ chip, headers, error text, spinners and the WebView skeletons (auth, store, portal, feedback) in every modal and in `OneloAuthGate` come from `brand_tokens` (`/api/sdk/config`, refreshed by store / portal / upgrade initiate). `onelo.auth.brandTokens()` is new; modal views take a `tokens` prop (the `backgroundColor` prop still works, deprecated). Older backend → the legacy colour fields; before config → neutral, never Onelo orange. Native text stays on the system font (React Native cannot tell whether a family is installed).

## [0.48.0-staging] — 2026-09-29

### Fixed

- After a purchase or a plan switch in the store modal, the Customer Portal modal (including `openUpgrade`) or the sign-in flow, the app shows the new plan at once instead of waiting for the Event Stream (#659). Every successful hand-back forces a features re-resolve and re-reads the entitlement; a `plan_switch_pending` switch is re-checked after 1, 2, 4, 8 and 15 s until the features change. `PortalResult` `done` now carries an optional `planChange`. One refresher (`core/plan-change.ts`), wired by `Onelo`.
- The entitlement now follows a plan change live (#635): the SDK listens for the Event Stream's per-user `paywall.access_changed` frame and calls `auth.revalidateEntitlement()`.

## [0.47.0-staging] — 2026-09-28

### Fixed

- A store whose link died (#619) now continues in the same modal: `?error=token_expired` and `{type:'onelo:cancel', reason:'expired'}` classify as `{ kind: 'expired' }`, the store modal resolves `{ type: 'expired' }`, and `store.open()` mints a fresh link through `store-initiate` and keeps the modal up on it. A failed mint closes it as a cancel. The access-gate store restarts through `/flow/init`.
## [0.46.0-staging] — 2026-09-28

### Added

- The feedback modal (`FeedbackModal`) now keeps the reporter when the form was left open longer than its 30-minute reporter token (#622). On submit the hosted form asks the SDK for a fresh token (`onelo:renew_request`, kind `feedback`); the SDK calls `/api/sdk/feedback/initiate` again with the same options and hands the new form URL back, and the report is sent with its reporter. Before, such a report was stored without a reporter and nobody was told.

## [0.45.0-staging] — 2026-09-28

### Added

- `customerPortal.open({ intent: 'change_plan' })` opens the portal straight into the plan picker, the same as `@onelo/js` (#606). The hosted portal asks the backend where the change goes. The `PortalIntent` type is exported.

### Changed

- `openUpgrade(plan)` opens the upgrade in the SDK's customer-portal modal instead of the system browser (#606). The store's hand-back (a purchase, a plan switch, or "Return to app" on a spent link) closes the modal, and the promise resolves when it closes. With no `<CustomerPortalModal>` mounted it still opens the system browser and logs a warning.
- The customer-portal modal re-reads the entitlement when it closes, so `hasActiveAccess()` reflects a plan bought or changed there (#606).

### Fixed

- One decoder for the store's postMessage hand-back (#627). The auth, store and portal modals decode `onelo:code`, `onelo:done` and `onelo:cancel` through `classifyHandBackMessage`, next to `classifyHandBack`. `OAUTH_RELAY_SCRIPT` now forwards the `onelo:cancel` the page actually sends (it forwarded the retired `onelo:cancelled`) and `onelo:done`. The exported `parseModalMessage` was removed.

## [0.44.0-staging] — 2026-09-28

### Fixed

- A purchase started from the Customer Portal ("Change plan" → checkout, `<scheme>://callback?code=`) now closes the portal modal as `done` instead of `cancelled` (#615). The store modal and the portal modal now decode every `<scheme>://callback` hand-back through one function, including the new `event=plan_switch_pending` (a paid switch still being updated — a success; the new plan arrives over the Event Stream).

## [0.43.0-staging] — 2026-09-28

### Added

- The Customer Portal modal renews an expired portal token instead of showing "Link expired" to a signed-in user (#613 / #614). The page's `onelo:renew_request` arrives through `onMessage`; the SDK mints a fresh portal with the current session and injects the reply. `PortalModalState.onRenewRequest` / `CustomerPortalModalView`'s `onRenewRequest` prop carry it; a 401 from `portal-initiate` now throws `not_authenticated`.

## [0.42.0-staging] — 2026-09-28

### Fixed

- After a month↔year plan switch or a scheduled downgrade, the store modal and the Customer Portal modal close by themselves as a success (#599). The hosted store reports these code-less finishes as `<scheme>://callback?source=store&event=plan_switched|switch_scheduled`; `store.open()` now resolves with the current session instead of `null` (cancel), and the portal resolves `done` instead of `cancelled`. The new plan arrives over the Event Stream.

## [0.41.0-staging] — 2026-09-26

### Changed

- A refused session refresh is now read from the server's real error body (#548). `session_compromised`, `session_expired` and `session_invalid` end the session with the neutral `OneloError` code `session_ended` ("Your session ended — please sign in again"); `banned` throws `user_revoked` and sets `isUserRevoked`; `no_plan_available` throws `no_active_plan`. `getSession()` still answers `null` for every ended session and never throws for it.
- Uncaught errors captured by Monitor carry `meta.origin` (`onelo_sdk` or `app`).
- A transient refresh failure — offline, a lost response, `429`, or a `5xx` including the new `503 refresh_unavailable` — no longer signs the user out. The session is kept and the refresh is retried after 5 s, 10 s, 20 s, 40 s, then every 60 s.

## [0.40.0-staging] — 2026-09-25

### Changed

- Features calls now prove the signed-in user with the Onelo access token (#518). Resolve, batch-ping, poll, module-token and the Event Stream send `Authorization: Bearer <access token>`, read fresh for every call and every reconnect. A refused token (`401 invalid_user_token`) is refreshed and retried once; if it is refused again, that call is made without a user and a warning is logged.
- `userIdHash` is no longer sent. `identify()` and its `userIdHash` argument still compile but are deprecated: the signed-in Onelo user is used automatically.
