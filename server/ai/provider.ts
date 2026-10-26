import { EntryDraft } from '../../src/ai/entryDraft';
import { ExtractionInput } from '../../src/ai/media';
export type { ExtractionInput } from '../../src/ai/media';

/** This boundary permits another provider later without changing financial contracts. */
export interface EntryExtractionProvider {
  readonly provider: string;
  extract(input: ExtractionInput): Promise<{ provider: string; sourceSha256: string; draft: EntryDraft }>;
}
