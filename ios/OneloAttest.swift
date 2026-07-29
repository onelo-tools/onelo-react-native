import Foundation
import DeviceCheck
import CryptoKit
// Import React as a MODULE so the bridge types used below (RCTPromiseResolveBlock,
// RCTPromiseRejectBlock, RCTBridgeModule) resolve WITHOUT a bridging header —
// bridging headers are unsupported when the pod is built as a framework target
// (New Architecture / use_frameworks!, the default on RN 0.76+/Expo 52+). See #22.
import React

/// Native iOS App Attest bridge for the Onelo React Native SDK.
///
/// This is the ONLY place DeviceCheck / `DCAppAttestService` is touched. JS
/// (`src/attest.ts`) orchestrates the HTTP round-trips (challenge → /attest) and
/// token caching; this module just exposes the three device-bound primitives that
/// cannot be done in JS: capability probe, fresh key generation, and signing the
/// attestation for a server challenge.
///
/// Exposed to JS as a classic `RCTBridgeModule` named `OneloAttest` (see
/// `OneloAttest.m`). All methods are Promise-based (`resolve` / `reject`).
///
/// A silently-failing security mechanism is worse than none, so every failure
/// rejects with a stable code + the underlying `NSError` so the JS layer can log
/// WHY attestation failed (Simulator, missing App Attest capability, Apple
/// server error) instead of an unexplained missing token.
@objc(OneloAttest)
class OneloAttest: NSObject {

  /// This module performs no UI work, so it must NOT be initialized on the main
  /// queue — keeps App Attest off the JS/main thread.
  @objc static func requiresMainQueueSetup() -> Bool { return false }

  /// `DCAppAttestService.shared.isSupported` — false on the Simulator and on any
  /// build without the App Attest capability. JS skips attestation entirely when
  /// this is false (parity with Swift `OneloAppAttest.performAttestation`'s guard).
  @objc(isSupported:rejecter:)
  func isSupported(_ resolve: @escaping RCTPromiseResolveBlock,
                   rejecter reject: @escaping RCTPromiseRejectBlock) {
    if #available(iOS 14.0, *) {
      resolve(DCAppAttestService.shared.isSupported)
    } else {
      resolve(false)
    }
  }

  /// `Bundle.main.bundleIdentifier` — the host app's bundle id, sent to the
  /// backend `/attest` endpoint as `bundle_id` so it can be matched against the
  /// app's registered bundle ids. JS falls back to this only when the developer
  /// did not pass `bundleId` in the SDK config.
  @objc(getBundleId:rejecter:)
  func getBundleId(_ resolve: @escaping RCTPromiseResolveBlock,
                   rejecter reject: @escaping RCTPromiseRejectBlock) {
    resolve(Bundle.main.bundleIdentifier ?? "")
  }

  /// Mint a FRESH App Attest key and resolve its key id.
  ///
  /// An App Attest key can be attested EXACTLY ONCE — Apple rejects `attestKey`
  /// on a key that was already attested. JS therefore generates a new key for
  /// every attestation (first launch, or ~30-day token refresh) and never reuses
  /// a stored key id (mirrors Swift `generateFreshAttestKey`).
  @objc(generateKey:rejecter:)
  func generateKey(_ resolve: @escaping RCTPromiseResolveBlock,
                   rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard #available(iOS 14.0, *) else {
      reject("unsupported", "App Attest requires iOS 14+.", nil); return
    }
    let service = DCAppAttestService.shared
    guard service.isSupported else {
      reject("unsupported", "App Attest not supported (Simulator, or the App Attest capability is not enabled).", nil)
      return
    }
    service.generateKey { keyId, error in
      if let error = error {
        reject("generate_key_failed", error.localizedDescription, error); return
      }
      guard let keyId = keyId else {
        reject("generate_key_failed", "generateKey returned no key id.", nil); return
      }
      resolve(keyId)
    }
  }

  /// Attest `keyId` against `challenge`.
  ///
  /// The `clientDataHash` is `SHA256(challenge)` — computed HERE in native code so
  /// the exact bytes Apple signs match what the backend re-derives from the raw
  /// challenge string (parity with Swift, which hashes the challenge before
  /// `attestKey`). Resolves `{ keyId, attestation }` where `attestation` is the
  /// base64-encoded CBOR attestation object.
  @objc(attestKey:challenge:resolver:rejecter:)
  func attestKey(_ keyId: String,
                 challenge: String,
                 resolver resolve: @escaping RCTPromiseResolveBlock,
                 rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard #available(iOS 14.0, *) else {
      reject("unsupported", "App Attest requires iOS 14+.", nil); return
    }
    let service = DCAppAttestService.shared
    guard service.isSupported else {
      reject("unsupported", "App Attest not supported.", nil); return
    }
    let clientDataHash = Data(SHA256.hash(data: Data(challenge.utf8)))
    service.attestKey(keyId, clientDataHash: clientDataHash) { attestation, error in
      if let error = error {
        reject("attest_key_failed", error.localizedDescription, error); return
      }
      guard let attestation = attestation else {
        reject("attest_key_failed", "attestKey returned no attestation.", nil); return
      }
      resolve([
        "keyId": keyId,
        "attestation": attestation.base64EncodedString(),
      ])
    }
  }

  /// FAZA 3 (assertion model) — per-request assertion. `clientData` is the FULL
  /// preimage the JS side built: `"{METHOD}\n{path?query}\n{challenge}\n{body}"`.
  /// We SHA-256 it HERE (native, like attestKey) so the bytes Apple signs match
  /// the backend's `compute_client_data_hash` exactly — the JS side never needs a
  /// crypto dependency, it just concatenates strings. Resolves the base64 CBOR
  /// assertion.
  @objc(generateAssertion:clientData:resolver:rejecter:)
  func generateAssertion(_ keyId: String,
                         clientData: String,
                         resolver resolve: @escaping RCTPromiseResolveBlock,
                         rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard #available(iOS 14.0, *) else {
      reject("unsupported", "App Attest requires iOS 14+.", nil); return
    }
    let service = DCAppAttestService.shared
    guard service.isSupported else {
      reject("unsupported", "App Attest not supported.", nil); return
    }
    let clientDataHash = Data(SHA256.hash(data: Data(clientData.utf8)))
    service.generateAssertion(keyId, clientDataHash: clientDataHash) { assertion, error in
      if let error = error {
        reject("generate_assertion_failed", error.localizedDescription, error); return
      }
      guard let assertion = assertion else {
        reject("generate_assertion_failed", "generateAssertion returned no data.", nil); return
      }
      resolve(assertion.base64EncodedString())
    }
  }
}
