import { OneloConfig, OneloSession } from '@onelo/core';
export { OneloConfig, OneloError, OneloSession, OneloUser, UserRole } from '@onelo/core';
import React from 'react';

type ModalResult = {
    type: 'code';
    code: string;
} | {
    type: 'cancelled';
} | {
    type: 'error';
    message: string;
};
interface AuthModalProps {
    visible: boolean;
    hostedUrl: string;
    onResult: (result: ModalResult) => void;
}
declare function AuthModal({ visible, hostedUrl, onResult }: AuthModalProps): React.CElement<{
    visible: boolean;
    animationType: string;
    presentationStyle: string;
}, React.Component<{
    visible: boolean;
    animationType: string;
    presentationStyle: string;
}, any, any>>;

declare class OneloAuth {
    private storage;
    private apiUrl;
    private publishableKey;
    private pkceVerifier;
    private resolvedConfig;
    private heartbeatTimer;
    private static readonly HEARTBEAT_MS;
    private initPromise;
    private authStateListeners;
    private modalStateListeners;
    private _modalVisible;
    private _modalUrl;
    private _modalResolve;
    isReady: boolean;
    isRevoked: boolean;
    allowCustomBranding: boolean;
    appName: string;
    appLogoUrl: string | null;
    constructor(config: OneloConfig);
    private initialize;
    whenReady(): Promise<void>;
    loadAuthView(): Promise<OneloSession | null>;
    /** Returns modal state for rendering — use with <AuthModal> component */
    getModalState(): {
        visible: boolean;
        url: string;
        onResult: ((result: ModalResult) => void) | null;
    };
    /** Subscribe to modal state changes. Returns an unsubscribe function. */
    onModalStateChange(callback: () => void): () => void;
    private getHostedUrl;
    signIn(email: string, password: string): Promise<OneloSession>;
    signUp(email: string, password: string): Promise<OneloSession>;
    signOut(): Promise<void>;
    getSession(): Promise<OneloSession | null>;
    refreshSession(): Promise<OneloSession | null>;
    onAuthStateChange(callback: (session: OneloSession | null) => void): () => void;
    private startHeartbeat;
    private stopHeartbeat;
    private saveSession;
    private notifyListeners;
    private notifyModalListeners;
    sendMagicLink(email: string): Promise<void>;
    sendPasswordReset(email: string): Promise<void>;
}

type FeatureStatus = 'enabled' | 'disabled' | 'greyed' | 'hidden' | 'upsell' | 'new' | 'beta' | 'coming_soon';
declare class FeatureState {
    readonly name: string;
    readonly status: FeatureStatus;
    constructor(name: string, status: FeatureStatus);
    get isEnabled(): boolean;
    get isDisabled(): boolean;
    get isVisible(): boolean;
    get isGreyed(): boolean;
    get isUpsell(): boolean;
    get isNew(): boolean;
    get isBeta(): boolean;
    get isComingSoon(): boolean;
    get badgeLabel(): string | null;
}
interface OneloFeaturesOptions {
    /** Suppress the anonymous-mode identify() warning. See OneloConfig.suppressIdentifyWarning. */
    suppressIdentifyWarning?: boolean;
}
declare class OneloFeatures {
    private readonly apiUrl;
    private readonly publishableKey;
    private readonly bundleId?;
    private cache;
    private discoveredNames;
    private configVersion;
    private pollTimer;
    private pingDebounce;
    private monitor;
    private suppressIdentifyWarning;
    private anonymousWarningLogged;
    constructor(apiUrl: string, publishableKey: string, monitor?: {
        _trackFeatureCall: (name: string) => void;
    } | null, bundleId?: string, options?: OneloFeaturesOptions);
    /** Declare feature names upfront — triggers a batch-ping immediately. */
    declare(names: string[]): void;
    /** Returns the current state for a feature. Auto-registers on first call. */
    feature(name: string): FeatureState;
    /** Load features for a user (or anonymous). Called by Onelo orchestrator. */
    load(userId: string | null): Promise<void>;
    /** Returns names of all features with an active status (enabled, new, or beta). */
    getActiveFeatures(): string[];
    /** Stop background polling. Call when SDK is no longer needed. */
    stopPolling(): void;
    /** Clears the local feature cache and resets the config version. The next feature() call will re-fetch. */
    invalidateCache(): void;
    private _scheduleBatchPing;
    private _batchPing;
    private _resolve;
    /**
     * Logs a one-time warning when the backend reports anonymous mode (no userId)
     * AND at least one targeted feature was hidden purely because of it. Helps
     * developers using their own auth system catch missing identify() calls.
     */
    private _maybeWarnAnonymous;
    private _poll;
    private _startPolling;
}

interface MonitorEventOptions {
    ok: boolean;
    durationMs?: number;
    error?: string;
    meta?: Record<string, unknown>;
}
declare class OneloMonitor {
    private readonly publishableKey;
    private readonly apiUrl;
    private readonly bundleId?;
    private buffer;
    private flushTimer;
    private currentUserId;
    private readonly sessionId;
    constructor(publishableKey: string, apiUrl: string, bundleId?: string);
    /** Sets the current user ID attached to all subsequent monitor events. Call after login/logout if not using Onelo Auth. */
    setUserId(userId: string | null): void;
    _trackFeatureCall(featureName: string): void;
    track<T>(featureName: string, fn: () => Promise<T> | T, options?: {
        meta?: Record<string, unknown>;
    }): Promise<T>;
    event(featureName: string, opts: MonitorEventOptions): void;
    flush(): Promise<void>;
    destroy(): void;
    private _push;
    private _registerGlobalHandlers;
}

interface FeedbackOptions {
    type?: 'bug' | 'feature_request' | 'general';
    area?: string;
    userId?: string;
}
declare class OneloFeedback {
    private readonly apiUrl;
    private readonly publishableKey;
    private readonly getActiveFeatures;
    private readonly bundleId?;
    private _url;
    private _visible;
    private _listeners;
    constructor(apiUrl: string, publishableKey: string, getActiveFeatures: () => string[], bundleId?: string | undefined);
    open(options?: FeedbackOptions): void;
    close(): void;
    private _fetchAndLoad;
    private _notify;
    subscribe(listener: (url: string | null, visible: boolean) => void): () => void;
    getCurrentUrl(): string | null;
    isVisible(): boolean;
}

declare class OneloPaywall {
    check(requiredPlan: string, userPlan?: string): boolean;
}

declare class OneloForms {
    private readonly apiUrl;
    private readonly publishableKey;
    private readonly bundleId?;
    constructor(apiUrl: string, publishableKey: string, bundleId?: string | undefined);
    submit(formSlug: string, data: Record<string, unknown>, submitterEmail?: string): Promise<{
        success: boolean;
        message?: string;
    }>;
}

declare class OneloWaitlist {
    private readonly apiUrl;
    private readonly publishableKey;
    private readonly bundleId?;
    constructor(apiUrl: string, publishableKey: string, bundleId?: string | undefined);
    join(slug: string | undefined, email: string): Promise<{
        success: boolean;
        position?: number;
        alreadyJoined: boolean;
    }>;
}

declare class Onelo {
    readonly auth: OneloAuth;
    readonly features: OneloFeatures;
    readonly monitor: OneloMonitor;
    readonly feedback: OneloFeedback;
    readonly paywall: OneloPaywall;
    readonly forms: OneloForms;
    readonly waitlist: OneloWaitlist;
    private authUnsubscribe;
    constructor(config: OneloConfig);
    /** Only needed when NOT using Onelo Auth (own auth system). */
    identify(userId: string): Promise<void>;
    /** Release background timers. Call when the SDK instance is no longer needed. */
    destroy(): void;
}

interface ModalState {
    visible: boolean;
    url: string;
    onResult: ((result: ModalResult) => void) | null;
}
/**
 * Reactive hook for rendering <AuthModal>.
 * Re-renders automatically when loadAuthView() opens or closes the modal.
 *
 * @example
 * const modal = useModalState(onelo.auth)
 * return <AuthModal visible={modal.visible} hostedUrl={modal.url} onResult={modal.onResult!} />
 */
declare function useModalState(auth: OneloAuth): ModalState;

interface FeedbackModalProps {
    feedback: OneloFeedback;
}
declare function FeedbackModal({ feedback }: FeedbackModalProps): React.CElement<{
    visible: boolean;
    animationType: string;
    presentationStyle: string;
    onRequestClose: () => void;
}, React.Component<{
    visible: boolean;
    animationType: string;
    presentationStyle: string;
    onRequestClose: () => void;
}, any, any>>;

export { AuthModal, FeatureState, type FeatureStatus, FeedbackModal, type FeedbackOptions, type ModalState, type MonitorEventOptions, Onelo, OneloFeatures, OneloFeedback, OneloForms, OneloMonitor, OneloPaywall, OneloWaitlist, useModalState };
