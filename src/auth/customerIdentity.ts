import type { User } from '@supabase/supabase-js';
import type { CustomerAccount } from '../contracts/customerAccount';

export const customerUuid = (value: unknown): value is string => typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);

export function customerEmail(raw: string): string {
  if (typeof raw !== 'string' || raw.length > 254) throw Error('CUSTOMER_EMAIL_INVALID');
  const email = raw.trim().toLowerCase();
  if (!/^[^\s<>(),;:"\\[\]@]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/.test(email)) throw Error('CUSTOMER_EMAIL_INVALID');
  // No Gmail dot/plus stripping, provider guessing, or customer lookup.
  return email;
}

/** Bangladesh local input is accepted; storage/comparison always uses canonical E.164. */
export function customerPhone(raw: string): string {
  if (typeof raw !== 'string' || raw.length > 48) throw Error('CUSTOMER_PHONE_INVALID');
  let phone = raw.replace(/[০-৯]/g, digit => String('০১২৩৪৫৬৭৮৯'.indexOf(digit))).replace(/[\s()-]/g, '');
  if (/^01[3-9]\d{8}$/.test(phone)) phone = '+88' + phone;
  else if (/^[1-9]\d{7,14}$/.test(phone)) phone = '+' + phone;
  if (!/^\+[1-9]\d{7,14}$/.test(phone) || (phone.startsWith('+880') && !/^\+8801[3-9]\d{8}$/.test(phone)))
    throw Error('CUSTOMER_PHONE_INVALID');
  return phone;
}

/** Only call with getUser()'s server response, never a cached session or user_metadata. */
export function verifiedCustomer(user: User, sessionUserId: string, expectedCustomerId: string | null): CustomerAccount {
  if (!customerUuid(user.id) || user.id !== sessionUserId || (expectedCustomerId !== null && user.id !== expectedCustomerId))
    throw Error('CLOUD_ACCOUNT_MISMATCH');
  if (user.is_anonymous || user.deleted_at || (user.banned_until && Date.parse(user.banned_until) > Date.now()))
    throw Error('CLOUD_IDENTITY_UNVERIFIED');
  const identities = user.identities?.filter(identity => identity.user_id === user.id) ?? [];
  const email = user.email && user.email_confirmed_at ? user.email : null;
  let phone: string | null = null;
  if (user.phone && user.phone_confirmed_at) phone = customerPhone(user.phone);
  const emailIdentity = !!email && identities.some(identity => ['google', 'email'].includes(identity.provider));
  const phoneIdentity = !!phone && identities.some(identity => identity.provider === 'phone');
  if (!emailIdentity && !phoneIdentity) throw Error('CLOUD_IDENTITY_UNVERIFIED');
  const googleIdentities = identities.filter(identity => identity.provider === 'google').map(identity => ({
    identityId: identity.identity_id,
    // Display only; neither identity_data nor an email string can change the customerId.
    email: typeof identity.identity_data?.email === 'string' ? identity.identity_data.email : null,
  }));
  if (googleIdentities.some(identity => !customerUuid(identity.identityId))) throw Error('CLOUD_IDENTITY_UNVERIFIED');
  return Object.freeze({ customerId: user.id, email, phone, googleIdentities: Object.freeze(googleIdentities.map(identity => Object.freeze(identity))) });
}
