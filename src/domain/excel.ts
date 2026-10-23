/**
 * Financial Excel (XLSX) Export Engine
 * Generates structured, multi-sheet Excel workbooks:
 * Sheet 1: All Journal Transactions
 * Sheet 2: Accounts & Balances Summary
 * Sheet 3: Categories & Budget Performance
 */

import * as XLSX from 'xlsx';
import {
  JournalTransaction,
  Account,
  Category,
  BusinessParty,
  Workspace,
  UUID
} from '../contracts/types';
import { toPaisa, paisaToDecimalString } from './money';

export function exportFinancialsToXLSX(
  workspace: Workspace,
  transactions: JournalTransaction[],
  accounts: Account[],
  categories: Category[],
  parties: BusinessParty[] = []
): Uint8Array {
  const safeParties = parties || [];
  const accountsMap = new Map<UUID, Account>(accounts.map((a) => [a.id, a]));
  const categoriesMap = new Map<UUID, Category>(categories.map((c) => [c.id, c]));
  const partiesMap = new Map<UUID, BusinessParty>(safeParties.map((p) => [p.id, p]));

  // Sheet 1: Transactions
  const txRows = transactions.map((tx, idx) => {
    let debitAmount = '0.00';
    let creditAmount = '0.00';
    let primaryAccountId = tx.lines[0]?.accountId;
    let categoryName = '';

    for (const l of tx.lines) {
      if (l.categoryId) {
        const cat = categoriesMap.get(l.categoryId);
        categoryName = cat ? cat.name : '';
      }
      if (l.debitMinor !== '0') {
        debitAmount = paisaToDecimalString(l.debitMinor);
      }
      if (l.creditMinor !== '0') {
        creditAmount = paisaToDecimalString(l.creditMinor);
      }
    }

    const acc = primaryAccountId ? accountsMap.get(primaryAccountId) : null;
    const party = tx.partyId ? partiesMap.get(tx.partyId) : null;

    return {
      'SL': idx + 1,
      'Date': tx.effectiveDate,
      'Type': tx.transactionType,
      'Account': acc?.name || 'Primary',
      'Category': categoryName || (tx.transactionType === 'transfer' ? 'Transfer' : 'General'),
      'Party / Member': party?.name || '-',
      'Debit (BDT)': debitAmount,
      'Credit (BDT)': creditAmount,
      'Note': tx.note || '',
      'Status': tx.isDeleted ? 'Deleted' : 'Active',
    };
  });

  // Sheet 2: Accounts Summary
  const accRows = accounts.map((acc) => {
    let debits = 0n;
    let credits = 0n;

    for (const tx of transactions) {
      if (tx.isDeleted) continue;
      for (const line of tx.lines) {
        if (line.accountId === acc.id) {
          debits += toPaisa(line.debitMinor);
          credits += toPaisa(line.creditMinor);
        }
      }
    }

    const opening = toPaisa(acc.openingBalanceMinor);
    const balance = opening + debits - credits;

    return {
      'Account Name': acc.name,
      'Type': acc.kind.toUpperCase(),
      'Opening Balance (BDT)': paisaToDecimalString(opening),
      'Total Debits / In (BDT)': paisaToDecimalString(debits),
      'Total Credits / Out (BDT)': paisaToDecimalString(credits),
      'Current Balance (BDT)': paisaToDecimalString(balance),
    };
  });

  // Sheet 3: Category Summary
  const catSpendingMap = new Map<UUID, bigint>();
  for (const tx of transactions) {
    if (tx.isDeleted || tx.transactionType !== 'expense') continue;
    for (const l of tx.lines) {
      if (l.categoryId) {
        const cur = catSpendingMap.get(l.categoryId) || 0n;
        catSpendingMap.set(l.categoryId, cur + toPaisa(l.debitMinor));
      }
    }
  }

  const catRows = categories.map((cat) => {
    const spent = catSpendingMap.get(cat.id) || 0n;
    return {
      'Category Name': cat.name,
      'English Name': cat.nameEn || '',
      'Type': cat.kind.toUpperCase(),
      'Total Spent (BDT)': paisaToDecimalString(spent),
    };
  });

  // Build Workbook
  const workbook = XLSX.utils.book_new();

  const wsTransactions = XLSX.utils.json_to_sheet(txRows);
  const wsAccounts = XLSX.utils.json_to_sheet(accRows);
  const wsCategories = XLSX.utils.json_to_sheet(catRows);

  XLSX.utils.book_append_sheet(workbook, wsTransactions, 'Transactions');
  XLSX.utils.book_append_sheet(workbook, wsAccounts, 'Accounts Summary');
  XLSX.utils.book_append_sheet(workbook, wsCategories, 'Categories');

  const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  return new Uint8Array(excelBuffer);
}
