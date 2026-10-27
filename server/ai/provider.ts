import type { EntryDraft } from '../../src/ai/entryDraft.js';
import type { ExtractionInput } from '../../src/ai/media.js';
export type { ExtractionInput } from '../../src/ai/media.js';

/** This boundary permits another provider later without changing financial contracts. */
export interface EntryExtractionProvider {
  readonly provider: string;
  extract(input: ExtractionInput): Promise<{ provider: string; sourceSha256: string; draft: EntryDraft }>;
}
