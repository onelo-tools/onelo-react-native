package com.onelo.reactnative

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.google.android.play.core.integrity.IntegrityManagerFactory
import com.google.android.play.core.integrity.StandardIntegrityManager.PrepareIntegrityTokenRequest
import com.google.android.play.core.integrity.StandardIntegrityManager.StandardIntegrityTokenProvider
import com.google.android.play.core.integrity.StandardIntegrityManager.StandardIntegrityTokenRequest
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await

/**
 * Android half of the `OneloAttest` native module (JS name:
 * `NativeModules.OneloAttest`, matching iOS `OneloAttest.swift`/`.m` — see the
 * comment there). iOS exposes App Attest primitives (`isSupported`/`generateKey`/
 * `attestKey`); this exposes Play Integrity primitives (`prepareIntegrityToken`/
 * `requestIntegrityToken`) plus the shared `getBundleId`. `src/attest.ts` branches
 * on `Platform.OS` and calls only the primitives that exist on each side — the
 * orchestration (caching, expiry, POSTing to the backend) lives in JS, exactly
 * mirroring how the iOS path is split.
 *
 * The Standard API split (prepare once, request per-exchange) is Google's
 * documented flow — see `com.onelo.android.internal.OneloPlayIntegrity` (native
 * onelo-android SDK), which this mirrors: prepareIntegrityToken is rate-limited
 * (~5/min) so the provider is cached here across calls; request() is not.
 */
class OneloAttestModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private val scope = CoroutineScope(Dispatchers.IO)

    // Cached per cloudProjectNumber — a dev could (in theory) reconfigure the app
    // without a process restart in a test harness; keying by number avoids
    // serving a stale provider for a different project.
    @Volatile private var preparedFor: Long = 0L
    @Volatile private var tokenProvider: StandardIntegrityTokenProvider? = null

    override fun getName(): String = "OneloAttest"

    @ReactMethod
    fun getBundleId(promise: Promise) {
        promise.resolve(reactApplicationContext.packageName)
    }

    /**
     * Prepares (and caches) the Standard Integrity token provider for
     * `cloudProjectNumber` (the developer's Google Cloud project NUMBER, from
     * `/api/sdk/config`'s `cloud_project_number` — required for the Standard API
     * on SDK/sideloaded installs per Google's docs). Resolves `true` on success;
     * rejects with code `integrity_not_configured` when the number is missing/0,
     * or `integrity_prepare_failed` on any Play error (e.g. Play Services
     * unavailable, or running on an emulator without Play).
     */
    @ReactMethod
    fun prepareIntegrityToken(cloudProjectNumber: Double, promise: Promise) {
        val projectNumber = cloudProjectNumber.toLong()
        if (projectNumber <= 0L) {
            promise.reject("integrity_not_configured", "cloudProjectNumber is missing or <= 0")
            return
        }
        tokenProvider?.let { if (preparedFor == projectNumber) { promise.resolve(true); return } }
        scope.launch {
            try {
                val manager = IntegrityManagerFactory.createStandard(reactApplicationContext)
                val provider = manager.prepareIntegrityToken(
                    PrepareIntegrityTokenRequest.builder()
                        .setCloudProjectNumber(projectNumber)
                        .build()
                ).await()
                tokenProvider = provider
                preparedFor = projectNumber
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("integrity_prepare_failed", e.message, e)
            }
        }
    }

    /**
     * Requests a fresh Standard integrity token bound to `requestHash` (max 500
     * bytes per Google's docs — callers pass a SHA-256 hex digest, well under
     * that). Must be called after `prepareIntegrityToken` resolved. Google Play
     * auto-prevents replay of the returned token server-side, so no client-side
     * nonce bookkeeping is needed.
     */
    @ReactMethod
    fun requestIntegrityToken(requestHash: String, promise: Promise) {
        val provider = tokenProvider
        if (provider == null) {
            promise.reject("integrity_not_prepared", "prepareIntegrityToken must succeed first")
            return
        }
        scope.launch {
            try {
                val response = provider.request(
                    StandardIntegrityTokenRequest.builder()
                        .setRequestHash(requestHash)
                        .build()
                ).await()
                promise.resolve(response.token())
            } catch (e: Exception) {
                promise.reject("integrity_request_failed", e.message, e)
            }
        }
    }
}
