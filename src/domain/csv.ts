/**
 * Safe CSV Export with Formula Injection Protection
 */

import { JournalTransaction, Account, Category } from '../contracts/types';
import { paisaToDecimalString } from './money';

/**
 * Sanitizes a string for CSV formula injection.
 * If the string starts with =, +, -, @, \t, or \r, prefix with single quote '.
 */
export function sanitizeCSVCell(value: any): string {
  if (value === null || value === undefined) {
    return '';
  }
  let str = String(value);

  // If first character is formula trigger, prefix with apostrophe
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'` + str;
  }

  // If contains comma, quote, or newline, escape double quotes and wrap in quotes
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

/**
 * Generates safe CSV from transactions.
 */
export function exportTransactionsToCSV(
  transactions: JournalTransaction[],
  accountsMap: Map<string, Account>,
  categoriesMap: Map<string, Category>
): string {
  const headers = [
    'তারিখ (Effective Date)',
    'ধরণ (Type)',
    'বিবরণ / নোট (Note)',
    'অ্যাকাউন্ট (Account)',
    'ক্যাটাগরি (Category)',
    'ডেবিট ৳ (Debit)',
    'ক্রেডিট ৳ (Credit)',
    'ট্রানজ্যাকশন আইডি (ID)',
    'সিঙ্ক অপারেশন (Op ID)',
    'রসিদ (Receipt)'
  ];

  const rows: string[] = [headers.map(sanitizeCSVCell).join(',')];

  for (const tx of transactions) {
    for (const line of tx.lines) {
      const acc = accountsMap.get(line.accountId);
      const cat = line.categoryId ? categoriesMap.get(line.categoryId) : null;
      const debit = paisaToDecimalString(line.debitMinor);
      const credit = paisaToDecimalString(line.creditMinor);

      const row = [
        tx.effectiveDate,
        tx.transactionType,
        tx.note || '',
        acc ? acc.name : line.accountId,
        cat ? cat.name : '-',
        debit === '0.00' ? '' : debit,
        credit === '0.00' ? '' : credit,
        tx.id,
        tx.createdOpId,
        tx.receiptName || (tx.receiptBlobSha256 ? 'সংযুক্ত' : '')
      ];

      rows.push(row.map(sanitizeCSVCell).join(','));
    }
  }

  return '\uFEFF' + rows.join('\r\n'); // UTF-8 BOM for Excel Bengali character compatibility
}
