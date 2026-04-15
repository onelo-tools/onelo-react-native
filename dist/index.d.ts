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
    private initPromise;
    private authStateListeners;
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
    private getHostedUrl;
    signIn(email: string, password: string): Promise<OneloSession>;
    signUp(email: string, password: string): Promise<OneloSession>;
    signOut(): Promise<void>;
    getSession(): Promise<OneloSession | null>;
    refreshSession(): Promise<OneloSession | null>;
    onAuthStateChange(callback: (session: OneloSession | null) => void): () => void;
    private saveSession;
    private notifyListeners;
}

declare class Onelo {
    readonly auth: OneloAuth;
    constructor(config: OneloConfig);
}

export { AuthModal, Onelo };
