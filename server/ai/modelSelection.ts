import { GoogleGenAI, Model } from '@google/genai';
import type { EntryExtractionProvider, ExtractionInput } from './provider.js';
import { GeminiEntryProvider } from './gemini.js';
import { validateExtractionMedia } from '../../src/ai/media.js';

/** Reviewed production models, in reliability order. Google's catalog can also
 * advertise retired/unsupported models, and a newer version may be overloaded.
 * Confirmed against official model docs and this app's live extraction test.
 * Keep auto within reviewed models; operators may explicitly pin another ID. */
export const AUTOMATIC_GEMINI_MODELS = ['gemini-3.6-flash', 'gemini-3.8-flash'] as const;
export function selectAutomaticGeminiModel(models: Model[], excluded: ReadonlySet<string> = new Set()): string {
  for (const name of AUTOMATIC_GEMINI_MODELS) {
    if (!excluded.has(name) && models.some(model => model.name?.replace(/^models\//, '') === name &&
      model.supportedActions?.includes('generateContent') && (model.outputTokenLimit || 0) >= 2048)) return name;
  }
  throw new Error('AI_MODEL_UNAVAILABLE');
}

export class AutomaticGeminiEntryProvider implements EntryExtractionProvider {
  readonly provider = 'gemini';
  private chosen?: { model: string; provider: EntryExtractionProvider; expires: number };
  private catalog?: { models: Model[]; expires: number };
  private cooldowns = new Map<string, number>();
  private selecting?: Promise<EntryExtractionProvider>;
  private list: () => Promise<Model[]>;
  private build: (model: string) => EntryExtractionProvider;
  constructor(apiKey: string, options?: { list?: () => Promise<Model[]>; build?: (model: string) => EntryExtractionProvider }) {
    if (typeof window !== 'undefined') throw new Error('AI_SERVER_ONLY');
    if (!apiKey || apiKey.startsWith('MY_')) throw new Error('AI_NOT_CONFIGURED');
    const client = options?.list ? null : new GoogleGenAI({ apiKey });
    this.list = options?.list || (async () => {
      const catalog = await client!.models.list({ config: { pageSize: 100, queryBase: true, abortSignal: AbortSignal.timeout(8000),
        httpOptions: { timeout: 8000, retryOptions: { attempts: 1 } } } });
      const models: Model[] = [];
      for await (const model of catalog) { models.push(model); if (models.length >= 500) break; }
      return models;
    });
    this.build = options?.build || (model => new GeminiEntryProvider({ apiKey, model }));
  }
  async extract(input: ExtractionInput) {
    validateExtractionMedia(input);
    if (!this.chosen || this.chosen.expires <= Date.now()) {
      if (!this.selecting) this.selecting = (async () => {
        try {
          for (const [model, until] of this.cooldowns) if (until <= Date.now()) this.cooldowns.delete(model);
          if (!this.catalog || this.catalog.expires <= Date.now()) this.catalog = { models: await this.list(), expires: Date.now() + 15 * 60_000 };
          const model = selectAutomaticGeminiModel(this.catalog.models, new Set(this.cooldowns.keys()));
          const provider = this.build(model);
          this.chosen = { model, provider, expires: Date.now() + 15 * 60_000 };
          return provider;
        } catch (error) {
          if (error instanceof Error && error.message === 'AI_MODEL_UNAVAILABLE') throw error;
          throw new Error('AI_PROVIDER_UNAVAILABLE');
        } finally { this.selecting = undefined; }
      })();
      await this.selecting;
    }
    // One generation attempt per click. A failed model is cooled down only for
    // the next explicitly requested extraction, never retried within this one.
    const chosen = this.chosen!;
    try { return await chosen.provider.extract(input); }
    catch (error) {
      if (error instanceof Error && ['AI_PROVIDER_BUSY', 'AI_MODEL_UNAVAILABLE'].includes(error.message)) {
        this.cooldowns.set(chosen.model, Date.now() + 10 * 60_000);
        if (this.chosen === chosen) this.chosen = undefined;
      }
      throw error;
    }
  }
}

/** Future OpenAI adapters register here; app forms and ledger contracts stay shared. */
export function createEntryProvider(environment: Record<string, string | undefined>): EntryExtractionProvider {
  if (environment.AI_PROVIDER && environment.AI_PROVIDER !== 'gemini') throw new Error('AI_NOT_CONFIGURED');
  const apiKey = environment.GEMINI_API_KEY || '';
  return !environment.GEMINI_MODEL || environment.GEMINI_MODEL === 'auto'
    ? new AutomaticGeminiEntryProvider(apiKey)
    : new GeminiEntryProvider({ apiKey, model: environment.GEMINI_MODEL });
}
