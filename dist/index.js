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
    var OneloError3 = class _OneloError extends Error {
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
      static planRequired() {
        return new _OneloError("plan_required", "[plan_required] Custom UI requires a paid Onelo plan. Use loadAuthView() instead.");
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
    exports2.OneloError = OneloError3;
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
    exports2.httpGet = httpGet3;
    exports2.httpPost = httpPost3;
    exports2.checkHostedFlowRequired = checkHostedFlowRequired2;
    var types_1 = require_types();
    async function httpGet3(url, headers) {
      let res;
      try {
        res = await fetch(url, { headers });
      } catch (e) {
        throw types_1.OneloError.network(e instanceof Error ? e.message : "fetch failed");
      }
      const json = await parseJson(res);
      return { status: res.status, json };
    }
    async function httpPost3(url, body, headers) {
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
      const user = j["user"];
      const appMeta = user?.["app_metadata"] ?? {};
      return {
        accessToken: j["access_token"],
        refreshToken: j["refresh_token"],
        expiresAt: j["expires_at"] ?? 0,
        user: {
          id: user["id"],
          email: user["email"],
          role: appMeta["user_role"] ?? user["role"] ?? "member",
          tenantId: appMeta["tenant_id"] ?? user["tenant_id"] ?? null
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

// ../onelo-core/dist/paywall.js
var require_paywall = __commonJS({
  "../onelo-core/dist/paywall.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.cancelSubscription = cancelSubscription;
    var http_1 = require_http();
    var types_1 = require_types();
    async function cancelSubscription(apiUrl, publishableKey, accessToken, opts = {}) {
      const body = { publishableKey };
      if (opts.reasonCode)
        body.reason_code = opts.reasonCode;
      if (opts.reasonText)
        body.reason_text = opts.reasonText.slice(0, 500);
      const { status, json } = await (0, http_1.httpPost)(`${apiUrl}/api/sdk/paywall/cancel`, body, { Authorization: `Bearer ${accessToken}` });
      if (status !== 200) {
        const j = json;
        const msg = typeof j["detail"] === "string" ? j["detail"] : "Failed to cancel subscription";
        throw types_1.OneloError.server(msg);
      }
      return { cancelled: true };
    }
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
    __exportStar(require_paywall(), exports2);
  }
});

// package.json
var require_package = __commonJS({
  "package.json"(exports2, module2) {
    module2.exports = {
      name: "@onelo/react-native",
      version: "0.12.0-staging",
      description: "Onelo React Native SDK",
      main: "./dist/index.js",
      types: "./dist/index.d.ts",
      files: [
        "dist"
      ],
      scripts: {
        build: "tsup src/index.ts --format cjs --dts --clean --no-splitting --external react --external react-native --external react-native-keychain --external react-native-webview",
        dev: "tsup src/index.ts --format cjs --dts --watch --no-splitting --external react --external react-native --external react-native-keychain --external react-native-webview",
        test: "vitest run"
      },
      dependencies: {
        "js-sha256": "^0.11.0"
      },
      peerDependencies: {
        react: ">=18.0.0",
        "react-native": ">=0.71.0",
        "react-native-keychain": ">=8.0.0",
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

// src/sdk-headers.ts
var sdk_headers_exports = {};
__export(sdk_headers_exports, {
  sdkHeaders: () => sdkHeaders
});
function sdkHeaders(bundleId) {
  return {
    "X-SDK-Version": import_package.version,
    ...bundleId ? { "X-Bundle-Id": bundleId } : {}
  };
}
var import_package;
var init_sdk_headers = __esm({
  "src/sdk-headers.ts"() {
    "use strict";
    import_package = __toESM(require_package());
  }
});

// src/index.ts
var index_exports = {};
__export(index_exports, {
  AuthModal: () => AuthModal,
  FeatureState: () => FeatureState,
  FeedbackModal: () => FeedbackModal,
  Onelo: () => Onelo,
  OneloError: () => import_core3.OneloError,
  OneloFeatures: () => OneloFeatures,
  OneloFeedback: () => OneloFeedback,
  OneloForms: () => OneloForms,
  OneloMonitor: () => OneloMonitor,
  OneloPaywall: () => OneloPaywall,
  OneloWaitlist: () => OneloWaitlist,
  useModalState: () => useModalState
});
module.exports = __toCommonJS(index_exports);

// src/auth/auth.ts
var import_core = __toESM(require_dist());

// src/core/pkce.ts
var import_js_sha256 = require("js-sha256");
function generateCodeVerifier() {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
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

// src/core/storage.ts
var Keychain = __toESM(require("react-native-keychain"));
var KeychainStorage = class {
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
      await Keychain.resetInternetCredentials(key);
    } catch {
    }
  }
  async clear() {
    const keys = ["onelo_access_token", "onelo_refresh_token", "onelo_expires_at", "onelo_user"];
    await Promise.all(keys.map((k) => this.delete(k)));
  }
};

// src/auth/auth.ts
var SDK_VERSION = require_package().version;
var _OneloAuth = class _OneloAuth {
  constructor(config) {
    this.pkceVerifier = null;
    this.resolvedConfig = null;
    this.heartbeatTimer = null;
    this.refreshTimer = null;
    this.authStateListeners = [];
    this.modalStateListeners = [];
    this._modalVisible = false;
    this._modalUrl = "";
    this._modalResolve = null;
    this.isReady = false;
    this.isRevoked = false;
    this.allowCustomBranding = false;
    this.appName = "App";
    this.appLogoUrl = null;
    if (!config.apiUrl) throw new Error("[Onelo] apiUrl is required");
    if (!config.publishableKey) throw new Error("[Onelo] publishableKey is required");
    this.apiUrl = config.apiUrl;
    this.publishableKey = config.publishableKey;
    this.storage = new KeychainStorage();
    this.initPromise = this.initialize();
  }
  async initialize() {
    try {
      const verifier = generateCodeVerifier();
      this.pkceVerifier = verifier;
      const challenge = generateCodeChallenge(verifier);
      const url = `${this.apiUrl}/api/sdk/config?key=${encodeURIComponent(this.publishableKey)}&code_challenge=${encodeURIComponent(challenge)}`;
      const { status, json } = await (0, import_core.httpGet)(url, { "X-SDK-Version": SDK_VERSION });
      if (status === 401 || status === 404) throw import_core.OneloError.invalidKey("Server rejected the key");
      if (status !== 200) throw import_core.OneloError.server(`Config request failed: HTTP ${status}`);
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
        manageUrl: j["manage_url"] ?? null
      };
      const resolved = this.resolvedConfig;
      this.allowCustomBranding = resolved.allowCustomBranding;
      if (resolved.appName) this.appName = resolved.appName;
      this.appLogoUrl = resolved.appLogoUrl;
      this.isReady = true;
    } catch (e) {
      if (e instanceof import_core.OneloError && e.code === "invalid_publishable_key") {
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
    if (this.isRevoked) throw import_core.OneloError.invalidKey("Application key has been revoked");
    const hostedUrl = await this.getHostedUrl();
    return new Promise((resolve, reject) => {
      this._modalUrl = hostedUrl;
      this._modalVisible = true;
      this.notifyModalListeners();
      this._modalResolve = async (result) => {
        this._modalVisible = false;
        this._modalResolve = null;
        this.notifyModalListeners();
        if (result.type === "cancelled") {
          resolve(null);
          return;
        }
        if (result.type === "error") {
          reject(import_core.OneloError.server(result.message));
          return;
        }
        try {
          const { status, json } = await (0, import_core.httpPost)(
            `${this.apiUrl}/api/sdk/auth/hosted-callback`,
            { publishableKey: this.publishableKey, code: result.code, code_verifier: this.pkceVerifier },
            { "X-SDK-Version": SDK_VERSION }
          );
          if (status !== 200) {
            reject(import_core.OneloError.server("Hosted callback failed"));
            return;
          }
          const session = (0, import_core.mapSession)(json);
          await this.saveSession(session);
          resolve(session);
        } catch (e) {
          reject(e);
        }
      };
    });
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
    const { status, json } = await (0, import_core.httpGet)(
      `${this.apiUrl}/api/sdk/auth/initiate?key=${encodeURIComponent(this.publishableKey)}&callback_scheme=onelorn`,
      { "X-SDK-Version": SDK_VERSION }
    );
    if (status !== 200) throw import_core.OneloError.server("Failed to initiate hosted auth flow");
    const j = json;
    const hostedUrl = j["hosted_url"];
    if (!hostedUrl) throw import_core.OneloError.server("Invalid initiate response");
    if (j["app_name"]) this.appName = j["app_name"];
    if (j["app_logo_url"]) this.appLogoUrl = j["app_logo_url"];
    return hostedUrl;
  }
  // ── Custom UI (paid plans only) ─────────────────────────────────────────────
  async signIn(email, password) {
    await this.initPromise;
    if (!this.allowCustomBranding) throw import_core.OneloError.planRequired();
    if (!this.pkceVerifier) this.pkceVerifier = generateCodeVerifier();
    const { status, json } = await (0, import_core.httpPost)(
      `${this.apiUrl}/api/sdk/auth/signin`,
      { email, password, publishableKey: this.publishableKey, code_verifier: this.pkceVerifier },
      { "X-SDK-Version": SDK_VERSION }
    );
    (0, import_core.checkHostedFlowRequired)(json);
    const j = json;
    if (status === 403) {
      const detail = j["detail"];
      if (detail?.["error"] === "user_revoked") throw import_core.OneloError.userRevoked();
      throw import_core.OneloError.server(detail?.["message"] ?? j["error"]);
    }
    if (status !== 200) throw import_core.OneloError.server(`Sign in failed: HTTP ${status}`);
    this.pkceVerifier = null;
    const session = (0, import_core.mapSession)(j);
    await this.saveSession(session);
    return session;
  }
  async signUp(email, password) {
    await this.initPromise;
    if (!this.allowCustomBranding) throw import_core.OneloError.planRequired();
    if (!this.pkceVerifier) this.pkceVerifier = generateCodeVerifier();
    const { status, json } = await (0, import_core.httpPost)(
      `${this.apiUrl}/api/sdk/auth/signup`,
      { email, password, publishableKey: this.publishableKey, code_verifier: this.pkceVerifier },
      { "X-SDK-Version": SDK_VERSION }
    );
    (0, import_core.checkHostedFlowRequired)(json);
    const j = json;
    if (status !== 200) throw import_core.OneloError.server(`Sign up failed: HTTP ${status}`);
    this.pkceVerifier = null;
    const session = (0, import_core.mapSession)(j);
    await this.saveSession(session);
    return session;
  }
  // ── Session management ──────────────────────────────────────────────────────
  async signOut() {
    this.stopHeartbeat();
    this.clearRefreshTimer();
    await this.storage.clear();
    this.notifyListeners(null);
  }
  async getSession() {
    const [accessToken, refreshToken, expiresAtStr, userJson] = await Promise.all([
      this.storage.get(import_core.TOKEN_KEYS.ACCESS_TOKEN),
      this.storage.get(import_core.TOKEN_KEYS.REFRESH_TOKEN),
      this.storage.get(import_core.TOKEN_KEYS.EXPIRES_AT),
      this.storage.get(import_core.TOKEN_KEYS.USER_JSON)
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
    const refreshToken = await this.storage.get(import_core.TOKEN_KEYS.REFRESH_TOKEN);
    if (!refreshToken) return null;
    const { status, json } = await (0, import_core.httpPost)(
      `${this.apiUrl}/api/sdk/auth/refresh`,
      { publishableKey: this.publishableKey, refreshToken },
      { "X-SDK-Version": SDK_VERSION }
    );
    (0, import_core.checkHostedFlowRequired)(json);
    const j = json;
    if (j["error"] === "user_revoked") {
      this.clearRefreshTimer();
      await this.storage.clear();
      this.notifyListeners(null);
      throw import_core.OneloError.userRevoked();
    }
    if (j["error"] === "app_revoked") {
      this.clearRefreshTimer();
      await this.storage.clear();
      this.notifyListeners(null);
      throw import_core.OneloError.revoked();
    }
    if (status !== 200) {
      this.clearRefreshTimer();
      await this.storage.clear();
      this.notifyListeners(null);
      return null;
    }
    const session = (0, import_core.mapSession)(j);
    await this.saveSession(session);
    return session;
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
      const session = await this.getSession();
      if (!session) {
        this.stopHeartbeat();
        return;
      }
      try {
        await fetch(`${this.apiUrl}/api/sdk/presence/heartbeat`, {
          method: "POST",
          headers: { Authorization: `Bearer ${session.accessToken}` }
        });
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
      this.storage.set(import_core.TOKEN_KEYS.ACCESS_TOKEN, session.accessToken),
      this.storage.set(import_core.TOKEN_KEYS.REFRESH_TOKEN, session.refreshToken),
      this.storage.set(import_core.TOKEN_KEYS.EXPIRES_AT, String(session.expiresAt)),
      this.storage.set(import_core.TOKEN_KEYS.USER_JSON, JSON.stringify(session.user))
    ]);
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
    const { status } = await (0, import_core.httpPost)(
      `${this.apiUrl}/api/sdk/auth/magic-link`,
      { email, publishableKey: this.publishableKey },
      { "X-SDK-Version": SDK_VERSION }
    );
    if (status !== 200) throw import_core.OneloError.server(`sendMagicLink failed: HTTP ${status}`);
  }
  async sendPasswordReset(email) {
    await this.initPromise;
    const { status } = await (0, import_core.httpPost)(
      `${this.apiUrl}/api/sdk/auth/reset-password/request`,
      { email, publishableKey: this.publishableKey },
      { "X-SDK-Version": SDK_VERSION }
    );
    if (status !== 200) throw import_core.OneloError.server(`sendPasswordReset failed: HTTP ${status}`);
  }
};
_OneloAuth.HEARTBEAT_MS = 13 * 60 * 1e3;
/** Refresh this many seconds before the access token expires. */
_OneloAuth.REFRESH_LEAD_SECONDS = 60;
var OneloAuth = _OneloAuth;

// src/features/features.ts
var import_core2 = __toESM(require_dist());
var FeatureState = class {
  constructor(name, status) {
    this.name = name;
    this.status = status;
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
  get badgeLabel() {
    if (this.status === "new") return "New";
    if (this.status === "beta") return "Beta";
    if (this.status === "coming_soon") return "Coming Soon";
    return null;
  }
};
var POLL_INTERVAL_MS = 6e4;
var OneloFeatures = class {
  constructor(apiUrl, publishableKey, monitor, bundleId, options) {
    this.cache = /* @__PURE__ */ new Map();
    this.discoveredNames = /* @__PURE__ */ new Set();
    this.configVersion = 0;
    this.pollTimer = null;
    this.pingDebounce = null;
    this.monitor = null;
    this.anonymousWarningLogged = false;
    this.apiUrl = apiUrl;
    this.publishableKey = publishableKey;
    this.monitor = monitor ?? null;
    this.bundleId = bundleId;
    this.suppressIdentifyWarning = options?.suppressIdentifyWarning ?? false;
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
    const status = this.cache.get(name) ?? "hidden";
    return new FeatureState(name, status);
  }
  /** Load features for a user (or anonymous). Called by Onelo orchestrator. */
  async load(userId) {
    await this._batchPing();
    await this._resolve(userId);
    this._startPolling(userId);
  }
  /** Returns names of all features with an active status (enabled, new, or beta). */
  getActiveFeatures() {
    const active = [];
    for (const [name, status] of this.cache) {
      if (status === "enabled" || status === "new" || status === "beta") {
        active.push(name);
      }
    }
    return active;
  }
  /** Stop background polling. Call when SDK is no longer needed. */
  stopPolling() {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.pingDebounce !== null) {
      clearTimeout(this.pingDebounce);
      this.pingDebounce = null;
    }
  }
  /** Clears the local feature cache and resets the config version. The next feature() call will re-fetch. */
  invalidateCache() {
    this.cache.clear();
    this.configVersion = 0;
  }
  // ── Private ──────────────────────────────────────────────────────────────────
  _scheduleBatchPing() {
    if (this.pingDebounce !== null) clearTimeout(this.pingDebounce);
    this.pingDebounce = setTimeout(() => {
      this.pingDebounce = null;
      void this._batchPing();
    }, 1e3);
  }
  async _batchPing() {
    const names = Array.from(this.discoveredNames);
    if (names.length === 0) return;
    try {
      const { sdkHeaders: sdkHeaders2 } = await Promise.resolve().then(() => (init_sdk_headers(), sdk_headers_exports));
      await (0, import_core2.httpPost)(`${this.apiUrl}/api/sdk/features/batch-ping`, {
        publishableKey: this.publishableKey,
        features: names
      }, sdkHeaders2(this.bundleId));
    } catch {
    }
  }
  async _resolve(userId) {
    try {
      const body = { publishableKey: this.publishableKey };
      if (userId) body["userId"] = userId;
      const { sdkHeaders: sdkHeaders2 } = await Promise.resolve().then(() => (init_sdk_headers(), sdk_headers_exports));
      const { status, json } = await (0, import_core2.httpPost)(`${this.apiUrl}/api/sdk/features/resolve`, body, sdkHeaders2(this.bundleId));
      if (status !== 200) return;
      const j = json;
      const features = j["features"];
      if (features) {
        this.cache.clear();
        for (const [name, state] of Object.entries(features)) {
          this.cache.set(name, state.status);
        }
      }
      if (typeof j["config_version"] === "number") {
        this.configVersion = j["config_version"];
      }
      this._maybeWarnAnonymous(j);
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
        version: String(this.configVersion)
      });
      if (userId) params.set("userId", userId);
      const { sdkHeaders: sdkHeaders2 } = await Promise.resolve().then(() => (init_sdk_headers(), sdk_headers_exports));
      const { status, json } = await (0, import_core2.httpGet)(
        `${this.apiUrl}/api/sdk/features/poll?${params.toString()}`,
        sdkHeaders2(this.bundleId)
      );
      if (status !== 200) return;
      const j = json;
      if (j["changed"] === false) return;
      const features = j["features"];
      if (features) {
        this.cache.clear();
        for (const [name, state] of Object.entries(features)) {
          this.cache.set(name, state.status);
        }
      }
      if (typeof j["config_version"] === "number") {
        this.configVersion = j["config_version"];
      }
      if (j["discovery_requested"] === true) {
        await this._batchPing();
      }
    } catch {
    }
  }
  _startPolling(userId) {
    if (this.pollTimer !== null) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => {
      void this._poll(userId);
    }, POLL_INTERVAL_MS);
  }
};

// src/monitor/monitor.ts
var MAX_BUFFER_SIZE = 200;
var PLATFORM = "reactnative";
var _globalHandlersRegistered = false;
var OneloMonitor = class {
  constructor(publishableKey, apiUrl, bundleId) {
    this.buffer = [];
    this.flushTimer = null;
    this.currentUserId = null;
    this.sessionId = (() => {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      bytes[6] = bytes[6] & 15 | 64;
      bytes[8] = bytes[8] & 63 | 128;
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    })();
    this.publishableKey = publishableKey;
    this.apiUrl = apiUrl;
    this.bundleId = bundleId;
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, 15e3);
    this._registerGlobalHandlers();
  }
  /** Sets the current user ID attached to all subsequent monitor events. Call after login/logout if not using Onelo Auth. */
  setUserId(userId) {
    this.currentUserId = userId;
  }
  _trackFeatureCall(featureName) {
    this._push(featureName, true, void 0, void 0, void 0, "feature_call");
  }
  async track(featureName, fn, options) {
    const start = Date.now();
    try {
      const result = await fn();
      this._push(featureName, true, Date.now() - start, void 0, options?.meta, "track");
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this._push(featureName, false, Date.now() - start, message, options?.meta, "track");
      throw err;
    }
  }
  event(featureName, opts) {
    this._push(featureName, opts.ok, opts.durationMs, opts.error, opts.meta, "event");
  }
  async flush() {
    if (this.buffer.length === 0) return;
    const events = this.buffer.splice(0);
    try {
      const { sdkHeaders: sdkHeaders2 } = await Promise.resolve().then(() => (init_sdk_headers(), sdk_headers_exports));
      await fetch(`${this.apiUrl}/api/sdk/monitor/events/batch`, {
        method: "POST",
        headers: { ...sdkHeaders2(this.bundleId), "Content-Type": "application/json" },
        body: JSON.stringify({ publishableKey: this.publishableKey, events })
      });
    } catch {
    }
  }
  destroy() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    void this.flush();
  }
  _push(featureName, ok, durationMs, error, meta, source = "event") {
    if (this.buffer.length >= MAX_BUFFER_SIZE) this.buffer.shift();
    this.buffer.push({
      featureName,
      ok,
      durationMs,
      error,
      meta,
      source,
      userId: this.currentUserId ?? void 0,
      platform: PLATFORM,
      sessionId: this.sessionId
    });
    if (!ok || source === "global_error") {
      void this.flush();
    }
  }
  _registerGlobalHandlers() {
    if (_globalHandlersRegistered) return;
    _globalHandlersRegistered = true;
    const handler = (error) => {
      this._push("unhandled", false, void 0, error, void 0, "global_error");
      void this.flush();
    };
    try {
      const ErrorUtils = globalThis?.ErrorUtils;
      if (ErrorUtils?.setGlobalHandler) {
        ErrorUtils.setGlobalHandler((err) => handler(err.message));
      }
    } catch {
    }
  }
};

// src/feedback/feedback.ts
var OneloFeedback = class {
  constructor(apiUrl, publishableKey, getActiveFeatures, bundleId) {
    this.apiUrl = apiUrl;
    this.publishableKey = publishableKey;
    this.getActiveFeatures = getActiveFeatures;
    this.bundleId = bundleId;
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
      if (options.userId) params.set("userId", options.userId);
      const active = this.getActiveFeatures();
      if (active.length > 0) params.set("session", JSON.stringify(active));
      const { sdkHeaders: sdkHeaders2 } = await Promise.resolve().then(() => (init_sdk_headers(), sdk_headers_exports));
      const res = await fetch(`${this.apiUrl}/api/sdk/feedback/initiate?${params}`, {
        headers: sdkHeaders2(this.bundleId)
      });
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
};

// src/paywall/paywall.ts
var TIER = { free: 0, pro: 1, business: 2, enterprise: 3 };
var OneloPaywall = class {
  check(requiredPlan, userPlan = "free") {
    const req = TIER[requiredPlan];
    const usr = TIER[userPlan];
    if (req === void 0 || usr === void 0) return false;
    return usr >= req;
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
      const body = { publishableKey: this.publishableKey, formSlug, data };
      if (submitterEmail) body.submitterEmail = submitterEmail;
      const res = await fetch(`${this.apiUrl}/api/sdk/forms/submit`, {
        method: "POST",
        headers: { ...sdkHeaders2(this.bundleId), "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const json = await res.json();
      return { success: json.success ?? false, message: json.message };
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
      const body = { publishableKey: this.publishableKey, email };
      if (slug !== void 0) body.slug = slug;
      const res = await fetch(`${this.apiUrl}/api/sdk/waitlist/join`, {
        method: "POST",
        headers: { ...sdkHeaders2(this.bundleId), "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const json = await res.json();
      return { success: json.success ?? false, position: json.position, alreadyJoined: json.alreadyJoined ?? false };
    } catch {
      return { success: false, alreadyJoined: false };
    }
  }
};

// src/onelo.ts
var Onelo = class {
  constructor(config) {
    this.authUnsubscribe = null;
    this.auth = new OneloAuth(config);
    this.monitor = new OneloMonitor(config.publishableKey, config.apiUrl, config.bundleId);
    this.features = new OneloFeatures(config.apiUrl, config.publishableKey, this.monitor, config.bundleId, {
      suppressIdentifyWarning: config.suppressIdentifyWarning ?? false
    });
    this.feedback = new OneloFeedback(config.apiUrl, config.publishableKey, () => this.features.getActiveFeatures(), config.bundleId);
    this.paywall = new OneloPaywall();
    this.forms = new OneloForms(config.apiUrl, config.publishableKey, config.bundleId);
    this.waitlist = new OneloWaitlist(config.apiUrl, config.publishableKey, config.bundleId);
    this.authUnsubscribe = this.auth.onAuthStateChange((session) => {
      const userId = session?.user.id ?? null;
      this.monitor.setUserId(userId);
      void this.features.load(userId);
    });
    this.monitor.setUserId(null);
    void this.features.load(null);
  }
  /** Only needed when NOT using Onelo Auth (own auth system). */
  async identify(userId) {
    await this.features.load(userId);
  }
  /** Release background timers. Call when the SDK instance is no longer needed. */
  destroy() {
    this.authUnsubscribe?.();
    this.features.stopPolling();
    this.monitor.destroy();
  }
};

// src/auth/auth-modal.tsx
var import_react = __toESM(require("react"));
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
function AuthModal({ visible, hostedUrl, onResult }) {
  const RN = require("react-native");
  const { WebView } = require("react-native-webview");
  const { Modal, View, StyleSheet, ActivityIndicator, TouchableOpacity, Text } = RN;
  const [loading, setLoading] = (0, import_react.useState)(true);
  const [error, setError] = (0, import_react.useState)(false);
  const handleMessage = (0, import_react.useCallback)((event) => {
    const parsed = parseModalMessage(event.nativeEvent.data);
    if (!parsed) return;
    if (parsed.type === "code") {
      onResult({ type: "code", code: parsed.code });
    } else {
      onResult({ type: "cancelled" });
    }
  }, [onResult]);
  const handleError = (0, import_react.useCallback)(() => {
    setLoading(false);
    setError(true);
  }, []);
  const handleRetry = (0, import_react.useCallback)(() => {
    setError(false);
    setLoading(true);
  }, []);
  const handleCancel = (0, import_react.useCallback)(() => {
    onResult({ type: "cancelled" });
  }, [onResult]);
  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: "#000000" },
    webview: { flex: 1 },
    overlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#000000", justifyContent: "center", alignItems: "center" },
    errorContainer: { flex: 1, justifyContent: "center", alignItems: "center", gap: 16 },
    retryButton: { backgroundColor: "#ffffff", paddingHorizontal: 32, paddingVertical: 14, borderRadius: 8 },
    retryText: { color: "#000000", fontSize: 16, fontWeight: "600" },
    cancelButton: { paddingHorizontal: 32, paddingVertical: 14 },
    cancelText: { color: "#ffffff", fontSize: 16 }
  });
  return import_react.default.createElement(
    Modal,
    { visible, animationType: "slide", presentationStyle: "fullScreen" },
    import_react.default.createElement(
      View,
      { style: styles.container },
      !error && import_react.default.createElement(WebView, {
        source: { uri: hostedUrl },
        onLoadEnd: () => setLoading(false),
        onError: handleError,
        onMessage: handleMessage,
        style: styles.webview
      }),
      loading && !error && import_react.default.createElement(
        View,
        { style: styles.overlay },
        import_react.default.createElement(ActivityIndicator, { size: "large", color: "#ffffff" })
      ),
      error && import_react.default.createElement(
        View,
        { style: styles.errorContainer },
        import_react.default.createElement(
          TouchableOpacity,
          { style: styles.retryButton, onPress: handleRetry },
          import_react.default.createElement(Text, { style: styles.retryText }, "Sign In")
        ),
        import_react.default.createElement(
          TouchableOpacity,
          { style: styles.cancelButton, onPress: handleCancel },
          import_react.default.createElement(Text, { style: styles.cancelText }, "Cancel")
        )
      )
    )
  );
}

// src/auth/hooks.ts
var import_react2 = require("react");
function useModalState(auth) {
  const [state, setState] = (0, import_react2.useState)(() => auth.getModalState());
  (0, import_react2.useEffect)(() => {
    const unsubscribe = auth.onModalStateChange(() => {
      setState(auth.getModalState());
    });
    return unsubscribe;
  }, [auth]);
  return state;
}

// src/feedback/FeedbackModal.tsx
var import_react3 = __toESM(require("react"));
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
    if (window.ReactNativeWebView && e.data && e.data.type === 'onelo:feedback_submitted') {
      window.ReactNativeWebView.postMessage(JSON.stringify(e.data));
    }
  });
})();
true;
`;
function FeedbackModal({ feedback }) {
  const RN = require("react-native");
  const { WebView } = require("react-native-webview");
  const { Modal, View, StyleSheet } = RN;
  const [url, setUrl] = (0, import_react3.useState)(feedback.getCurrentUrl());
  const [visible, setVisible] = (0, import_react3.useState)(feedback.isVisible());
  (0, import_react3.useEffect)(() => {
    const unsub = feedback.subscribe((nextUrl, nextVisible) => {
      setUrl(nextUrl);
      setVisible(nextVisible);
    });
    return unsub;
  }, [feedback]);
  const handleMessage = (0, import_react3.useCallback)((event) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg["type"] === "onelo:feedback_submitted") feedback.close();
    } catch {
    }
  }, [feedback]);
  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: "#111111" },
    webview: { flex: 1, backgroundColor: "#111111" }
  });
  return import_react3.default.createElement(
    Modal,
    {
      visible,
      animationType: "slide",
      presentationStyle: "pageSheet",
      onRequestClose: () => feedback.close()
    },
    import_react3.default.createElement(
      View,
      { style: styles.container },
      // Always render WebView: shows skeleton HTML until real URL loads
      import_react3.default.createElement(WebView, {
        source: url ? { uri: url } : { html: SKELETON_HTML },
        onMessage: handleMessage,
        injectedJavaScript: RELAY_JS,
        style: styles.webview,
        backgroundColor: "#111111"
      })
    )
  );
}

// src/index.ts
var import_core3 = __toESM(require_dist());
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AuthModal,
  FeatureState,
  FeedbackModal,
  Onelo,
  OneloError,
  OneloFeatures,
  OneloFeedback,
  OneloForms,
  OneloMonitor,
  OneloPaywall,
  OneloWaitlist,
  useModalState
});
