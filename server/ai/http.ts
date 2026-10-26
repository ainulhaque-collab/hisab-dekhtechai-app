import { Request, Response, Router, json } from 'express';
import { validateExtractionMedia } from '../../src/ai/media';
import { AIBudget } from './budget';
import { AIServiceError } from './googleIdentity';
import { EntryExtractionProvider, ExtractionInput } from './provider';

export interface AIHttpOptions {
  enabled: boolean;
  provider?: EntryExtractionProvider;
  verifyToken: (token: string) => Promise<string>;
  budget?: AIBudget;
  allowedOrigins: Set<string>;
}

export function createAIRouter(options: AIHttpOptions) {
  const router = Router();
  router.use((_request, response, next) => {
    response.set({ 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    next();
  });
  router.use((request, response, next) => {
    const origin = request.get('origin');
    if (origin && !options.allowedOrigins.has(origin)) { response.status(403).json({ error: 'AI_ORIGIN_DENIED' }); return; }
    if (origin) { response.set('Access-Control-Allow-Origin', origin); response.vary('Origin'); }
    if (request.method === 'OPTIONS') {
      response.set({ 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' });
      response.status(204).end(); return;
    }
    next();
  });
  router.post('/extract', (request, response, next) => {
    if (!options.enabled || !options.provider || !options.budget) { response.status(503).json({ error: 'AI_NOT_CONFIGURED' }); return; }
    if (!request.is('application/json') || request.get('content-encoding') && request.get('content-encoding') !== 'identity') {
      response.status(415).json({ error: 'AI_CONTENT_TYPE' }); return;
    }
    next();
  }, json({ limit: '3mb', strict: true, inflate: false }), async (request: Request, response: Response) => {
    try {
      const bearer = request.get('authorization')?.match(/^Bearer ([^\s]+)$/)?.[1];
      if (!bearer) throw new AIServiceError('AI_AUTH_REQUIRED', 401);
      const owner = await options.verifyToken(bearer);
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
      await options.budget!.reserve(owner, body.requestId);
      const result = await options.provider!.extract(input);
      // Bind the reply to this request without recording the media or model output.
      response.json({ ...result, requestId: body.requestId });
    } catch (error) {
      if (error instanceof AIServiceError) { response.status(error.status).json({ error: error.code }); return; }
      if (error instanceof Error && error.message === 'AI_MODEL_UNAVAILABLE') { response.status(503).json({ error: 'AI_MODEL_UNAVAILABLE' }); return; }
      if (error instanceof Error && ['AI_PROVIDER_BUSY', 'AI_PROVIDER_QUOTA', 'AI_PROVIDER_AUTH_ERROR'].includes(error.message)) {
        response.status(error.message === 'AI_PROVIDER_QUOTA' ? 429 : 503).json({ error: error.message }); return;
      }
      const code = error instanceof Error && ['AI_RESPONSE_INVALID', 'AI_DRAFT_INVALID', 'AI_DRAFT_INVALID_AMOUNT', 'AI_DRAFT_INVALID_DATE_TIME'].includes(error.message)
        ? 'AI_RESPONSE_INVALID' : 'AI_PROVIDER_UNAVAILABLE';
      response.status(502).json({ error: code });
    }
  });
  router.all('/extract', (_request, response) => { response.set('Allow', 'POST, OPTIONS'); response.status(405).json({ error: 'AI_METHOD_NOT_ALLOWED' }); });
  router.use((error: any, _request: Request, response: Response, _next: unknown) => {
    // Parser failures must never echo the submitted body, token, key or SDK error.
    response.status(error?.type === 'entity.too.large' ? 413 : 400).json({ error: error?.type === 'entity.too.large' ? 'AI_MEDIA_TOO_LARGE' : 'AI_REQUEST_INVALID' });
  });
  return router;
}
