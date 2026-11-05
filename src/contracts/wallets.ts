import type { AccountKind, UUID } from './types';

/** A physical place for money. It has no separately entered cash balance. */
export interface MasterWallet {
  id: UUID;
  code: string;
  homeWorkspaceId: UUID;
  name: string;
  kind: AccountKind;
  createdAt: string;
}
export interface WalletAllocation {
  walletId: UUID;
  accountId: UUID;
  workspaceId: UUID;
}
export interface AllocationTransfer {
  id: UUID;
  sourceAccountId: UUID;
  destinationAccountId: UUID;
  amountMinor: string;
  effectiveDate: string;
  occurredAtUtc: string;
  occurredTimezoneOffsetMinutes: number;
  createdAtUtc: string;
  note: string;
}
export type WalletEvent =
  | {version:1;action:'wallet.create';wallet:MasterWallet;accountId:UUID;adopted:boolean}
  | {version:1;action:'wallet.link';walletId:UUID;accountId:UUID}
  | {version:1;action:'allocation.transfer';transfer:AllocationTransfer};

export interface WalletAllocationSummary extends WalletAllocation {
  workspaceName: string;
  accountName: string;
  balanceMinor: string;
  reservedMinor: string;
  availableMinor: string;
  incomeMinor: string;
  expenseMinor: string;
  archived: boolean;
}
export interface MasterWalletSummary {
  wallet: MasterWallet;
  allocations: WalletAllocationSummary[];
  balanceMinor: string;
  reservedMinor: string;
  availableMinor: string;
}
