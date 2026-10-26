import { EntryDraft } from '../../src/ai/entryDraft';
import { ReceiptBlob } from '../../src/contracts/types';

export type ExtractionInput = { source: 'receipt'; receipt: ReceiptBlob; consentToProcess: boolean }
  | { source: 'voice'; dataBase64: string; mimeType: string; consentToProcess: boolean };

/** This boundary permits another provider later without changing financial contracts. */
export interface EntryExtractionProvider {
  readonly provider: string;
  extract(input: ExtractionInput): Promise<{ provider: string; sourceSha256: string; draft: EntryDraft }>;
}
