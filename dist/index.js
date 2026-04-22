"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
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
  }
});

// package.json
var require_package = __commonJS({
  "package.json"(exports2, module2) {
    module2.exports = {
      name: "@onelo/react-native",
      version: "0.3.0-staging",
      description: "Onelo React Native SDK",
      main: "./dist/index.js",
      types: "./dist/index.d.ts",
      files: ["dist"],
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

// src/index.ts
var index_exports = {};
__export(index_exports, {
  AuthModal: () => AuthModal,
  FeatureState: () => FeatureState,
  Onelo: () => Onelo,
  OneloError: () => import_core3.OneloError,
  OneloFeatures: () => OneloFeatures,
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
var OneloAuth = class {
  constructor(config) {
    this.pkceVerifier = null;
    this.resolvedConfig = null;
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
        appLogoUrl: j["app_logo_url"] ?? null
      };
      this.allowCustomBranding = this.resolvedConfig.allowCustomBranding;
      if (this.resolvedConfig.appName) this.appName = this.resolvedConfig.appName;
      this.appLogoUrl = this.resolvedConfig.appLogoUrl;
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
            { publishableKey: this.publishableKey, code: result.code },
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
    return { accessToken, refreshToken, expiresAt, user: JSON.parse(userJson) };
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
      await this.storage.clear();
      this.notifyListeners(null);
      throw import_core.OneloError.userRevoked();
    }
    if (j["error"] === "app_revoked") {
      await this.storage.clear();
      this.notifyListeners(null);
      throw import_core.OneloError.revoked();
    }
    if (status !== 200) {
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
  async saveSession(session) {
    await Promise.all([
      this.storage.set(import_core.TOKEN_KEYS.ACCESS_TOKEN, session.accessToken),
      this.storage.set(import_core.TOKEN_KEYS.REFRESH_TOKEN, session.refreshToken),
      this.storage.set(import_core.TOKEN_KEYS.EXPIRES_AT, String(session.expiresAt)),
      this.storage.set(import_core.TOKEN_KEYS.USER_JSON, JSON.stringify(session.user))
    ]);
    this.notifyListeners(session);
  }
  notifyListeners(session) {
    for (const cb of this.authStateListeners) cb(session);
  }
  notifyModalListeners() {
    for (const cb of this.modalStateListeners) cb();
  }
};

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
  constructor(apiUrl, publishableKey) {
    this.cache = /* @__PURE__ */ new Map();
    this.discoveredNames = /* @__PURE__ */ new Set();
    this.configVersion = 0;
    this.pollTimer = null;
    this.pingDebounce = null;
    this.apiUrl = apiUrl;
    this.publishableKey = publishableKey;
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
      await (0, import_core2.httpPost)(`${this.apiUrl}/api/sdk/features/batch-ping`, {
        publishableKey: this.publishableKey,
        features: names
      });
    } catch {
    }
  }
  async _resolve(userId) {
    try {
      const body = { publishableKey: this.publishableKey };
      if (userId) body["userId"] = userId;
      const { status, json } = await (0, import_core2.httpPost)(`${this.apiUrl}/api/sdk/features/resolve`, body);
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
    } catch {
    }
  }
  async _poll(userId) {
    try {
      const params = new URLSearchParams({
        key: this.publishableKey,
        version: String(this.configVersion)
      });
      if (userId) params.set("userId", userId);
      const { status, json } = await (0, import_core2.httpGet)(
        `${this.apiUrl}/api/sdk/features/poll?${params.toString()}`
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

// src/onelo.ts
var Onelo = class {
  constructor(config) {
    this.authUnsubscribe = null;
    this.auth = new OneloAuth(config);
    this.features = new OneloFeatures(config.apiUrl, config.publishableKey);
    this.authUnsubscribe = this.auth.onAuthStateChange((session) => {
      void this.features.load(session?.user.id ?? null);
    });
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

// src/index.ts
var import_core3 = __toESM(require_dist());
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AuthModal,
  FeatureState,
  Onelo,
  OneloError,
  OneloFeatures,
  useModalState
});
