import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportFinancialsToXLSX } from '../domain/excel';
import { JournalTransaction, Account, Category } from '../contracts/types';

test('exportFinancialsToXLSX: produces valid binary array without corruption', () => {
  const accounts: Account[] = [
    {
      id: 'acc-1',
      workspaceId: 'ws-1',
      name: 'Cash In Hand',
      kind: 'cash',
      openingBalanceMinor: '100000',
      createdAt: new Date().toISOString(),
    },
    {
      id: 'acc-2',
      workspaceId: 'ws-1',
      name: 'bKash Personal',
      kind: 'bkash',
      openingBalanceMinor: '50000',
      createdAt: new Date().toISOString(),
    },
  ];

  const categories: Category[] = [
    {
      id: 'cat-1',
      workspaceId: 'ws-1',
      kind: 'expense',
      name: 'কাঁচাবাজার',
      nameEn: 'Groceries',
      icon: 'ShoppingCart',
      color: '#F97316',
    },
    {
      id: 'cat-2',
      workspaceId: 'ws-1',
      kind: 'income',
      name: 'বেতন',
      nameEn: 'Salary',
      icon: 'Briefcase',
      color: '#10B981',
    },
  ];

  const transactions: JournalTransaction[] = [
    {
      id: 'tx-1',
      workspaceId: 'ws-1',
      transactionType: 'income',
      effectiveDate: '2026-10-20',
      occurredAtUtc: new Date().toISOString(),
      note: 'Monthly Salary',
      createdOpId: 'op-1',
      lines: [
        {
          id: 'line-1',
          transactionId: 'tx-1',
          accountId: 'acc-1',
          debitMinor: '5000000',
          creditMinor: '0',
          categoryId: 'cat-2',
        },
        {
          id: 'line-2',
          transactionId: 'tx-1',
          accountId: 'acc-1',
          debitMinor: '0',
          creditMinor: '5000000',
          categoryId: 'cat-2',
        },
      ],
    },
    {
      id: 'tx-2',
      workspaceId: 'ws-1',
      transactionType: 'expense',
      effectiveDate: '2026-10-21',
      occurredAtUtc: new Date().toISOString(),
      note: 'Fish and Vegetables',
      createdOpId: 'op-2',
      lines: [
        {
          id: 'line-3',
          transactionId: 'tx-2',
          accountId: 'acc-1',
          debitMinor: '125050',
          creditMinor: '0',
          categoryId: 'cat-1',
        },
        {
          id: 'line-4',
          transactionId: 'tx-2',
          accountId: 'acc-1',
          debitMinor: '0',
          creditMinor: '125050',
          categoryId: 'cat-1',
        },
      ],
    },
  ];

  const workspace = {
    id: 'ws-1',
    ownerSubjectHash: 'hash',
    name: 'Personal Ledger',
    kind: 'personal' as const,
    currency: 'BDT' as const,
    createdAt: new Date().toISOString(),
  };

  const buffer = exportFinancialsToXLSX(
    workspace,
    transactions,
    accounts,
    categories,
    []
  );

  assert.ok(buffer instanceof Uint8Array, 'Must return a Uint8Array');
  assert.ok(buffer.length > 500, 'XLSX file must have substantial binary content');

  // Verify PK header for ZIP / OOXML XLSX format
  assert.equal(buffer[0], 0x50, 'XLSX file must begin with PK header byte 0 (0x50)');
  assert.equal(buffer[1], 0x4b, 'XLSX file must begin with PK header byte 1 (0x4B)');
});
