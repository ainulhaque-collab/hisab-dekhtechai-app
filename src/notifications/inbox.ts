export interface NotificationInboxItem { id: string; kind: 'transaction' | 'test'; at: number; sequence: number }
export interface NotificationInbox { items: NotificationInboxItem[]; readThrough: number }

/** Only fixed templates are rendered. The service cannot inject message HTML,
 * financial details, destinations or device tokens into the inbox. */
export function validateNotificationInbox(value: unknown, now = Date.now()): NotificationInbox {
  const raw = value as NotificationInbox;
  if (!raw || typeof raw !== 'object' || Object.keys(raw).some(key => !['items', 'readThrough'].includes(key)) ||
    !Number.isSafeInteger(raw.readThrough) || raw.readThrough < 0 || !Array.isArray(raw.items) || raw.items.length > 100) throw new Error('PUSH_INBOX_INVALID');
  const seen = new Set<string>(); let previous = Infinity;
  for (const item of raw.items) {
    if (!item || typeof item !== 'object' || Object.keys(item).some(key => !['id', 'kind', 'at', 'sequence'].includes(key)) ||
      typeof item.id !== 'string' || !/^[a-f0-9]{64}$/.test(item.id) || seen.has(item.id) || !['transaction', 'test'].includes(item.kind) ||
      !Number.isSafeInteger(item.at) || item.at < 0 || item.at > now + 60000 || !Number.isSafeInteger(item.sequence) || item.sequence <= 0 || item.sequence >= previous)
      throw new Error('PUSH_INBOX_INVALID');
    seen.add(item.id); previous = item.sequence;
  }
  return { items: raw.items.map(item => ({ ...item })), readThrough: raw.readThrough };
}
