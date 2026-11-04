/** Contacts are replaceable sign-in methods. They are never financial ownership keys. */
export interface CustomerAccount {
  readonly customerId: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly googleIdentities: readonly { readonly identityId: string; readonly email: string | null }[];
}

export type CustomerChangeStatus = 'pending_verification' | 'verified' | 'already_linked';
export interface CustomerChangeResult {
  readonly status: CustomerChangeStatus;
  readonly account: CustomerAccount;
}
export interface PendingCustomerChange {
  readonly kind: 'email' | 'phone' | 'google';
  readonly target: string | null;
  readonly expired: boolean;
}

export interface CustomerAccountChanges {
  readAccount(): Promise<CustomerAccount>;
  readPendingChange(): Promise<PendingCustomerChange | null>;
  requestEmailChange(email: string): Promise<CustomerChangeResult>;
  checkEmailChange(): Promise<CustomerChangeResult>;
  requestPhoneChange(phone: string): Promise<CustomerChangeResult>;
  confirmPhoneChange(otp: string): Promise<CustomerChangeResult>;
  beginGoogleLink(): Promise<string>;
  completeGoogleLink(callbackUrl: string): Promise<CustomerChangeResult>;
  removeGoogleIdentity(identityId: string): Promise<CustomerAccount>;
  cancelPendingChange(): Promise<void>;
}
