import { Request, Response, Router, json } from 'express';
import { validateExtractionMedia } from '../../src/ai/media.js';
import type { AIBudget } from './budget.js';
import { AIServiceError } from './googleIdentity.js';
import type { EntryExtractionProvider, ExtractionInput } from './provider.js';

export interface AIHttpOptions {
  enabled: boolean;
  provider?: EntryExtractionProvider;
  verifyToken: (token: string) => Promise<string>;
  budget?: AIBudget;
  allowedOrigins: Set<string>;
  onFailure?: (failure: { code: string; status: number; stage: string }) => void;
}

export function createAIRouter(options: AIHttpOptions) {
  const router = Router();
  const fail = (response: Response, status: number, code: string, stage: string) => {
    // Only fixed application codes/stages: no raw SDK errors, media, identity or tokens.
    try { options.onFailure?.({ code, status, stage }); } catch { /* Diagnostics cannot break error handling. */ }
    response.status(status).json({ error: code });
  };
  router.use((_request, response, next) => {
    response.set({ 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    next();
  });
  router.use((request, response, next) => {
    const origin = request.get('origin');
    if (origin && !options.allowedOrigins.has(origin)) { fail(response, 403, 'AI_ORIGIN_DENIED', 'origin'); return; }
    if (origin) { response.set('Access-Control-Allow-Origin', origin); response.vary('Origin'); }
    if (request.method === 'OPTIONS') {
      response.set({ 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' });
      response.status(204).end(); return;
    }
    next();
  });
  router.post('/extract', (request, response, next) => {
    if (!options.enabled || !options.provider || !options.budget) { fail(response, 503, 'AI_NOT_CONFIGURED', 'configuration'); return; }
    if (!request.is('application/json') || request.get('content-encoding') && request.get('content-encoding') !== 'identity') {
      fail(response, 415, 'AI_CONTENT_TYPE', 'request'); return;
    }
    next();
  }, json({ limit: '3mb', strict: true, inflate: false }), async (request: Request, response: Response) => {
    let stage = 'authentication';
    try {
      const bearer = request.get('authorization')?.match(/^Bearer ([^\s]+)$/)?.[1];
      if (!bearer) throw new AIServiceError('AI_AUTH_REQUIRED', 401);
      const owner = await options.verifyToken(bearer);
      stage = 'validation';
      const body = request.body;
      if (!body || typeof body !== 'object' || Array.isArray(body) ||
          Object.keys(body).some(key => !['ownerHash', 'requestId', 'input'].includes(key)) ||
          !/^[a-f0-9]{64}$/.test(body.ownerHash) ||
          typeof body.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(body.requestId))
        throw new AIServiceError('AI_REQUEST_INVALID', 400);
      if (owner !== body.ownerHash) throw new AIServiceError('AI_OWNER_MISMATCH', 403);
      const input = body.input as ExtractionInput;
      try { validateExtractionMedia(input); } catch { throw new AIServiceError('AI_MEDIA_OR_CONSENT_INVALID', 400); }
      // Count attempts before the chargeable call. Provider failures are not retried
      // automatically or refunded, so failures cannot bypass the spending cap.
      stage = 'quota';
      await options.budget!.reserve(owner, body.requestId);
      stage = 'generation';
      const result = await options.provider!.extract(input);
      // Bind the reply to this request without recording the media or model output.
      response.json({ ...result, requestId: body.requestId });
    } catch (error) {
      if (error instanceof AIServiceError) { fail(response, error.status, error.code, stage); return; }
      if (error instanceof Error && error.message === 'AI_MODEL_UNAVAILABLE') { fail(response, 503, 'AI_MODEL_UNAVAILABLE', stage); return; }
      if (error instanceof Error && ['AI_PROVIDER_BUSY', 'AI_PROVIDER_QUOTA', 'AI_PROVIDER_AUTH_ERROR'].includes(error.message)) {
        fail(response, error.message === 'AI_PROVIDER_QUOTA' ? 429 : 503, error.message, stage); return;
      }
      if (error instanceof Error && ['AI_CONTENT_BLOCKED', 'AI_RESPONSE_INCOMPLETE'].includes(error.message)) {
        fail(response, 422, error.message, stage); return;
      }
      const code = error instanceof Error && ['AI_RESPONSE_INVALID', 'AI_DRAFT_INVALID', 'AI_DRAFT_INVALID_AMOUNT', 'AI_DRAFT_INVALID_DATE_TIME'].includes(error.message)
        ? 'AI_RESPONSE_INVALID' : 'AI_PROVIDER_UNAVAILABLE';
      fail(response, 502, code, stage);
    }
  });
  router.all('/extract', (_request, response) => { response.set('Allow', 'POST, OPTIONS'); fail(response, 405, 'AI_METHOD_NOT_ALLOWED', 'request'); });
  router.use((error: any, _request: Request, response: Response, _next: unknown) => {
    // Parser failures must never echo the submitted body, token, key or SDK error.
    fail(response, error?.type === 'entity.too.large' ? 413 : 400, error?.type === 'entity.too.large' ? 'AI_MEDIA_TOO_LARGE' : 'AI_REQUEST_INVALID', 'request');
  });
  return router;
}
