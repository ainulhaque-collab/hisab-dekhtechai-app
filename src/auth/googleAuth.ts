/**
 * Google Authentication and Scoped Drive Authorization Manager
 * Strictly adheres to 05_GOOGLE_DRIVE_SYNC.md and Phase 3 specifications:
 * - Real Google Identity Services (GIS) Token Client for drive.appdata scope
 * - No fake authentication fallbacks in production
 * - Single Google Owner per dataset
 * - Stable cryptographic subject hashing (SHA-256)
 * - Safe offline retention of authenticated profile for returning users
 * - Token expiry tracking and renewal
 */

import { Capacitor } from '@capacitor/core';
import { computeSha256 } from '../sync/canonical';

export interface GoogleUserProfile {
  subjectId: string;
  subjectHash: string;
  email: string;
  displayName: string;
  photoUrl?: string;
  isDriveAuthorized: boolean;
  accessToken?: string;
  tokenExpiresAt?: number; // epoch ms
}

/**
 * Canonical owner subject hashing function used across the entire application.
 * Prepends the standard prefix 'hisab-owner:' and calculates SHA-256.
 */
export async function computeOwnerSubjectHash(sub: string): Promise<string> {
  if (!sub || typeof sub !== 'string' || sub.trim() === '') {
    throw new Error('Valid Google subject identifier (sub) is required to compute owner hash.');
  }
  return await computeSha256(`hisab-owner:${sub.trim()}`);
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            hint?: string;
            callback: (response: { access_token?: string; error?: any; expires_in?: number }) => void;
            error_callback?: (error: any) => void;
          }) => {
            requestAccessToken: (overrideConfig?: { prompt?: string; hint?: string }) => void;
          };
        };
      };
    };
  }
}

export class GoogleAuthManager {
  public static readonly DEFAULT_CLIENT_ID =
    '271505920973-an5igoqnn715b3j39g05r7vausnqhat2.apps.googleusercontent.com';

  private currentProfile: GoogleUserProfile | null = null;
  private isSimulatedAuth = false;
  public simulatedRenewSubjectHash?: string | null;
  public fetchFn: typeof fetch = (...args) => fetch(...args);
  private readonly DRIVE_SCOPE =
    'https://www.googleapis.com/auth/drive.appdata email profile openid';

  constructor() {
    this.loadSavedProfile();
  }

  public getClientId(): string {
    return (
      (typeof import.meta !== 'undefined' &&
        import.meta.env &&
        import.meta.env.VITE_GOOGLE_CLIENT_ID) ||
      GoogleAuthManager.DEFAULT_CLIENT_ID
    );
  }

  /**
   * Safely loads cached public user profile.
   * OAuth access tokens are NEVER restored from unencrypted localStorage.
   */
  private loadSavedProfile(): void {
    if (typeof localStorage !== 'undefined') {
      try {
        const raw = localStorage.getItem('hisab_google_user');
        if (raw) {
          const parsed = JSON.parse(raw);
          // Never trust or load raw tokens from unencrypted localStorage
          delete parsed.accessToken;
          delete parsed.tokenExpiresAt;
          this.currentProfile = parsed;
        }
      } catch (err) {
        console.warn('Failed to parse cached Google user profile:', err);
      }
    }
  }

  /**
   * Persists user identity offline without saving sensitive raw OAuth access tokens.
   */
  private saveProfile(): void {
    if (typeof localStorage !== 'undefined') {
      if (this.currentProfile) {
        // Strip sensitive raw accessToken and tokenExpiresAt before persisting to localStorage
        const sanitized: Omit<GoogleUserProfile, 'accessToken' | 'tokenExpiresAt'> = {
          subjectId: this.currentProfile.subjectId,
          subjectHash: this.currentProfile.subjectHash,
          email: this.currentProfile.email,
          displayName: this.currentProfile.displayName,
          photoUrl: this.currentProfile.photoUrl,
          isDriveAuthorized: this.currentProfile.isDriveAuthorized,
        };
        localStorage.setItem('hisab_google_user', JSON.stringify(sanitized));
      } else {
        localStorage.removeItem('hisab_google_user');
      }
    }
  }

  public getProfile(): GoogleUserProfile | null {
    return this.currentProfile;
  }

  public isAuthenticated(): boolean {
    return this.currentProfile !== null;
  }

  public isRealGoogleAuthenticated(): boolean {
    return (
      !this.isSimulatedAuth &&
      this.currentProfile !== null &&
      !!this.currentProfile.accessToken &&
      !this.isTokenExpired()
    );
  }

  public isTestMode(): boolean {
    return this.isSimulatedAuth;
  }

  public isTokenExpired(): boolean {
    if (!this.currentProfile?.accessToken) return true;
    if (!this.currentProfile.tokenExpiresAt) return false;
    return Date.now() >= this.currentProfile.tokenExpiresAt - 60000; // 1 min buffer
  }

  public isDriveAuthorized(): boolean {
    if (!this.currentProfile?.isDriveAuthorized) return false;
    if (!this.currentProfile.accessToken) return false;
    return !this.isTokenExpired();
  }

  /**
   * Prompts the real Google Sign-In & Drive scope consent popup via Google Identity Services.
   */
  public async promptGoogleSignIn(): Promise<GoogleUserProfile> {
    const clientId = this.getClientId();

    return new Promise((resolve, reject) => {
      if (typeof window === 'undefined') {
        reject(new Error('Google Sign-In is only available in a browser or WebView environment.'));
        return;
      }

      if (!window.google?.accounts?.oauth2) {
        reject(
          new Error(
            'Google Identity Services client library is still loading or offline. Please check your internet connection and try again.'
          )
        );
        return;
      }

      try {
        const tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: this.DRIVE_SCOPE,
          callback: async (resp) => {
            if (resp.error || !resp.access_token) {
              reject(new Error(resp.error?.message || 'Google authorization cancelled or failed'));
              return;
            }

            try {
              // Fetch authenticated user profile using the access token
              const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                headers: {
                  Authorization: `Bearer ${resp.access_token}`,
                },
              });

              if (!userInfoRes.ok) {
                throw new Error(`Failed to fetch Google user profile (${userInfoRes.status})`);
              }

              const info = await userInfoRes.json();
              const sub = info.sub;
              if (!sub) {
                throw new Error('Google userinfo response did not include a valid subject identifier.');
              }

              const email = info.email || 'user@gmail.com';
              const name = info.name || email.split('@')[0];
              const picture = info.picture;
              const subjectHash = await computeOwnerSubjectHash(sub);

              const expiresIn = resp.expires_in || 3600;

              this.currentProfile = {
                subjectId: sub,
                subjectHash,
                email,
                displayName: name,
                photoUrl: picture,
                isDriveAuthorized: true,
                accessToken: resp.access_token,
                tokenExpiresAt: Date.now() + expiresIn * 1000,
              };

              this.saveProfile();
              resolve(this.currentProfile);
            } catch (err) {
              reject(err);
            }
          },
          error_callback: (err) => {
            reject(new Error(err?.message || 'Google OAuth error occurred during authorization.'));
          },
        });

        tokenClient.requestAccessToken({ prompt: 'consent' });
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Authorizes Drive access with a valid verified token.
   */
  public async authorizeDrive(token: string, expiresIn = 3600): Promise<boolean> {
    if (!this.currentProfile) {
      throw new Error('User must be signed in before authorizing Google Drive');
    }

    if (!token || typeof token !== 'string') {
      throw new Error('Valid OAuth token is required for Drive authorization');
    }

    this.currentProfile.isDriveAuthorized = true;
    this.currentProfile.accessToken = token;
    this.currentProfile.tokenExpiresAt = Date.now() + expiresIn * 1000;
    this.saveProfile();
    return true;
  }

  /**
   * Silently renews expired OAuth access token without prompting for consent again.
   */
  public async renewAccessTokenSilent(prompt: '' | 'consent' = ''): Promise<string> {
    if (this.isSimulatedAuth) {
      if (this.currentProfile) {
        if (this.simulatedRenewSubjectHash) {
          if (this.simulatedRenewSubjectHash === 'unverified') {
            throw new Error('Security Error: Failed to verify Google userinfo during token renewal (unverified).');
          }
          if (this.simulatedRenewSubjectHash !== this.currentProfile.subjectHash) {
            throw new Error(
              `Security Error: Renewed Google account owner (${this.simulatedRenewSubjectHash}) does not match dataset owner (${this.currentProfile.subjectHash}).`
            );
          }
        }
        this.currentProfile.accessToken = 'renewed-simulated-token-' + Date.now();
        this.currentProfile.tokenExpiresAt = Date.now() + 3600 * 1000;
        return this.currentProfile.accessToken;
      }
      throw new Error('No user profile available for simulated token renewal.');
    }

    const clientId = this.getClientId();
    return new Promise((resolve, reject) => {
      if (typeof window === 'undefined' || !window.google?.accounts?.oauth2) {
        reject(new Error('Google Identity Services client library is not loaded.'));
        return;
      }

      try {
        const tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: this.DRIVE_SCOPE,
          hint: this.currentProfile?.email || undefined,
          callback: async (resp) => {
            if (resp.error || !resp.access_token) {
              reject(new Error(resp.error?.message || 'Token renewal failed or was cancelled.'));
              return;
            }

            try {
              // Verify identity of renewed token to prevent account switching
              if (this.currentProfile?.subjectHash) {
                const userRes = await this.fetchFn('https://www.googleapis.com/oauth2/v3/userinfo', {
                  headers: { Authorization: `Bearer ${resp.access_token}` },
                });
                if (!userRes.ok) {
                  throw new Error(
                    `Security Error: Failed to verify Google userinfo during token renewal (${userRes.status}).`
                  );
                }
                const userInfo = await userRes.json();
                if (!userInfo || !userInfo.sub) {
                  throw new Error(
                    'Security Error: Google userinfo response missing valid subject identifier during renewal.'
                  );
                }
                const renewedSubjectHash = await computeOwnerSubjectHash(userInfo.sub);
                if (renewedSubjectHash !== this.currentProfile.subjectHash) {
                  throw new Error(
                    `Security Error: Renewed Google account owner does not match dataset owner.`
                  );
                }
              }

              if (this.currentProfile) {
                this.currentProfile.accessToken = resp.access_token;
                const expiresIn = resp.expires_in || 3600;
                this.currentProfile.tokenExpiresAt = Date.now() + expiresIn * 1000;
                this.saveProfile();
              }
              resolve(resp.access_token);
            } catch (verifyErr) {
              reject(verifyErr);
            }
          },
          error_callback: (err) => {
            reject(new Error(err?.message || 'OAuth error occurred during token renewal.'));
          },
        });

        tokenClient.requestAccessToken({ prompt, hint: this.currentProfile?.email });
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Obtains a valid, unexpired access token.
   * If forceRenew is true (e.g. after HTTP 401 error), invalidates local token and triggers renewal.
   */
  public async getValidAccessToken(forceRenew = false): Promise<string> {
    if (!this.currentProfile?.accessToken && !forceRenew) {
      throw new Error('User is not signed in to Google.');
    }
    if (forceRenew) {
      if (this.currentProfile) {
        this.currentProfile.accessToken = undefined;
        this.currentProfile.tokenExpiresAt = 0;
      }
      return await this.renewAccessTokenSilent();
    }
    if (this.isTokenExpired()) {
      return await this.renewAccessTokenSilent();
    }
    return this.currentProfile!.accessToken!;
  }

  /**
   * Specifically for unit tests and local mock verification.
   * Isolated from standard production authorization.
   * Throws in production environments to ensure real authentication integrity.
   */
  public async setTestProfileForTesting(
    email: string,
    displayName: string,
    subjectId = 'test-sub-' + Math.random().toString(36).substring(2, 10),
    token?: string
  ): Promise<GoogleUserProfile> {
    const isProd =
      (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'production') ||
      (typeof import.meta !== 'undefined' && (import.meta as any).env?.PROD === true);
    if (isProd) {
      throw new Error(
        'Security Error: Simulated authentication credentials are strictly forbidden in production mode.'
      );
    }

    this.isSimulatedAuth = true;
    const subjectHash = await computeOwnerSubjectHash(subjectId);
    this.currentProfile = {
      subjectId,
      subjectHash,
      email,
      displayName,
      isDriveAuthorized: !!token,
      accessToken: token,
      tokenExpiresAt: token ? Date.now() + 3600000 : undefined,
    };
    this.saveProfile();
    return this.currentProfile;
  }

  public revokeDriveConsent(): void {
    if (this.currentProfile) {
      this.currentProfile.isDriveAuthorized = false;
      this.currentProfile.accessToken = undefined;
      this.currentProfile.tokenExpiresAt = undefined;
      this.saveProfile();
    }
  }

  public signOut(): void {
    this.currentProfile = null;
    this.saveProfile();
  }
}
