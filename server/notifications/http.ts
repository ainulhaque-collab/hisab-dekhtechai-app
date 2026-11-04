import { Router, json } from 'express';
import { AIServiceError } from '../ai/googleIdentity.js';
import { PushError, pushHash, type PushStore } from './store.js';
import type { PushSender } from './sender.js';

export interface PushHttpOptions { enabled: boolean; allowedOrigins: Set<string>; verifyToken: (token: string) => Promise<string>; store?: PushStore; sender?: PushSender }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function createPushRouter(options: PushHttpOptions) {
  const router = Router();
  router.use((req, res, next) => {
    res.set({ 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    const origin = req.get('origin');
    if (origin && !options.allowedOrigins.has(origin)) { res.status(403).json({ error: 'PUSH_ORIGIN_DENIED' }); return; }
    if (origin) { res.set('Access-Control-Allow-Origin', origin); res.vary('Origin'); }
    if (req.method === 'OPTIONS') { res.set({ 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' }); res.status(204).end(); return; }
    next();
  });
  router.post('/push', (req, res, next) => {
    if (!req.is('application/json') || req.get('content-encoding') && req.get('content-encoding') !== 'identity') { res.status(415).json({ error: 'PUSH_REQUEST_INVALID' }); return; }
    next();
  }, json({ limit: '8kb', strict: true, inflate: false }), async (req, res) => {
    try {
      const bearer = req.get('authorization')?.match(/^Bearer ([^\s]+)$/)?.[1];
      if (!bearer) throw new PushError('PUSH_AUTH_REQUIRED', 401);
      if (!options.enabled || !options.store || !options.sender) throw new PushError('PUSH_NOT_CONFIGURED');
      const owner = await options.verifyToken(bearer);
      const body = req.body;
      const keys: Record<string, string[]> = {
        register: ['ownerHash', 'action', 'deviceId', 'secret', 'token', 'platform', 'language'],
        unregister: ['ownerHash', 'action', 'deviceId', 'secret'],
        test: ['ownerHash', 'action', 'deviceId', 'secret', 'eventId'],
        transaction: ['ownerHash', 'action', 'eventId'],
        inbox: ['ownerHash', 'action'],
        read: ['ownerHash', 'action', 'itemId'],
      };
      if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.action !== 'string' || !Object.hasOwn(keys, body.action) ||
        Object.keys(body).some(key => !keys[body.action].includes(key)) || !/^[a-f0-9]{64}$/.test(body.ownerHash)) throw new PushError('PUSH_REQUEST_INVALID', 400);
      if (owner !== body.ownerHash) throw new PushError('PUSH_OWNER_MISMATCH', 403);
      if (['register', 'unregister', 'test'].includes(body.action) && (!UUID.test(body.deviceId) || !UUID.test(body.secret))) throw new PushError('PUSH_REQUEST_INVALID', 400);
      if (body.action === 'inbox') { res.json(await options.store.inbox(owner)); return; }
      if (body.action === 'read') {
        if (typeof body.itemId !== 'string' || !/^[a-f0-9]{64}$/.test(body.itemId)) throw new PushError('PUSH_REQUEST_INVALID', 400);
        await options.store.markRead(owner, body.itemId); res.json({ read: true }); return;
      }
      if (['transaction', 'test'].includes(body.action) && (typeof body.eventId !== 'string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(body.eventId))) throw new PushError('PUSH_REQUEST_INVALID', 400);
      if (body.action === 'register') {
        if (typeof body.token !== 'string' || !/^[A-Za-z0-9_:\-]{32,4096}$/.test(body.token) ||
          !['android', 'web'].includes(body.platform) || !['bn', 'en'].includes(body.language)) throw new PushError('PUSH_REQUEST_INVALID', 400);
        await options.store.register(owner, { id: body.deviceId, secretHash: pushHash(body.secret), token: body.token,
          tokenHash: pushHash(body.token), platform: body.platform, language: body.language, updatedAt: Date.now() });
        res.json({ registered: true }); return;
      }
      if (body.action === 'unregister') { await options.store.remove(owner, body.deviceId, pushHash(body.secret)); res.json({ registered: false }); return; }
      let devices = await options.store.devices(owner);
      if (body.action === 'test') {
        devices = devices.filter(device => device.id === body.deviceId && device.secretHash === pushHash(body.secret));
        if (!devices.length) throw new PushError('PUSH_DEVICE_NOT_REGISTERED', 409);
      }
      if (!await options.store.reserve(owner, `${body.action}:${body.eventId}`)) { res.json({ accepted: 0, duplicate: true }); return; }
      const results = await options.sender.send(devices, body.action, body.eventId);
      await Promise.all(results.map((result, index) => result === 'expired' ? options.store!.forget(owner, devices[index]) : Promise.resolve()));
      // FCM acceptance is not a delivery receipt. Do not return device IDs/tokens.
      const accepted = results.filter(result => result === 'accepted').length;
      if (results.some(result => result === 'unavailable')) throw new PushError('PUSH_DELIVERY_UNAVAILABLE');
      res.json({ accepted, duplicate: false });
    } catch (error) {
      if (error instanceof PushError) { res.status(error.status).json({ error: error.code }); return; }
      if (error instanceof AIServiceError) { res.status(error.status).json({ error: error.status === 401 ? 'PUSH_AUTH_REQUIRED' : 'PUSH_AUTH_UNAVAILABLE' }); return; }
      res.status(503).json({ error: 'PUSH_UNAVAILABLE' });
    }
  });
  router.all('/push', (_req, res) => { res.set('Allow', 'POST, OPTIONS'); res.status(405).json({ error: 'PUSH_METHOD_NOT_ALLOWED' }); });
  router.use((_error: unknown, _req: unknown, res: any, _next: unknown) => { res.status(400).json({ error: 'PUSH_REQUEST_INVALID' }); });
  return router;
}
