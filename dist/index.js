"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// ../onelo-core/dist/types.js
var require_types = __commonJS({
  "../onelo-core/dist/types.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.OneloError = void 0;
    var OneloError7 = class _OneloError extends Error {
      constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "OneloError";
      }
      static notAuthenticated() {
        return new _OneloError("not_authenticated", "User is not authenticated");
      }
      static hostedFlowRequired() {
        return new _OneloError("hosted_flow_required", "This app requires the hosted sign-in flow. Use loadAuthView().");
      }
      /**
       * The DEVELOPER's app is on a plan that doesn't allow custom auth UI. This is
       * a build-time configuration error — the fix is to use the hosted flow
       * (loadAuthView) or upgrade the Onelo plan. NOT for an end-user's lapsed
       * subscription — see noActivePlan().
       */
      static planRequired() {
        return new _OneloError("plan_required", "[plan_required] Custom UI requires a paid Onelo plan. Use loadAuthView() instead.");
      }
      /**
       * The END USER has no active subscription (it lapsed or was cancelled) — the
       * backend cleared the session. This is NOT a config error and NOT an account
       * revocation: route the user to your store / upgrade flow to re-subscribe.
       */
      static noActivePlan() {
        return new _OneloError("no_active_plan", "[no_active_plan] No active subscription \u2014 the plan has expired or was cancelled. Route the user to your store / upgrade flow to re-subscribe.");
      }
      static invalidKey(msg) {
        return new _OneloError("invalid_publishable_key", `Invalid publishable key: ${msg}`);
      }
      static network(msg) {
        return new _OneloError("network_error", `Network error: ${msg}`);
      }
      static server(msg) {
        return new _OneloError("server_error", msg);
      }
      static timeout(msg) {
        return new _OneloError("timeout", msg);
      }
      static cancelled() {
        return new _OneloError("cancelled", "Sign in was cancelled");
      }
      static revoked() {
        return new _OneloError("revoked", "This application has been revoked");
      }
      static userRevoked() {
        return new _OneloError("user_revoked", "This user account has been suspended");
      }
    };
    exports2.OneloError = OneloError7;
  }
});

// ../onelo-core/dist/pkce.js
var require_pkce = __commonJS({
  "../onelo-core/dist/pkce.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.generateCodeVerifier = generateCodeVerifier2;
    exports2.generateCodeChallenge = generateCodeChallenge2;
    function generateCodeVerifier2() {
      const array = new Uint8Array(32);
      crypto.getRandomValues(array);
      return base64urlEncode2(array);
    }
    async function generateCodeChallenge2(verifier) {
      const encoder = new TextEncoder();
      const data = encoder.encode(verifier);
      const digest = await crypto.subtle.digest("SHA-256", data);
      return base64urlEncode2(new Uint8Array(digest));
    }
    function base64urlEncode2(bytes) {
      let str = "";
      for (const byte of bytes) {
        str += String.fromCharCode(byte);
      }
      return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
    }
  }
});

// ../onelo-core/dist/http.js
var require_http = __commonJS({
  "../onelo-core/dist/http.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.httpGet = httpGet7;
    exports2.httpPost = httpPost5;
    exports2.checkHostedFlowRequired = checkHostedFlowRequired2;
    var types_1 = require_types();
    async function httpGet7(url, headers) {
      let res;
      try {
        res = await fetch(url, { headers });
      } catch (e) {
        throw types_1.OneloError.network(e instanceof Error ? e.message : "fetch failed");
      }
      const json = await parseJson(res);
      return { status: res.status, json };
    }
    async function httpPost5(url, body, headers) {
      let res;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify(body)
        });
      } catch (e) {
        throw types_1.OneloError.network(e instanceof Error ? e.message : "fetch failed");
      }
      const json = await parseJson(res);
      return { status: res.status, json };
    }
    async function parseJson(res) {
      try {
        return await res.json();
      } catch {
        throw types_1.OneloError.network("Invalid JSON response");
      }
    }
    function checkHostedFlowRequired2(json) {
      const j = json;
      const errorCode = j["error"] ?? j["detail"]?.["error"];
      if (errorCode === "hosted_flow_required") {
        const hint = j["hint"] ?? j["detail"]?.["hint"] ?? "Use loadAuthView() in your web app.";
        console.warn("[Onelo] \u26A0\uFE0F  hosted_flow_required:", hint);
        console.info("[Onelo] \u{1F4A1} Fix: call onelo.auth.loadAuthView() or upgrade your Onelo plan.");
        throw types_1.OneloError.hostedFlowRequired();
      }
    }
  }
});

// ../onelo-core/dist/session.js
var require_session = __commonJS({
  "../onelo-core/dist/session.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.TOKEN_KEYS = void 0;
    exports2.mapSession = mapSession2;
    function mapSession2(j) {
      const tokens = j["session"] ?? j;
      const user = j["user"];
      const appMeta = user?.["app_metadata"] ?? {};
      const expiresIn = tokens["expires_in"];
      const expiresAt = typeof expiresIn === "number" ? Math.floor(Date.now() / 1e3) + expiresIn : 0;
      return {
        accessToken: tokens["access_token"],
        refreshToken: tokens["refresh_token"],
        expiresAt,
        user: {
          id: user["id"],
          email: user["email"],
          role: appMeta["user_role"] ?? user["role"] ?? "member",
          tenantId: appMeta["tenant_id"] ?? user["tenant_id"] ?? null,
          // Backend sends "active" | "none"; absent MUST decode to 'none' (never
          // treat a missing entitlement as active). Round-trips via USER_JSON.
          entitlement: user["entitlement"] === "active" ? "active" : "none"
        }
      };
    }
    exports2.TOKEN_KEYS = {
      ACCESS_TOKEN: "onelo_access_token",
      REFRESH_TOKEN: "onelo_refresh_token",
      EXPIRES_AT: "onelo_expires_at",
      USER_JSON: "onelo_user"
    };
  }
});

// ../onelo-core/dist/reason-enum.js
var require_reason_enum = __commonJS({
  "../onelo-core/dist/reason-enum.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.REASON_LABELS = exports2.RESPONSE_REASON_CODES = void 0;
    exports2.RESPONSE_REASON_CODES = [
      "too_expensive",
      "missing_features",
      "not_working",
      "not_using_anymore",
      "found_alternative",
      "bought_by_mistake",
      "duplicate_charge",
      "unauthorized",
      "prefer_not_to_say",
      "other",
      "skipped"
    ];
    exports2.REASON_LABELS = {
      too_expensive: "Too expensive",
      missing_features: "Missing features",
      not_working: "Doesn't work as expected",
      not_using_anymore: "Not using anymore",
      found_alternative: "Found alternative",
      bought_by_mistake: "Bought by mistake",
      duplicate_charge: "Duplicate charge",
      unauthorized: "I didn't authorise this",
      prefer_not_to_say: "Prefer not to say",
      other: "Other",
      skipped: "(skipped survey)"
    };
  }
});

// ../onelo-core/dist/index.js
var require_dist = __commonJS({
  "../onelo-core/dist/index.js"(exports2) {
    "use strict";
    var __createBinding = exports2 && exports2.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __exportStar = exports2 && exports2.__exportStar || function(m, exports3) {
      for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports3, p)) __createBinding(exports3, m, p);
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    __exportStar(require_types(), exports2);
    __exportStar(require_pkce(), exports2);
    __exportStar(require_http(), exports2);
    __exportStar(require_session(), exports2);
    __exportStar(require_reason_enum(), exports2);
  }
});

// src/core/storage.ts
var storage_exports = {};
__export(storage_exports, {
  KeychainStorage: () => KeychainStorage
});
var Keychain, KeychainStorage;
var init_storage = __esm({
  "src/core/storage.ts"() {
    "use strict";
    Keychain = __toESM(require("react-native-keychain"));
    KeychainStorage = class {
      async get(key) {
        try {
          const result = await Keychain.getInternetCredentials(key);
          if (!result) return null;
          return result.password;
        } catch {
          return null;
        }
      }
      async set(key, value) {
        try {
          await Keychain.setInternetCredentials(key, key, value);
        } catch {
        }
      }
      async delete(key) {
        try {
          await Keychain.resetInternetCredentials({ server: key });
        } catch {
        }
      }
      async clear() {
        const keys = ["onelo_access_token", "onelo_refresh_token", "onelo_expires_at", "onelo_user"];
        await Promise.all(keys.map((k) => this.delete(k)));
      }
    };
  }
});

// package.json
var require_package = __commonJS({
  "package.json"(exports2, module2) {
    module2.exports = {
      name: "@onelo/react-native",
      version: "0.32.0",
      description: "Onelo React Native SDK",
      main: "./dist/index.js",
      types: "./dist/index.d.ts",
      files: [
        "dist",
        "ios",
        "onelo-react-native.podspec"
      ],
      scripts: {
        build: "tsup src/index.ts --format cjs --dts --clean --no-splitting --external react --external react-native --external react-native-keychain --external react-native-webview",
        dev: "tsup src/index.ts --format cjs --dts --watch --no-splitting --external react --external react-native --external react-native-keychain --external react-native-webview",
        test: "vitest run",
        typecheck: "tsc --noEmit"
      },
      dependencies: {
        "js-sha256": "^0.11.0"
      },
      peerDependencies: {
        react: ">=18.0.0",
        "react-native": ">=0.71.0",
        "react-native-get-random-values": ">=1.8.0",
        "react-native-keychain": ">=9.0.0",
        "react-native-webview": ">=13.0.0"
      },
      devDependencies: {
        "@onelo/core": "workspace:*",
        typescript: "^5.7.0",
        tsup: "^8.0.0",
        vitest: "^1.6.0",
        "@types/react": "^18.0.0",
        "@types/react-native": "^0.73.0"
      },
      publishConfig: {
        access: "public"
      }
    };
  }
});

// src/core/instance-id.ts
function _uuidv4() {
  const bytes = new Uint8Array(16);
  try {
    ;
    globalThis.crypto.getRandomValues(bytes);
  } catch {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = bytes[6] & 15 | 64;
  bytes[8] = bytes[8] & 63 | 128;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
async function getInstanceId() {
  if (_cachedInstanceId) return _cachedInstanceId;
  if (_inflight) return _inflight;
  _inflight = (async () => {
    let id = null;
    try {
      const { KeychainStorage: KeychainStorage2 } = await Promise.resolve().then(() => (init_storage(), storage_exports));
      const storage = new KeychainStorage2();
      const existing = (await storage.get(INSTANCE_ID_KEY))?.toLowerCase() ?? null;
      id = existing || _uuidv4();
      if (!existing) {
        await storage.set(INSTANCE_ID_KEY, id);
      }
    } catch {
      id = id ?? _uuidv4();
    }
    _cachedInstanceId = id;
    return id;
  })();
  try {
    return await _inflight;
  } finally {
    _inflight = null;
  }
}
var INSTANCE_ID_KEY, _cachedInstanceId, _inflight;
var init_instance_id = __esm({
  "src/core/instance-id.ts"() {
    "use strict";
    INSTANCE_ID_KEY = "onelo.instance_id";
    _cachedInstanceId = null;
    _inflight = null;
  }
});

// src/attest.ts
var attest_exports = {};
__export(attest_exports, {
  OneloAttest: () => OneloAttest,
  _setActiveAttest: () => _setActiveAttest,
  getAssertionHeaders: () => getAssertionHeaders,
  getCachedAttestToken: () => getCachedAttestToken,
  maybeSelfHealFromError: () => maybeSelfHealFromError,
  selfHealAttest: () => selfHealAttest
});
function getCachedAttestToken() {
  return _cachedAttestToken;
}
function _setActiveAttest(a) {
  _activeAttest = a;
}
async function getAssertionHeaders(method, path, query, body) {
  return _activeAttest ? _activeAttest.assertionHeaders(method, path, query, body) : null;
}
function selfHealAttest() {
  void _activeAttest?.resetForSelfHeal();
}
function maybeSelfHealFromError(json) {
  const detail = json?.detail;
  const code = detail && typeof detail === "object" ? detail.error : void 0;
  if (code && ["attest_key_unknown", "attest_key_revoked", "invalid_assertion"].includes(code)) {
    selfHealAttest();
  }
}
function log(message) {
  console.warn(`[Onelo][attest] ${message}`);
}
function _truncate(s, max) {
  return s.length > max ? s.slice(0, max) : s;
}
function _withTimeout(p, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer !== void 0) clearTimeout(timer);
  });
}
function _decodeJwtExp(token) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    let payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (payload.length % 4 !== 0) payload += "=";
    const decoded = _base64Decode(payload);
    const json = JSON.parse(decoded);
    const exp = json["exp"];
    return typeof exp === "number" ? exp : null;
  } catch {
    return null;
  }
}
function _base64Decode(b64) {
  const g = globalThis;
  if (typeof g.atob === "function") return g.atob(b64);
  if (g.Buffer) return g.Buffer.from(b64, "base64").toString("utf-8");
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  const clean = b64.replace(/=+$/, "");
  for (let i = 0; i < clean.length; i += 4) {
    const n = chars.indexOf(clean[i]) << 18 | chars.indexOf(clean[i + 1]) << 12 | (chars.indexOf(clean[i + 2]) & 63) << 6 | chars.indexOf(clean[i + 3]) & 63;
    out += String.fromCharCode(n >> 16 & 255);
    if (clean[i + 2] !== void 0) out += String.fromCharCode(n >> 8 & 255);
    if (clean[i + 3] !== void 0) out += String.fromCharCode(n & 255);
  }
  return out;
}
var import_core, TOKEN_KEY, EXPIRY_KEY, KEY_ID_KEY, REFRESH_SKEW_MS, ATTEST_HTTP_TIMEOUT_MS, _cachedAttestToken, _activeAttest, _OneloAttest, OneloAttest;
var init_attest = __esm({
  "src/attest.ts"() {
    "use strict";
    import_core = __toESM(require_dist());
    init_instance_id();
    TOKEN_KEY = "onelo.attest_token";
    EXPIRY_KEY = "onelo.attest_token_expiry";
    KEY_ID_KEY = "onelo.attest_key_id";
    REFRESH_SKEW_MS = 5 * 60 * 1e3;
    ATTEST_HTTP_TIMEOUT_MS = 1e4;
    _cachedAttestToken = null;
    _activeAttest = null;
    _OneloAttest = class _OneloAttest {
      constructor(apiUrl, publishableKey, bundleId) {
        this.apiUrl = apiUrl;
        this.publishableKey = publishableKey;
        this.bundleId = bundleId;
        this.started = false;
        /** Single-flight guard so a foreground refresh can't race the initial attest
         *  (or two foregrounds) into two concurrent fresh-key attestations. */
        this._inflight = null;
        // 4 min < 5-min server TTL
        this._statelessChallenge = null;
        /** Windowed self-heal loop guard (#34, parity with Swift): the single-flight
         *  stops CONCURRENT storms but not SEQUENTIAL ones (403 → re-attest → 403 → …).
         *  Cap re-attests per window then back off — a systematic reject can't be fixed
         *  by re-attesting and only DDoSes Apple's rate-limited attestKey + the backend. */
        this._selfHealCount = 0;
        this._selfHealWindowStart = 0;
        _setActiveAttest(this);
      }
      /**
       * Warm the cache from Keychain and attest if needed. Call once after config
       * resolves and `attest_required` is true. No-op on non-iOS / unsupported
       * devices. Never throws.
       */
      async start() {
        if (this.started) return;
        if (!this._isIOS()) return;
        const native = this._native();
        if (!native) {
          log("native module OneloAttest is not linked \u2014 did you run `pod install`? Skipping attestation.");
          return;
        }
        let supported = false;
        try {
          supported = await native.isSupported();
        } catch (e) {
          log(`isSupported() threw: ${String(e)}`);
        }
        if (!supported) {
          log("DCAppAttestService.isSupported == false (Simulator, or the App Attest capability is not enabled). Skipping attestation.");
          return;
        }
        this.started = true;
        const cached = await this._loadCached();
        if (cached && !this._isNearExpiry(cached.expiresAt)) {
          _cachedAttestToken = cached.token;
          return;
        }
        await this._attestSingleFlight(native);
      }
      /**
       * Re-attest if the cached token is missing or within {@link REFRESH_SKEW_MS} of
       * expiry. Wired to the SDK's app-foreground hook (see `onelo.ts`) — the
       * reliable moment to refresh a ~30-day token without a long-lived timer that a
       * backgrounded/killed app would drop. No-op until `start()` has run.
       */
      async refreshIfNeeded() {
        if (!this.started) return;
        const native = this._native();
        if (!native) return;
        const current = _cachedAttestToken ? await this._loadCached() : null;
        if (current && !this._isNearExpiry(current.expiresAt)) return;
        await this._attestSingleFlight(native);
      }
      // ── Attestation ───────────────────────────────────────────────────────────
      _attestSingleFlight(native) {
        if (this._inflight) return this._inflight;
        this._inflight = (async () => {
          try {
            await this._performAttestation(native);
          } catch (e) {
            log(`attestation failed: ${String(e)}`);
          } finally {
            this._inflight = null;
          }
        })();
        return this._inflight;
      }
      /**
       * Per-request App Attest assertion headers, or null (no attested key / not iOS
       * / offline) → the caller keeps the legacy `X-Attest-Token` bearer (backward
       * compatible). The signed preimage is
       * `${METHOD}\n${path?query}\n${challenge}\n${body}` — byte-identical to the
       * backend `compute_client_data_hash` (native SHA-256s it). `body` MUST be the
       * exact JSON string sent on the wire (parity is the whole point).
       */
      async assertionHeaders(method, path, query, body) {
        if (!this._isIOS()) return null;
        const native = this._native();
        if (!native?.generateAssertion) return null;
        const keyId = await this._loadKeyId();
        if (!keyId) return null;
        let challenge;
        try {
          challenge = _OneloAttest.REPLAY_GUARD_PATHS.has(path) ? await this._fetchSingleUseChallenge() : await this._cachedOrFreshStatelessChallenge();
        } catch (e) {
          log(`assertion challenge fetch failed: ${String(e)}`);
          return null;
        }
        const pathWithQuery = query ? `${path}?${query}` : path;
        const clientData = `${method.toUpperCase()}
${pathWithQuery}
${challenge}
${body}`;
        try {
          const assertion = await native.generateAssertion(keyId, clientData);
          return {
            "X-Attest-Key-Id": keyId,
            "X-Attest-Assertion": assertion,
            "X-Attest-Challenge": challenge
          };
        } catch (e) {
          log(`generateAssertion failed: ${String(e)}`);
          return null;
        }
      }
      // 5 min
      /** Self-heal after a HARD attestation reject (#24 P4): drop key+token, re-attest
       *  via the single-flight + windowed cap. NOT for counter_stale (retryable) nor
       *  the session path (Filar 5). In monitor-mode this is dormant anyway — the
       *  backend degrades a failed assertion to the bearer, so the reject codes that
       *  trigger this never come back on enforced endpoints (#34 root fix). */
      async resetForSelfHeal() {
        const native = this._native();
        if (!native) return;
        const now = Date.now();
        if (now - this._selfHealWindowStart > _OneloAttest.SELF_HEAL_WINDOW_MS) {
          this._selfHealWindowStart = now;
          this._selfHealCount = 0;
        }
        if (this._selfHealCount >= _OneloAttest.SELF_HEAL_MAX_PER_WINDOW) {
          log("self-heal cap reached \u2014 a persistent reject won't be fixed by re-attesting; backing off");
          return;
        }
        this._selfHealCount++;
        _cachedAttestToken = null;
        this._statelessChallenge = null;
        try {
          const { KeychainStorage: KeychainStorage2 } = await Promise.resolve().then(() => (init_storage(), storage_exports));
          const storage = new KeychainStorage2();
          await storage.delete(KEY_ID_KEY);
          await storage.delete(TOKEN_KEY);
          await storage.delete(EXPIRY_KEY);
        } catch {
        }
        await this._attestSingleFlight(native);
      }
      async _loadKeyId() {
        try {
          const { KeychainStorage: KeychainStorage2 } = await Promise.resolve().then(() => (init_storage(), storage_exports));
          return await new KeychainStorage2().get(KEY_ID_KEY) || null;
        } catch {
          return null;
        }
      }
      async _fetchSingleUseChallenge() {
        const url = `${this.apiUrl}/api/sdk/auth/assert-challenge?key=${encodeURIComponent(this.publishableKey)}`;
        const { status, json } = await _withTimeout(
          (0, import_core.httpGet)(url, { "X-Onelo-Instance-Id": await getInstanceId() }),
          ATTEST_HTTP_TIMEOUT_MS,
          "assert-challenge"
        );
        if (status !== 200) throw new Error(`assert-challenge failed: HTTP ${status}`);
        const ch = json?.["challenge"];
        if (typeof ch !== "string" || !ch) throw new Error("assert-challenge: no challenge in response");
        return ch;
      }
      async _cachedOrFreshStatelessChallenge() {
        const c = this._statelessChallenge;
        if (c && Date.now() - c.fetchedAt < _OneloAttest.STATELESS_MAX_AGE_MS) return c.value;
        const value = await this._fetchChallenge();
        this._statelessChallenge = { value, fetchedAt: Date.now() };
        return value;
      }
      async _performAttestation(native) {
        const keyId = await native.generateKey();
        const challenge = await this._fetchChallenge();
        const { attestation } = await native.attestKey(keyId, challenge);
        const bundleId = this.bundleId || await native.getBundleId();
        const { token, expiresAt } = await this._sendAttestation({ attestation, keyId, bundleId, challenge });
        _cachedAttestToken = token;
        await this._saveCached(token, expiresAt, keyId);
      }
      // ── Network ───────────────────────────────────────────────────────────────
      /** `GET /api/sdk/auth/attest-challenge` with `X-Onelo-Instance-Id` (parity with
       *  Swift `fetchChallenge`). */
      async _fetchChallenge() {
        const { status, json } = await _withTimeout(
          (0, import_core.httpGet)(
            `${this.apiUrl}/api/sdk/auth/attest-challenge`,
            { "X-Onelo-Instance-Id": await getInstanceId() }
          ),
          ATTEST_HTTP_TIMEOUT_MS,
          "attest-challenge"
        );
        if (status !== 200) throw new Error(`attest-challenge failed: HTTP ${status}`);
        const challenge = json?.["challenge"];
        if (typeof challenge !== "string" || !challenge) throw new Error("attest-challenge: no challenge in response");
        return challenge;
      }
      /**
       * `POST /api/sdk/auth/attest` with `X-Onelo-Instance-Id`, JSON body matching the
       * fixed backend contract (`platform: "ios"`). Returns the `attest_token` plus
       * its expiry (from the response's `expires_at`, so we never have to decode the
       * JWT to know when to refresh).
       */
      async _sendAttestation(args) {
        const { status, json } = await _withTimeout(
          (0, import_core.httpPost)(
            `${this.apiUrl}/api/sdk/auth/attest`,
            {
              attestation: args.attestation,
              key_id: args.keyId,
              bundle_id: args.bundleId,
              challenge: args.challenge,
              platform: "ios",
              publishable_key: this.publishableKey
            },
            { "X-Onelo-Instance-Id": await getInstanceId() }
          ),
          ATTEST_HTTP_TIMEOUT_MS,
          "attest"
        );
        if (status !== 200) {
          const detail = _truncate(JSON.stringify(json ?? ""), 300);
          throw new Error(`attest endpoint rejected (HTTP ${status}): ${detail}`);
        }
        const obj = json ?? {};
        const token = obj["attest_token"];
        if (typeof token !== "string" || !token) throw new Error("attest endpoint returned 200 but no attest_token");
        const expiresAt = this._parseExpiry(obj["expires_at"], token);
        return { token, expiresAt };
      }
      /** Prefer the response's `expires_at`; fall back to the JWT `exp`; last-resort a
       *  short 15-min window so a missing expiry can't pin a stale token forever. */
      _parseExpiry(expiresAtField, token) {
        if (typeof expiresAtField === "string") {
          const d = new Date(expiresAtField);
          if (!Number.isNaN(d.getTime())) return d;
        }
        const jwtExp = _decodeJwtExp(token);
        if (jwtExp) return new Date(jwtExp * 1e3);
        return new Date(Date.now() + 15 * 60 * 1e3);
      }
      // ── Token cache (Keychain) ────────────────────────────────────────────────
      _isNearExpiry(expiresAt) {
        return Date.now() + REFRESH_SKEW_MS >= expiresAt.getTime();
      }
      async _loadCached() {
        try {
          const { KeychainStorage: KeychainStorage2 } = await Promise.resolve().then(() => (init_storage(), storage_exports));
          const storage = new KeychainStorage2();
          const token = await storage.get(TOKEN_KEY);
          const expiryStr = await storage.get(EXPIRY_KEY);
          if (!token || !expiryStr) return null;
          const expiresAt = new Date(expiryStr);
          if (Number.isNaN(expiresAt.getTime())) return null;
          return { token, expiresAt };
        } catch {
          return null;
        }
      }
      async _saveCached(token, expiresAt, keyId) {
        try {
          const { KeychainStorage: KeychainStorage2 } = await Promise.resolve().then(() => (init_storage(), storage_exports));
          const storage = new KeychainStorage2();
          await storage.set(TOKEN_KEY, token);
          await storage.set(EXPIRY_KEY, expiresAt.toISOString());
          await storage.set(KEY_ID_KEY, keyId);
        } catch {
        }
      }
      // ── Environment ───────────────────────────────────────────────────────────
      // `protected` (not private) so tests can subclass and inject a fake platform /
      // native module — `require('react-native')` can't run under a plain Node test
      // runner (it loads RN's untransformed source), the same reason `monitor.ts`'s
      // lazy require isn't unit-tested through the require path.
      _isIOS() {
        try {
          const Platform = require("react-native").Platform;
          return Platform?.OS === "ios";
        } catch {
          return false;
        }
      }
      _native() {
        try {
          const NativeModules = require("react-native").NativeModules;
          const mod = NativeModules?.["OneloAttest"];
          return mod ? mod : null;
        } catch {
          return null;
        }
      }
    };
    // ── Assertions (FAZA 3 — per-request device proof) ─────────────────────────
    /** Mirror of the backend REPLAY_GUARD_PATHS (app/lib/attest_gate.py) — these
     *  need a single-use challenge; everything else reuses the stateless nonce.
     *  A path added on the server MUST be added here or the SDK sends the wrong
     *  (reusable) challenge and 403s. */
    _OneloAttest.REPLAY_GUARD_PATHS = /* @__PURE__ */ new Set([
      "/api/sdk/auth/signin",
      "/api/sdk/auth/signup",
      "/api/sdk/auth/magic-link",
      "/api/sdk/auth/hosted-callback",
      "/api/sdk/paywall/switch/apply",
      "/api/sdk/waitlist/join",
      "/api/sdk/waitlist/redeem",
      "/api/sdk/forms/submit"
    ]);
    _OneloAttest.STATELESS_MAX_AGE_MS = 24e4;
    _OneloAttest.SELF_HEAL_MAX_PER_WINDOW = 3;
    _OneloAttest.SELF_HEAL_WINDOW_MS = 3e5;
    OneloAttest = _OneloAttest;
  }
});

// src/sdk-headers.ts
var sdk_headers_exports = {};
__export(sdk_headers_exports, {
  getNativeBundleId: () => getNativeBundleId,
  sdkHeaders: () => sdkHeaders
});
async function getNativeBundleId() {
  if (_nativeBundleId !== void 0) return _nativeBundleId;
  try {
    const rn = require("react-native");
    const mod = rn.NativeModules?.["OneloAttest"];
    _nativeBundleId = mod?.getBundleId ? await mod.getBundleId() || null : null;
  } catch {
    _nativeBundleId = null;
  }
  return _nativeBundleId;
}
async function sdkHeaders(bundleId, publishableKey, assertion) {
  const instanceId = await getInstanceId();
  const attestToken = getCachedAttestToken();
  const resolvedBundleId = bundleId ?? await getNativeBundleId();
  const assertionHeaders = assertion ? await getAssertionHeaders(assertion.method, assertion.path, assertion.query ?? "", assertion.body ?? "") : null;
  return {
    "X-SDK-Version": import_package.version,
    "X-Onelo-Instance-Id": instanceId,
    "X-Onelo-Sdk-Platform": "react-native",
    ...resolvedBundleId ? { "X-Bundle-Id": resolvedBundleId } : {},
    ...publishableKey ? { "X-Publishable-Key": publishableKey } : {},
    ...attestToken ? { "X-Attest-Token": attestToken } : {},
    ...assertionHeaders ?? {}
  };
}
var import_package, _nativeBundleId;
var init_sdk_headers = __esm({
  "src/sdk-headers.ts"() {
    "use strict";
    import_package = __toESM(require_package());
    init_instance_id();
    init_attest();
    _nativeBundleId = void 0;
  }
});

// src/index.ts
var index_exports = {};
__export(index_exports, {
  AuthModal: () => AuthModal,
  ConsentGateModal: () => ConsentGateModal,
  ConsentGateModalView: () => ConsentGateModalView,
  CustomerPortalModal: () => CustomerPortalModal,
  CustomerPortalModalView: () => CustomerPortalModalView,
  FeatureState: () => FeatureState,
  FeedbackModal: () => FeedbackModal,
  Onelo: () => Onelo,
  OneloAuthGate: () => OneloAuthGate,
  OneloConsent: () => OneloConsent,
  OneloCustomerPortal: () => OneloCustomerPortal,
  OneloError: () => import_core8.OneloError,
  OneloFeatures: () => OneloFeatures,
  OneloFeaturesError: () => OneloFeaturesError,
  OneloFeedback: () => OneloFeedback,
  OneloForms: () => OneloForms,
  OneloMonitor: () => OneloMonitor,
  OneloStore: () => OneloStore,
  OneloWaitlist: () => OneloWaitlist,
  REASON_LABELS: () => import_core9.REASON_LABELS,
  RESPONSE_REASON_CODES: () => import_core9.RESPONSE_REASON_CODES,
  StoreModal: () => StoreModal,
  StoreModalView: () => StoreModalView,
  parseConsentMessage: () => parseConsentMessage,
  useConsentModalState: () => useConsentModalState,
  useModalState: () => useModalState,
  usePortalModalState: () => usePortalModalState,
  useStoreModalState: () => useStoreModalState
});
module.exports = __toCommonJS(index_exports);

// src/auth/auth.ts
var import_core2 = __toESM(require_dist());

// src/core/pkce.ts
var import_js_sha256 = require("js-sha256");
function generateCodeVerifier() {
  const cryptoObj = globalThis.crypto;
  if (!cryptoObj?.getRandomValues) {
    throw new Error(
      "[Onelo] Secure random is unavailable for PKCE. Install `react-native-get-random-values` and add `import 'react-native-get-random-values'` as the FIRST line of your app entry (index.js), before creating the Onelo client. See the Onelo SDK install snippet."
    );
  }
  const bytes = new Uint8Array(32);
  cryptoObj.getRandomValues(bytes);
  return base64urlEncode(bytes);
}
function generateCodeChallenge(verifier) {
  const hash = import_js_sha256.sha256.arrayBuffer(verifier);
  return base64urlEncode(new Uint8Array(hash));
}
function base64urlEncode(bytes) {
  let str = "";
  for (const byte of bytes) {
    str += String.fromCharCode(byte);
  }
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

// src/auth/auth.ts
init_storage();
init_sdk_headers();
var SDK_VERSION2 = require_package().version;
var CALLBACK_SCHEME = "onelorn";
var ATTEST_WAIT_CAP_MS = 5e3;
var _OneloAuth = class _OneloAuth {
  constructor(config, attestReady) {
    this.pkceVerifier = null;
    this.resolvedConfig = null;
    this.heartbeatTimer = null;
    this.refreshTimer = null;
    // Monotonic sign-out counter. signOut() bumps it; any in-flight entitlement
    // revalidation captures it BEFORE its network await and refuses to write tokens
    // back if it moved — prevents a proactive revalidate completing just after
    // sign-out from resurrecting the just-cleared session. Parity with Swift's
    // `_signOutEpoch` and the JS SDK.
    this.signOutEpoch = 0;
    /** In-flight refresh promise — single-flight dedupe so concurrent getSession()
     *  callers share ONE POST /auth/refresh. Two concurrent refreshes would POST the
     *  SAME rotating refresh_token → the backend's reuse-detection revokes the whole
     *  family → a routine foreground silently logs the user out. */
    this._refreshInFlight = null;
    this.authStateListeners = [];
    this.modalStateListeners = [];
    this._modalVisible = false;
    this._modalUrl = "";
    this._modalResolve = null;
    this.isReady = false;
    this.isRevoked = false;
    /** #29 — non-null when `initialize()` threw (e.g. the `react-native-get-random-values`
     *  polyfill is missing, so `generateCodeVerifier()` throws). Previously that error
     *  was swallowed silently, leaving `isReady=false` forever with NO trace. Surfaced
     *  here (and logged) so the failure is diagnosable instead of a mystery. */
    this.initError = null;
    /** True once the CURRENT user's session was revoked server-side (a
     *  `session.revoked` SSE push, or — future — a heartbeat 401 / refresh
     *  user_revoked). Distinct from `isRevoked` (the whole app key was revoked).
     *  Parity with Swift/JS `isUserRevoked`. */
    this.isUserRevoked = false;
    this.allowCustomBranding = false;
    this.appName = "App";
    this.appLogoUrl = null;
    /** True when the backend requires iOS App Attest for this app (at least one
     *  registered bundle id has `attest_enabled=true`). Read from `/api/sdk/config`
     *  (`attest_required`); the composition root (`Onelo`) uses it to decide whether
     *  to kick off attestation. Parity with Swift `OneloAuth.attestRequired`. */
    this.attestRequired = false;
    if (!config.apiUrl) throw new Error("[Onelo] apiUrl is required");
    if (!config.publishableKey) throw new Error("[Onelo] publishableKey is required");
    this._attestReady = attestReady;
    this.apiUrl = config.apiUrl;
    this.publishableKey = config.publishableKey;
    this.bundleId = config.bundleId;
    this._callbackScheme = config.callbackScheme || CALLBACK_SCHEME;
    this.storage = new KeychainStorage();
    if (!config.bundleId) {
      void getNativeBundleId().then((nb) => {
        if (!nb) {
          console.warn(
            '[Onelo] No `bundleId` in config and none could be derived natively (Android has no native source; on iOS the native module must be linked). Set `bundleId` to your app id (e.g. "com.company.app") \u2014 it is REQUIRED for bundle attestation. Without it, requests are rejected with bundle_id_mismatch (403) once enforcement is active.'
          );
        }
      });
    }
    this.initPromise = this.initialize();
  }
  /** Deep-link callback scheme this app returns through (config.callbackScheme,
   *  default 'onelorn'). Register it natively (Android intent-filter + iOS
   *  CFBundleURLSchemes); AuthModal/StoreModal/PortalModal catch `<scheme>://…`. */
  get callbackScheme() {
    return this._callbackScheme;
  }
  /**
   * Common security headers for every auth request — `X-SDK-Version`,
   * `X-Bundle-Id`, `X-Onelo-Instance-Id`, `X-Onelo-Sdk-Platform` (via
   * `sdkHeaders`) plus per-request extras (`Authorization` / `X-Publishable-Key`).
   * Threading the bundle id is what lets a LIVE React Native app pass the
   * backend's `validate_sdk_request_security` gate (which enforces `X-Bundle-Id`
   * for native app types once a bundle is registered) — without it, `flow/init`
   * and `initiate` are rejected and sign-in throws.
   */
  async _secHeaders(extra = {}) {
    return { ...await sdkHeaders(this.bundleId), ...extra };
  }
  /**
   * Block until iOS App Attest has produced its token (or settled as
   * not-required / failed) BEFORE the first gated request. The composition root
   * kicks attestation off in the background (fire-and-forget) so it never blocks
   * construction; without this gate a cold-start `loadAuthView` / `signIn` races
   * AHEAD of the ~3-4-round-trip attestation and the backend rejects the
   * tokenless request with 403 — which then "works" a couple seconds later once
   * the cached token exists (#25). Attestation is best-effort, so the wait only
   * costs the sub-second–2s it takes and never throws. No-op (resolves after
   * config) when attestation isn't required, or when used without the root.
   *
   * MUST NOT be called from `_secHeaders` / `initialize`: attestation awaits
   * `whenReady()` (initPromise), so gating header-building on it would deadlock.
   * Only call it at gated ENTRY points, after config is available.
   *
   * The wait is BOUNDED (`ATTEST_WAIT_CAP_MS`): attestation is best-effort and
   * its `fetch` calls have no timeout, so a stalled network handshake (captive
   * portal, dead socket) must never hang the auth UI. On the cap we proceed
   * tokenless — the same outcome as before this gate existed (a possible 403 the
   * app already handles) — while the background attestation keeps running so its
   * token rides later requests. `catch` alone is NOT enough: the risk is
   * non-settlement, not rejection.
   */
  async _awaitAttestReady() {
    await this.initPromise;
    if (!this.attestRequired || !this._attestReady) return;
    let timer;
    const cap = new Promise((resolve) => {
      timer = setTimeout(resolve, ATTEST_WAIT_CAP_MS);
    });
    try {
      await Promise.race([this._attestReady(), cap]);
    } catch {
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  async initialize() {
    try {
      const verifier = generateCodeVerifier();
      this.pkceVerifier = verifier;
      const challenge = generateCodeChallenge(verifier);
      const url = `${this.apiUrl}/api/sdk/config?key=${encodeURIComponent(this.publishableKey)}&code_challenge=${encodeURIComponent(challenge)}`;
      const { status, json } = await (0, import_core2.httpGet)(url, await this._secHeaders());
      if (status === 401 || status === 404) throw import_core2.OneloError.invalidKey("Server rejected the key");
      if (status !== 200) throw import_core2.OneloError.server(`Config request failed: HTTP ${status}`);
      const j = json;
      this.resolvedConfig = {
        supabaseUrl: j["supabase_url"],
        supabaseAnonKey: j["supabase_anon_key"],
        tenantId: j["tenant_id"],
        allowCustomBranding: j["allow_custom_branding"] ?? false,
        appName: j["app_name"] ?? null,
        appLogoUrl: j["app_logo_url"] ?? null,
        paywallEnabled: j["paywall_enabled"] ?? false,
        waitlistMode: j["waitlist_mode"] ?? false,
        sdkRedirectUrl: j["sdk_redirect_url"] ?? null,
        storeUrl: j["store_url"] ?? null,
        manageUrl: j["manage_url"] ?? null,
        // Branding page background (--onelo-page-bg). Native WebViews paint this so
        // there is no white flash before the hosted page renders. Default #111111.
        pageBackgroundColor: j["checkout_bg_color"] || "#111111",
        // Plan-gated enabled OAuth providers (google/github/apple). Previously
        // unmapped — the field is surfaced via the `oauthProviders` getter and
        // consumed by the Round 2 OAuth entry point.
        oauthProviders: Array.isArray(j["oauth_providers"]) ? j["oauth_providers"] : void 0
      };
      this.attestRequired = j["attest_required"] ?? false;
      const resolved = this.resolvedConfig;
      this.allowCustomBranding = resolved.allowCustomBranding;
      if (resolved.appName) this.appName = resolved.appName;
      this.appLogoUrl = resolved.appLogoUrl;
      this.isReady = true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.initError = msg;
      console.warn(
        "[Onelo] SDK initialization failed \u2014 auth, attestation and config-gated features are disabled until this is fixed: " + msg
      );
      if (e instanceof import_core2.OneloError && e.code === "invalid_publishable_key") {
        this.isRevoked = true;
      }
    }
  }
  async whenReady() {
    await this.initPromise;
  }
  // ── Hosted flow ─────────────────────────────────────────────────────────────
  async loadAuthView() {
    await this.initPromise;
    if (this.isRevoked) throw import_core2.OneloError.invalidKey("Application key has been revoked");
    let decision = null;
    const { status, json } = await this._flowInit();
    if (status !== 404 && status !== 405) decision = this._decisionFromFlow(status, json);
    if (decision?.action === "authorized") {
      if (this.isPaywallEnabled()) await this.revalidateEntitlement().catch(() => {
      });
      return await this.getSession();
    }
    const hostedUrl = decision ? decision.url : await this.getHostedUrl();
    return new Promise((resolve, reject) => {
      this._modalResolve = async (result) => {
        this._modalVisible = false;
        this._modalResolve = null;
        this.notifyModalListeners();
        if (result.type === "cancelled") {
          resolve(null);
          return;
        }
        if (result.type === "error") {
          reject(import_core2.OneloError.server(result.message));
          return;
        }
        try {
          resolve(await this.exchangeHostedCode(result.code));
        } catch (e) {
          reject(e);
        }
      };
      this._modalUrl = hostedUrl;
      this._modalVisible = true;
      this.notifyModalListeners();
    });
  }
  /**
   * Exchange a hosted-flow one-time code (sign-in OR store checkout) for a
   * session and persist it, leaving the user signed in and firing
   * onAuthStateChange. Shared by `loadAuthView` and the store flow (OneloStore)
   * so the exchange lives in exactly one place. `POST /api/sdk/auth/hosted-callback`
   * body `{publishableKey, code, code_verifier}` (PKCE snake even in a camel body).
   */
  async exchangeHostedCode(code) {
    const { status, json } = await (0, import_core2.httpPost)(
      `${this.apiUrl}/api/sdk/auth/hosted-callback`,
      { publishableKey: this.publishableKey, code, code_verifier: this.pkceVerifier },
      await this._secHeaders()
    );
    if (status !== 200) throw import_core2.OneloError.server("Hosted callback failed");
    const session = (0, import_core2.mapSession)(json);
    await this.saveSession(session);
    return session;
  }
  /** Returns modal state for rendering — use with <AuthModal> component */
  getModalState() {
    return {
      visible: this._modalVisible,
      url: this._modalUrl,
      onResult: this._modalResolve
    };
  }
  /** Subscribe to modal state changes. Returns an unsubscribe function. */
  onModalStateChange(callback) {
    this.modalStateListeners.push(callback);
    return () => {
      this.modalStateListeners = this.modalStateListeners.filter((l) => l !== callback);
    };
  }
  async getHostedUrl() {
    const { status, json } = await (0, import_core2.httpGet)(
      `${this.apiUrl}/api/sdk/auth/initiate?key=${encodeURIComponent(this.publishableKey)}&callback_scheme=${this._callbackScheme}`,
      await this._secHeaders()
    );
    if (status !== 200) throw import_core2.OneloError.server("Failed to initiate hosted auth flow");
    const j = json;
    const hostedUrl = j["hosted_url"];
    if (!hostedUrl) throw import_core2.OneloError.server("Invalid initiate response");
    if (j["app_name"]) this.appName = j["app_name"];
    if (j["app_logo_url"]) this.appLogoUrl = j["app_logo_url"];
    return hostedUrl;
  }
  /**
   * Ask the backend for the single next flow step (`GET /api/sdk/flow/init`).
   * Sends the current access token as a Bearer when signed in so the backend can
   * decide authorized-vs-sign-in-vs-store bound to this user. Returns
   * `{action:'authorized'}` (show content, no UI) or `{action:'present', url,…}`
   * (open `url` in the hosted WebView). Throws `OneloError.server` on any non-200
   * — including `store_not_configured`, which this SDK's error taxonomy has no
   * dedicated code for (mirrors the JS SDK). Public so a Round 2 content-gate /
   * accessory WebView can reuse the same centralised decision. Parity with Swift
   * `resolveFlow` and JS `resolveFlow`.
   */
  async resolveFlow(lang) {
    const { status, json } = await this._flowInit(lang);
    return this._decisionFromFlow(status, json);
  }
  /** Raw `/flow/init` request — returns status + body so `loadAuthView` can tell
   *  "endpoint unavailable" (404/405 → legacy fallback) apart from a real error
   *  (surfaced by `_decisionFromFlow`). */
  async _flowInit(lang) {
    await this._awaitAttestReady();
    const existing = await this.getSession();
    const headers = await this._secHeaders();
    if (existing?.accessToken) headers["Authorization"] = `Bearer ${existing.accessToken}`;
    const langParam = lang ? `&lang=${encodeURIComponent(lang)}` : "";
    const { status, json } = await (0, import_core2.httpGet)(
      `${this.apiUrl}/api/sdk/flow/init?key=${encodeURIComponent(this.publishableKey)}&callback_scheme=${this._callbackScheme}${langParam}`,
      headers
    );
    return { status, json: json ?? {} };
  }
  /** Map a `/flow/init` response to a FlowDecision, throwing on any non-200. */
  _decisionFromFlow(status, j) {
    if (status !== 200) {
      const detail = j["detail"];
      const reason = typeof detail === "string" ? detail : j["error"] ?? `HTTP ${status}`;
      throw import_core2.OneloError.server(`Failed to resolve auth flow: ${reason}`);
    }
    if (j["action"] === "authorized") return { action: "authorized" };
    if (j["action"] === "present" && typeof j["url"] === "string") {
      const appName = typeof j["app_name"] === "string" ? j["app_name"] : void 0;
      const appLogo = typeof j["app_logo_url"] === "string" ? j["app_logo_url"] : void 0;
      if (appName) this.appName = appName;
      if (appLogo) this.appLogoUrl = appLogo;
      return { action: "present", surface: String(j["surface"] ?? ""), url: j["url"], appName, appLogo };
    }
    throw import_core2.OneloError.server("Invalid flow response");
  }
  // ── Custom UI (paid plans only) ─────────────────────────────────────────────
  async signIn(email, password) {
    await this.initPromise;
    await this._awaitAttestReady();
    if (!this.allowCustomBranding) throw import_core2.OneloError.planRequired();
    if (!this.pkceVerifier) this.pkceVerifier = generateCodeVerifier();
    const { status, json } = await (0, import_core2.httpPost)(
      `${this.apiUrl}/api/sdk/auth/signin`,
      { email, password, publishableKey: this.publishableKey, code_verifier: this.pkceVerifier },
      await this._secHeaders()
    );
    (0, import_core2.checkHostedFlowRequired)(json);
    const j = json;
    if (status === 403) {
      const detail = j["detail"];
      if (detail?.["error"] === "user_revoked") throw import_core2.OneloError.userRevoked();
      throw import_core2.OneloError.server(detail?.["message"] ?? j["error"]);
    }
    if (status !== 200) throw import_core2.OneloError.server(`Sign in failed: HTTP ${status}`);
    this.pkceVerifier = null;
    const session = (0, import_core2.mapSession)(j);
    await this.saveSession(session);
    return session;
  }
  async signUp(email, password) {
    await this.initPromise;
    await this._awaitAttestReady();
    if (!this.allowCustomBranding) throw import_core2.OneloError.planRequired();
    if (!this.pkceVerifier) this.pkceVerifier = generateCodeVerifier();
    const { status, json } = await (0, import_core2.httpPost)(
      `${this.apiUrl}/api/sdk/auth/signup`,
      { email, password, publishableKey: this.publishableKey, code_verifier: this.pkceVerifier },
      await this._secHeaders()
    );
    (0, import_core2.checkHostedFlowRequired)(json);
    const j = json;
    if (status !== 200) throw import_core2.OneloError.server(`Sign up failed: HTTP ${status}`);
    this.pkceVerifier = null;
    const session = (0, import_core2.mapSession)(j);
    await this.saveSession(session);
    return session;
  }
  // ── Session management ──────────────────────────────────────────────────────
  async signOut() {
    this.signOutEpoch++;
    this.stopHeartbeat();
    this.clearRefreshTimer();
    const accessToken = await this.storage.get(import_core2.TOKEN_KEYS.ACCESS_TOKEN);
    await this.storage.clear();
    this.notifyListeners(null);
    if (accessToken) {
      const headers = await this._secHeaders({
        Authorization: `Bearer ${accessToken}`,
        "X-Publishable-Key": this.publishableKey
      });
      void (0, import_core2.httpPost)(`${this.apiUrl}/api/sdk/auth/signout`, {}, headers).catch(() => {
      });
    }
  }
  // ── Real-time revocation (shared SSE stream) ─────────────────────────────────
  /**
   * Wire the shared event stream (called once by Onelo, BEFORE the stream is
   * started). Registers a `session.revoked` listener so a server-side revoke
   * (refund lapse, admin force-logout, account deletion, ban) signs the user out
   * in ~sub-second — the real-time complement to the ≤13-min heartbeat fallback.
   * Registered once and survives sign-in/sign-out cycles, exactly like Swift's
   * `_handleSessionRevoked` wiring. Does NOT start the stream — Onelo owns the
   * connection lifecycle.
   */
  attachEventStream(stream) {
    stream.on("session.revoked", (data) => {
      void this._handleSessionRevoked(data);
    });
  }
  /**
   * Handle a `session.revoked` push. One app can multiplex multiple buyers on the
   * shared connection, so filter to the current user: a `app_user_id` that
   * targets a DIFFERENT user is ignored; a missing `app_user_id` is treated as
   * "current user" (forward-compat — the backend may omit it for account-wide
   * revokes). No active session → nothing to revoke. Teardown mirrors `signOut()`
   * exactly (and bumps `signOutEpoch` first) so an in-flight refresh/entitlement
   * revalidation can't resurrect the just-cleared session.
   */
  async _handleSessionRevoked(data) {
    const userJson = await this.storage.get(import_core2.TOKEN_KEYS.USER_JSON);
    if (!userJson) return;
    let currentUserId;
    try {
      currentUserId = JSON.parse(userJson).id;
    } catch {
    }
    const eventUserId = data["app_user_id"];
    if (typeof eventUserId === "string" && currentUserId && eventUserId !== currentUserId) {
      return;
    }
    this.signOutEpoch++;
    this.stopHeartbeat();
    this.clearRefreshTimer();
    await this.storage.clear();
    this.isUserRevoked = true;
    this.notifyListeners(null);
  }
  /**
   * Fast presence probe for a stored session — reads the token keys ONLY, with
   * NO refresh and NO network. The React Native analogue of Swift's SYNCHRONOUS
   * `hasStoredSessionSync()` (#36): RN's Keychain storage is async-only, so this
   * is a Promise, but it is far cheaper than `getSession()` (no near-expiry
   * refresh) / `whenReady()` (no config wait). `OneloAuthGate` uses it to tell
   * "restoring an existing session on cold start" (→ show a neutral branded
   * background, never the sign-in skeleton) apart from a "genuine no-session cold
   * start" (→ show the sign-in skeleton immediately) — so an auto-login never
   * flashes the sign-in form before content. Returns true only when access +
   * refresh tokens AND a decodable user (with an id) are all present; never throws.
   */
  async hasStoredSession() {
    try {
      const [accessToken, refreshToken, userJson] = await Promise.all([
        this.storage.get(import_core2.TOKEN_KEYS.ACCESS_TOKEN),
        this.storage.get(import_core2.TOKEN_KEYS.REFRESH_TOKEN),
        this.storage.get(import_core2.TOKEN_KEYS.USER_JSON)
      ]);
      if (!accessToken || !refreshToken || !userJson) return false;
      const user = JSON.parse(userJson);
      return typeof user?.id === "string" && user.id.length > 0;
    } catch {
      return false;
    }
  }
  async getSession() {
    const [accessToken, refreshToken, expiresAtStr, userJson] = await Promise.all([
      this.storage.get(import_core2.TOKEN_KEYS.ACCESS_TOKEN),
      this.storage.get(import_core2.TOKEN_KEYS.REFRESH_TOKEN),
      this.storage.get(import_core2.TOKEN_KEYS.EXPIRES_AT),
      this.storage.get(import_core2.TOKEN_KEYS.USER_JSON)
    ]);
    if (!accessToken || !refreshToken || !userJson) return null;
    const expiresAt = parseInt(expiresAtStr ?? "0", 10);
    if (Date.now() / 1e3 > expiresAt - 60) {
      return this.refreshSession();
    }
    const user = JSON.parse(userJson);
    if (!user.id) {
      await this.storage.clear();
      return null;
    }
    const session = { accessToken, refreshToken, expiresAt, user };
    this.scheduleRefresh(session);
    return session;
  }
  async refreshSession() {
    if (this._refreshInFlight) return this._refreshInFlight;
    this._refreshInFlight = this._doRefresh();
    try {
      return await this._refreshInFlight;
    } finally {
      this._refreshInFlight = null;
    }
  }
  async _doRefresh() {
    const epoch = this.signOutEpoch;
    const refreshToken = await this.storage.get(import_core2.TOKEN_KEYS.REFRESH_TOKEN);
    if (!refreshToken) return null;
    const { status, json } = await (0, import_core2.httpPost)(
      `${this.apiUrl}/api/sdk/auth/refresh`,
      // Wire key MUST be snake_case `refresh_token`: the backend
      // RefreshRequest model (sdk_auth.py) requires it and rejects a
      // camelCase `refreshToken` with a hard 422 (the handler never runs).
      // Matches every response payload + the Swift SDK request.
      { publishableKey: this.publishableKey, refresh_token: refreshToken },
      await this._secHeaders()
    );
    (0, import_core2.checkHostedFlowRequired)(json);
    const j = json;
    const teardown = async () => {
      if (epoch !== this.signOutEpoch) return;
      this.clearRefreshTimer();
      await this.storage.clear();
      this.notifyListeners(null);
    };
    if (j["error"] === "user_revoked") {
      if (epoch === this.signOutEpoch) this.isUserRevoked = true;
      await teardown();
      throw import_core2.OneloError.userRevoked();
    }
    if (j["error"] === "app_revoked") {
      if (epoch === this.signOutEpoch) this.isRevoked = true;
      await teardown();
      throw import_core2.OneloError.revoked();
    }
    if (status !== 200) {
      await teardown();
      return null;
    }
    if (epoch !== this.signOutEpoch) return null;
    const session = (0, import_core2.mapSession)(j);
    await this.saveSession(session);
    return session;
  }
  /**
   * One-time cold-start restore: if a valid session sits in the keychain, PUBLISH
   * it (so the Onelo bridge starts the SSE stream — incl. `session.revoked` — plus
   * features/monitor/consent and arms the heartbeat) and best-effort verify it
   * against the backend. Without this a returning signed-in user gets NONE of those
   * on launch: `notifyListeners` only fires from `saveSession` (a fresh sign-in or
   * refresh), so real-time revocation, per-user features, and the consent gate would
   * silently not run until a token refresh eventually happened. Parity with Swift
   * `restoreSession`. Call once from the Onelo composition root.
   */
  async restoreSession() {
    await this.initPromise;
    let session;
    try {
      session = await this.getSession();
    } catch {
      return null;
    }
    if (!session) return null;
    if (this.heartbeatTimer === null) {
      this.startHeartbeat(session.accessToken);
      this.notifyListeners(session);
    }
    if (this.isPaywallEnabled()) void this.revalidateEntitlement().catch(() => {
    });
    void this._verifySession(session.accessToken).catch(() => {
    });
    return session;
  }
  /**
   * Best-effort backend session check (`GET /api/sdk/auth/verify`, sdk_auth.py:2911)
   * — catches an account revoked/deleted/suspended while the app was OFFLINE, which
   * the SSE push can't deliver. 403 with a revoke reason → clear + `isUserRevoked`;
   * any other status / network failure fails OPEN (keep the cached session). Epoch-
   * guarded so a concurrent sign-out isn't clobbered.
   */
  async _verifySession(accessToken) {
    const epoch = this.signOutEpoch;
    try {
      const { status, json } = await (0, import_core2.httpGet)(
        `${this.apiUrl}/api/sdk/auth/verify`,
        await this._secHeaders({ Authorization: `Bearer ${accessToken}` })
      );
      if (status !== 403) return;
      const j = json;
      const detail = j["detail"];
      const reason = String(detail?.["error"] ?? j["error"] ?? "");
      const revokeReasons = [
        "revoked",
        "deleted",
        "suspended",
        "banned",
        "account_revoked",
        "account_deleted",
        "account_suspended",
        "session_compromised"
      ];
      if (revokeReasons.includes(reason) && epoch === this.signOutEpoch) {
        this.stopHeartbeat();
        this.clearRefreshTimer();
        this.signOutEpoch++;
        await this.storage.clear();
        this.isUserRevoked = true;
        this.notifyListeners(null);
      }
    } catch {
    }
  }
  // ── Entitlement ─────────────────────────────────────────────────────────────
  /**
   * True when the current session's user has an active paid entitlement.
   * Snapshot read of the persisted session (no network) — mirrors Swift's
   * `hasActiveAccess`. Returns false when there is no session.
   */
  async hasActiveAccess() {
    const session = await this.getSession();
    return session?.user.entitlement === "active";
  }
  /**
   * Re-fetch the user's entitlement from the backend and, if it changed, rebuild
   * + persist + republish the session so `hasActiveAccess()` and auth-state
   * listeners see the new value. Call after an external checkout or on app
   * resume. Best-effort: returns the currently-cached entitlement on any
   * non-200/network failure and never throws (mirrors Swift/JS
   * `revalidateEntitlement`). Epoch-guarded: a sign-out that races this request
   * cancels the write-back so a stale entitlement can't resurrect the session.
   */
  async revalidateEntitlement() {
    const epoch = this.signOutEpoch;
    const session = await this.getSession();
    if (!session) return "none";
    try {
      const { status, json } = await (0, import_core2.httpGet)(
        `${this.apiUrl}/api/sdk/auth/user`,
        await this._secHeaders({
          Authorization: `Bearer ${session.accessToken}`,
          "X-Publishable-Key": this.publishableKey
        })
      );
      if (status !== 200) return session.user.entitlement;
      const next = json["entitlement"] === "active" ? "active" : "none";
      if (next !== session.user.entitlement && epoch === this.signOutEpoch) {
        await this.saveSession({ ...session, user: { ...session.user, entitlement: next } });
      }
      return next;
    } catch {
      return session.user.entitlement;
    }
  }
  /** True when the app has the paywall enabled (from `/api/sdk/config`). Gate
   *  callers use this so non-paywall apps enter on a session alone (their
   *  `entitlement` is always `'none'`). Mirrors Electron `isPaywallEnabled`. */
  isPaywallEnabled() {
    return this.resolvedConfig?.paywallEnabled ?? false;
  }
  /** Branding "Page background" color (`checkout_bg_color`, --onelo-page-bg) from
   *  `/api/sdk/config`. Native modals paint their WebView + container with this so
   *  there is no white flash before the hosted page's own background renders.
   *  Defaults to #111111 (the hosted-page default) before config resolves. */
  pageBackgroundColor() {
    return this.resolvedConfig?.pageBackgroundColor ?? "#111111";
  }
  /** Plan-gated enabled OAuth providers (google/github/apple) from
   *  `/api/sdk/config`; empty when social is disabled. Consumed by the Round 2
   *  OAuth entry point. */
  get oauthProviders() {
    return this.resolvedConfig?.oauthProviders ?? [];
  }
  /** Backend base URL. `AuthModal` uses it to build the OAuth system-browser
   *  hand-off URL (`{baseUrl}/api/sdk/auth/oauth/hosted-init?provider=…&token=…`)
   *  when the hosted page relays a `native_oauth{provider,token}` message. Optional for
   *  the primary OAuth path (a hosted-page `window.location.href` navigation to
   *  the full provider/oauth-init URL is diverted to the system browser without
   *  it) — thread it only to enable the message-relay path. */
  get baseUrl() {
    return this.apiUrl;
  }
  onAuthStateChange(callback) {
    this.authStateListeners.push(callback);
    return () => {
      this.authStateListeners = this.authStateListeners.filter((l) => l !== callback);
    };
  }
  startHeartbeat(accessToken) {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(async () => {
      const epoch = this.signOutEpoch;
      try {
        const session = await this.getSession();
        if (!session) {
          this.stopHeartbeat();
          return;
        }
        const res = await fetch(`${this.apiUrl}/api/sdk/presence/heartbeat`, {
          method: "POST",
          headers: await this._secHeaders({ Authorization: `Bearer ${session.accessToken}` })
        });
        if (res.status === 401 && epoch === this.signOutEpoch) {
          this.stopHeartbeat();
          this.clearRefreshTimer();
          this.signOutEpoch++;
          await this.storage.clear();
          this.isUserRevoked = true;
          this.notifyListeners(null);
        }
      } catch {
      }
    }, _OneloAuth.HEARTBEAT_MS);
  }
  stopHeartbeat() {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
  /**
   * Schedule a background refresh of the access token to fire `REFRESH_LEAD_SECONDS`
   * before it expires. Idempotent — cancels any pending refresh first. Without this,
   * an idle app would carry a stale token past its TTL and the next request would 401.
   */
  scheduleRefresh(session) {
    this.clearRefreshTimer();
    const nowSec = Date.now() / 1e3;
    const delaySec = session.expiresAt - nowSec - _OneloAuth.REFRESH_LEAD_SECONDS;
    const delayMs = delaySec > 0 ? delaySec * 1e3 : 0;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void this.refreshSession().catch(() => {
      });
    }, delayMs);
  }
  clearRefreshTimer() {
    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }
  async saveSession(session) {
    await Promise.all([
      this.storage.set(import_core2.TOKEN_KEYS.ACCESS_TOKEN, session.accessToken),
      this.storage.set(import_core2.TOKEN_KEYS.REFRESH_TOKEN, session.refreshToken),
      this.storage.set(import_core2.TOKEN_KEYS.EXPIRES_AT, String(session.expiresAt)),
      this.storage.set(import_core2.TOKEN_KEYS.USER_JSON, JSON.stringify(session.user))
    ]);
    this.isUserRevoked = false;
    this.notifyListeners(session);
    this.startHeartbeat(session.accessToken);
    this.scheduleRefresh(session);
  }
  notifyListeners(session) {
    for (const cb of this.authStateListeners) cb(session);
  }
  notifyModalListeners() {
    for (const cb of this.modalStateListeners) cb();
  }
  // ── Magic link & password reset ─────────────────────────────────────────────
  async sendMagicLink(email) {
    await this.initPromise;
    const { status } = await (0, import_core2.httpPost)(
      `${this.apiUrl}/api/sdk/auth/magic-link`,
      { email, publishableKey: this.publishableKey },
      await this._secHeaders()
    );
    if (status !== 200) throw import_core2.OneloError.server(`sendMagicLink failed: HTTP ${status}`);
  }
  async sendPasswordReset(email) {
    await this.initPromise;
    const { status } = await (0, import_core2.httpPost)(
      `${this.apiUrl}/api/sdk/auth/reset-password/request`,
      { email, publishableKey: this.publishableKey },
      await this._secHeaders()
    );
    if (status !== 200) throw import_core2.OneloError.server(`sendPasswordReset failed: HTTP ${status}`);
  }
};
_OneloAuth.HEARTBEAT_MS = 13 * 60 * 1e3;
/** Refresh this many seconds before the access token expires. */
_OneloAuth.REFRESH_LEAD_SECONDS = 60;
var OneloAuth = _OneloAuth;

// src/features/features.ts
var import_core3 = __toESM(require_dist());

// src/features/feature-cache.ts
async function loadFeatureCache(key) {
  try {
    const { KeychainStorage: KeychainStorage2 } = await Promise.resolve().then(() => (init_storage(), storage_exports));
    const raw = await new KeychainStorage2().get(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
async function saveFeatureCache(key, value) {
  try {
    const { KeychainStorage: KeychainStorage2 } = await Promise.resolve().then(() => (init_storage(), storage_exports));
    await new KeychainStorage2().set(key, JSON.stringify(value));
  } catch {
  }
}

// src/features/features.ts
var KNOWN_STATUSES = /* @__PURE__ */ new Set([
  "enabled",
  "disabled",
  "greyed",
  "hidden",
  "upsell",
  "new",
  "beta",
  "coming_soon"
]);
function normalizeStatus(status) {
  return KNOWN_STATUSES.has(status) ? status : "hidden";
}
var KNOWN_REASONS = /* @__PURE__ */ new Set([
  "user_override",
  "plan",
  "default",
  "static",
  "paywall_no_plan",
  "paywall_off",
  "suspended",
  "unknown"
]);
function normalizeReason(reason) {
  if (reason == null) return void 0;
  return KNOWN_REASONS.has(reason) ? reason : "unknown";
}
function wireToEntry(w) {
  return {
    status: normalizeStatus(w.status),
    reason: normalizeReason(w.reason),
    requiredPlan: w.required_plan,
    requiredPlanLabel: w.required_plan_label,
    upgradeCta: w.upgrade_cta ?? false
  };
}
var FeatureState = class {
  constructor(name, status, reason, requiredPlan, requiredPlanLabel, upgradeCta = false) {
    this.name = name;
    this.status = status;
    this.reason = reason;
    this.requiredPlan = requiredPlan;
    this.requiredPlanLabel = requiredPlanLabel;
    this.upgradeCta = upgradeCta;
  }
  get isEnabled() {
    return this.status === "enabled" || this.status === "new" || this.status === "beta";
  }
  get isDisabled() {
    return this.status === "disabled";
  }
  get isVisible() {
    return this.status !== "hidden";
  }
  get isGreyed() {
    return this.status === "greyed";
  }
  get isUpsell() {
    return this.status === "upsell";
  }
  get isNew() {
    return this.status === "new";
  }
  get isBeta() {
    return this.status === "beta";
  }
  get isComingSoon() {
    return this.status === "coming_soon";
  }
  /** Promo/lock badge (parity with Swift): New/Beta/Coming Soon, 🔒 for greyed
   *  (locked — never hide it), and "Available in <plan>" for upsell. */
  get badgeLabel() {
    switch (this.status) {
      case "new":
        return "New";
      case "beta":
        return "Beta";
      case "coming_soon":
        return "Coming Soon";
      case "greyed":
        return "\u{1F512}";
      case "upsell":
        if (this.requiredPlanLabel) return `Available in ${this.requiredPlanLabel}`;
        if (this.requiredPlan) return `Available in ${this.requiredPlan}`;
        return "Upgrade";
      default:
        return null;
    }
  }
  /** Non-null when the feature is plan-blocked AND the backend named the
   *  unlocking plan — surface in upgrade-prompt UI. */
  get upgradeHint() {
    if (this.reason === "plan" && this.requiredPlan && (this.status === "greyed" || this.status === "hidden" || this.status === "upsell" || this.status === "coming_soon")) {
      return { requiredPlan: this.requiredPlan, currentStatus: this.status };
    }
    return null;
  }
};
var OneloFeaturesError = class _OneloFeaturesError extends Error {
  constructor(code, message) {
    super(message ?? code);
    this.code = code;
    this.name = "OneloFeaturesError";
    Object.setPrototypeOf(this, _OneloFeaturesError.prototype);
  }
};
var POLL_INTERVAL_MS = 6e4;
var REFRESH_DEBOUNCE_MS = 1e3;
var CACHE_KEY_PREFIX = "io.onelo.features";
var OneloFeatures = class {
  constructor(apiUrl, publishableKey, monitor, bundleId, options) {
    this.cache = /* @__PURE__ */ new Map();
    // In-memory observers notified AFTER any cache change (SSE Deploy push,
    // foreground/identity resync, invalidateCache). Purely local fan-out — no
    // network, no DB, no extra SSE (reuses the one shared stream).
    this.changeListeners = /* @__PURE__ */ new Set();
    this.discoveredNames = /* @__PURE__ */ new Set();
    this.configVersion = 0;
    this.pollTimer = null;
    this.pingDebounce = null;
    this.monitor = null;
    this.anonymousWarningLogged = false;
    this.currentUserId = null;
    // Secure-mode targeting hash (HMAC of userId, computed on the DEV's server and
    // forwarded here — the SDK never holds the secret). Threaded into
    // resolve / batch-ping / module-token.
    this.currentUserIdHash = null;
    // Shared multiplexed SSE stream — INJECTED by Onelo (composition root) via
    // attachEventStream(). Features NEVER calls start()/stop() on it: auth owns the
    // lifecycle (starts it on sign-in, stops on sign-out). Null in standalone use /
    // tests, where load() falls back to a one-shot resolve + 60s poll.
    this.stream = null;
    // ready() cold-start sync — resolved on the first applied snapshot or timeout
    // (parity with Swift firstEventReceived + readyWaiters).
    this.firstEventReceived = false;
    this.readyWaiters = /* @__PURE__ */ new Set();
    // refresh() debounce cursor (parity with Swift lastRefreshAt).
    this.lastRefreshAt = 0;
    this.apiUrl = apiUrl;
    this.publishableKey = publishableKey;
    this.monitor = monitor ?? null;
    this.bundleId = bundleId;
    this.suppressIdentifyWarning = options?.suppressIdentifyWarning ?? false;
    this.featureEnvironment = options?.featureEnvironment;
    this.defaultStatus = options?.featureDefaultStatus ?? "hidden";
  }
  /**
   * Wire the shared multiplexed SSE stream (called once by Onelo). Registers the
   * four feature-side handlers; handlers survive reconnects and receive the
   * already-parsed event `data`. Does NOT start the stream — auth owns its
   * lifecycle (parity with Swift `ownsEventStream = false`).
   */
  attachEventStream(stream) {
    this.stream = stream;
    if (this.featureEnvironment) stream.featureEnvironment = this.featureEnvironment;
    const applyIfSnapshot = (data) => {
      const features = data["features"];
      if (features) {
        const v = typeof data["config_version"] === "number" ? data["config_version"] : this.configVersion;
        this._applySnapshot(v, features);
      }
    };
    stream.on("connected", (data) => {
      applyIfSnapshot(data);
      this._maybeWarnAnonymous(data);
      this._signalFirstEvent();
    });
    stream.on("features_updated", applyIfSnapshot);
    stream.on("up_to_date", (data) => {
      if (typeof data["config_version"] === "number") this.configVersion = data["config_version"];
      this._signalFirstEvent();
    });
    stream.on("discovery_requested", () => this._scheduleBatchPing());
  }
  /** Declare feature names upfront — triggers a batch-ping immediately. */
  declare(names) {
    for (const name of names) this.discoveredNames.add(name);
    this._scheduleBatchPing();
  }
  /** Returns the current state for a feature. Auto-registers on first call. */
  feature(name) {
    const isNew = !this.discoveredNames.has(name);
    this.discoveredNames.add(name);
    if (isNew) this.monitor?._trackFeatureCall(name);
    if (isNew) this._scheduleBatchPing();
    const entry = this.cache.get(name);
    const status = entry?.status ?? this.defaultStatus;
    this.monitor?.recordFlag?.(name, status);
    return new FeatureState(name, status, entry?.reason, entry?.requiredPlan, entry?.requiredPlanLabel, entry?.upgradeCta ?? false);
  }
  /** Convenience: `true` when the feature resolves to an active status
   *  (enabled / new / beta). Equivalent to `feature(name).isEnabled`. */
  isEnabled(name) {
    return this.feature(name).isEnabled;
  }
  /**
   * Subscribe to feature-cache changes so the UI can re-render the instant a fresh
   * snapshot lands — an admin's Deploy (SSE), a foreground/identity resync, or
   * `invalidateCache()`. The callback fires AFTER the in-memory cache is updated;
   * re-read `feature(name)` inside it. Purely local: NO network request, NO DB, NO
   * extra SSE connection — it reuses the single shared stream you already have.
   * Returns an unsubscribe function; call it on unmount. Powers the reactive
   * `useFeature` hook shown in the SDK snippet.
   */
  subscribe(listener) {
    this.changeListeners.add(listener);
    return () => {
      this.changeListeners.delete(listener);
    };
  }
  /** Notify subscribers after a cache mutation. A throwing listener never breaks
   *  cache application (parity with the modal-state / monitor listener guards). */
  _emitChange() {
    for (const l of [...this.changeListeners]) {
      try {
        l();
      } catch {
      }
    }
  }
  /**
   * Load features for a user (or anonymous). Called by the Onelo orchestrator on
   * construction, identity change, and app-foreground. Restores the disk cache
   * for instant UI, sends a (sampled) batch-ping, then either relies on the
   * shared SSE stream (signed-in) or falls back to a one-shot REST resolve + 60s
   * poll (anonymous / standalone).
   */
  async load(userId, userIdHash) {
    this.currentUserId = userId;
    this.currentUserIdHash = userIdHash ?? null;
    await this._loadCache(userId);
    if (this._shouldBatchPingOnLoad()) await this._batchPing();
    this._stopPollTimer();
    if (this.stream && userId != null) {
      this.stream.updateSinceVersion(this.configVersion);
      await this.refresh();
    } else {
      await this._resolve(userId);
      this._startPolling(userId);
    }
  }
  /** Returns names of all features with an active status (enabled, new, or beta). */
  getActiveFeatures() {
    const active = [];
    for (const [name, entry] of this.cache) {
      if (entry.status === "enabled" || entry.status === "new" || entry.status === "beta") {
        active.push(name);
      }
    }
    return active;
  }
  /**
   * Resolves once the first live snapshot has been applied (SSE `connected` /
   * `up_to_date`, or a REST resolve), or after `timeoutMs` — whichever first.
   * Never rejects. Lets a host await a settled state before first paint to avoid
   * a cache→SSE flicker. Parity with Swift `ready(timeout:)`. Multiple callers
   * resolve together on the first event (or each on its own timeout).
   */
  ready(timeoutMs = 1500) {
    if (this.firstEventReceived) return Promise.resolve();
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        this.readyWaiters.delete(finish);
        resolve();
      };
      this.readyWaiters.add(finish);
      setTimeout(finish, Math.max(0, timeoutMs));
    });
  }
  /**
   * Force-reconcile the snapshot from the server via REST (does NOT touch the SSE
   * stream). Debounced to one call/sec unless `force` (use force from a
   * user-initiated "Refresh" action). Never throws — a network error leaves the
   * cached state intact and SSE catches up later. Parity with Swift
   * `refresh(force:)`.
   */
  async refresh(force = false) {
    const now = Date.now();
    if (!force && now - this.lastRefreshAt < REFRESH_DEBOUNCE_MS) return;
    this.lastRefreshAt = now;
    await this._resolve(this.currentUserId);
  }
  /**
   * Requests a short-lived (60s) per-feature JWT from
   * `POST /api/sdk/features/module-token` — proof the current user is entitled to
   * `slug`, which the host forwards to its OWN backend/CDN to gate code download.
   * The backend re-verifies entitlement on every request. Parity with Swift
   * `moduleToken(for:)`.
   *
   * Throws {@link OneloFeaturesError}:
   * - `not_authenticated` — no user identified yet (NO network call is made)
   * - `not_entitled` (403) — the user lacks access to `slug`
   * - `secure_mode_required` (401) — app requires `userIdHash`, none supplied
   * - `invalid_user_hash` (401) — supplied `userIdHash` failed backend HMAC
   * - `network_error` — transport failure or malformed response
   *
   * @param slug        Feature/module slug to mint a token for.
   * @param userIdHash  Optional secure-mode HMAC; overrides the one from load().
   */
  async moduleToken(slug, userIdHash) {
    if (!this.currentUserId) throw new OneloFeaturesError("not_authenticated");
    const body = {
      publishableKey: this.publishableKey,
      userId: this.currentUserId,
      slug
    };
    const hash = userIdHash ?? this.currentUserIdHash;
    if (hash) body["userIdHash"] = hash;
    let status;
    let json;
    try {
      const { sdkHeaders: sdkHeaders2 } = await Promise.resolve().then(() => (init_sdk_headers(), sdk_headers_exports));
      const res = await (0, import_core3.httpPost)(`${this.apiUrl}/api/sdk/features/module-token`, body, await sdkHeaders2(this.bundleId));
      status = res.status;
      json = res.json ?? {};
    } catch {
      throw new OneloFeaturesError("network_error");
    }
    if (status === 200) {
      const token = json["token"];
      if (typeof token === "string" && token.length > 0) return token;
      throw new OneloFeaturesError("network_error");
    }
    if (status === 401) {
      const detail = json["detail"];
      const errCode = detail?.["error"] ?? json["error"];
      if (errCode === "secure_mode_required") throw new OneloFeaturesError("secure_mode_required");
      if (errCode === "invalid_user_hash") throw new OneloFeaturesError("invalid_user_hash");
      throw new OneloFeaturesError("not_authenticated");
    }
    if (status === 403) throw new OneloFeaturesError("not_entitled");
    throw new OneloFeaturesError("network_error");
  }
  /** Stop the fallback poll + pending batch-ping. The shared SSE stream is owned
   *  and torn down by Onelo (Onelo.destroy → stream.destroy), NOT here — closing
   *  it from features would also drop auth's session.revoked subscription. */
  stopPolling() {
    this._stopPollTimer();
    if (this.pingDebounce !== null) {
      clearTimeout(this.pingDebounce);
      this.pingDebounce = null;
    }
  }
  /** Clears the local feature cache and resets the config version. The next
   *  resolve / SSE snapshot re-fills it. */
  invalidateCache() {
    this.cache.clear();
    this.configVersion = 0;
    void saveFeatureCache(this._cacheKey(this.currentUserId), this._snapshotForDisk());
    this._emitChange();
  }
  // ── Private ──────────────────────────────────────────────────────────────────
  /** Signals all pending ready() callers that the first snapshot arrived.
   *  Idempotent (parity with Swift `_signalFirstEvent`). */
  _signalFirstEvent() {
    if (this.firstEventReceived) return;
    this.firstEventReceived = true;
    const waiters = Array.from(this.readyWaiters);
    this.readyWaiters.clear();
    for (const w of waiters) w();
  }
  _scheduleBatchPing() {
    if (this.pingDebounce !== null) clearTimeout(this.pingDebounce);
    this.pingDebounce = setTimeout(() => {
      this.pingDebounce = null;
      void this._batchPing();
    }, 1e3);
  }
  /**
   * Decide whether to send a batch-ping on LOAD (parity with Swift
   * `_shouldBatchPingOnLoad`). Test env ALWAYS pings (reliable discovery of new
   * slugs); live env samples at 1% to avoid fleet-scale write amplification —
   * on live, batch-ping only bumps `last_seen_at` (registration is test-env only
   * server-side), so 1/100 is ample staleness resolution.
   *
   * "test" = explicit featureEnvironment OR a `_test_` key prefix — the latter
   * mirrors the backend's effective-env key-prefix fallback, so a test-keyed app
   * WITHOUT the env var still discovers.
   */
  _shouldBatchPingOnLoad() {
    if (this.featureEnvironment === "test" || this.publishableKey.includes("_test_")) return true;
    return Math.random() < 0.01;
  }
  async _batchPing() {
    const names = Array.from(this.discoveredNames);
    if (names.length === 0) return;
    try {
      const { sdkHeaders: sdkHeaders2 } = await Promise.resolve().then(() => (init_sdk_headers(), sdk_headers_exports));
      await (0, import_core3.httpPost)(`${this.apiUrl}/api/sdk/features/batch-ping`, {
        publishableKey: this.publishableKey,
        features: names,
        ...this.currentUserId ? { userId: this.currentUserId } : {},
        ...this.currentUserIdHash ? { userIdHash: this.currentUserIdHash } : {},
        ...this.featureEnvironment ? { environment: this.featureEnvironment } : {}
      }, await sdkHeaders2(this.bundleId));
    } catch {
    }
  }
  async _resolve(userId) {
    try {
      const body = { publishableKey: this.publishableKey };
      if (userId) body["userId"] = userId;
      if (this.currentUserIdHash) body["userIdHash"] = this.currentUserIdHash;
      if (this.featureEnvironment) body["environment"] = this.featureEnvironment;
      const { sdkHeaders: sdkHeaders2 } = await Promise.resolve().then(() => (init_sdk_headers(), sdk_headers_exports));
      const headers = await sdkHeaders2(this.bundleId, void 0, {
        method: "POST",
        path: "/api/sdk/features/resolve",
        body: JSON.stringify(body)
      });
      const { status, json } = await (0, import_core3.httpPost)(`${this.apiUrl}/api/sdk/features/resolve`, body, headers);
      if (status !== 200) {
        const { maybeSelfHealFromError: maybeSelfHealFromError2 } = await Promise.resolve().then(() => (init_attest(), attest_exports));
        maybeSelfHealFromError2(json);
        return;
      }
      const j = json;
      const features = j["features"];
      if (features) {
        this._applySnapshot(typeof j["config_version"] === "number" ? j["config_version"] : this.configVersion, features);
      }
      this._maybeWarnAnonymous(j);
      this._signalFirstEvent();
    } catch {
    }
  }
  /**
   * Logs a one-time warning when the backend reports anonymous mode (no userId)
   * AND at least one targeted feature was hidden purely because of it. Helps
   * developers using their own auth system catch missing identify() calls.
   */
  _maybeWarnAnonymous(response) {
    if (this.suppressIdentifyWarning || this.anonymousWarningLogged) return;
    if (response["anonymous"] !== true) return;
    const misses = typeof response["targeting_misses"] === "number" ? response["targeting_misses"] : 0;
    if (misses <= 0) return;
    this.anonymousWarningLogged = true;
    console.warn(
      `[Onelo] ${misses} feature(s) hidden because no user is identified.
If you handle auth yourself, call onelo.identify(userId) after login so per-user/per-plan targeting can apply.
If your app is intentionally anonymous, pass suppressIdentifyWarning: true in OneloConfig to silence this.`
    );
  }
  async _poll(userId) {
    try {
      const params = new URLSearchParams({
        key: this.publishableKey,
        since_version: String(this.configVersion)
      });
      if (this.featureEnvironment) params.set("environment", this.featureEnvironment);
      if (userId) params.set("userId", userId);
      const { sdkHeaders: sdkHeaders2 } = await Promise.resolve().then(() => (init_sdk_headers(), sdk_headers_exports));
      const { status, json } = await (0, import_core3.httpGet)(
        `${this.apiUrl}/api/sdk/features/poll?${params.toString()}`,
        await sdkHeaders2(this.bundleId)
      );
      if (status !== 200) return;
      const j = json;
      if (j["up_to_date"] === true) {
        if (typeof j["config_version"] === "number") this.configVersion = j["config_version"];
      } else {
        const features = j["features"];
        if (features) {
          this._applySnapshot(typeof j["config_version"] === "number" ? j["config_version"] : this.configVersion, features);
        }
      }
      if (j["discovery_requested"] === true) {
        await this._batchPing();
      }
    } catch {
    }
  }
  _startPolling(userId) {
    this._stopPollTimer();
    this.pollTimer = setInterval(() => {
      void this._poll(userId);
    }, POLL_INTERVAL_MS);
  }
  _stopPollTimer() {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
  // ── Snapshot + disk cache ────────────────────────────────────────────────────
  _applySnapshot(version, features) {
    this.configVersion = version;
    this.cache.clear();
    for (const [name, wire] of Object.entries(features)) {
      this.cache.set(name, wireToEntry(wire));
    }
    void saveFeatureCache(this._cacheKey(this.currentUserId), this._snapshotForDisk());
    this.stream?.updateSinceVersion(version);
    this._emitChange();
  }
  _cacheKey(userId) {
    return `${CACHE_KEY_PREFIX}.${this.publishableKey}.${userId ?? "anon"}`;
  }
  /** v2 disk shape (snake_case, mirrors Swift) — persists the FULL entry so a
   *  cold-start `up_to_date` still renders upgrade badges. */
  _snapshotForDisk() {
    const features = {};
    for (const [name, entry] of this.cache) {
      const wire = { status: entry.status };
      if (entry.reason) wire.reason = entry.reason;
      if (entry.requiredPlan) wire.required_plan = entry.requiredPlan;
      if (entry.requiredPlanLabel) wire.required_plan_label = entry.requiredPlanLabel;
      if (entry.upgradeCta) wire.upgrade_cta = true;
      features[name] = wire;
    }
    return { config_version: this.configVersion, features };
  }
  async _loadCache(userId) {
    const parsed = await loadFeatureCache(this._cacheKey(userId));
    if (!parsed || typeof parsed.config_version !== "number" || !parsed.features) return;
    this.configVersion = parsed.config_version;
    this.cache.clear();
    for (const [name, cached] of Object.entries(parsed.features)) {
      if (typeof cached === "string") {
        this.cache.set(name, { status: normalizeStatus(cached), upgradeCta: false });
      } else if (cached && typeof cached === "object") {
        this.cache.set(name, wireToEntry(cached));
      }
    }
    this._emitChange();
  }
};

// src/monitor/monitor.ts
var import_package2 = __toESM(require_package());

// src/monitor/scrubber.ts
var REDACTED = "[REDACTED]";
var MAX_DEPTH = 10;
var DEPTH_MARKER = "_onelo_depth_exceeded";
var KEY_SUBSTRINGS = [
  "password",
  "passwd",
  "secret",
  "token",
  "api_key",
  "apikey",
  "authorization",
  "cookie",
  "credential",
  "private_key",
  "client_secret",
  "cvv",
  "ssn"
];
var SENSITIVE_KEYS = /* @__PURE__ */ new Set([
  // headers
  "authorization",
  "cookie",
  "set-cookie",
  "proxy-authorization",
  "x-api-key",
  "x-auth-token",
  "x-onelo-secret",
  "www-authenticate",
  // query params / short-form keys
  "token",
  "access_token",
  "refresh_token",
  "id_token",
  "key",
  "api_key",
  "apikey",
  "secret",
  "client_secret",
  "password",
  "passwd",
  "auth",
  "code",
  // OAuth authorization code
  "session"
  // session token in URL / meta
]);
var VALUE_PATTERNS = [
  /(^|[^A-Za-z0-9])Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /(^|[^A-Za-z0-9])eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+(?![A-Za-z0-9])/g,
  // JWT
  /(^|[^A-Za-z0-9])(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}(?![A-Za-z0-9])/g,
  // Stripe-style
  /(^|[^A-Za-z0-9])onelo_(?:pk|sk|rk)_(?:live|test)_[A-Za-z0-9]{8,}(?![A-Za-z0-9])/g,
  // Onelo keys
  /(^|[^A-Za-z0-9])(?:4[0-9]{3}|5[1-5][0-9]{2}|3[47][0-9]{2}|6(?:011|5[0-9]{2}))[\s-][0-9]{4}[\s-][0-9]{4}[\s-][0-9]{4}(?![A-Za-z0-9])/g,
  // CC separated
  /(^|[^A-Za-z0-9])(?:4|5[1-5]|6(?:011|5))[0-9]{14,}(?![0-9])/g,
  // CC unseparated
  /(^|[^A-Za-z0-9])3[47][0-9]{13,}(?![0-9])/g
  // Amex unseparated
];
function keyIsPii(key) {
  const k = key.toLowerCase();
  if (SENSITIVE_KEYS.has(k)) return true;
  if (KEY_SUBSTRINGS.some((p) => k.includes(p))) return true;
  return k.replace(/-/g, "_").split("_").includes("key");
}
function scrubText(text) {
  let out = text;
  for (const pat of VALUE_PATTERNS) out = out.replace(pat, (_m, boundary) => boundary + REDACTED);
  return out;
}
function scrubValue(value, redacted, depth) {
  if (Array.isArray(value)) {
    if (depth >= MAX_DEPTH) {
      redacted.add(DEPTH_MARKER);
      return { [DEPTH_MARKER]: true };
    }
    return value.map((v) => scrubValue(v, redacted, depth + 1));
  }
  if (value !== null && typeof value === "object") {
    if (depth >= MAX_DEPTH) {
      redacted.add(DEPTH_MARKER);
      return { [DEPTH_MARKER]: true };
    }
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === "_onelo_redacted") {
        out[k] = v;
        continue;
      }
      if (keyIsPii(k)) {
        redacted.add(k);
        out[k] = REDACTED;
      } else out[k] = scrubValue(v, redacted, depth + 1);
    }
    return out;
  }
  if (typeof value === "string") return scrubText(value);
  return value;
}
function scrubMeta(meta) {
  if (meta == null) return meta;
  const redacted = /* @__PURE__ */ new Set();
  const cleaned = scrubValue(meta, redacted, 0);
  if (redacted.size > 0) cleaned["_onelo_redacted"] = Array.from(redacted).sort();
  return cleaned;
}

// src/monitor/monitor.ts
var SDK_NAME = "@onelo/react-native";
var MAX_BUFFER_SIZE = 200;
var MAX_FLAGS = 100;
var MAX_BREADCRUMBS = 100;
var MAX_META_BYTES = 16e3;
var PLATFORM = "reactnative";
var MAX_RETRY_AFTER_MS = 36e5;
var _warn = (...args) => console.warn("[onelo.monitor]", ...args);
function _parseRetryAfter(res) {
  let raw = null;
  try {
    raw = res.headers?.get?.("Retry-After") ?? null;
  } catch {
  }
  if (!raw) return 0;
  const seconds = Number(raw.trim());
  if (!Number.isFinite(seconds)) return 0;
  return Math.max(0, Math.min(seconds * 1e3, MAX_RETRY_AFTER_MS));
}
var _globalHandlersRegistered = false;
var _previousGlobalHandler;
var _installedGlobalHandler;
function _uuidv42() {
  const bytes = new Uint8Array(16);
  try {
    ;
    globalThis.crypto.getRandomValues(bytes);
  } catch {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = bytes[6] & 15 | 64;
  bytes[8] = bytes[8] & 63 | 128;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
var _platformCache;
function _platform() {
  if (_platformCache !== void 0) return _platformCache ?? void 0;
  try {
    _platformCache = require("react-native").Platform ?? null;
  } catch {
    _platformCache = null;
  }
  return _platformCache ?? void 0;
}
function _deviceContext(heavy) {
  const d = {};
  const P = _platform();
  d["os"] = P?.OS ?? "unknown";
  if (P?.Version != null) d["osVersion"] = String(P.Version);
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) d["timezone"] = tz;
  } catch {
  }
  if (heavy) {
    if (P?.isTV != null) d["isTV"] = P.isTV;
    const c = P?.constants;
    if (c) {
      if (typeof c["Brand"] === "string") d["brand"] = c["Brand"];
      if (typeof c["Model"] === "string") d["model"] = c["Model"];
      if (typeof c["systemName"] === "string") d["systemName"] = c["systemName"];
      if (typeof c["interfaceIdiom"] === "string") d["interfaceIdiom"] = c["interfaceIdiom"];
    }
  }
  return d;
}
function _extractError(err) {
  if (err instanceof Error) return { message: err.message, stack: err.stack, errorType: err.name };
  return { message: String(err) };
}
var OneloMonitor = class {
  constructor(publishableKey, apiUrl, bundleId, appVersion, appBuild, environment) {
    this.buffer = [];
    // Per-feature call counters — every `feature("name")` lookup increments one,
    // and flush emits ONE `feature_call_summary` event per feature with
    // `meta.calls = N` (write-amplification control, parity with Swift). Errors /
    // explicit `event()` / `track()` are NOT aggregated — they carry unique data.
    this.summaryBuffer = /* @__PURE__ */ new Map();
    // Rolling snapshot of the most recently evaluated feature flags (name→status),
    // LRU-capped. Attached to ERROR events so a captured error carries the active
    // flag state (parity with Swift's MonitorFeatureFlagBuffer).
    this.flags = /* @__PURE__ */ new Map();
    // Ring buffer of breadcrumbs (the trail leading up to an error), snapshotted
    // into meta.breadcrumbs on error events (parity with Swift).
    this.breadcrumbs = [];
    this.flushTimer = null;
    this.currentUserId = null;
    /** Serialises all drains so a timer flush and an error flush can't overlap. */
    this.flushChain = Promise.resolve();
    /** Epoch ms until which we hold off sending (set from a 429 `Retry-After`). */
    this.retryAfterUntil = 0;
    /** Set by destroy(); stops any further sends after teardown. */
    this._destroyed = false;
    // NEVER inline `crypto.getRandomValues` here unguarded — a field initializer
    // that throws takes down `new Onelo(config)` entirely. `_uuidv4` degrades to
    // `Math.random()` when the CSPRNG polyfill is absent.
    this.sessionId = _uuidv42();
    /** True only on the instance that actually installed the global ErrorUtils
     *  handler — gates handler restoration in `destroy()`. */
    this._registeredGlobalHandler = false;
    this.publishableKey = publishableKey;
    this.apiUrl = apiUrl;
    this.bundleId = bundleId;
    const app = {};
    if (appVersion) app["version"] = appVersion;
    if (appBuild) app["build"] = appBuild;
    if (bundleId) app["bundleId"] = bundleId;
    this.staticMeta = {
      sdk: { name: SDK_NAME, version: import_package2.version },
      ...Object.keys(app).length > 0 ? { app } : {}
    };
    this.environment = environment;
    this.breadcrumb = Object.assign(
      (message, opts) => this._addBreadcrumb(opts?.category ?? "info", message, opts?.data),
      {
        info: (message, data) => this._addBreadcrumb("info", message, data),
        navigationTo: (view) => this._addBreadcrumb("navigation", view, { to: view })
      }
    );
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, 15e3);
    this._registerGlobalHandlers();
    this._push("session_opened", true, void 0, void 0, void 0, "event");
  }
  /** Sets the current user ID attached to all subsequent monitor events. Call after login/logout if not using Onelo Auth. */
  setUserId(userId) {
    this.currentUserId = userId;
  }
  /**
   * Internal hook — used by `OneloFeatures` on the first lookup of each name.
   * High-volume path: aggregated into a per-feature counter and emitted as one
   * `feature_call_summary` event at flush (parity with Swift).
   */
  _trackFeatureCall(featureName) {
    this.summaryBuffer.set(featureName, (this.summaryBuffer.get(featureName) ?? 0) + 1);
  }
  /**
   * Record the current value of a feature flag for flag↔error correlation.
   * Intended to be wired from `OneloFeatures` on every evaluation. LRU:
   * re-recording a key moves it to most-recent; capped at MAX_FLAGS. Not an
   * event — just updates the snapshot attached to future error captures.
   */
  recordFlag(key, value) {
    if (this.flags.has(key)) this.flags.delete(key);
    this.flags.set(key, value);
    if (this.flags.size > MAX_FLAGS) {
      const oldest = this.flags.keys().next().value;
      if (oldest !== void 0) this.flags.delete(oldest);
    }
  }
  async track(featureName, fn, options) {
    const start = Date.now();
    try {
      const result = await fn();
      this._push(featureName, true, Date.now() - start, void 0, options?.meta, "track");
      return result;
    } catch (err) {
      const { message, stack, errorType } = _extractError(err);
      this._push(featureName, false, Date.now() - start, message, this._withError(options?.meta, stack, errorType), "track");
      throw err;
    }
  }
  event(featureName, opts) {
    this._push(featureName, opts.ok, opts.durationMs, opts.error, opts.meta, "event");
  }
  /**
   * Manually capture an error/exception with its stack + the active breadcrumbs
   * and feature flags (parity with Swift's `capture`). Use for caught errors you
   * still want reported. Never throws.
   */
  capture(error, opts) {
    const { message, stack, errorType } = _extractError(error);
    this._push(opts?.featureName ?? "captured", false, void 0, message, this._withError(opts?.meta, stack, errorType), "event");
  }
  /**
   * Drains are SERIALISED through one promise chain: the 15s timer, an error
   * auto-flush and an explicit `flush()` must never drain concurrently, because
   * two overlapping drains would interleave batches (and the second would see an
   * empty buffer and report "sent").
   */
  async flush() {
    this.flushChain = this.flushChain.then(() => this._drain()).catch(() => {
    });
    return this.flushChain;
  }
  async _drain() {
    if (this._destroyed) return;
    for (const [featureName, count] of this.summaryBuffer) {
      if (count > 0) {
        this.buffer.push({
          // Stamped as the summary event is materialised — the close of the
          // aggregation window it describes. Same reason as _push: without it a
          // batch delayed by an outage lands under the recovery's timestamp.
          ts: (/* @__PURE__ */ new Date()).toISOString(),
          featureName,
          ok: true,
          source: "feature_call_summary",
          meta: { calls: count },
          userId: this.currentUserId ?? void 0,
          platform: PLATFORM,
          sessionId: this.sessionId
        });
      }
    }
    this.summaryBuffer.clear();
    if (this.buffer.length === 0) return;
    if (Date.now() < this.retryAfterUntil) return;
    const events = this.buffer.splice(0);
    const body = JSON.stringify({ publishableKey: this.publishableKey, events });
    if (await this._sendOnce(body) === "requeue") this._requeue(events);
  }
  /** One POST. Never throws — classifies the result instead. */
  async _sendOnce(body) {
    let res;
    try {
      const { sdkHeaders: sdkHeaders2 } = await Promise.resolve().then(() => (init_sdk_headers(), sdk_headers_exports));
      res = await fetch(`${this.apiUrl}/api/sdk/monitor/events/batch`, {
        method: "POST",
        headers: { ...await sdkHeaders2(this.bundleId), "Content-Type": "application/json" },
        body
      });
    } catch {
      return "requeue";
    }
    const status = res?.status ?? 0;
    if (status >= 200 && status < 300) return "done";
    if (status === 429) {
      const waitMs = _parseRetryAfter(res);
      if (waitMs > 0) this.retryAfterUntil = Math.max(this.retryAfterUntil, Date.now() + waitMs);
      return "requeue";
    }
    if (status >= 400 && status < 500) {
      _warn(`batch rejected with HTTP ${status} \u2014 dropping it (retrying would fail identically)`);
      return "drop";
    }
    return "requeue";
  }
  /**
   * Put an undelivered batch back at the FRONT of the buffer so the next flush
   * retries it, then re-apply the cap.
   *
   * Priority policy under a sustained outage: NEWEST EVENTS WIN. The buffer is
   * trimmed from the front, so the oldest re-queued events go first. This matches
   * `_push`'s newest-wins eviction, keeps memory bounded at MAX_BUFFER_SIZE no
   * matter how long the device is offline, and stops a wedged batch from starving
   * live telemetry. Drops are reported, never silent.
   */
  _requeue(events) {
    this.buffer.unshift(...events);
    let dropped = 0;
    while (this.buffer.length > MAX_BUFFER_SIZE) {
      this.buffer.shift();
      dropped++;
    }
    _warn(
      `delivery failed \u2014 ${events.length} event(s) re-queued` + (dropped > 0 ? `, ${dropped} oldest dropped (buffer cap ${MAX_BUFFER_SIZE})` : "")
    );
  }
  destroy() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this._unregisterGlobalHandlers();
    void this.flush().finally(() => {
      this._destroyed = true;
    });
  }
  _addBreadcrumb(category, message, data) {
    this.breadcrumbs.push({
      category,
      message: scrubText(message),
      ts: Date.now(),
      ...data ? { data } : {}
    });
    if (this.breadcrumbs.length > MAX_BREADCRUMBS) this.breadcrumbs.shift();
  }
  /** Fold stack/errorType into a caller's meta without mutating it. */
  _withError(meta, stack, errorType) {
    return {
      ...meta ?? {},
      ...stack ? { stack } : {},
      ...errorType ? { errorType } : {}
    };
  }
  /**
   * Returns a NEW meta object with always-on context merged in (parity with
   * Swift's enrichMeta): `sdk` + `app` (authoritative, override caller keys),
   * `environment` (only when the caller didn't set it per-event), and a light
   * `device` block. On error/crash the device block carries heavier fields.
   * Never mutates the caller's meta.
   */
  _enrich(meta, isError) {
    const out = { ...meta ?? {}, ...this.staticMeta };
    if (this.environment != null && out["environment"] == null) out["environment"] = this.environment;
    const device = _deviceContext(isError);
    if (Object.keys(device).length > 0) out["device"] = device;
    return out;
  }
  /** Trim error meta to the ~16KB soft cap: drop oldest breadcrumbs, then flags. Best-effort, never throws. */
  _capMeta(meta) {
    const size = (m) => {
      try {
        return JSON.stringify(m).length;
      } catch {
        return 0;
      }
    };
    if (size(meta) <= MAX_META_BYTES) return meta;
    let out = meta;
    if (Array.isArray(out["breadcrumbs"])) {
      const crumbs = out["breadcrumbs"].slice();
      while (crumbs.length > 0 && size({ ...out, breadcrumbs: crumbs }) > MAX_META_BYTES) crumbs.shift();
      out = { ...out, breadcrumbs: crumbs };
      if (crumbs.length === 0) {
        const { breadcrumbs: _b, ...rest } = out;
        out = rest;
      }
    }
    if (size(out) > MAX_META_BYTES && "flags" in out) {
      const { flags: _f, ...rest } = out;
      out = rest;
    }
    if (size(out) > MAX_META_BYTES) out["_onelo_meta_truncated"] = true;
    return out;
  }
  _push(featureName, ok, durationMs, error, meta, source = "event") {
    if (this.buffer.length >= MAX_BUFFER_SIZE) this.buffer.shift();
    const isError = !ok || source === "global_error";
    const enriched = this._enrich(meta, isError);
    if (isError && this.breadcrumbs.length > 0) enriched["breadcrumbs"] = this.breadcrumbs.slice();
    let scrubbed = scrubMeta(enriched);
    if (isError && this.flags.size > 0 && scrubbed) {
      scrubbed["flags"] = Object.fromEntries(this.flags);
    }
    if (isError && scrubbed) scrubbed = this._capMeta(scrubbed);
    this.buffer.push({
      ts: (/* @__PURE__ */ new Date()).toISOString(),
      featureName,
      ok,
      durationMs,
      error: error != null ? scrubText(error) : error,
      meta: scrubbed,
      source,
      userId: this.currentUserId ?? void 0,
      platform: PLATFORM,
      sessionId: this.sessionId
    });
    if (isError) void this.flush();
  }
  _registerGlobalHandlers() {
    if (_globalHandlersRegistered) return;
    try {
      const ErrorUtils = globalThis?.ErrorUtils;
      if (ErrorUtils?.setGlobalHandler) {
        const prev = ErrorUtils.getGlobalHandler?.();
        const handler = (err, isFatal) => {
          try {
            const { message, stack, errorType } = _extractError(err);
            this._push("unhandled", false, void 0, message, this._withError(void 0, stack, errorType), "global_error");
          } catch {
          }
          prev?.(err, isFatal);
        };
        ErrorUtils.setGlobalHandler(handler);
        _previousGlobalHandler = prev;
        _installedGlobalHandler = handler;
        _globalHandlersRegistered = true;
        this._registeredGlobalHandler = true;
      }
    } catch {
    }
  }
  /**
   * Restore the ErrorUtils handler that was installed before this monitor
   * registered, and reset the module registration state so a freshly-constructed
   * monitor re-registers (rather than being stuck behind a `true` flag pointing
   * at a torn-down instance). Only the instance that actually installed the
   * handler acts; only restores if OUR handler is still the current one (never
   * clobber a handler someone installed on top of ours). Never throws.
   */
  _unregisterGlobalHandlers() {
    if (!this._registeredGlobalHandler) return;
    this._registeredGlobalHandler = false;
    try {
      const ErrorUtils = globalThis?.ErrorUtils;
      if (ErrorUtils?.setGlobalHandler) {
        const current = ErrorUtils.getGlobalHandler?.();
        if (current === _installedGlobalHandler) {
          ErrorUtils.setGlobalHandler(_previousGlobalHandler ?? (() => {
          }));
        }
      }
    } catch {
    }
    _previousGlobalHandler = void 0;
    _installedGlobalHandler = void 0;
    _globalHandlersRegistered = false;
  }
};

// src/feedback/feedback.ts
var OneloFeedback = class {
  constructor(apiUrl, publishableKey, getActiveFeatures, bundleId, pageBackgroundColor = () => "#111111") {
    this.apiUrl = apiUrl;
    this.publishableKey = publishableKey;
    this.getActiveFeatures = getActiveFeatures;
    this.bundleId = bundleId;
    this.pageBackgroundColor = pageBackgroundColor;
    this._url = null;
    this._visible = false;
    this._listeners = [];
  }
  open(options = {}) {
    this._notify(null, true);
    void this._fetchAndLoad(options);
  }
  close() {
    this._notify(null, false);
  }
  async _fetchAndLoad(options) {
    try {
      const params = new URLSearchParams({ key: this.publishableKey });
      if (options.type) params.set("type", options.type);
      if (options.area) params.set("area", options.area);
      const active = this.getActiveFeatures();
      if (active.length > 0) params.set("session", JSON.stringify(active));
      const { sdkHeaders: sdkHeaders2 } = await Promise.resolve().then(() => (init_sdk_headers(), sdk_headers_exports));
      const headers = { ...await sdkHeaders2(this.bundleId), ...options.userId ? { "X-Onelo-User-Id": options.userId } : {} };
      const res = await fetch(`${this.apiUrl}/api/sdk/feedback/initiate?${params}`, { headers });
      if (!res.ok) {
        this.close();
        return;
      }
      const { hosted_url } = await res.json();
      if (this._visible) this._notify(hosted_url, true);
    } catch {
      this.close();
    }
  }
  _notify(url, visible) {
    this._url = url;
    this._visible = visible;
    this._listeners.forEach((l) => l(url, visible));
  }
  subscribe(listener) {
    this._listeners.push(listener);
    return () => {
      this._listeners = this._listeners.filter((l) => l !== listener);
    };
  }
  getCurrentUrl() {
    return this._url;
  }
  isVisible() {
    return this._visible;
  }
  /** Branding page background (--onelo-page-bg) so the feedback WebView never
   *  flashes white before the hosted feedback page paints. */
  getPageBackgroundColor() {
    return this.pageBackgroundColor();
  }
};

// src/forms/forms.ts
var OneloForms = class {
  constructor(apiUrl, publishableKey, bundleId) {
    this.apiUrl = apiUrl;
    this.publishableKey = publishableKey;
    this.bundleId = bundleId;
  }
  async submit(formSlug, data, submitterEmail) {
    try {
      const { sdkHeaders: sdkHeaders2 } = await Promise.resolve().then(() => (init_sdk_headers(), sdk_headers_exports));
      const { maybeSelfHealFromError: _maybeSelfHeal } = await Promise.resolve().then(() => (init_attest(), attest_exports));
      const body = { publishableKey: this.publishableKey, formSlug, data };
      if (submitterEmail) body.submitterEmail = submitterEmail;
      const bodyStr = JSON.stringify(body);
      const res = await fetch(`${this.apiUrl}/api/sdk/forms/submit`, {
        method: "POST",
        headers: {
          ...await sdkHeaders2(this.bundleId, void 0, {
            method: "POST",
            path: "/api/sdk/forms/submit",
            body: bodyStr
          }),
          "Content-Type": "application/json"
        },
        body: bodyStr
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) await _maybeSelfHeal(json);
      const message = typeof json.detail === "string" ? json.detail : typeof json.message === "string" ? json.message : void 0;
      return { success: res.ok, message };
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : String(err) };
    }
  }
};

// src/waitlist/waitlist.ts
var OneloWaitlist = class {
  constructor(apiUrl, publishableKey, bundleId) {
    this.apiUrl = apiUrl;
    this.publishableKey = publishableKey;
    this.bundleId = bundleId;
  }
  async join(slug, email) {
    try {
      const { sdkHeaders: sdkHeaders2 } = await Promise.resolve().then(() => (init_sdk_headers(), sdk_headers_exports));
      const { maybeSelfHealFromError: _maybeSelfHeal } = await Promise.resolve().then(() => (init_attest(), attest_exports));
      const body = { publishableKey: this.publishableKey, email };
      if (slug !== void 0) body.slug = slug;
      const bodyStr = JSON.stringify(body);
      const res = await fetch(`${this.apiUrl}/api/sdk/waitlist/join`, {
        method: "POST",
        headers: {
          ...await sdkHeaders2(this.bundleId, void 0, {
            method: "POST",
            path: "/api/sdk/waitlist/join",
            body: bodyStr
          }),
          "Content-Type": "application/json"
        },
        body: bodyStr
      });
      if (!res.ok) _maybeSelfHeal(await res.clone().json().catch(() => ({})));
      const json = await res.json().catch(() => ({}));
      const message = typeof json.detail === "string" ? json.detail : typeof json.message === "string" ? json.message : void 0;
      return { success: res.ok, position: json.position, alreadyJoined: json.alreadyJoined ?? false, message };
    } catch {
      return { success: false, alreadyJoined: false };
    }
  }
};

// src/customer-portal/customer-portal.ts
var import_core4 = __toESM(require_dist());
init_sdk_headers();
var SDK_VERSION4 = require_package().version;
var CALLBACK_SCHEME2 = "onelorn";
var PORTAL_REVOKE_EVENTS = /* @__PURE__ */ new Set([
  "account_deletion_scheduled",
  "account_revoked",
  "session_compromised"
]);
var OneloCustomerPortal = class {
  /**
   * @param bundleId Threaded into `sdkHeaders` so portal-initiate sends
   *   `X-Bundle-Id`. A LIVE native app with a registered bundle is 403'd by the
   *   backend's `validate_sdk_request_security` without it.
   * @param onRevoked Injected by `Onelo` — invoked (in addition to `signOut`)
   *   when the portal returns a session-invalidating event (account deletion,
   *   account revoked, session compromised) so `auth.isUserRevoked` is set.
   *   Parity with Swift `portalRevokeEvents` + guard #9.
   */
  constructor(apiUrl, publishableKey, bundleId, getAccessToken, signOut, onRevoked, pageBackgroundColor = () => "#111111", callbackScheme = CALLBACK_SCHEME2) {
    this._modalVisible = false;
    this._modalUrl = "";
    this._modalResolve = null;
    this.portalStateListeners = [];
    if (!apiUrl) throw new Error("[Onelo] apiUrl is required");
    this.apiUrl = apiUrl;
    this.publishableKey = publishableKey;
    this.bundleId = bundleId;
    this.getAccessToken = getAccessToken;
    this.signOut = signOut;
    this.onRevoked = onRevoked;
    this.pageBg = pageBackgroundColor;
    this.callbackScheme = callbackScheme;
  }
  /** Open the hosted customer portal in a fullscreen WebView modal. */
  async open() {
    const token = await this.getAccessToken();
    if (!token) throw new import_core4.OneloError("not_authenticated", "Sign in before opening the customer portal");
    const url = `${this.apiUrl}/api/sdk/paywall/portal-initiate?key=${encodeURIComponent(this.publishableKey)}&callback_scheme=${encodeURIComponent(this.callbackScheme)}`;
    const { status, json } = await (0, import_core4.httpGet)(url, {
      ...await sdkHeaders(this.bundleId),
      "X-SDK-Version": SDK_VERSION4,
      Authorization: `Bearer ${token}`
    });
    if (status !== 200) throw import_core4.OneloError.server("Failed to initiate customer portal");
    const j = json;
    const hostedUrl = j["hosted_url"];
    if (!hostedUrl) throw import_core4.OneloError.server("Invalid portal-initiate response");
    return new Promise((resolve) => {
      this._modalUrl = hostedUrl;
      this._modalResolve = async (result) => {
        this._modalVisible = false;
        this._modalResolve = null;
        this.notifyPortalListeners();
        if (result.type === "cancelled") {
          resolve();
          return;
        }
        if (result.event && PORTAL_REVOKE_EVENTS.has(result.event)) {
          try {
            this.onRevoked?.();
          } catch {
          }
          try {
            await this.signOut();
          } catch {
          }
        }
        resolve();
      };
      this._modalVisible = true;
      this.notifyPortalListeners();
    });
  }
  /** Returns current modal state for rendering <CustomerPortalModal>. */
  getModalState() {
    return {
      visible: this._modalVisible,
      hostedUrl: this._modalUrl,
      callbackScheme: this.callbackScheme,
      apiUrl: this.apiUrl,
      backgroundColor: this.pageBg(),
      onResult: this._modalResolve
    };
  }
  /** Subscribe to portal modal state changes. Returns an unsubscribe function. */
  onPortalStateChange(callback) {
    this.portalStateListeners.push(callback);
    return () => {
      this.portalStateListeners = this.portalStateListeners.filter((l) => l !== callback);
    };
  }
  notifyPortalListeners() {
    for (const cb of this.portalStateListeners) cb();
  }
};

// src/consent/consent.ts
var import_core5 = __toESM(require_dist());
init_sdk_headers();
function _mapRequirement(j) {
  const versionId = j["version_id"];
  const docType = j["doc_type"];
  const version = j["version"];
  if (typeof versionId !== "string" || typeof docType !== "string" || typeof version !== "string") {
    return null;
  }
  const rawEnf = j["enforcement"];
  const enforcement = rawEnf === "block" || rawEnf === "notify" ? rawEnf : "unknown";
  return {
    docType,
    versionId,
    version,
    enforcement,
    blocking: j["blocking"] === true,
    url: typeof j["url"] === "string" ? j["url"] : null,
    consentUrl: typeof j["consent_url"] === "string" ? j["consent_url"] : null
  };
}
var OneloConsent = class {
  constructor(apiUrl, publishableKey, auth, bundleId, autoPresent = true) {
    this._modalVisible = false;
    this._modalUrl = "";
    this._modalResolve = null;
    this.modalStateListeners = [];
    /** Bumped on each `legal.consent_required` push (parity with Swift's
     *  @Published consentRevision). Observe via `onConsentRequired`. */
    this._consentRevision = 0;
    this.revisionListeners = /* @__PURE__ */ new Set();
    /** Set synchronously at the top of presentGateIfNeeded and held across its
     *  `await requiredConsents()` round-trip — serializes concurrent callers (e.g.
     *  a sign-in bridge trigger + an app foreground call) so only one gate opens.
     *  JS is single-threaded, so a boolean is enough. */
    this._presenting = false;
    if (!apiUrl) throw new Error("[Onelo] apiUrl is required");
    this.apiUrl = apiUrl;
    this.publishableKey = publishableKey;
    this.auth = auth;
    this.bundleId = bundleId;
    this.autoPresent = autoPresent;
  }
  /** Current consent revision — bumped on each `legal.consent_required` push
   *  (parity with Swift @Published consentRevision). */
  get consentRevision() {
    return this._consentRevision;
  }
  /**
   * Subscribe to `legal.consent_required` pushes (revision bumps). Returns an
   * unsubscribe fn. Use this when you build your own consent UI (with
   * `autoPresentConsentGate:false`) instead of the auto-presented gate.
   */
  onConsentRequired(listener) {
    this.revisionListeners.add(listener);
    return () => {
      this.revisionListeners.delete(listener);
    };
  }
  // ── Real-time consent signal (shared SSE stream) ─────────────────────────────
  /**
   * Register the `legal.consent_required` listener on the shared stream (called
   * once by Onelo). The event is a signal only (payload ignored): on receipt we
   * bump the revision, notify `onConsentRequired` observers, and — unless
   * `autoPresent` is false — re-run the gate. Keeps the existing
   * `presentGateIfNeeded` concurrency guard, so a push that races the sign-in
   * bridge can't stack a second gate.
   */
  attachEventStream(stream) {
    stream.on("legal.consent_required", () => {
      this._consentRevision++;
      for (const l of [...this.revisionListeners]) {
        try {
          l(this._consentRevision);
        } catch {
        }
      }
      if (this.autoPresent) void this.presentGateIfNeeded();
    });
  }
  // ── Data API (mirrors Swift OneloAuth.requiredConsents / acceptConsent) ──────
  /**
   * Fetch the signed-in user's outstanding legal documents. Requires a session;
   * returns `[]` when signed out. Fail-open: any network/non-200/parse failure
   * returns `[]` (never throws).
   */
  async requiredConsents() {
    const session = await this.auth.getSession();
    if (!session) return [];
    try {
      const { status, json } = await (0, import_core5.httpGet)(`${this.apiUrl}/v1/sdk/consent/required`, {
        ...await sdkHeaders(this.bundleId, this.publishableKey),
        Authorization: `Bearer ${session.accessToken}`
      });
      if (status !== 200) return [];
      const rows = json.required;
      if (!Array.isArray(rows)) return [];
      return rows.map((r) => _mapRequirement(r)).filter((r) => r !== null);
    } catch {
      return [];
    }
  }
  /**
   * Record acceptance of a legal document version. Requires a session. Throws
   * `OneloError` on no-session or a non-2xx response. Server-side idempotent.
   */
  async acceptConsent(versionId) {
    const session = await this.auth.getSession();
    if (!session) throw import_core5.OneloError.notAuthenticated();
    const { status } = await (0, import_core5.httpPost)(
      `${this.apiUrl}/v1/sdk/consent/accept`,
      // snake_case `document_version_id` — the backend ConsentActionIn model.
      { document_version_id: versionId },
      {
        ...await sdkHeaders(this.bundleId, this.publishableKey),
        Authorization: `Bearer ${session.accessToken}`
      }
    );
    if (status === 401) throw import_core5.OneloError.notAuthenticated();
    if (status < 200 || status >= 300) throw import_core5.OneloError.server(`Failed to record consent: HTTP ${status}`);
  }
  // ── Gate presentation ────────────────────────────────────────────────────────
  /**
   * Check for an outstanding BLOCKING consent and, if present, open the hosted
   * gate modal. Resolves `true` if a gate was shown. No-op (returns `false`)
   * when: no session, no blocking document with a gate URL, a gate is already
   * open, or another call is mid-flight. Call this on app foreground; it is also
   * wired to fire automatically on sign-in.
   */
  async presentGateIfNeeded() {
    if (this._presenting) return false;
    if (this._modalVisible) return false;
    this._presenting = true;
    try {
      const items = await this.requiredConsents();
      const blocker = items.find((i) => i.blocking && i.consentUrl);
      if (!blocker || !blocker.consentUrl) return false;
      this._openGate(blocker.consentUrl, blocker.versionId);
      return true;
    } finally {
      this._presenting = false;
    }
  }
  /** Alias for `presentGateIfNeeded()`. */
  checkConsent() {
    return this.presentGateIfNeeded();
  }
  _openGate(consentUrl, versionId) {
    this._modalUrl = consentUrl;
    this._modalResolve = async (result) => {
      this._modalVisible = false;
      this._modalResolve = null;
      this.notifyModalListeners();
      if (result.action === "accept") {
        try {
          await this.acceptConsent(versionId);
        } catch {
        }
        await this.presentGateIfNeeded();
      } else {
        await this.auth.signOut().catch(() => {
        });
      }
    };
    this._modalVisible = true;
    this.notifyModalListeners();
  }
  // ── Modal-state plumbing (mirrors auth.ts / customer-portal.ts) ──────────────
  /** Returns current modal state for rendering <ConsentGateModal>. */
  getModalState() {
    return {
      visible: this._modalVisible,
      hostedUrl: this._modalUrl,
      onResult: this._modalResolve,
      backgroundColor: this.auth.pageBackgroundColor()
    };
  }
  /** Subscribe to consent modal state changes. Returns an unsubscribe function. */
  onModalStateChange(callback) {
    this.modalStateListeners.push(callback);
    return () => {
      this.modalStateListeners = this.modalStateListeners.filter((l) => l !== callback);
    };
  }
  notifyModalListeners() {
    for (const cb of this.modalStateListeners) cb();
  }
  /** Release listeners and hide any open gate. Call on SDK teardown. */
  dispose() {
    this.modalStateListeners = [];
    this.revisionListeners.clear();
    this._modalResolve = null;
    this._modalVisible = false;
  }
};

// src/store/store.ts
var import_core6 = __toESM(require_dist());
init_sdk_headers();
var SDK_VERSION5 = require_package().version;
var CALLBACK_SCHEME3 = "onelorn";
var OneloStore = class {
  /**
   * @param exchangeCode Injected by `Onelo` — exchanges the hosted-flow one-time
   *   code for a session AND persists it (so the buyer is left signed in and
   *   auth-state listeners fire). Delegates to the auth module's hosted-callback
   *   exchange. Required for `open()` to complete a purchase.
   */
  constructor(apiUrl, publishableKey, bundleId, getAccessToken, exchangeCode, pageBackgroundColor = () => "#111111", callbackScheme = CALLBACK_SCHEME3) {
    this._modalVisible = false;
    this._modalUrl = "";
    this._modalResolve = null;
    this.storeStateListeners = [];
    if (!apiUrl) throw new Error("[Onelo] apiUrl is required");
    this.apiUrl = apiUrl;
    this.publishableKey = publishableKey;
    this.bundleId = bundleId;
    this.getAccessToken = getAccessToken;
    this.exchangeCode = exchangeCode;
    this.pageBg = pageBackgroundColor;
    this.callbackScheme = callbackScheme;
  }
  /** Security headers for every store request (`sdkHeaders`) plus per-request extras. */
  async _secHeaders(extra = {}) {
    return { ...await sdkHeaders(this.bundleId), "X-SDK-Version": SDK_VERSION5, ...extra };
  }
  /**
   * Mint a tokenized hosted-store URL (plan selection + payment + registration in
   * one page). When a session exists its access token is attached (`Authorization:
   * Bearer`) so the store binds to the existing user and skips signup (re-purchase);
   * cold-start omits it. Mirrors Swift `initiateStoreFlow(lang:)`. Use for a custom
   * presentation; `open()` wraps it.
   *
   * @throws OneloError('server_error') on `store_not_configured` (409) /
   *   `paywall_not_enabled` (403) — DO NOT open a WebView in that case — or any
   *   other non-200. `OneloError('invalid_publishable_key')` on 401.
   */
  async initiateStoreFlow(lang = "en") {
    const token = await this.getAccessToken();
    const url = `${this.apiUrl}/api/sdk/paywall/store-initiate?key=${encodeURIComponent(this.publishableKey)}&callback_scheme=${encodeURIComponent(this.callbackScheme)}&lang=${encodeURIComponent(lang)}`;
    const { status, json } = await (0, import_core6.httpGet)(
      url,
      await this._secHeaders(token ? { Authorization: `Bearer ${token}` } : {})
    );
    if (status === 401) throw import_core6.OneloError.invalidKey("Store rejected the publishable key");
    if (status !== 200) {
      const j = json;
      const code = j?.error ?? j?.detail;
      throw import_core6.OneloError.server(`Failed to initiate store flow: HTTP ${status}${code ? ` (${code})` : ""}`);
    }
    const storeUrl = json["store_url"];
    if (!storeUrl) throw import_core6.OneloError.server("Invalid store-initiate response: missing store_url");
    return storeUrl;
  }
  /**
   * Open the hosted store in a fullscreen WebView modal and complete checkout. The
   * store completes with a `onelorn://callback?code=` deep-link that is exchanged
   * for a session — the buyer ends up signed in. Resolves with that session, or
   * `null` if the modal was closed without completing a purchase.
   *
   * Requires `<StoreModal onelo={onelo} />` mounted near your app root.
   */
  async open(lang = "en") {
    const hostedUrl = await this.initiateStoreFlow(lang);
    return new Promise((resolve, reject) => {
      this._modalUrl = hostedUrl;
      this._modalResolve = async (result) => {
        this._modalVisible = false;
        this._modalResolve = null;
        this.notifyStoreListeners();
        if (result.type === "cancelled") {
          resolve(null);
          return;
        }
        if (!this.exchangeCode) {
          reject(import_core6.OneloError.server("Store exchange not wired: missing exchangeCode dependency"));
          return;
        }
        try {
          const session = await this.exchangeCode(result.code);
          resolve(session);
        } catch (e) {
          reject(e);
        }
      };
      this._modalVisible = true;
      this.notifyStoreListeners();
    });
  }
  /**
   * Act on an upsell (a feature's `upgradeCta`/`upgradeHint`, an "Available in
   * <plan>" tap). Requires a signed-in session. The backend is the single source
   * of truth for billing: an active subscriber is routed to a hosted plan-switch
   * checkout, a user with no subscription to the hosted store. The resulting URL
   * opens in the SYSTEM BROWSER via `Linking.openURL` (mirrors Swift
   * `openUpgrade(forPlan:)` / `NSWorkspace.open`) — never an in-app WebView.
   *
   * @throws OneloError('not_authenticated') when signed out (401) or
   *   `OneloError('server_error')` on `plan_not_purchasable` (404) /
   *   `callback_scheme_required` (400) / any other non-200.
   */
  async openUpgrade(plan, lang = "en") {
    const token = await this.getAccessToken();
    if (!token) throw import_core6.OneloError.notAuthenticated();
    const url = `${this.apiUrl}/api/sdk/paywall/upgrade-initiate?key=${encodeURIComponent(this.publishableKey)}&plan=${encodeURIComponent(plan)}&callback_scheme=${encodeURIComponent(this.callbackScheme)}&lang=${encodeURIComponent(lang)}`;
    const { status, json } = await (0, import_core6.httpGet)(url, await this._secHeaders({ Authorization: `Bearer ${token}` }));
    if (status === 401) throw import_core6.OneloError.notAuthenticated();
    if (status !== 200) {
      const j = json;
      const code = j?.error ?? j?.detail;
      throw import_core6.OneloError.server(`Failed to initiate upgrade: HTTP ${status}${code ? ` (${code})` : ""}`);
    }
    const upgradeUrl = json["upgrade_url"];
    if (!upgradeUrl) throw import_core6.OneloError.server("Invalid upgrade-initiate response: missing upgrade_url");
    const { Linking } = require("react-native");
    await Linking.openURL(upgradeUrl);
  }
  /** Returns current modal state for rendering <StoreModal>. */
  getModalState() {
    return {
      visible: this._modalVisible,
      hostedUrl: this._modalUrl,
      callbackScheme: this.callbackScheme,
      apiUrl: this.apiUrl,
      backgroundColor: this.pageBg(),
      onResult: this._modalResolve
    };
  }
  /** Subscribe to store modal state changes. Returns an unsubscribe function. */
  onStoreStateChange(callback) {
    this.storeStateListeners.push(callback);
    return () => {
      this.storeStateListeners = this.storeStateListeners.filter((l) => l !== callback);
    };
  }
  notifyStoreListeners() {
    for (const cb of this.storeStateListeners) cb();
  }
};

// src/core/event-stream.ts
init_sdk_headers();
init_instance_id();
var RECONNECT_DELAYS_MS = [1e3, 2e3, 5e3, 1e4, 3e4];
var RECONNECT_FLOOR_MS = 500;
var HEADERS_RECEIVED = 2;
var LOADING = 3;
var DONE = 4;
var OneloEventStream = class {
  /**
   * @param apiUrl          Base API URL (no trailing slash), e.g. `https://st.backend.onelo.tools`.
   * @param publishableKey  `onelo_pk_...` — authenticates the stream via the `key` query param.
   * @param sdkVersion      SDK version string, forwarded as `sdk_version`.
   * @param bundleId        Host app bundle id, forwarded via `sdkHeaders()` as `X-Bundle-Id`.
   *
   * The `instance_id` query param + `X-Onelo-Instance-Id` header are sourced
   * internally from `getInstanceId()` (Keychain-backed, cached) — no wiring
   * needed from the caller.
   */
  constructor(apiUrl, publishableKey, sdkVersion, bundleId) {
    this.apiUrl = apiUrl;
    this.publishableKey = publishableKey;
    this.sdkVersion = sdkVersion;
    this.bundleId = bundleId;
    this.handlers = /* @__PURE__ */ new Map();
    // Connection state.
    this.xhr = null;
    this.started = false;
    /** epoch-ms the current XHR was opened; used to decide if a dropped connection
     *  was stable (alive long enough) before resetting the reconnect counter. */
    this.connOpenedAt = 0;
    this.destroyed = false;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    // Query identity — the current values sent on the NEXT (re)connect.
    this.userId = null;
    this.userIdHash = void 0;
    this.sinceVersion = 0;
    this.appVersion = void 0;
    /**
     * Explicit feature environment ('test' | 'live') forwarded as the
     * `environment` query param. Set once by OneloFeatures; constant for the
     * stream's lifetime, so it is intentionally NOT part of start()'s idempotency
     * comparison (parity with Swift's `featureEnvironment`).
     */
    this.featureEnvironment = void 0;
    /**
     * Epoch-ms timestamp of the last byte received from the server (named event
     * OR `:keepalive` comment). A liveness signal — a consumer can compare it to
     * `Date.now()` to detect a silently dead connection. `null` until first byte.
     */
    this.lastEventReceived = null;
    // Incremental-parse state (reset on every fresh connection).
    this.offset = 0;
    this.currentEvent = "";
    this.dataLines = [];
    /**
     * Monotonic connection generation. Bumped on every close/(re)connect so an
     * async connection-open that was awaiting `getInstanceId()`/`sdkHeaders()` can
     * detect it was superseded (or the stream stopped) and bail before opening a
     * now-orphaned socket.
     */
    this.connGen = 0;
  }
  /**
   * Register a handler for a named server event (`connected`, `features_updated`,
   * `session.revoked`, `legal.consent_required`, …). Multiple handlers per name
   * are supported; all fire. Survives reconnects. Register BEFORE `start()` (in a
   * module constructor) so no event is missed between connect and sign-in.
   */
  on(event, handler) {
    const arr = this.handlers.get(event) ?? [];
    arr.push(handler);
    this.handlers.set(event, arr);
  }
  /**
   * Open (or re-open) the connection.
   *
   * Idempotent: a repeat call with identical params while already connected is a
   * no-op (no needless reconnect). A changed userId / userIdHash / sinceVersion /
   * appVersion reconnects so per-user routing stays correct.
   *
   * Downgrade refusal: once bound to a non-null userId, a `start({userId: null})`
   * is IGNORED. An anonymous-mode reload (e.g. features bootstrap) must not evict
   * the auth-bound subscription — otherwise an in-flight `session.revoked` during
   * the reconnect window vanishes and the user stays logged in until the heartbeat
   * fallback (~13 min). Explicit teardown still works via `stop()`.
   */
  start(params = {}) {
    if (this.destroyed) return;
    const nextUserId = params.userId ?? null;
    if (this.started && this.userId !== null && nextUserId === null) {
      return;
    }
    const nextSinceVersion = params.sinceVersion ?? this.sinceVersion;
    const nextAppVersion = params.appVersion ?? this.appVersion;
    const nextUserIdHash = params.userIdHash ?? this.userIdHash;
    const changed = !this.started || nextUserId !== this.userId || nextUserIdHash !== this.userIdHash || nextSinceVersion !== this.sinceVersion || nextAppVersion !== this.appVersion;
    this.userId = nextUserId;
    this.userIdHash = nextUserIdHash;
    this.sinceVersion = nextSinceVersion;
    this.appVersion = nextAppVersion;
    this.started = true;
    if (changed) this._connect();
  }
  /**
   * Update the `since_version` cursor used on the NEXT reconnect. Does NOT force
   * a reconnect — the live connection keeps serving; if it drops, the reconnect
   * picks up the new value (parity with Swift `updateSinceVersion`).
   */
  updateSinceVersion(version) {
    this.sinceVersion = version;
  }
  /**
   * Close the connection and cancel any pending reconnect. Intentional stop:
   * NO reconnect follows (the in-flight XHR's callbacks are detached first, so
   * its abort cannot re-arm the backoff). Handlers stay registered — `start()`
   * resumes delivery.
   */
  stop() {
    this.started = false;
    this._clearReconnect();
    this._closeXhr();
  }
  /**
   * Permanent teardown — detaches the connection and forbids restart. Use from
   * `Onelo.destroy()`. After `destroy()`, `start()` is a no-op.
   */
  destroy() {
    this.destroyed = true;
    this.stop();
  }
  // ── Connection ────────────────────────────────────────────────────────────
  _connect() {
    if (this.destroyed || !this.started) return;
    this._clearReconnect();
    this._closeXhr();
    this.offset = 0;
    this.currentEvent = "";
    this.dataLines = [];
    const gen = this.connGen;
    void this._openXhr(gen);
  }
  async _openXhr(gen) {
    let instanceId = "";
    let securityHeaders = {};
    try {
      instanceId = await getInstanceId();
    } catch {
    }
    try {
      securityHeaders = await sdkHeaders(this.bundleId);
    } catch {
      securityHeaders = {};
    }
    if (gen !== this.connGen || this.destroyed || !this.started) return;
    const url = this._buildUrl(instanceId);
    const xhr = new XMLHttpRequest();
    this.xhr = xhr;
    let ended = false;
    let statusChecked = false;
    let statusOk = false;
    const end = (reconnect) => {
      if (ended) return;
      ended = true;
      if (this.xhr === xhr) this.xhr = null;
      xhr.onprogress = null;
      xhr.onreadystatechange = null;
      xhr.onerror = null;
      xhr.ontimeout = null;
      xhr.onabort = null;
      if (reconnect && !this.destroyed && this.started) this._scheduleReconnect();
    };
    const checkStatus = () => {
      if (statusChecked) return statusOk;
      if (xhr.readyState < HEADERS_RECEIVED) return false;
      statusChecked = true;
      statusOk = xhr.status === 200;
      if (!statusOk) {
        try {
          xhr.abort();
        } catch {
        }
        end(true);
      }
      return statusOk;
    };
    const pump = () => {
      if (ended || this.xhr !== xhr) return;
      if (!checkStatus()) return;
      const text = xhr.responseText;
      if (typeof text === "string" && text.length > this.offset) {
        this.lastEventReceived = Date.now();
        this._consume(text);
      }
    };
    xhr.onreadystatechange = () => {
      if (this.xhr !== xhr) return;
      if (xhr.readyState >= HEADERS_RECEIVED) checkStatus();
      if (xhr.readyState >= LOADING) pump();
      if (xhr.readyState === DONE) end(true);
    };
    xhr.onprogress = () => {
      pump();
    };
    xhr.onerror = () => {
      if (this.xhr === xhr) end(true);
    };
    xhr.ontimeout = () => {
      if (this.xhr === xhr) end(true);
    };
    try {
      xhr.open("GET", url, true);
      const headers = {
        ...securityHeaders,
        Accept: "text/event-stream",
        "Cache-Control": "no-cache"
      };
      for (const [k, v] of Object.entries(headers)) {
        try {
          xhr.setRequestHeader(k, v);
        } catch {
        }
      }
      xhr.send();
      this.connOpenedAt = Date.now();
    } catch {
      end(true);
    }
  }
  /**
   * Drain complete lines from the cumulative responseText, advancing `offset` to
   * the start of the trailing incomplete line so the next chunk continues cleanly.
   *
   * NOTE (memory): `responseText` grows for the life of ONE connection — RN gives
   * no way to truncate it. `:keepalive` comments are tiny, so growth is slow, and
   * every reconnect starts a fresh XHR with an empty responseText (offset reset).
   * A very long-lived, chatty connection is the only case that accumulates; the
   * backend's periodic connection recycling bounds it in practice.
   */
  _consume(fullText) {
    let searchFrom = this.offset;
    for (; ; ) {
      const nl = fullText.indexOf("\n", searchFrom);
      if (nl === -1) break;
      let line = fullText.slice(searchFrom, nl);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      this._processLine(line);
      searchFrom = nl + 1;
    }
    this.offset = searchFrom;
  }
  /** WHATWG SSE line parser (event/data accumulation; dispatch on blank line). */
  _processLine(line) {
    if (line === "") {
      if (this.dataLines.length > 0) {
        this._dispatch(this.currentEvent, this.dataLines.join("\n"));
      }
      this.currentEvent = "";
      this.dataLines = [];
      return;
    }
    if (line.startsWith(":")) return;
    const colon = line.indexOf(":");
    let field;
    let value;
    if (colon === -1) {
      field = line;
      value = "";
    } else {
      field = line.slice(0, colon);
      value = line.slice(colon + 1);
      if (value.startsWith(" ")) value = value.slice(1);
    }
    switch (field) {
      case "event":
        this.currentEvent = value;
        break;
      case "data":
        this.dataLines.push(value);
        break;
      // `id` / `retry` are unused by Onelo today.
      default:
        break;
    }
  }
  /** Decode the JSON payload and fan out to every handler registered for the event name. */
  _dispatch(type, payload) {
    if (type === "") return;
    const list = this.handlers.get(type);
    if (list === void 0 || list.length === 0) return;
    let data = {};
    if (payload.length > 0) {
      try {
        data = JSON.parse(payload);
      } catch {
      }
    }
    for (const handler of list) {
      try {
        handler(data);
      } catch {
      }
    }
  }
  _buildUrl(instanceId) {
    const parts = [];
    const add = (k, v) => {
      parts.push(`${k}=${encodeURIComponent(v)}`);
    };
    add("key", this.publishableKey);
    add("since_version", String(this.sinceVersion));
    if (instanceId) add("instance_id", instanceId);
    add("sdk_platform", "react-native");
    if (this.sdkVersion) add("sdk_version", this.sdkVersion);
    if (this.appVersion) add("app_version", this.appVersion);
    if (this.featureEnvironment) add("environment", this.featureEnvironment);
    if (this.userId) add("userId", this.userId);
    if (this.userIdHash) add("userIdHash", this.userIdHash);
    return `${this.apiUrl}/api/sdk/features/stream?${parts.join("&")}`;
  }
  _scheduleReconnect() {
    if (this.destroyed || !this.started) return;
    this._clearReconnect();
    const maxTier = RECONNECT_DELAYS_MS[RECONNECT_DELAYS_MS.length - 1];
    if (this.connOpenedAt > 0 && Date.now() - this.connOpenedAt > maxTier) {
      this.reconnectAttempts = 0;
    }
    this.connOpenedAt = 0;
    const base = RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempts, RECONNECT_DELAYS_MS.length - 1)];
    this.reconnectAttempts++;
    const delay = Math.max(RECONNECT_FLOOR_MS, Math.floor(Math.random() * base));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this._connect();
    }, delay);
  }
  _clearReconnect() {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
  /**
   * Intentional close. Detaching `this.xhr` BEFORE `abort()` means the abort's
   * `onreadystatechange(DONE)` / `onerror` see `this.xhr !== xhr` and bail — so a
   * user-driven stop never re-arms the reconnect backoff.
   */
  _closeXhr() {
    this.connGen++;
    const xhr = this.xhr;
    if (xhr === null) return;
    this.xhr = null;
    xhr.onprogress = null;
    xhr.onreadystatechange = null;
    xhr.onerror = null;
    xhr.ontimeout = null;
    xhr.onabort = null;
    try {
      xhr.abort();
    } catch {
    }
  }
};

// src/onelo.ts
var SDK_VERSION6 = require_package().version;
var Onelo = class {
  constructor(config) {
    this.authUnsubscribe = null;
    /** RN AppState 'change' subscription, removed in destroy() so a torn-down SDK
     *  can't leak a foreground callback that fires against dead state. */
    this.appStateSubscription = null;
    /** iOS App Attest lifecycle. Created lazily in `_initAttest` ONLY when the app
     *  is iOS AND config reports `attest_required`; null otherwise (Android, or
     *  attest not required). Its token rides every request via `sdkHeaders`. */
    this.attest = null;
    /** Resolves when the background attestation kicked off in the constructor has
     *  produced its token (or settled as not-required / failed). Gated auth entry
     *  points await this so a cold-start request never races AHEAD of the token
     *  and gets a spurious 403 (#25). Defaults to a resolved promise so it's
     *  always awaitable even before `_initAttest` is assigned below. */
    this._attestReady = Promise.resolve();
    this.auth = new OneloAuth(config, () => this._attestReady);
    this.monitor = new OneloMonitor(
      config.publishableKey,
      config.apiUrl,
      config.bundleId,
      config.appVersion,
      config.appBuild,
      config.environment
    );
    const featureEnvironment = config.featureEnvironment === "test" || config.featureEnvironment === "live" ? config.featureEnvironment : void 0;
    this.features = new OneloFeatures(config.apiUrl, config.publishableKey, this.monitor, config.bundleId, {
      suppressIdentifyWarning: config.suppressIdentifyWarning ?? false,
      featureEnvironment,
      featureDefaultStatus: config.featureDefaultStatus
    });
    this.feedback = new OneloFeedback(config.apiUrl, config.publishableKey, () => this.features.getActiveFeatures(), config.bundleId, () => this.auth.pageBackgroundColor());
    this.forms = new OneloForms(config.apiUrl, config.publishableKey, config.bundleId);
    this.waitlist = new OneloWaitlist(config.apiUrl, config.publishableKey, config.bundleId);
    this.customerPortal = new OneloCustomerPortal(
      config.apiUrl,
      config.publishableKey,
      config.bundleId,
      async () => (await this.auth.getSession())?.accessToken ?? null,
      () => this.auth.signOut(),
      () => {
        this.auth.isUserRevoked = true;
      },
      () => this.auth.pageBackgroundColor(),
      this.auth.callbackScheme
    );
    this.autoPresentConsent = config.autoPresentConsentGate ?? true;
    this.autoLifecycleRefresh = config.autoLifecycleRefresh ?? true;
    this.consent = new OneloConsent(config.apiUrl, config.publishableKey, this.auth, config.bundleId, this.autoPresentConsent);
    this.store = new OneloStore(
      config.apiUrl,
      config.publishableKey,
      config.bundleId,
      async () => (await this.auth.getSession())?.accessToken ?? null,
      (code) => this.auth.exchangeHostedCode(code),
      () => this.auth.pageBackgroundColor(),
      this.auth.callbackScheme
    );
    this.eventStream = new OneloEventStream(config.apiUrl, config.publishableKey, SDK_VERSION6, config.bundleId);
    this.eventStream.featureEnvironment = featureEnvironment;
    this.auth.attachEventStream(this.eventStream);
    this.consent.attachEventStream(this.eventStream);
    this.features.attachEventStream(this.eventStream);
    this.authUnsubscribe = this.auth.onAuthStateChange((session) => {
      const userId = session?.user.id ?? null;
      this.monitor.setUserId(userId);
      void this.features.load(userId);
      if (session != null && userId != null) {
        this.eventStream.start({ userId });
        if (this.autoPresentConsent) void this.consent.presentGateIfNeeded();
      } else {
        this.eventStream.stop();
      }
    });
    this.monitor.setUserId(null);
    void this.features.load(null);
    void this.auth.restoreSession();
    this._attestReady = this._initAttest(config);
    this._wireForeground();
  }
  /**
   * Start iOS App Attest when the backend requires it. Awaits config resolution
   * (`auth.whenReady`) to read `attest_required`, then hands off to the platform-
   * guarded `OneloAttest` (no-op on Android / Simulator / unlinked native). Never
   * throws — attestation is best-effort and independent of sign-in.
   */
  async _initAttest(config) {
    try {
      await this.auth.whenReady();
      if (!this.auth.attestRequired) return;
      const { OneloAttest: OneloAttest2 } = await Promise.resolve().then(() => (init_attest(), attest_exports));
      const attest = new OneloAttest2(config.apiUrl, config.publishableKey, config.bundleId);
      this.attest = attest;
      await attest.start();
    } catch {
    }
  }
  /**
   * Re-check consent (and resync features) when the app returns to the
   * foreground — RN has no built-in foreground hook, so we subscribe to
   * AppState 'change' → 'active'. Mirrors Swift's foreground resync. `AppState`
   * is required LAZILY so a pure-Node import of this module (tests) never pulls
   * `react-native`; any failure (unusual RN polyfill) degrades to "no foreground
   * re-check" rather than throwing at construction.
   */
  _wireForeground() {
    let AppState;
    try {
      AppState = require("react-native").AppState;
    } catch {
      AppState = void 0;
    }
    if (!AppState) return;
    this.appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      void (async () => {
        if (this.autoLifecycleRefresh) void this.features.refresh(true);
        void this.attest?.refreshIfNeeded();
        const session = await this.auth.getSession();
        if (session != null && this.autoPresentConsent) {
          void this.consent.presentGateIfNeeded();
        }
      })();
    });
  }
  /** Only needed when NOT using Onelo Auth (own auth system). `userIdHash` is the
   *  host-supplied HMAC for Features secure mode (threaded into resolve / batch-ping
   *  / module-token); omit it when not using secure mode. */
  async identify(userId, userIdHash) {
    await this.features.load(userId, userIdHash);
  }
  /**
   * Opens the hosted upgrade flow for `plan` in the SYSTEM BROWSER and returns.
   * The backend decides the destination: an active subscriber lands on "Change
   * plan" (target pinned; one click to confirm), a non-subscriber on the store.
   * Requires a signed-in session (throws `OneloError('not_authenticated')` otherwise).
   *
   * Wire it to a plan-gated tile whose `upgradeCta` is on:
   *   `if (f.upgradeCta && f.requiredPlan) onelo.openUpgrade(f.requiredPlan)`
   *
   * Thin delegate to {@link OneloStore.openUpgrade} for cross-platform parity with
   * Swift `Onelo.openUpgrade(forPlan:)` / Android / Flutter `onelo.openUpgrade`.
   */
  async openUpgrade(plan, lang = "en") {
    return this.store.openUpgrade(plan, lang);
  }
  /** Release background timers. Call when the SDK instance is no longer needed. */
  destroy() {
    this.authUnsubscribe?.();
    this.appStateSubscription?.remove();
    this.appStateSubscription = null;
    this.eventStream.destroy();
    this.features.stopPolling();
    this.monitor.destroy();
    this.consent.dispose();
  }
};

// src/auth/auth-modal.tsx
var import_react2 = __toESM(require("react"));

// src/auth/webview-oauth.ts
var OAUTH_PROVIDER_HOSTS = ["github.com", "accounts.google.com", "appleid.apple.com"];
var OAUTH_INIT_PATH_RE = /^\/api\/sdk\/auth\/oauth\/(github|google|apple)(\/|$|\?)/;
function parseOAuthMessage(data) {
  try {
    const msg = JSON.parse(data);
    if (msg["type"] === "onelo:native_oauth" && typeof msg["provider"] === "string" && typeof msg["token"] === "string") {
      return { type: "native_oauth", provider: msg["provider"], token: msg["token"] };
    }
    if (msg["type"] === "onelo:native_oauth_url" && typeof msg["url"] === "string") {
      return { type: "native_oauth_url", url: msg["url"] };
    }
    return null;
  } catch {
    return null;
  }
}
function parseCallbackDeepLink(url, scheme) {
  const prefix = `${scheme}://`;
  if (!url.toLowerCase().startsWith(prefix.toLowerCase())) return null;
  let rest = url.slice(prefix.length);
  let query = "";
  const q = rest.indexOf("?");
  if (q !== -1) {
    query = rest.slice(q + 1);
    rest = rest.slice(0, q);
  }
  const slash = rest.indexOf("/");
  const host = (slash === -1 ? rest : rest.slice(0, slash)).toLowerCase();
  const params = {};
  for (const part of query.split("&")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    const k = eq === -1 ? part : part.slice(0, eq);
    const v = eq === -1 ? "" : part.slice(eq + 1);
    if (k) {
      try {
        params[decodeURIComponent(k)] = decodeURIComponent(v);
      } catch {
        params[k] = v;
      }
    }
  }
  return { host, params };
}
function httpHostPath(url) {
  const m = /^https?:\/\/([^/?#]+)([^?#]*)/i.exec(url);
  if (!m) return null;
  return { host: m[1].toLowerCase().replace(/:\d+$/, ""), path: m[2] || "/" };
}
function isOAuthNavigation(url) {
  const hp = httpHostPath(url);
  if (!hp) return false;
  return OAUTH_PROVIDER_HOSTS.includes(hp.host) || OAUTH_INIT_PATH_RE.test(hp.path);
}
function withOAuthPreauth(url, preauth) {
  const [beforeHash, hash] = url.split("#");
  const qIdx = beforeHash.indexOf("?");
  const path = qIdx === -1 ? beforeHash : beforeHash.slice(0, qIdx);
  const query = qIdx === -1 ? "" : beforeHash.slice(qIdx + 1);
  const kept = query.split("&").filter((p) => p && !/^oauth_(preauth|code|error)=/i.test(p));
  kept.push(`oauth_preauth=${encodeURIComponent(preauth)}`);
  return `${path}?${kept.join("&")}${hash ? `#${hash}` : ""}`;
}
function buildHostedInitUrl(apiUrl, provider, token) {
  return `${apiUrl}/api/sdk/auth/oauth/hosted-init?provider=${encodeURIComponent(provider)}&token=${encodeURIComponent(token)}`;
}
var OAUTH_RELAY_SCRIPT = `
(function () {
  function forward(d) {
    try {
      if (typeof d === 'string') { d = JSON.parse(d); }
      // Forward the OAuth hand-off AND the hosted-flow success/cancel codes. The
      // hosted store's sendSuccess() posts { type:'onelo:code', code } to
      // window.parent \u2014 which, inside react-native-webview, is window itself, so it
      // fires a same-window 'message' event that ONLY reaches the native side if we
      // relay it to ReactNativeWebView.postMessage here. Without this, an in-WebView
      // store purchase renders "You're in!" but the code never reaches the app \u2192
      // no exchange, no auto-login.
      if (d && (
        d.type === 'onelo:native_oauth' ||
        d.type === 'onelo:native_oauth_url' ||
        d.type === 'onelo:code' ||
        d.type === 'onelo:cancelled' ||
        // #40 Phase 2 \u2014 the hosted page signals it has mounted so the host can hide
        // its native fail-safe \u2715 (used by the customer-portal modal; auth/store
        // ignore it). The canonical \u2715 is then owned by the hosted page.
        d.type === 'onelo:ready'
      )) {
        window.ReactNativeWebView.postMessage(JSON.stringify(d));
      }
    } catch (err) { /* ignore non-JSON page messages */ }
  }
  window.addEventListener('message', function (e) { forward(e.data); });
  true;
})();
`;
function openInSystemBrowser(Linking, url, onError) {
  Linking.openURL(url).catch(() => onError());
}

// src/auth/auth-skeleton.tsx
var import_react = __toESM(require("react"));
function authSkeletonHtml(socialCount, backgroundColor, redirectTo) {
  const n = Math.max(0, Math.min(4, Math.floor(socialCount || 0)));
  const bg = backgroundColor || "#111111";
  const redirect = redirectTo ? `<script>requestAnimationFrame(function(){requestAnimationFrame(function(){location.replace(${JSON.stringify(redirectTo)})})})</script>` : "";
  const pills = Array.from({ length: n }).map(() => '<div class="onelo-skel-strong pill"></div>').join("");
  const divider = n > 0 ? '<div class="divider"><span class="dline"></span><span class="onelo-skel dtext"></span><span class="dline"></span></div>' : "";
  return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{background:${bg};font-family:-apple-system,BlinkMacSystemFont,sans-serif;overflow:hidden}
.wrap{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;width:100%;padding:48px 24px}
.col{width:100%;max-width:300px;display:flex;flex-direction:column;gap:10px}
.onelo-skel{background-color:rgba(255,255,255,0.04);background-image:linear-gradient(90deg,rgba(255,255,255,0) 0%,rgba(255,255,255,0.14) 50%,rgba(255,255,255,0) 100%);background-size:60vw 100%;background-repeat:no-repeat;background-position:-100vw 0;border-radius:8px}
.onelo-skel-strong{background-color:rgba(255,255,255,0.08);background-image:linear-gradient(90deg,rgba(255,255,255,0) 0%,rgba(255,255,255,0.20) 50%,rgba(255,255,255,0) 100%);background-size:60vw 100%;background-repeat:no-repeat;background-position:-100vw 0;border-radius:9px}
.icon{width:64px;height:64px;border-radius:14px;margin-bottom:14px}
.title{width:200px;height:22px;margin-bottom:10px;border-radius:6px}
.sub{width:140px;height:13px;opacity:0.7;margin-bottom:28px;border-radius:4px}
.pill{height:44px;border-radius:9px}
.divider{display:flex;align-items:center;gap:12px;margin:16px 0 4px}
.dline{flex:1;height:1px;background:rgba(255,255,255,0.1)}
.dtext{width:14px;height:11px;opacity:0.5}
.lbl{width:38px;height:11px}
.input{height:44px}
.lblrow{display:flex;justify-content:space-between;align-items:center}
.lbl2{width:58px;height:11px}
.forgot{width:90px;height:11px;opacity:0.7}
.cta{height:48px;border-radius:10px;margin-top:6px}
.signup{width:200px;height:12px;opacity:0.6;border-radius:4px;margin:6px auto 0}
</style></head><body>
<div class="wrap" aria-hidden="true">
<div class="onelo-skel icon"></div>
<div class="onelo-skel title"></div>
<div class="onelo-skel sub"></div>
<div class="col">
${pills}${divider}
<div class="onelo-skel lbl"></div>
<div class="onelo-skel-strong input"></div>
<div class="lblrow"><div class="onelo-skel lbl2"></div><div class="onelo-skel forgot"></div></div>
<div class="onelo-skel-strong input"></div>
<div class="onelo-skel-strong cta"></div>
<div class="onelo-skel signup"></div>
</div>
</div>
<script>(function(){var D=2400,BW=60;var q=function(){return document.querySelectorAll('.onelo-skel,.onelo-skel-strong')};var s=performance.now();function tick(now){var vw=window.innerWidth;var bpx=vw*(BW/100);var span=vw+bpx;var p=((now-s)%D)/D;var bx=-bpx+p*span;q().forEach(function(el){var r=el.getBoundingClientRect();el.style.backgroundPositionX=(bx-r.left)+'px'});requestAnimationFrame(tick)}requestAnimationFrame(tick)})();</script>
${redirect}
</body></html>`;
}
function AuthSkeleton({ socialCount = 0, backgroundColor = "#111111" }) {
  const RN = require("react-native");
  const { WebView } = require("react-native-webview");
  const { View } = RN;
  const html = authSkeletonHtml(socialCount, backgroundColor);
  return import_react.default.createElement(
    View,
    // pointerEvents none: it's a placeholder — never swallow touches (so the
    // AuthModal close ✕ layered above it stays tappable).
    { style: { flex: 1, backgroundColor }, pointerEvents: "none" },
    import_react.default.createElement(WebView, {
      source: { html },
      originWhitelist: ["*"],
      scrollEnabled: false,
      showsVerticalScrollIndicator: false,
      showsHorizontalScrollIndicator: false,
      // Kill the react-native-webview white default paint before first render.
      backgroundColor,
      style: { flex: 1, backgroundColor }
    })
  );
}

// src/auth/auth-modal.tsx
var CALLBACK_SCHEME4 = "onelorn";
function parseModalMessage(data) {
  try {
    const msg = JSON.parse(data);
    if (msg["type"] === "onelo:code" && typeof msg["code"] === "string") {
      return { type: "code", code: msg["code"] };
    }
    if (msg["type"] === "onelo:cancelled") {
      return { type: "cancelled" };
    }
    return null;
  } catch {
    return null;
  }
}
function AuthModal({ visible, hostedUrl, onResult, apiUrl, backgroundColor, callbackScheme, socialCount = 0 }) {
  const scheme = callbackScheme || CALLBACK_SCHEME4;
  const RN = require("react-native");
  const { WebView } = require("react-native-webview");
  const { Modal, View, StyleSheet, TouchableOpacity, Text, Linking, Platform, StatusBar } = RN;
  const [error, setError] = (0, import_react2.useState)(false);
  const [retryKey, setRetryKey] = (0, import_react2.useState)(0);
  const [currentUrl, setCurrentUrl] = (0, import_react2.useState)(hostedUrl);
  const resolvedRef = (0, import_react2.useRef)(false);
  const webViewRef = (0, import_react2.useRef)(null);
  const [canGoBack, setCanGoBack] = (0, import_react2.useState)(false);
  const isStoreUrl = (u) => u.toLowerCase().includes("/store/");
  const [onStore, setOnStore] = (0, import_react2.useState)(isStoreUrl(hostedUrl));
  (0, import_react2.useEffect)(() => {
    setCurrentUrl(hostedUrl);
    resolvedRef.current = false;
    setCanGoBack(false);
    setOnStore(isStoreUrl(hostedUrl));
  }, [hostedUrl, visible]);
  const resolveOnce = (0, import_react2.useCallback)(
    (result) => {
      if (resolvedRef.current) return;
      resolvedRef.current = true;
      onResult(result);
    },
    [onResult]
  );
  const handleCallbackUrl = (0, import_react2.useCallback)(
    (url) => {
      const parsed = parseCallbackDeepLink(url, scheme);
      if (!parsed) return false;
      if (parsed.host !== "callback") {
        resolveOnce({ type: "error", message: "Auth callback URL has unexpected host" });
        return true;
      }
      const { code, preauth, error: errParam } = parsed.params;
      if (code) {
        resolveOnce({ type: "code", code });
      } else if (preauth) {
        const preauthUrl = withOAuthPreauth(hostedUrl, preauth);
        webViewRef.current?.injectJavaScript(
          `window.location.replace(${JSON.stringify(preauthUrl)}); true;`
        );
      } else if (errParam) {
        resolveOnce({ type: "error", message: errParam });
      } else {
        resolveOnce({ type: "error", message: "Auth callback missing code parameter" });
      }
      return true;
    },
    [resolveOnce, hostedUrl, scheme]
  );
  const openInSystemBrowser2 = (0, import_react2.useCallback)(
    (url) => {
      openInSystemBrowser(Linking, url, () => {
        resolveOnce({ type: "error", message: "Could not open the sign-in browser" });
      });
    },
    [Linking, resolveOnce]
  );
  const openOAuth = (0, import_react2.useCallback)(
    (msg) => {
      if (msg.type === "native_oauth_url") {
        openInSystemBrowser2(msg.url);
        return;
      }
      if (!apiUrl) return;
      openInSystemBrowser2(buildHostedInitUrl(apiUrl, msg.provider, msg.token));
    },
    [apiUrl, openInSystemBrowser2]
  );
  const handleMessage = (0, import_react2.useCallback)(
    (event) => {
      const data = event.nativeEvent.data;
      const parsed = parseModalMessage(data);
      if (parsed) {
        if (parsed.type === "code") resolveOnce({ type: "code", code: parsed.code });
        else resolveOnce({ type: "cancelled" });
        return;
      }
      const oauth = parseOAuthMessage(data);
      if (oauth) openOAuth(oauth);
    },
    [resolveOnce, openOAuth]
  );
  const handleShouldStartLoad = (0, import_react2.useCallback)(
    (request) => {
      const url = request.url ?? "";
      if (url.toLowerCase().startsWith(`${scheme}://`)) {
        handleCallbackUrl(url);
        return false;
      }
      if (isOAuthNavigation(url)) {
        openInSystemBrowser2(url);
        return false;
      }
      return true;
    },
    [handleCallbackUrl, openInSystemBrowser2, scheme]
  );
  const handleNavChange = (0, import_react2.useCallback)(
    (navState) => {
      const url = navState.url ?? "";
      if (url.toLowerCase().startsWith(`${scheme}://`)) handleCallbackUrl(url);
      setCanGoBack(!!navState.canGoBack);
      setOnStore(isStoreUrl(url));
    },
    [handleCallbackUrl, scheme]
  );
  (0, import_react2.useEffect)(() => {
    if (!visible || !Linking?.addEventListener) return;
    const onUrl = (event) => {
      if (event?.url) handleCallbackUrl(event.url);
    };
    const sub = Linking.addEventListener("url", onUrl);
    return () => {
      if (sub && typeof sub.remove === "function") sub.remove();
      else if (Linking.removeEventListener) Linking.removeEventListener("url", onUrl);
    };
  }, [visible, Linking, handleCallbackUrl]);
  const handleError = (0, import_react2.useCallback)(() => {
    setError(true);
  }, []);
  const handleRetry = (0, import_react2.useCallback)(() => {
    setError(false);
    setCurrentUrl(hostedUrl);
    setRetryKey((k) => k + 1);
  }, [hostedUrl]);
  const handleCancel = (0, import_react2.useCallback)(() => {
    resolveOnce({ type: "cancelled" });
  }, [resolveOnce]);
  const handleBackOrCancel = (0, import_react2.useCallback)(() => {
    if (!isStoreUrl(hostedUrl) && canGoBack) webViewRef.current?.goBack();
    else handleCancel();
  }, [hostedUrl, canGoBack, handleCancel]);
  const bg = backgroundColor || "#111111";
  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: bg },
    webview: { flex: 1, backgroundColor: bg },
    errorContainer: { flex: 1, justifyContent: "center", alignItems: "center", gap: 16 },
    retryButton: { backgroundColor: "#ffffff", paddingHorizontal: 32, paddingVertical: 14, borderRadius: 8 },
    retryText: { color: "#000000", fontSize: 16, fontWeight: "600" },
    cancelButton: { paddingHorizontal: 32, paddingVertical: 14 },
    cancelText: { color: "#ffffff", fontSize: 16 },
    // #27 — persistent close affordance in the NORMAL flow (the hosted page,
    // e.g. the store, may not render its own cancel → user was trapped and had
    // to kill the app). Top-trailing, cleared past the notch/status bar.
    closeButton: {
      position: "absolute",
      top: Platform.OS === "ios" ? 52 : (StatusBar.currentHeight ?? 24) + 8,
      right: 16,
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: "rgba(0,0,0,0.4)",
      justifyContent: "center",
      alignItems: "center",
      zIndex: 10
    },
    closeText: { color: "#ffffff", fontSize: 19, fontWeight: "600", lineHeight: 21 }
  });
  return import_react2.default.createElement(
    Modal,
    {
      visible,
      // #28 — 'none' (not 'slide'): the modal's loading skeleton is PIXEL-IDENTICAL
      // to the gate's skeleton it appears over (same HTML, bg, socialCount), so a
      // slide-in reads as a jarring "second load / jump". Swapping in place makes
      // the gate→modal skeleton hand-off seamless (one continuous surface).
      animationType: "none",
      presentationStyle: "fullScreen",
      // #27 — Android hardware back: step back in the hosted flow, else cancel.
      onRequestClose: handleBackOrCancel
    },
    import_react2.default.createElement(
      View,
      { style: styles.container },
      !error && import_react2.default.createElement(WebView, {
        // Route the custom callback scheme THROUGH onShouldStartLoadWithRequest
        // (where handleShouldStartLoad extracts the one-time code + returns false).
        // Without the scheme whitelisted, react-native-webview shunts
        // `onelorn://callback?code=…` to Linking.openURL ("Can't open url" when the
        // scheme isn't registered) and the in-WebView interceptor is bypassed — the
        // code is lost and sign-in never completes. http/https keep normal page loads.
        originWhitelist: ["http://*", "https://*", `${scheme}://*`],
        // Ephemeral session — RN analogue of Swift's `websiteDataStore =
        // .nonPersistent()`. Auth cookies/localStorage/cache must NOT survive the
        // modal or the app restart: otherwise a half-finished or expired hosted
        // flow leaves stale state the page reloads into ("session expired" on a
        // supposedly-fresh start, requiring a manual data clear).
        incognito: true,
        ref: webViewRef,
        key: retryKey,
        // #28 single-WebView: load the skeleton HTML, which `location.replace()`s
        // to the hosted URL after it paints. ONE WebView shows the skeleton then
        // the page — no separate overlay instance, no slide, no jump. The skeleton
        // stays visible during the network load until the hosted page paints.
        source: { html: authSkeletonHtml(socialCount, bg, currentUrl) },
        onError: handleError,
        onMessage: handleMessage,
        injectedJavaScript: OAUTH_RELAY_SCRIPT,
        onShouldStartLoadWithRequest: handleShouldStartLoad,
        onNavigationStateChange: handleNavChange,
        style: styles.webview,
        // Native WebView bg (separate from style) — react-native-webview paints
        // white by default before first paint; set it to the branding bg to kill
        // the flash on both iOS and Android.
        backgroundColor: bg
      }),
      // #27 — ✕ shown ONLY on the store ("Choose your plan"), never on the entry
      // sign-in form. Reached via "Sign Up" → it steps BACK to the sign-in form
      // (has history); reached as the entry page (signed-in-but-unentitled) → it
      // cancels out (no history). Either way the user is never trapped. Rendered
      // LAST so it sits on top of the WebView + skeleton overlay (pointerEvents:none).
      !error && onStore && import_react2.default.createElement(
        TouchableOpacity,
        {
          style: styles.closeButton,
          onPress: handleBackOrCancel,
          accessibilityRole: "button",
          accessibilityLabel: canGoBack ? "Back" : "Close",
          hitSlop: { top: 8, bottom: 8, left: 8, right: 8 }
        },
        import_react2.default.createElement(Text, { style: styles.closeText }, "\u2715")
      ),
      error && import_react2.default.createElement(
        View,
        { style: styles.errorContainer },
        import_react2.default.createElement(
          TouchableOpacity,
          { style: styles.retryButton, onPress: handleRetry },
          import_react2.default.createElement(Text, { style: styles.retryText }, "Sign In")
        ),
        import_react2.default.createElement(
          TouchableOpacity,
          { style: styles.cancelButton, onPress: handleCancel },
          import_react2.default.createElement(Text, { style: styles.cancelText }, "Cancel")
        )
      )
    )
  );
}

// src/auth/OneloAuthGate.tsx
var import_react4 = __toESM(require("react"));
var import_core7 = __toESM(require_dist());

// src/auth/hooks.ts
var import_react3 = require("react");
function useModalState(auth) {
  const [state, setState] = (0, import_react3.useState)(() => auth.getModalState());
  (0, import_react3.useEffect)(() => {
    const unsubscribe = auth.onModalStateChange(() => {
      setState(auth.getModalState());
    });
    return unsubscribe;
  }, [auth]);
  return state;
}

// src/auth/OneloAuthGate.tsx
function errorMessage(e) {
  if (e instanceof import_core7.OneloError) return e.message;
  if (e instanceof Error) return e.message;
  return void 0;
}
function OneloAuthGate({ onelo, children, fallback }) {
  const RN = require("react-native");
  const { View, StyleSheet, TouchableOpacity, Text, AppState } = RN;
  const [state, setState] = (0, import_react4.useState)({ resolved: false, allowedIn: false });
  const [restoring, setRestoring] = (0, import_react4.useState)(true);
  const [retry, setRetry] = (0, import_react4.useState)(null);
  const modal = useModalState(onelo.auth);
  const flowInFlight = (0, import_react4.useRef)(false);
  const mountedRef = (0, import_react4.useRef)(true);
  const recompute = (0, import_react4.useCallback)(async () => {
    await onelo.auth.whenReady();
    const session = await onelo.auth.getSession();
    const signedIn = session != null;
    const paywallEnabled = onelo.auth.isPaywallEnabled();
    const entitled = session?.user.entitlement === "active";
    const allowedIn = signedIn && (!paywallEnabled || entitled);
    if (!mountedRef.current) return;
    setState({ resolved: true, allowedIn });
    setRestoring(false);
  }, [onelo]);
  const driveFlow = (0, import_react4.useCallback)(async () => {
    if (flowInFlight.current) return;
    flowInFlight.current = true;
    try {
      const session = await onelo.auth.loadAuthView();
      if (mountedRef.current && session == null) setRetry({});
    } catch (e) {
      if (mountedRef.current) setRetry({ message: errorMessage(e) });
    } finally {
      flowInFlight.current = false;
      await recompute();
    }
  }, [onelo, recompute]);
  (0, import_react4.useEffect)(() => {
    mountedRef.current = true;
    onelo.auth.hasStoredSession().then((has) => {
      if (mountedRef.current && !has) setRestoring(false);
    }).catch(() => {
      if (mountedRef.current) setRestoring(false);
    });
    void recompute();
    void onelo.auth.revalidateEntitlement().then(recompute).catch(() => {
    });
    const unsubAuth = onelo.auth.onAuthStateChange(() => {
      void recompute();
    });
    const handleAppState = (next) => {
      if (next === "active") {
        void onelo.auth.revalidateEntitlement().then(recompute).catch(() => {
        });
      }
    };
    const appSub = AppState && typeof AppState.addEventListener === "function" ? AppState.addEventListener("change", handleAppState) : void 0;
    return () => {
      mountedRef.current = false;
      unsubAuth();
      if (appSub && typeof appSub.remove === "function") appSub.remove();
      else if (AppState && typeof AppState.removeEventListener === "function") {
        AppState.removeEventListener("change", handleAppState);
      }
    };
  }, [onelo, recompute]);
  (0, import_react4.useEffect)(() => {
    if (!state.resolved) return;
    if (state.allowedIn) return;
    if (retry) return;
    void driveFlow();
  }, [state.resolved, state.allowedIn, retry, driveFlow]);
  const bg = onelo.auth.pageBackgroundColor();
  const styles = StyleSheet.create({
    // #36 — the cold-start restore splash: the branding page background ONLY, no
    // form, no skeleton, no spinner. Reads as "opening…" for an auto-login rather
    // than flashing the sign-in form. Mirrors Swift's neutral branded background.
    restoringContainer: { flex: 1, backgroundColor: bg },
    retryContainer: { flex: 1, backgroundColor: bg, justifyContent: "center", alignItems: "center", gap: 16, padding: 32 },
    errorText: { color: "#ff6b6b", fontSize: 13, textAlign: "center" },
    retryButton: { backgroundColor: "#ffffff", paddingHorizontal: 32, paddingVertical: 14, borderRadius: 8 },
    retryText: { color: "#000000", fontSize: 16, fontWeight: "600" }
  });
  const handleRetry = (0, import_react4.useCallback)(() => setRetry(null), []);
  const preAuth = restoring && !state.resolved ? import_react4.default.createElement(View, { style: styles.restoringContainer }) : retry ? import_react4.default.createElement(
    View,
    { style: styles.retryContainer },
    retry.message ? import_react4.default.createElement(Text, { style: styles.errorText }, retry.message) : null,
    import_react4.default.createElement(
      TouchableOpacity,
      { style: styles.retryButton, onPress: handleRetry },
      import_react4.default.createElement(Text, { style: styles.retryText }, "Sign In")
    )
  ) : fallback ?? // #26 part B — auth-shaped loading skeleton (was a bare spinner), matching
  // the hosted page's own skeleton so the transition has no jump. social-aware.
  import_react4.default.createElement(AuthSkeleton, {
    socialCount: onelo.auth.oauthProviders.length,
    backgroundColor: bg
  });
  return import_react4.default.createElement(
    import_react4.default.Fragment,
    null,
    state.allowedIn ? children : preAuth,
    import_react4.default.createElement(AuthModal, {
      visible: modal.visible,
      hostedUrl: modal.url,
      onResult: modal.onResult ?? (() => {
      }),
      // Enables the native_oauth{provider,token} message-relay hand-off (builds the
      // system-browser OAuth URL from the backend base). Nav-diversion works without
      // it, but this activates the full OAuth path inside the gate.
      apiUrl: onelo.auth.baseUrl,
      // Branding page background — the hosted auth page paints this behind its card,
      // so the WebView shows it (not white) while loading. Resolved from config,
      // which is ready before loadAuthView() opens the modal.
      backgroundColor: onelo.auth.pageBackgroundColor(),
      // #26 part B — social-pill count for the loading skeleton so it matches
      // what the hosted form will render.
      socialCount: onelo.auth.oauthProviders.length,
      // Deep-link scheme (config.callbackScheme, default 'onelorn') so OAuth returns
      // from the system browser reopen the app and complete sign-in.
      callbackScheme: onelo.auth.callbackScheme
    })
  );
}

// src/feedback/FeedbackModal.tsx
var import_react5 = __toESM(require("react"));
var SKELETON_HTML = `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#111;font-family:-apple-system,sans-serif;padding:40px 36px 32px;overflow:hidden}
@keyframes shimmer{0%{background-position:-600px 0}100%{background-position:600px 0}}
.sk{border-radius:10px;background:linear-gradient(90deg,#1e1e1e 25%,#2a2a2a 50%,#1e1e1e 75%);background-size:600px 100%;animation:shimmer 1.4s infinite linear}
.icon{width:64px;height:64px;border-radius:14px;margin:0 auto 16px}
.title{width:220px;height:22px;margin:0 auto 40px;border-radius:6px}
.cards{display:flex;gap:12px;margin-bottom:32px}
.card{flex:1;height:76px;border-radius:12px}
.label{width:60px;height:13px;border-radius:4px;margin-bottom:8px}
.input{width:100%;height:44px;border-radius:10px;margin-bottom:24px}
.textarea{width:100%;height:110px;border-radius:10px;margin-bottom:32px}
.btn{width:100%;height:48px;border-radius:12px}
</style></head><body>
<div class="sk icon"></div><div class="sk title"></div>
<div class="cards"><div class="sk card"></div><div class="sk card"></div><div class="sk card"></div></div>
<div class="sk label"></div><div class="sk input"></div>
<div class="sk label"></div><div class="sk textarea"></div>
<div class="sk btn"></div>
</body></html>`;
var RELAY_JS = `
(function() {
  window.addEventListener('message', function(e) {
    if (!window.ReactNativeWebView || !e.data || !e.data.type) return;
    if (e.data.type === 'onelo:feedback_submitted' ||
        e.data.type === 'onelo:feedback_close' ||
        e.data.type === 'onelo:ready') {
      window.ReactNativeWebView.postMessage(JSON.stringify(e.data));
    }
  });
})();
true;
`;
function FeedbackModal({ feedback }) {
  const RN = require("react-native");
  const { WebView } = require("react-native-webview");
  const { Modal, View, StyleSheet, Platform, StatusBar, TouchableOpacity, Text } = RN;
  const [url, setUrl] = (0, import_react5.useState)(feedback.getCurrentUrl());
  const [visible, setVisible] = (0, import_react5.useState)(feedback.isVisible());
  const [hostedReady, setHostedReady] = (0, import_react5.useState)(false);
  const [failSafeArmed, setFailSafeArmed] = (0, import_react5.useState)(false);
  const [loadError, setLoadError] = (0, import_react5.useState)(false);
  (0, import_react5.useEffect)(() => {
    const unsub = feedback.subscribe((nextUrl, nextVisible) => {
      setUrl(nextUrl);
      setVisible(nextVisible);
    });
    return unsub;
  }, [feedback]);
  (0, import_react5.useEffect)(() => {
    if (!visible) return;
    setHostedReady(false);
    setFailSafeArmed(false);
    setLoadError(false);
    const t = setTimeout(() => setFailSafeArmed(true), 3500);
    return () => clearTimeout(t);
  }, [visible, url]);
  const handleMessage = (0, import_react5.useCallback)((event) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      const type = msg["type"];
      if (type === "onelo:feedback_submitted" || type === "onelo:feedback_close") feedback.close();
      else if (type === "onelo:ready") setHostedReady(true);
    } catch {
    }
  }, [feedback]);
  const showNativeClose = !hostedReady && (failSafeArmed || loadError);
  const topInset = Platform.OS === "android" ? StatusBar.currentHeight ?? 0 : 8;
  const bg = feedback.getPageBackgroundColor();
  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: bg },
    // Visible, always-present close affordance — parity with Swift's toolbar
    // "Close" button (OneloFeedback.swift). Works IDENTICALLY on iOS + Android;
    // no reliance on the Android Back gesture or the iOS swipe-to-dismiss (which
    // is absent on Android's full-screen pageSheet — the UX gap this closes).
    header: {
      flexDirection: "row",
      alignItems: "center",
      // Close (✕) trailing / top-right — the single unified close position across
      // every Onelo modal + SDK (coexists with the portal's leading "‹ Back").
      justifyContent: "flex-end",
      paddingTop: topInset,
      paddingHorizontal: 8,
      height: 48 + topInset,
      backgroundColor: bg,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: "#262626"
    },
    closeBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
    closeIcon: { color: "#ffffff", fontSize: 22, fontWeight: "400", lineHeight: 24 },
    webview: { flex: 1, backgroundColor: bg }
  });
  return import_react5.default.createElement(
    Modal,
    {
      visible,
      animationType: "slide",
      presentationStyle: "pageSheet",
      onRequestClose: () => feedback.close()
    },
    import_react5.default.createElement(
      View,
      { style: styles.container },
      // Header with a close (✕), trailing (top-right) — the single unified close
      // position across every Onelo modal + SDK. Same control on iOS + Android.
      // #40 Phase 2 — the native ✕ is now a FAIL-SAFE: shown only during the
      // pre-load / error window (see `showNativeClose`). Once the hosted page posts
      // `onelo:ready`, its canonical ✕ takes over and this hides. The bar itself is
      // kept (preserves the status-bar top inset + avoids layout shift); an empty
      // spacer holds its place when the ✕ is hidden.
      import_react5.default.createElement(
        View,
        { style: styles.header },
        showNativeClose ? import_react5.default.createElement(
          TouchableOpacity,
          {
            onPress: () => feedback.close(),
            style: styles.closeBtn,
            accessibilityRole: "button",
            accessibilityLabel: "Close feedback",
            hitSlop: { top: 8, bottom: 8, left: 8, right: 8 }
          },
          import_react5.default.createElement(Text, { style: styles.closeIcon, allowFontScaling: false }, "\u2715")
        ) : import_react5.default.createElement(View, { style: styles.closeBtn })
      ),
      // Always render WebView: shows skeleton HTML until real URL loads
      import_react5.default.createElement(WebView, {
        source: url ? { uri: url } : { html: SKELETON_HTML },
        onMessage: handleMessage,
        // #44 — a load error reveals the native fail-safe ✕ immediately (no grace
        // wait) so the user is never trapped with no way out on a failed hosted page.
        onError: () => setLoadError(true),
        injectedJavaScript: RELAY_JS,
        style: styles.webview,
        backgroundColor: bg
      })
    )
  );
}

// src/index.ts
var import_core8 = __toESM(require_dist());
var import_core9 = __toESM(require_dist());

// src/customer-portal/customer-portal-modal.tsx
var import_react6 = __toESM(require("react"));
var portalSkeletonHtml = (bg) => `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:${bg};font-family:-apple-system,sans-serif;overflow:hidden}
@keyframes onelo-shimmer{0%{background-position:-60vw 0}100%{background-position:100vw 0}}
.wrap{display:flex;flex-direction:column;align-items:center;width:100%;padding:48px 24px 0}
.col{width:100%;max-width:432px;display:flex;flex-direction:column;gap:14px}
.sk{background-color:rgba(255,255,255,0.04);background-image:linear-gradient(90deg,rgba(255,255,255,0) 0%,rgba(255,255,255,0.12) 50%,rgba(255,255,255,0) 100%);background-size:60vw 100%;background-repeat:no-repeat;background-attachment:fixed;animation:onelo-shimmer 2.4s linear infinite;border-radius:8px}
.strong{background-color:rgba(255,255,255,0.08);background-image:linear-gradient(90deg,rgba(255,255,255,0) 0%,rgba(255,255,255,0.18) 50%,rgba(255,255,255,0) 100%);background-size:60vw 100%;background-repeat:no-repeat;background-attachment:fixed;animation:onelo-shimmer 2.4s linear infinite;border-radius:9px}
.icon{width:64px;height:64px;border-radius:14px;margin-bottom:14px;background:rgba(255,255,255,0.06);border:1.5px solid rgba(255,255,255,0.1)}
.title{width:200px;height:22px;margin-bottom:10px;border-radius:6px}
.sub{width:80px;height:13px;opacity:0.7;margin-bottom:32px;border-radius:4px}
.c1{height:240px;border-radius:14px}
.c2{height:80px;border-radius:14px}
.c3{height:140px;border-radius:14px}
</style></head><body>
<div class="wrap">
<div class="sk icon"></div>
<div class="sk title"></div>
<div class="sk sub"></div>
<div class="col"><div class="strong c1"></div><div class="strong c2"></div><div class="strong c3"></div></div>
</div>
</body></html>`;
function usePortalModalState(portal) {
  const [state, setState] = (0, import_react6.useState)(() => portal.getModalState());
  (0, import_react6.useEffect)(() => {
    setState(portal.getModalState());
    const unsubscribe = portal.onPortalStateChange(() => {
      setState(portal.getModalState());
    });
    return unsubscribe;
  }, [portal]);
  return state;
}
function CustomerPortalModal({ onelo }) {
  const state = usePortalModalState(onelo.customerPortal);
  const handleResult = (0, import_react6.useCallback)((result) => {
    state.onResult?.(result);
  }, [state.onResult]);
  if (!state.visible || !state.hostedUrl) return null;
  return import_react6.default.createElement(CustomerPortalModalView, {
    visible: state.visible,
    hostedUrl: state.hostedUrl,
    callbackScheme: state.callbackScheme,
    apiUrl: state.apiUrl,
    backgroundColor: state.backgroundColor,
    onResult: handleResult
  });
}
function CustomerPortalModalView({ visible, hostedUrl, callbackScheme, apiUrl, onResult, backgroundColor }) {
  const bg = backgroundColor || "#111111";
  const RN = require("react-native");
  const { WebView } = require("react-native-webview");
  const { Modal, View, StyleSheet, TouchableOpacity, Text, Linking, Platform, StatusBar } = RN;
  const [loading, setLoading] = (0, import_react6.useState)(true);
  const [error, setError] = (0, import_react6.useState)(false);
  const [retryKey, setRetryKey] = (0, import_react6.useState)(0);
  const [canGoBack, setCanGoBack] = (0, import_react6.useState)(false);
  const [hostedReady, setHostedReady] = (0, import_react6.useState)(false);
  const [failSafeArmed, setFailSafeArmed] = (0, import_react6.useState)(false);
  const resolvedRef = (0, import_react6.useRef)(false);
  const webviewRef = (0, import_react6.useRef)(null);
  (0, import_react6.useEffect)(() => {
    resolvedRef.current = false;
    setCanGoBack(false);
  }, [hostedUrl, visible]);
  (0, import_react6.useEffect)(() => {
    if (!visible) return;
    setHostedReady(false);
    setFailSafeArmed(false);
    const t = setTimeout(() => setFailSafeArmed(true), 3500);
    return () => clearTimeout(t);
  }, [visible, hostedUrl, retryKey]);
  const resolveOnce = (0, import_react6.useCallback)(
    (result) => {
      if (resolvedRef.current) return;
      resolvedRef.current = true;
      onResult(result);
    },
    [onResult]
  );
  const handleCallbackUrl = (0, import_react6.useCallback)(
    (url) => {
      const parsed = parseCallbackDeepLink(url, callbackScheme);
      if (!parsed) return false;
      if (parsed.host !== "callback" || parsed.params["source"] !== "portal") {
        resolveOnce({ type: "cancelled" });
        return true;
      }
      resolveOnce({ type: "done", event: parsed.params["event"] });
      return true;
    },
    [callbackScheme, resolveOnce]
  );
  const openInSystemBrowser2 = (0, import_react6.useCallback)(
    (url) => {
      openInSystemBrowser(Linking, url, () => resolveOnce({ type: "cancelled" }));
    },
    [Linking, resolveOnce]
  );
  const openOAuth = (0, import_react6.useCallback)(
    (msg) => {
      if (msg.type === "native_oauth_url") {
        openInSystemBrowser2(msg.url);
        return;
      }
      if (!apiUrl) return;
      openInSystemBrowser2(buildHostedInitUrl(apiUrl, msg.provider, msg.token));
    },
    [apiUrl, openInSystemBrowser2]
  );
  const handleMessage = (0, import_react6.useCallback)(
    (event) => {
      const data = event.nativeEvent.data;
      try {
        const m = JSON.parse(data);
        if (m && m["type"] === "onelo:ready") {
          setHostedReady(true);
          return;
        }
      } catch {
      }
      const oauth = parseOAuthMessage(data);
      if (oauth) openOAuth(oauth);
    },
    [openOAuth]
  );
  const handleShouldStartLoad = (0, import_react6.useCallback)(
    (request) => {
      const url = request.url ?? "";
      if (url.toLowerCase().startsWith(`${callbackScheme}://`)) {
        handleCallbackUrl(url);
        return false;
      }
      if (isOAuthNavigation(url)) {
        openInSystemBrowser2(url);
        return false;
      }
      return true;
    },
    [callbackScheme, handleCallbackUrl, openInSystemBrowser2]
  );
  const handleOpenWindow = (0, import_react6.useCallback)(
    (event) => {
      const url = event?.nativeEvent?.targetUrl ?? "";
      if (url) openInSystemBrowser(Linking, url, () => {
      });
    },
    [Linking]
  );
  const handleNavChange = (0, import_react6.useCallback)(
    (navState) => {
      const url = navState.url ?? "";
      if (url.toLowerCase().startsWith(`${callbackScheme}://`)) handleCallbackUrl(url);
      setCanGoBack(!!navState.canGoBack);
    },
    [callbackScheme, handleCallbackUrl]
  );
  const goBack = (0, import_react6.useCallback)(() => {
    webviewRef.current?.goBack?.();
  }, []);
  (0, import_react6.useEffect)(() => {
    if (!visible || !Linking?.addEventListener) return;
    const onUrl = (event) => {
      if (event?.url) handleCallbackUrl(event.url);
    };
    const sub = Linking.addEventListener("url", onUrl);
    return () => {
      if (sub && typeof sub.remove === "function") sub.remove();
      else if (Linking.removeEventListener) Linking.removeEventListener("url", onUrl);
    };
  }, [visible, Linking, handleCallbackUrl]);
  const handleError = (0, import_react6.useCallback)(() => {
    setLoading(false);
    setError(true);
  }, []);
  const handleRetry = (0, import_react6.useCallback)(() => {
    setError(false);
    setLoading(true);
    setRetryKey((k) => k + 1);
  }, []);
  const handleCancel = (0, import_react6.useCallback)(() => {
    resolveOnce({ type: "cancelled" });
  }, [resolveOnce]);
  const handleRequestClose = (0, import_react6.useCallback)(() => {
    if (canGoBack) goBack();
    else handleCancel();
  }, [canGoBack, goBack, handleCancel]);
  const topInset = Platform.OS === "android" ? StatusBar.currentHeight ?? 0 : 8;
  const headerHeight = 48 + topInset;
  const showNativeClose = !hostedReady && (failSafeArmed || error);
  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: bg },
    // Always-present navigation chrome — a fullScreen Modal has NO swipe-to-dismiss
    // (iOS) and NO system Back affordance beyond the hardware key (Android), so
    // without this the WebView traps the user unless the hosted page happens to
    // offer its own exit. "‹ Back" steps within the portal; "Done" exits to the app.
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingTop: topInset,
      paddingHorizontal: 8,
      height: headerHeight,
      backgroundColor: bg,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: "#262626",
      // Stay above the absolute loading overlay so "Done" is tappable even while
      // the portal is loading (or if a load hangs) — the exit must never be covered.
      zIndex: 1,
      elevation: 1
    },
    headerBtn: { minWidth: 44, height: 44, paddingHorizontal: 8, alignItems: "center", justifyContent: "center", flexDirection: "row" },
    backText: { color: "#ffffff", fontSize: 17, fontWeight: "400" },
    // Close (✕) — same neutral white icon (22px/400) as the Feedback modal, so the
    // close control is identical across every Onelo modal + SDK.
    doneText: { color: "#ffffff", fontSize: 22, fontWeight: "400", lineHeight: 24 },
    webview: { flex: 1, backgroundColor: bg },
    // Skeleton sits BELOW the header (top: headerHeight) so its 48px top padding
    // aligns with where the real hosted content paints — zero shift on cross-fade.
    skeletonOverlay: { position: "absolute", top: headerHeight, left: 0, right: 0, bottom: 0, backgroundColor: bg },
    errorContainer: { flex: 1, justifyContent: "center", alignItems: "center", gap: 16 },
    retryButton: { backgroundColor: "#ffffff", paddingHorizontal: 32, paddingVertical: 14, borderRadius: 8 },
    retryText: { color: "#000000", fontSize: 16, fontWeight: "600" },
    cancelButton: { paddingHorizontal: 32, paddingVertical: 14 },
    cancelText: { color: "#ffffff", fontSize: 16 }
  });
  return import_react6.default.createElement(
    Modal,
    { visible, animationType: "slide", presentationStyle: "fullScreen", onRequestClose: handleRequestClose },
    import_react6.default.createElement(
      View,
      { style: styles.container },
      // Persistent navigation chrome: leading "‹ Back" (only when the portal has a
      // deeper page open) + trailing "Done" (always) so the user can exit back to
      // the app. Rendered above the WebView so it's never covered by page content.
      import_react6.default.createElement(
        View,
        { style: styles.header },
        !error && canGoBack ? import_react6.default.createElement(TouchableOpacity, {
          onPress: goBack,
          style: styles.headerBtn,
          accessibilityRole: "button",
          accessibilityLabel: "Go back",
          hitSlop: { top: 8, bottom: 8, left: 8, right: 8 }
        }, import_react6.default.createElement(Text, { style: styles.backText, allowFontScaling: false }, "\u2039 Back")) : import_react6.default.createElement(View, { style: styles.headerBtn }),
        // #40 Phase 2 — native ✕ is a fail-safe: shown only pre-ready (grace/error),
        // hidden once the hosted page's canonical ✕ takes over. Spacer holds its slot.
        showNativeClose ? import_react6.default.createElement(TouchableOpacity, {
          onPress: handleCancel,
          style: styles.headerBtn,
          accessibilityRole: "button",
          accessibilityLabel: "Close customer portal",
          hitSlop: { top: 8, bottom: 8, left: 8, right: 8 }
        }, import_react6.default.createElement(Text, { style: styles.doneText, allowFontScaling: false }, "\u2715")) : import_react6.default.createElement(View, { style: styles.headerBtn })
      ),
      !error && import_react6.default.createElement(WebView, {
        ref: webviewRef,
        // Whitelist the callback scheme so `onelorn://callback?source=portal…` routes
        // through onShouldStartLoadWithRequest (revoke/close handling) instead of being
        // shunted to Linking.openURL by react-native-webview. http/https keep normal loads.
        originWhitelist: ["http://*", "https://*", `${callbackScheme}://*`],
        // Ephemeral session (Swift .nonPersistent() parity) — no stale portal
        // state survives the modal / app restart.
        incognito: true,
        key: retryKey,
        source: { uri: hostedUrl },
        onLoadEnd: () => setLoading(false),
        onError: handleError,
        onMessage: handleMessage,
        injectedJavaScript: OAUTH_RELAY_SCRIPT,
        onNavigationStateChange: handleNavChange,
        onShouldStartLoadWithRequest: handleShouldStartLoad,
        onOpenWindow: handleOpenWindow,
        style: styles.webview,
        backgroundColor: bg
      }),
      // Loading placeholder: a baked shimmer skeleton (matches the hosted
      // PortalSkeleton) instead of a bare spinner, shown until the real page paints.
      // Purely visual — no message/nav/callback handlers, so it can't interfere with
      // the deep-link / OAuth interception on the real WebView above.
      loading && !error && import_react6.default.createElement(
        View,
        { style: styles.skeletonOverlay, pointerEvents: "none" },
        import_react6.default.createElement(WebView, {
          source: { html: portalSkeletonHtml(bg) },
          style: styles.webview,
          backgroundColor: bg,
          scrollEnabled: false,
          pointerEvents: "none"
        })
      ),
      error && import_react6.default.createElement(
        View,
        { style: styles.errorContainer },
        import_react6.default.createElement(
          TouchableOpacity,
          { style: styles.retryButton, onPress: handleRetry },
          import_react6.default.createElement(Text, { style: styles.retryText }, "Manage Subscription")
        ),
        import_react6.default.createElement(
          TouchableOpacity,
          { style: styles.cancelButton, onPress: handleCancel },
          import_react6.default.createElement(Text, { style: styles.cancelText }, "Cancel")
        )
      )
    )
  );
}

// src/store/store-modal.tsx
var import_react7 = __toESM(require("react"));
var storeSkeletonHtml = (bg) => `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:${bg};font-family:-apple-system,sans-serif;overflow:hidden}
@keyframes onelo-shimmer{0%{background-position:-60vw 0}100%{background-position:100vw 0}}
.wrap{width:100%;max-width:896px;margin:0 auto;padding:48px 24px 0;display:flex;flex-direction:column;align-items:center}
.head{width:100%;display:flex;flex-direction:column;align-items:center;margin-bottom:32px}
.sk{background-color:rgba(255,255,255,0.04);background-image:linear-gradient(90deg,rgba(255,255,255,0) 0%,rgba(255,255,255,0.14) 50%,rgba(255,255,255,0) 100%);background-size:60vw 100%;background-repeat:no-repeat;background-attachment:fixed;animation:onelo-shimmer 2.4s linear infinite;border-radius:8px}
.logo{width:64px;height:64px;border-radius:12px;margin-bottom:14px;background:rgba(255,255,255,0.06);border:1.5px solid rgba(255,255,255,0.1)}
.h{width:220px;height:22px;margin-bottom:10px;border-radius:6px}
.sub{width:140px;height:13px;opacity:0.7;border-radius:4px}
.grid{width:100%;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}
.card{border-radius:14px;padding:18px;min-height:180px;display:flex;flex-direction:column;gap:12px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06)}
.name{width:60%;height:14px}
.price{width:40%;height:22px}
.desc{width:90%;height:10px;opacity:0.7}
.desc2{width:75%;height:10px;opacity:0.7}
.spacer{flex:1}
.cta{width:100%;height:40px;border-radius:10px}
.foot{width:110px;height:14px;opacity:0.5;margin-top:36px}
</style></head><body>
<div class="wrap">
<div class="head"><div class="sk logo"></div><div class="sk h"></div><div class="sk sub"></div></div>
<div class="grid">
<div class="card"><div class="sk name"></div><div class="sk price"></div><div class="sk desc"></div><div class="sk desc2"></div><div class="spacer"></div><div class="sk cta"></div></div>
<div class="card"><div class="sk name"></div><div class="sk price"></div><div class="sk desc"></div><div class="sk desc2"></div><div class="spacer"></div><div class="sk cta"></div></div>
<div class="card"><div class="sk name"></div><div class="sk price"></div><div class="sk desc"></div><div class="sk desc2"></div><div class="spacer"></div><div class="sk cta"></div></div>
</div>
<div class="sk foot"></div>
</div>
</body></html>`;
function useStoreModalState(store) {
  const [state, setState] = (0, import_react7.useState)(() => store.getModalState());
  (0, import_react7.useEffect)(() => {
    setState(store.getModalState());
    const unsubscribe = store.onStoreStateChange(() => {
      setState(store.getModalState());
    });
    return unsubscribe;
  }, [store]);
  return state;
}
function StoreModal({ onelo }) {
  const state = useStoreModalState(onelo.store);
  const handleResult = (0, import_react7.useCallback)((result) => {
    state.onResult?.(result);
  }, [state.onResult]);
  if (!state.visible || !state.hostedUrl) return null;
  return import_react7.default.createElement(StoreModalView, {
    visible: state.visible,
    hostedUrl: state.hostedUrl,
    callbackScheme: state.callbackScheme,
    apiUrl: state.apiUrl,
    backgroundColor: state.backgroundColor,
    onResult: handleResult
  });
}
function StoreModalView({ visible, hostedUrl, callbackScheme, apiUrl, onResult, backgroundColor }) {
  const bg = backgroundColor || "#111111";
  const RN = require("react-native");
  const { WebView } = require("react-native-webview");
  const { Modal, View, StyleSheet, TouchableOpacity, Text, Linking, Platform, StatusBar } = RN;
  const [loading, setLoading] = (0, import_react7.useState)(true);
  const [error, setError] = (0, import_react7.useState)(false);
  const [retryKey, setRetryKey] = (0, import_react7.useState)(0);
  const [currentUrl, setCurrentUrl] = (0, import_react7.useState)(hostedUrl);
  const [canGoBack, setCanGoBack] = (0, import_react7.useState)(false);
  const resolvedRef = (0, import_react7.useRef)(false);
  const webviewRef = (0, import_react7.useRef)(null);
  (0, import_react7.useEffect)(() => {
    setCurrentUrl(hostedUrl);
    resolvedRef.current = false;
    setCanGoBack(false);
  }, [hostedUrl, visible]);
  const resolveOnce = (0, import_react7.useCallback)(
    (result) => {
      if (resolvedRef.current) return;
      resolvedRef.current = true;
      onResult(result);
    },
    [onResult]
  );
  const handleCallbackUrl = (0, import_react7.useCallback)(
    (url) => {
      const parsed = parseCallbackDeepLink(url, callbackScheme);
      if (!parsed) return false;
      if (parsed.host !== "callback") {
        resolveOnce({ type: "cancelled" });
        return true;
      }
      const { code, preauth } = parsed.params;
      if (code) {
        resolveOnce({ type: "success", code });
      } else if (preauth) {
        setCurrentUrl((prev) => withOAuthPreauth(prev || hostedUrl, preauth));
      } else {
        resolveOnce({ type: "cancelled" });
      }
      return true;
    },
    [callbackScheme, hostedUrl, resolveOnce]
  );
  const openInSystemBrowser2 = (0, import_react7.useCallback)(
    (url) => {
      openInSystemBrowser(Linking, url, () => resolveOnce({ type: "cancelled" }));
    },
    [Linking, resolveOnce]
  );
  const handleOpenWindow = (0, import_react7.useCallback)(
    (event) => {
      const url = event?.nativeEvent?.targetUrl ?? "";
      if (url) openInSystemBrowser(Linking, url, () => {
      });
    },
    [Linking]
  );
  const openOAuth = (0, import_react7.useCallback)(
    (msg) => {
      if (msg.type === "native_oauth_url") {
        openInSystemBrowser2(msg.url);
        return;
      }
      if (!apiUrl) return;
      openInSystemBrowser2(buildHostedInitUrl(apiUrl, msg.provider, msg.token));
    },
    [apiUrl, openInSystemBrowser2]
  );
  const handleMessage = (0, import_react7.useCallback)(
    (event) => {
      const data = event.nativeEvent.data;
      const parsed = parseModalMessage(data);
      if (parsed) {
        if (parsed.type === "code") resolveOnce({ type: "success", code: parsed.code });
        else resolveOnce({ type: "cancelled" });
        return;
      }
      const oauth = parseOAuthMessage(data);
      if (oauth) openOAuth(oauth);
    },
    [resolveOnce, openOAuth]
  );
  const handleShouldStartLoad = (0, import_react7.useCallback)(
    (request) => {
      const url = request.url ?? "";
      if (url.toLowerCase().startsWith(`${callbackScheme}://`)) {
        handleCallbackUrl(url);
        return false;
      }
      if (isOAuthNavigation(url)) {
        openInSystemBrowser2(url);
        return false;
      }
      return true;
    },
    [callbackScheme, handleCallbackUrl, openInSystemBrowser2]
  );
  const handleNavChange = (0, import_react7.useCallback)(
    (navState) => {
      const url = navState.url ?? "";
      if (url.toLowerCase().startsWith(`${callbackScheme}://`)) handleCallbackUrl(url);
      setCanGoBack(!!navState.canGoBack);
    },
    [callbackScheme, handleCallbackUrl]
  );
  const goBack = (0, import_react7.useCallback)(() => {
    webviewRef.current?.goBack?.();
  }, []);
  (0, import_react7.useEffect)(() => {
    if (!visible || !Linking?.addEventListener) return;
    const onUrl = (event) => {
      if (event?.url) handleCallbackUrl(event.url);
    };
    const sub = Linking.addEventListener("url", onUrl);
    return () => {
      if (sub && typeof sub.remove === "function") sub.remove();
      else if (Linking.removeEventListener) Linking.removeEventListener("url", onUrl);
    };
  }, [visible, Linking, handleCallbackUrl]);
  const handleError = (0, import_react7.useCallback)(() => {
    setLoading(false);
    setError(true);
  }, []);
  const handleRetry = (0, import_react7.useCallback)(() => {
    setError(false);
    setLoading(true);
    setCurrentUrl(hostedUrl);
    setRetryKey((k) => k + 1);
  }, [hostedUrl]);
  const handleCancel = (0, import_react7.useCallback)(() => {
    resolveOnce({ type: "cancelled" });
  }, [resolveOnce]);
  const handleRequestClose = (0, import_react7.useCallback)(() => {
    if (canGoBack) goBack();
    else handleCancel();
  }, [canGoBack, goBack, handleCancel]);
  const topInset = Platform.OS === "android" ? StatusBar.currentHeight ?? 0 : 8;
  const headerHeight = 48 + topInset;
  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: bg },
    // Always-present navigation chrome — a fullScreen Modal has NO swipe-to-dismiss
    // (iOS) and NO on-screen Back (Android), so without this the buyer is trapped in
    // checkout (hardware Back also did nothing). "‹ Back" steps within the flow;
    // "✕" abandons checkout → returns to the app.
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingTop: topInset,
      paddingHorizontal: 8,
      height: headerHeight,
      backgroundColor: bg,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: "#262626",
      // Stay above the absolute loading overlay so "✕" is tappable even while the
      // checkout is loading (or if a load hangs) — the exit must never be covered.
      zIndex: 1,
      elevation: 1
    },
    headerBtn: { minWidth: 44, height: 44, paddingHorizontal: 8, alignItems: "center", justifyContent: "center", flexDirection: "row" },
    backText: { color: "#ffffff", fontSize: 17, fontWeight: "400" },
    // Close (✕) — same neutral white icon as every other Onelo modal + SDK.
    closeText: { color: "#ffffff", fontSize: 22, fontWeight: "400", lineHeight: 24 },
    webview: { flex: 1, backgroundColor: bg },
    // Skeleton sits BELOW the header (top: headerHeight) so its 48px top padding
    // aligns with where the real hosted content paints — zero shift on cross-fade.
    skeletonOverlay: { position: "absolute", top: headerHeight, left: 0, right: 0, bottom: 0, backgroundColor: bg },
    errorContainer: { flex: 1, justifyContent: "center", alignItems: "center", gap: 16 },
    retryButton: { backgroundColor: "#ffffff", paddingHorizontal: 32, paddingVertical: 14, borderRadius: 8 },
    retryText: { color: "#000000", fontSize: 16, fontWeight: "600" },
    cancelButton: { paddingHorizontal: 32, paddingVertical: 14 },
    cancelText: { color: "#ffffff", fontSize: 16 }
  });
  return import_react7.default.createElement(
    Modal,
    { visible, animationType: "slide", presentationStyle: "fullScreen", onRequestClose: handleRequestClose },
    import_react7.default.createElement(
      View,
      { style: styles.container },
      // Persistent navigation chrome: leading "‹ Back" (only when the checkout has a
      // deeper step open) + trailing "✕" (always) so the buyer can step back or
      // abandon and return to the app. Rendered above the WebView + overlay.
      import_react7.default.createElement(
        View,
        { style: styles.header },
        !error && canGoBack ? import_react7.default.createElement(TouchableOpacity, {
          onPress: goBack,
          style: styles.headerBtn,
          accessibilityRole: "button",
          accessibilityLabel: "Go back",
          hitSlop: { top: 8, bottom: 8, left: 8, right: 8 }
        }, import_react7.default.createElement(Text, { style: styles.backText, allowFontScaling: false }, "\u2039 Back")) : import_react7.default.createElement(View, { style: styles.headerBtn }),
        import_react7.default.createElement(TouchableOpacity, {
          onPress: handleCancel,
          style: styles.headerBtn,
          accessibilityRole: "button",
          accessibilityLabel: "Close checkout",
          hitSlop: { top: 8, bottom: 8, left: 8, right: 8 }
        }, import_react7.default.createElement(Text, { style: styles.closeText, allowFontScaling: false }, "\u2715"))
      ),
      !error && import_react7.default.createElement(WebView, {
        ref: webviewRef,
        // Whitelist the callback scheme so `onelorn://callback?code=…` routes through
        // onShouldStartLoadWithRequest (code extraction) instead of being shunted to
        // Linking.openURL by react-native-webview. Without it, store checkout can't
        // complete. http/https keep normal page loads.
        originWhitelist: ["http://*", "https://*", `${callbackScheme}://*`],
        // Ephemeral session (Swift .nonPersistent() parity) — no stale checkout
        // flow-state survives the modal / app restart.
        incognito: true,
        key: retryKey,
        source: { uri: currentUrl },
        onLoadEnd: () => setLoading(false),
        onError: handleError,
        onMessage: handleMessage,
        injectedJavaScript: OAUTH_RELAY_SCRIPT,
        onNavigationStateChange: handleNavChange,
        onShouldStartLoadWithRequest: handleShouldStartLoad,
        onOpenWindow: handleOpenWindow,
        style: styles.webview,
        backgroundColor: bg
      }),
      // Loading placeholder: a baked shimmer skeleton (matches the hosted
      // StoreSkeleton) instead of a bare spinner, shown until the real page paints.
      // Purely visual — no message/nav/callback handlers, so it can't interfere with
      // the deep-link / OAuth interception on the real WebView above.
      loading && !error && import_react7.default.createElement(
        View,
        { style: styles.skeletonOverlay, pointerEvents: "none" },
        import_react7.default.createElement(WebView, {
          source: { html: storeSkeletonHtml(bg) },
          style: styles.webview,
          backgroundColor: bg,
          scrollEnabled: false,
          pointerEvents: "none"
        })
      ),
      error && import_react7.default.createElement(
        View,
        { style: styles.errorContainer },
        import_react7.default.createElement(
          TouchableOpacity,
          { style: styles.retryButton, onPress: handleRetry },
          import_react7.default.createElement(Text, { style: styles.retryText }, "Retry")
        ),
        import_react7.default.createElement(
          TouchableOpacity,
          { style: styles.cancelButton, onPress: handleCancel },
          import_react7.default.createElement(Text, { style: styles.cancelText }, "Cancel")
        )
      )
    )
  );
}

// src/consent/consent-modal.tsx
var import_react8 = __toESM(require("react"));
function parseConsentMessage(data) {
  try {
    const msg = JSON.parse(data);
    if (msg["type"] === "onelo:consent" && typeof msg["action"] === "string") {
      return { action: msg["action"] };
    }
    return null;
  } catch {
    return null;
  }
}
var POSTMESSAGE_RELAY_SCRIPT = `
(function () {
  window.addEventListener('message', function (e) {
    try {
      var d = e.data;
      if (typeof d === 'string') { d = JSON.parse(d); }
      if (d && d.type === 'onelo:consent' && d.action) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'onelo:consent', action: d.action }));
      }
    } catch (err) { /* ignore non-JSON page messages */ }
  });
  true;
})();
`;
function useConsentModalState(consent) {
  const [state, setState] = (0, import_react8.useState)(() => consent.getModalState());
  (0, import_react8.useEffect)(() => {
    setState(consent.getModalState());
    const unsubscribe = consent.onModalStateChange(() => {
      setState(consent.getModalState());
    });
    return unsubscribe;
  }, [consent]);
  return state;
}
function ConsentGateModal({ onelo }) {
  const state = useConsentModalState(onelo.consent);
  const handleResult = (0, import_react8.useCallback)((result) => {
    state.onResult?.(result);
  }, [state.onResult]);
  if (!state.visible || !state.hostedUrl) return null;
  return import_react8.default.createElement(ConsentGateModalView, {
    visible: state.visible,
    hostedUrl: state.hostedUrl,
    onResult: handleResult,
    backgroundColor: state.backgroundColor
  });
}
function ConsentGateModalView({ visible, hostedUrl, onResult, backgroundColor }) {
  const bg = backgroundColor || "#111111";
  const RN = require("react-native");
  const { WebView } = require("react-native-webview");
  const { Modal, View, StyleSheet, ActivityIndicator, TouchableOpacity, Text, BackHandler } = RN;
  const [loading, setLoading] = (0, import_react8.useState)(true);
  const [error, setError] = (0, import_react8.useState)(false);
  const [retryKey, setRetryKey] = (0, import_react8.useState)(0);
  (0, import_react8.useEffect)(() => {
    if (!visible || !BackHandler?.addEventListener) return;
    const swallow = () => true;
    const sub = BackHandler.addEventListener("hardwareBackPress", swallow);
    return () => {
      if (sub && typeof sub.remove === "function") sub.remove();
      else if (BackHandler.removeEventListener) BackHandler.removeEventListener("hardwareBackPress", swallow);
    };
  }, [visible, BackHandler]);
  const handleMessage = (0, import_react8.useCallback)((event) => {
    const parsed = parseConsentMessage(event.nativeEvent.data);
    if (!parsed) return;
    onResult({ action: parsed.action });
  }, [onResult]);
  const handleError = (0, import_react8.useCallback)(() => {
    setLoading(false);
    setError(true);
  }, []);
  const handleRetry = (0, import_react8.useCallback)(() => {
    setError(false);
    setLoading(true);
    setRetryKey((k) => k + 1);
  }, []);
  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: bg },
    webview: { flex: 1, backgroundColor: bg },
    overlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: bg, justifyContent: "center", alignItems: "center" },
    errorContainer: { flex: 1, justifyContent: "center", alignItems: "center", gap: 16 },
    retryButton: { backgroundColor: "#ffffff", paddingHorizontal: 32, paddingVertical: 14, borderRadius: 8 },
    retryText: { color: "#000000", fontSize: 16, fontWeight: "600" }
  });
  return import_react8.default.createElement(
    Modal,
    { visible, animationType: "slide", presentationStyle: "fullScreen" },
    import_react8.default.createElement(
      View,
      { style: styles.container },
      !error && import_react8.default.createElement(WebView, {
        key: retryKey,
        source: { uri: hostedUrl },
        onLoadEnd: () => setLoading(false),
        onError: handleError,
        onMessage: handleMessage,
        injectedJavaScript: POSTMESSAGE_RELAY_SCRIPT,
        style: styles.webview,
        backgroundColor: bg
      }),
      loading && !error && import_react8.default.createElement(
        View,
        { style: styles.overlay },
        import_react8.default.createElement(ActivityIndicator, { size: "large", color: "#ffffff" })
      ),
      // On a load failure allow a Retry (still no Cancel — the gate stays a hard
      // block, but a network blip must not trap the user behind a blank screen).
      error && import_react8.default.createElement(
        View,
        { style: styles.errorContainer },
        import_react8.default.createElement(
          TouchableOpacity,
          { style: styles.retryButton, onPress: handleRetry },
          import_react8.default.createElement(Text, { style: styles.retryText }, "Retry")
        )
      )
    )
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AuthModal,
  ConsentGateModal,
  ConsentGateModalView,
  CustomerPortalModal,
  CustomerPortalModalView,
  FeatureState,
  FeedbackModal,
  Onelo,
  OneloAuthGate,
  OneloConsent,
  OneloCustomerPortal,
  OneloError,
  OneloFeatures,
  OneloFeaturesError,
  OneloFeedback,
  OneloForms,
  OneloMonitor,
  OneloStore,
  OneloWaitlist,
  REASON_LABELS,
  RESPONSE_REASON_CODES,
  StoreModal,
  StoreModalView,
  parseConsentMessage,
  useConsentModalState,
  useModalState,
  usePortalModalState,
  useStoreModalState
});
