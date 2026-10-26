import { GoogleGenAI, Model } from '@google/genai';
import { EntryExtractionProvider, ExtractionInput } from './provider';
import { GeminiEntryProvider } from './gemini';
import { validateExtractionMedia } from '../../src/ai/media';

/** Explicit policy: newest stable Flash family advertised by this key's model
 * catalog. Avoid Pro pricing, previews, experimental/live/image/TTS/tuned models.
 * Availability and a name are not a claim of measured extraction accuracy. */
export function selectAutomaticGeminiModel(models: Model[]): string {
  const eligible = models.flatMap(model => {
    const match = model.name?.match(/^(?:models\/)?gemini-(\d+)(?:\.(\d+))?-flash(?:-(\d{3}))?$/);
    if (!match || !model.supportedActions?.includes('generateContent') || (model.outputTokenLimit || 0) < 2048) return [];
    const major = Number(match[1]), minor = Number(match[2] || 0), revision = Number(match[3] || 0);
    if (major < 2 || major === 2 && minor < 5) return [];
    return [{ name: model.name!.replace(/^models\//, ''), major, minor, revision }];
  });
  eligible.sort((a, b) => b.major - a.major || b.minor - a.minor || b.revision - a.revision || a.name.localeCompare(b.name));
  if (!eligible.length) throw new Error('AI_MODEL_UNAVAILABLE');
  return eligible[0].name;
}

export class AutomaticGeminiEntryProvider implements EntryExtractionProvider {
  readonly provider = 'gemini';
  private chosen?: { provider: EntryExtractionProvider; expires: number };
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
          const model = selectAutomaticGeminiModel(await this.list());
          const provider = this.build(model);
          this.chosen = { provider, expires: Date.now() + 15 * 60_000 };
          return provider;
        } catch (error) {
          if (error instanceof Error && error.message === 'AI_MODEL_UNAVAILABLE') throw error;
          throw new Error('AI_PROVIDER_UNAVAILABLE');
        } finally { this.selecting = undefined; }
      })();
      await this.selecting;
    }
    // One generation attempt. No automatic fallback to other paid models.
    return this.chosen!.provider.extract(input);
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
