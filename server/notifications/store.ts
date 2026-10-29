import { createHash } from 'node:crypto';
import { validateNotificationInbox, type NotificationInbox } from '../../src/notifications/inbox.js';

export class PushError extends Error {
  constructor(public code: string, public status = 503) { super(code); }
}
export interface PushDevice {
  id: string; token: string; tokenHash: string; secretHash: string;
  platform: 'android' | 'web'; language: 'bn' | 'en'; updatedAt: number;
}
export interface PushStore {
  register(owner: string, device: PushDevice): Promise<void>;
  remove(owner: string, id: string, secretHash: string): Promise<void>;
  devices(owner: string): Promise<PushDevice[]>;
  forget(owner: string, device: PushDevice): Promise<void>;
  reserve(owner: string, event: string): Promise<boolean>;
  inbox(owner: string): Promise<NotificationInbox>;
  markRead(owner: string, id: string): Promise<void>;
}
export const pushHash = (value: string) => createHash('sha256').update(value).digest('hex');
const PREFIX = 'hisab:push:preview:v1:';
const EXPIRY = 30 * 86400;

// Each registration replaces one installation atomically. A token cannot belong
// to two owners/installations. A stale revoke cannot remove a rotated session.
export const REGISTER_SCRIPT = `
local claim = redis.call('GET', KEYS[2])
if claim and claim ~= ARGV[1] then return 1 end
local old = redis.call('HGET', KEYS[1], ARGV[2])
if old then
  local previous = cjson.decode(old)
  if previous.secretHash ~= ARGV[3] then return 1 end
  if previous.tokenHash ~= ARGV[4] and redis.call('GET', ARGV[5] .. previous.tokenHash) == ARGV[1] then redis.call('DEL', ARGV[5] .. previous.tokenHash) end
else
  local entries = redis.call('HGETALL', KEYS[1])
  for i=1,#entries,2 do
    if cjson.decode(entries[i+1]).updatedAt < tonumber(ARGV[8]) then redis.call('HDEL', KEYS[1], entries[i]) end
  end
  if redis.call('HLEN', KEYS[1]) >= 5 then return 2 end
end
redis.call('HSET', KEYS[1], ARGV[2], ARGV[6])
redis.call('EXPIRE', KEYS[1], ARGV[7])
redis.call('SET', KEYS[2], ARGV[1], 'EX', ARGV[7])
return 0`;
const REMOVE_SCRIPT = `
local old = redis.call('HGET', KEYS[1], ARGV[1])
if old then
  local previous = cjson.decode(old)
  if previous.secretHash == ARGV[2] and (ARGV[4] == '' or previous.tokenHash == ARGV[4]) then
    redis.call('HDEL', KEYS[1], ARGV[1])
    if redis.call('GET', ARGV[3] .. previous.tokenHash) == ARGV[5] then redis.call('DEL', ARGV[3] .. previous.tokenHash) end
  end
end
return 0`;
export const RESERVE_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 1 then return 1 end
if tonumber(redis.call('GET', KEYS[2]) or '0') >= 300 or tonumber(redis.call('GET', KEYS[3]) or '0') >= 3000 then return 2 end
redis.call('SET', KEYS[1], '1', 'EX', 172800)
for i = 2,3 do redis.call('INCR', KEYS[i]); redis.call('EXPIRE', KEYS[i], 172800) end
local sequence = redis.call('INCR', KEYS[6])
redis.call('EXPIRE', KEYS[6], 7776000)
redis.call('ZADD', KEYS[4], sequence, ARGV[1])
redis.call('HSET', KEYS[5], ARGV[1], cjson.encode({id=ARGV[1],kind=ARGV[2],at=tonumber(ARGV[3]),sequence=sequence}))
local count = redis.call('ZCARD', KEYS[4])
if count > 100 then
  local expired = redis.call('ZRANGE', KEYS[4], 0, count-101)
  for _,id in ipairs(expired) do redis.call('HDEL', KEYS[5], id) end
  redis.call('ZREMRANGEBYRANK', KEYS[4], 0, count-101)
end
redis.call('EXPIRE', KEYS[4], 2592000); redis.call('EXPIRE', KEYS[5], 2592000)
return 0`;

export const INBOX_SCRIPT = `
local result = {tonumber(redis.call('GET', KEYS[3]) or '0')}
for _,id in ipairs(redis.call('ZREVRANGE', KEYS[1], 0, 99)) do
  local raw = redis.call('HGET', KEYS[2], id)
  if raw and cjson.decode(raw).at >= tonumber(ARGV[1]) then table.insert(result, raw)
  else redis.call('HDEL', KEYS[2], id); redis.call('ZREM', KEYS[1], id) end
end
return result`;
export const READ_SCRIPT = `
local sequence = redis.call('ZSCORE', KEYS[1], ARGV[1])
if not sequence then return 1 end
local previous = tonumber(redis.call('GET', KEYS[2]) or '0')
if tonumber(sequence) > previous then redis.call('SET', KEYS[2], sequence, 'EX', 7776000) end
return 0`;

/** Dedicated namespace in the existing free REST Redis, never ledger/AI keys. */
export class RedisPushStore implements PushStore {
  constructor(private endpoint: string, private credential: string, private fetchFn = fetch, private now = () => Date.now()) {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !credential) throw new PushError('PUSH_NOT_CONFIGURED');
  }
  private async command(args: (string | number)[]) {
    try {
      const response = await this.fetchFn(this.endpoint, { method: 'POST',
        headers: { Authorization: `Bearer ${this.credential}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(args), signal: AbortSignal.timeout(5000), redirect: 'error' });
      if (!response.ok) throw new Error();
      const value = await response.json();
      if (!value || value.error || !('result' in value)) throw new Error();
      return value.result;
    } catch { throw new PushError('PUSH_STORAGE_UNAVAILABLE'); }
  }
  async register(owner: string, device: PushDevice) {
    const result = await this.command(['EVAL', REGISTER_SCRIPT, 2, `${PREFIX}owner:${owner}`, `${PREFIX}token:${device.tokenHash}`,
      `${owner}:${device.id}`, device.id, device.secretHash, device.tokenHash, `${PREFIX}token:`, JSON.stringify(device), EXPIRY, this.now() - EXPIRY * 1000]);
    if (result === 1) throw new PushError('PUSH_DEVICE_CONFLICT', 409);
    if (result === 2) throw new PushError('PUSH_DEVICE_LIMIT', 409);
    if (result !== 0) throw new PushError('PUSH_STORAGE_UNAVAILABLE');
  }
  async remove(owner: string, id: string, secretHash: string) {
    await this.command(['EVAL', REMOVE_SCRIPT, 1, `${PREFIX}owner:${owner}`, id, secretHash, `${PREFIX}token:`, '', `${owner}:${id}`]);
  }
  async forget(owner: string, device: PushDevice) {
    await this.command(['EVAL', REMOVE_SCRIPT, 1, `${PREFIX}owner:${owner}`, device.id, device.secretHash, `${PREFIX}token:`, device.tokenHash, `${owner}:${device.id}`]);
  }
  async devices(owner: string) {
    const values = await this.command(['HVALS', `${PREFIX}owner:${owner}`]);
    if (!Array.isArray(values) || values.length > 5) throw new PushError('PUSH_STORAGE_UNAVAILABLE');
    try { return values.map(value => JSON.parse(value) as PushDevice).filter(value => value.updatedAt > this.now() - EXPIRY * 1000); }
    catch { throw new PushError('PUSH_STORAGE_UNAVAILABLE'); }
  }
  async reserve(owner: string, event: string) {
    const day = new Date(this.now()).toISOString().slice(0, 10);
    const id = pushHash(event);
    const result = await this.command(['EVAL', RESERVE_SCRIPT, 6, `${PREFIX}event:${owner}:${id}`,
      `${PREFIX}daily:${owner}:${day}`, `${PREFIX}daily:global:${day}`, `${PREFIX}inbox:${owner}:order`, `${PREFIX}inbox:${owner}:items`, `${PREFIX}inbox:${owner}:sequence`,
      id, event.startsWith('test:') ? 'test' : 'transaction', this.now()]);
    if (result === 2) throw new PushError('PUSH_LIMIT_REACHED', 429);
    if (result !== 0 && result !== 1) throw new PushError('PUSH_STORAGE_UNAVAILABLE');
    return result === 0;
  }
  async inbox(owner: string) {
    const result = await this.command(['EVAL', INBOX_SCRIPT, 3, `${PREFIX}inbox:${owner}:order`, `${PREFIX}inbox:${owner}:items`, `${PREFIX}inbox:${owner}:read`, this.now() - 2592000000]);
    try {
      if (!Array.isArray(result) || !result.length) throw new Error();
      return validateNotificationInbox({ readThrough: result[0], items: result.slice(1).map(value => JSON.parse(value)) }, this.now());
    } catch { throw new PushError('PUSH_INBOX_UNAVAILABLE'); }
  }
  async markRead(owner: string, id: string) {
    const result = await this.command(['EVAL', READ_SCRIPT, 2, `${PREFIX}inbox:${owner}:order`, `${PREFIX}inbox:${owner}:read`, id]);
    if (result === 1) throw new PushError('PUSH_INBOX_ITEM_MISSING', 409);
    if (result !== 0) throw new PushError('PUSH_INBOX_UNAVAILABLE');
  }
}
