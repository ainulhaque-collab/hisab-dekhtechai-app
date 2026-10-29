export const FIREBASE_SENDER_SCOPE: string;
export function assertPreviewSenderClaims(token: string, nowSeconds?: number): void;
export interface FirebaseSenderOptions {
  type: string; audience: string; subject_token_type: string; token_url: string;
  service_account_impersonation_url: string; service_account_impersonation: { token_lifetime_seconds: number };
  scopes: string[]; transporterOptions: { timeout: number; retry: boolean };
  subject_token_supplier: { getSubjectToken(): Promise<string> };
}
export function firebaseSenderCredentialOptions(getSubjectToken?: () => string | Promise<string>): FirebaseSenderOptions;
export function getFirebaseSenderAccessToken(options?: {
  environment?: string;
  getSubjectToken?: () => string | Promise<string>;
  createClient?: (options: FirebaseSenderOptions) => { getAccessToken(): Promise<{ token?: string | null }> } | null;
}): Promise<string>;
