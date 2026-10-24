import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  formatBDT,
  parsePaisaString,
  normalizeNumericAmountInput,
  formatAccountTitle,
} from '../domain/money';
import {
  Banknote,
  Building,
  Smartphone,
  Plus,
  ArrowUpRight,
  ArrowDownLeft,
  X,
  CreditCard,
  FolderPlus,
  Layers,
  Edit2,
  Trash2,
  Archive,
  RotateCcw,
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  ShieldAlert,
} from 'lucide-react';
import { Account, AccountGroup, AccountKind, UUID } from '../contracts/types';

export const AccountsTab: React.FC = () => {
  const {
    dashboardData,
    currentWorkspace,
    language,
    accounts,
    accountGroups,
    createAccount,
    updateAccount,
    archiveAccount,
    restoreAccount,
    safeDeleteAccount,
    createAccountGroup,
    updateAccountGroup,
    archiveAccountGroup,
    restoreAccountGroup,
    addAccountToGroup,
    removeAccountFromGroup,
    getAccountGroupSummary,
    refreshState,
  } = useApp();

  const isEn = language === 'en';

  const [activeSegment, setActiveSegment] = useState<'accounts' | 'groups'>('accounts');
  const [showAddAccountModal, setShowAddAccountModal] = useState(false);
  const [showAddGroupModal, setShowAddGroupModal] = useState(false);

  // Edit Account state
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [editName, setEditName] = useState('');
  const [editKind, setEditKind] = useState<AccountKind>('cash');
  const [editAccountNumber, setEditAccountNumber] = useState('');
  const [editGroupId, setEditGroupId] = useState<string>('');

  // Delete Account state (strict confirmation word DELET)
  const [deletingAccount, setDeletingAccount] = useState<Account | null>(null);
  const [deleteConfirmationInput, setDeleteConfirmationInput] = useState('');
  const [deleteFeedback, setDeleteFeedback] = useState<string | null>(null);

  // New Account form state
  const [newAccName, setNewAccName] = useState('');
  const [newAccKind, setNewAccKind] = useState<AccountKind>('cash');
  const [newAccOpeningBalance, setNewAccOpeningBalance] = useState('');
  const [newAccAccountNumber, setNewAccAccountNumber] = useState('');
  const [newAccGroupId, setNewAccGroupId] = useState<string>('');

  // Group form state
  const [editingGroup, setEditingGroup] = useState<AccountGroup | null>(null);
  const [groupName, setGroupName] = useState('');
  const [groupDescription, setGroupDescription] = useState('');
  const [expandedGroupId, setExpandedGroupId] = useState<UUID | null>(null);

  if (!dashboardData || !currentWorkspace) return null;

  const handleCreateAccountSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAccName.trim()) return;

    let openingMinor = '0';
    if (newAccOpeningBalance) {
      try {
        openingMinor = parsePaisaString(newAccOpeningBalance).toString();
      } catch {
        openingMinor = '0';
      }
    }

    createAccount(
      newAccName.trim(),
      newAccKind,
      openingMinor,
      newAccAccountNumber.trim(),
      'asset',
      newAccGroupId ? (newAccGroupId as UUID) : null
    );

    setNewAccName('');
    setNewAccOpeningBalance('');
    setNewAccAccountNumber('');
    setNewAccGroupId('');
    setShowAddAccountModal(false);
  };

  const handleSaveEditAccount = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAccount || !editName.trim()) return;

    updateAccount(editingAccount.id, {
      name: editName.trim(),
      kind: editKind,
      accountNumberMasked: editAccountNumber.trim(),
      groupId: editGroupId ? (editGroupId as UUID) : null,
    });

    setEditingAccount(null);
  };

  const handleExecuteDeleteAccount = (e: React.FormEvent) => {
    e.preventDefault();
    if (!deletingAccount || deleteConfirmationInput !== 'DELET') return;

    const res = safeDeleteAccount(deletingAccount.id, deleteConfirmationInput);
    if (res.success) {
      const msg =
        res.mode === 'archived'
          ? isEn
            ? 'Account has historical transactions and was safely archived to preserve ledger balance.'
            : 'অ্যাকাউন্টে পূর্বের লেনদেন থাকায় ব্যালেন্সের সুরক্ষার্থে এটি নিরাপদে আর্কাইভ করা হয়েছে।'
          : isEn
          ? 'Account with zero transactions was permanently removed.'
          : 'অ্যাকাউন্টে কোনো লেনদেন না থাকায় এটি সফলভাবে মুছে ফেলা হয়েছে।';
      setDeleteFeedback(msg);
      setTimeout(() => {
        setDeleteFeedback(null);
        setDeletingAccount(null);
        setDeleteConfirmationInput('');
      }, 2500);
    } else {
      setDeleteFeedback(res.error || 'Failed to delete');
    }
  };

  const handleCreateOrUpdateGroup = (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupName.trim()) return;

    if (editingGroup) {
      updateAccountGroup(editingGroup.id, {
        name: groupName.trim(),
        description: groupDescription.trim() || undefined,
      });
      setEditingGroup(null);
    } else {
      createAccountGroup(groupName.trim(), undefined, groupDescription.trim() || undefined);
      setShowAddGroupModal(false);
    }

    setGroupName('');
    setGroupDescription('');
  };

  const getAccountIcon = (k: AccountKind) => {
    switch (k) {
      case 'bkash':
      case 'nagad':
      case 'rocket':
        return <Smartphone className="w-5 h-5 text-pink-600" />;
      case 'bank':
        return <Building className="w-5 h-5 text-blue-600" />;
      case 'cash':
      default:
        return <Banknote className="w-5 h-5 text-emerald-600" />;
    }
  };

  return (
    <div className="space-y-4 pb-24 animate-in fade-in">
      {/* Header with Title and Creation Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-base font-bold text-slate-900 tracking-tight">
            {isEn ? 'Accounts & Wallets' : 'অ্যাকাউন্ট ও ওয়ালেট'}
          </h1>
          <p className="text-xs text-slate-500">
            {isEn
              ? `Manage financial accounts & groups in ${formatAccountTitle(currentWorkspace.name, 'en')}`
              : `${formatAccountTitle(currentWorkspace.name, 'bn')} খাতার হিসাব ও গ্রুপ নিয়ন্ত্রণ`}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {activeSegment === 'accounts' ? (
            <button
              type="button"
              onClick={() => setShowAddAccountModal(true)}
              className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-colors min-h-[44px]"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{isEn ? 'New Account' : 'নতুন অ্যাকাউন্ট'}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setGroupName('');
                setGroupDescription('');
                setEditingGroup(null);
                setShowAddGroupModal(true);
              }}
              className="px-3 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-colors min-h-[44px]"
            >
              <FolderPlus className="w-3.5 h-3.5" />
              <span>{isEn ? 'New Group' : 'নতুন গ্রুপ'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Segment Switcher: Accounts vs Groups */}
      <div className="flex rounded-xl bg-slate-200/70 p-1 text-xs font-semibold">
        <button
          type="button"
          onClick={() => setActiveSegment('accounts')}
          className={`flex-1 py-2 rounded-lg transition-all min-h-[40px] flex items-center justify-center gap-1.5 ${
            activeSegment === 'accounts'
              ? 'bg-white text-slate-900 shadow-2xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <CreditCard className="w-3.5 h-3.5" />
          <span>{isEn ? `Accounts (${accounts.length})` : `অ্যাকাউন্টসমূহ (${accounts.length})`}</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSegment('groups')}
          className={`flex-1 py-2 rounded-lg transition-all min-h-[40px] flex items-center justify-center gap-1.5 ${
            activeSegment === 'groups'
              ? 'bg-white text-slate-900 shadow-2xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>
            {isEn
              ? `Account Groups (${accountGroups.filter((g) => !g.archivedAt).length})`
              : `গ্রুপসমূহ (${accountGroups.filter((g) => !g.archivedAt).length})`}
          </span>
        </button>
      </div>

      {/* Segment 1: Accounts List */}
      {activeSegment === 'accounts' && (
        <div className="space-y-3">
          {dashboardData.accountSummaries.length === 0 ? (
            <div className="p-8 text-center bg-white rounded-2xl border border-dashed border-slate-200 text-slate-500">
              <Banknote className="w-8 h-8 mx-auto mb-2 opacity-40 text-slate-400" />
              <p className="text-xs font-medium">{isEn ? 'No accounts found' : 'কোনো অ্যাকাউন্ট পাওয়া যায়নি'}</p>
            </div>
          ) : (
            dashboardData.accountSummaries.map((accSummary) => {
              const fullAccount = accounts.find((a) => a.id === accSummary.accountId);
              const group = fullAccount?.groupId
                ? accountGroups.find((g) => g.id === fullAccount.groupId)
                : null;
              const formattedName = formatAccountTitle(accSummary.name, language);

              return (
                <div
                  key={accSummary.accountId}
                  className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-xs hover:border-slate-300 transition-colors space-y-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center shrink-0">
                        {getAccountIcon(accSummary.kind)}
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <h3 className="text-sm font-bold text-slate-900">{formattedName}</h3>
                          {group && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] bg-blue-50 text-blue-700 font-semibold border border-blue-200">
                              {group.name}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-400 font-mono">
                          <span className="uppercase">{accSummary.kind}</span>
                          {fullAccount?.accountNumberMasked && (
                            <span>• {fullAccount.accountNumberMasked}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-base font-bold text-slate-900 tabular-nums">
                        {formatBDT(accSummary.currentBalanceMinor, { locale: language })}
                      </div>
                      <div className="text-[10px] text-slate-400 font-medium">
                        {isEn ? 'Current Balance' : 'বর্তমান ব্যালেন্স'}
                      </div>
                    </div>
                  </div>

                  {/* Summary Metric Row */}
                  <div className="grid grid-cols-3 gap-2 pt-2.5 border-t border-slate-100 text-xs">
                    <div>
                      <span className="text-[10px] text-slate-400">
                        {isEn ? 'Opening' : 'প্রারম্ভিক'}
                      </span>
                      <div className="font-semibold text-slate-700 tabular-nums">
                        {formatBDT(accSummary.openingBalanceMinor, { locale: language, showDecimals: false })}
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center gap-0.5 text-emerald-600 text-[10px]">
                        <ArrowDownLeft className="w-2.5 h-2.5" />
                        <span>{isEn ? 'Total In' : 'মোট জমা'}</span>
                      </div>
                      <div className="font-semibold text-slate-700 tabular-nums">
                        {formatBDT(accSummary.totalDebitsMinor, { locale: language, showDecimals: false })}
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center gap-0.5 text-rose-600 text-[10px]">
                        <ArrowUpRight className="w-2.5 h-2.5" />
                        <span>{isEn ? 'Total Out' : 'মোট খরচ'}</span>
                      </div>
                      <div className="font-semibold text-slate-700 tabular-nums">
                        {formatBDT(accSummary.totalCreditsMinor, { locale: language, showDecimals: false })}
                      </div>
                    </div>
                  </div>

                  {/* Card Actions (Edit, Archive, Safe Delete) */}
                  {fullAccount && (
                    <div className="pt-2 border-t border-slate-100 flex items-center justify-end gap-1 text-xs">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingAccount(fullAccount);
                          setEditName(fullAccount.name);
                          setEditKind(fullAccount.kind);
                          setEditAccountNumber(fullAccount.accountNumberMasked || '');
                          setEditGroupId(fullAccount.groupId || '');
                        }}
                        className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg flex items-center gap-1 transition-colors min-h-[40px] px-2"
                        title={isEn ? 'Edit Account' : 'সম্পাদনা করুন'}
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                        <span>{isEn ? 'Edit' : 'সম্পাদনা'}</span>
                      </button>

                      {!!fullAccount.archivedAt ? (
                        <button
                          type="button"
                          onClick={() => restoreAccount(fullAccount.id)}
                          className="p-1.5 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-lg flex items-center gap-1 transition-colors min-h-[40px] px-2"
                          title={isEn ? 'Restore Account' : 'পুনরুদ্ধার করুন'}
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>{isEn ? 'Restore' : 'পুনরুদ্ধার'}</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => archiveAccount(fullAccount.id)}
                          className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg flex items-center gap-1 transition-colors min-h-[40px] px-2"
                          title={isEn ? 'Archive Account' : 'আর্কাইভ করুন'}
                        >
                          <Archive className="w-3.5 h-3.5" />
                          <span>{isEn ? 'Archive' : 'আর্কাইভ'}</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => {
                          setDeletingAccount(fullAccount);
                          setDeleteConfirmationInput('');
                          setDeleteFeedback(null);
                        }}
                        className="p-1.5 text-rose-600 hover:text-rose-800 hover:bg-rose-50 rounded-lg flex items-center gap-1 transition-colors min-h-[40px] px-2"
                        title={isEn ? 'Delete Account' : 'মুছে ফেলুন'}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>{isEn ? 'Delete' : 'মুছুন'}</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Segment 2: Account Groups (FEAT-001) */}
      {activeSegment === 'groups' && (
        <div className="space-y-4">
          {accountGroups.filter((g) => !g.archivedAt).length === 0 ? (
            <div className="p-8 text-center bg-white rounded-2xl border border-dashed border-slate-200 text-slate-500 space-y-3">
              <Layers className="w-10 h-10 mx-auto opacity-40 text-blue-600" />
              <div>
                <h3 className="font-bold text-slate-800 text-sm">
                  {isEn ? 'No Account Groups Yet' : 'এখনো কোনো গ্রুপ তৈরি করা হয়নি'}
                </h3>
                <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                  {isEn
                    ? 'Group multiple accounts (e.g. PestGurd Business Group: Cash, bKash, Bank) to view consolidated balances, income, and expense.'
                    : 'একাধিক অ্যাকাউন্ট নিয়ে গ্রুপ তৈরি করুন (যেমন: PestGurd Business Group: ক্যাশ, বিকাশ, ব্যাংক) এবং যৌথ হিসাব পর্যালোচনা করুন।'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setGroupName('');
                  setGroupDescription('');
                  setEditingGroup(null);
                  setShowAddGroupModal(true);
                }}
                className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-semibold shadow-xs hover:bg-slate-800 inline-flex items-center gap-1.5"
              >
                <FolderPlus className="w-3.5 h-3.5" />
                <span>{isEn ? 'Create First Group' : 'প্রথম গ্রুপ তৈরি করুন'}</span>
              </button>
            </div>
          ) : (
            accountGroups
              .filter((g) => !g.archivedAt)
              .map((group) => {
                const summary = getAccountGroupSummary(group.id);
                const isExpanded = expandedGroupId === group.id;
                const memberAccounts = accounts.filter((a) => a.groupId === group.id);

                return (
                  <div
                    key={group.id}
                    className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden"
                  >
                    {/* Group Header Card */}
                    <div className="p-4 bg-linear-to-r from-slate-50 to-white border-b border-slate-100">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center font-bold shrink-0 border border-blue-200/60">
                            <Layers className="w-5 h-5" />
                          </div>
                          <div>
                            <h3 className="text-sm font-bold text-slate-900">{group.name}</h3>
                            <p className="text-[11px] text-slate-500">
                              {group.description ||
                                (isEn
                                  ? `${memberAccounts.length} accounts connected`
                                  : `${memberAccounts.length}টি অ্যাকাউন্ট সংযুক্ত`)}
                            </p>
                          </div>
                        </div>

                        <div className="text-right">
                          <div className="text-base font-bold text-slate-900 tabular-nums">
                            {formatBDT(summary?.currentBalanceMinor || '0', { locale: language })}
                          </div>
                          <span className="text-[10px] text-slate-400 font-medium">
                            {isEn ? 'Group Balance' : 'গ্রুপ মোট ব্যালেন্স'}
                          </span>
                        </div>
                      </div>

                      {/* Group Reconciled Totals (Income / Expense) */}
                      <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-slate-100 text-xs">
                        <div className="p-2 bg-emerald-50/60 rounded-xl border border-emerald-100">
                          <span className="text-[10px] text-emerald-800 font-semibold block">
                            {isEn ? 'Total Income' : 'মোট আয়'}
                          </span>
                          <span className="font-bold text-emerald-950 tabular-nums">
                            {formatBDT(summary?.totalIncomeMinor || '0', { locale: language, showDecimals: false })}
                          </span>
                        </div>
                        <div className="p-2 bg-rose-50/60 rounded-xl border border-rose-100">
                          <span className="text-[10px] text-rose-800 font-semibold block">
                            {isEn ? 'Total Expense' : 'মোট ব্যয়'}
                          </span>
                          <span className="font-bold text-rose-950 tabular-nums">
                            {formatBDT(summary?.totalExpenseMinor || '0', { locale: language, showDecimals: false })}
                          </span>
                        </div>
                      </div>

                      {/* Group Card Actions */}
                      <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
                        <button
                          type="button"
                          onClick={() => setExpandedGroupId(isExpanded ? null : group.id)}
                          className="text-blue-700 hover:text-blue-900 font-semibold flex items-center gap-1 min-h-[36px]"
                        >
                          {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                          <span>
                            {isExpanded
                              ? isEn
                                ? 'Hide Accounts'
                                : 'অ্যাকাউন্ট লুকান'
                              : isEn
                              ? `View ${memberAccounts.length} Accounts`
                              : `${memberAccounts.length}টি অ্যাকাউন্ট দেখুন`}
                          </span>
                        </button>

                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingGroup(group);
                              setGroupName(group.name);
                              setGroupDescription(group.description || '');
                              setShowAddGroupModal(true);
                            }}
                            className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors min-h-[36px]"
                            title={isEn ? 'Edit Group' : 'গ্রুপ সম্পাদনা'}
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => archiveAccountGroup(group.id)}
                            className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors min-h-[36px]"
                            title={isEn ? 'Archive Group' : 'গ্রুপ আর্কাইভ'}
                          >
                            <Archive className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Collapsible Member Accounts List */}
                    {isExpanded && (
                      <div className="p-4 bg-slate-50/70 space-y-2 border-t border-slate-100">
                        <div className="flex items-center justify-between text-xs text-slate-500 pb-1 font-semibold">
                          <span>{isEn ? 'Member Accounts' : 'সংযুক্ত অ্যাকাউন্টসমূহ'}</span>
                          <span className="text-[10px]">
                            {isEn ? 'Intra-group transfers remain neutral' : 'গ্রুপের অভ্যন্তরীণ স্থানান্তর নিরপেক্ষ থাকে'}
                          </span>
                        </div>

                        {memberAccounts.length === 0 ? (
                          <p className="text-xs text-slate-400 py-3 text-center">
                            {isEn
                              ? 'No accounts assigned to this group yet. Edit an account to assign it here.'
                              : 'এই গ্রুপে কোনো অ্যাকাউন্ট যুক্ত করা হয়নি। অ্যাকাউন্ট সম্পাদনা করে যুক্ত করুন।'}
                          </p>
                        ) : (
                          memberAccounts.map((acc) => (
                            <div
                              key={acc.id}
                              className="p-2.5 bg-white rounded-xl border border-slate-200 flex items-center justify-between text-xs shadow-2xs"
                            >
                              <div className="flex items-center gap-2">
                                {getAccountIcon(acc.kind)}
                                <div>
                                  <span className="font-bold text-slate-900 block">{acc.name}</span>
                                  <span className="text-[10px] text-slate-400 uppercase">{acc.kind}</span>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => removeAccountFromGroup(acc.id)}
                                className="text-rose-600 hover:underline text-[11px] font-semibold px-2 py-1"
                              >
                                {isEn ? 'Remove from Group' : 'গ্রুপ থেকে বাদ দিন'}
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                );
              })
          )}
        </div>
      )}

      {/* Add Account Modal */}
      {showAddAccountModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-2xl border border-slate-200 animate-in zoom-in-95">
            <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-900">
                {isEn ? 'Add Account' : 'নতুন অ্যাকাউন্ট যোগ করুন'}
              </h3>
              <button
                type="button"
                onClick={() => setShowAddAccountModal(false)}
                className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateAccountSubmit} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-slate-700 font-semibold mb-1">
                  {isEn ? 'Account Name *' : 'অ্যাকাউন্টের নাম *'}
                </label>
                <input
                  type="text"
                  placeholder={isEn ? 'e.g. City Bank Savings' : 'যেমন: সিটি ব্যাংক'}
                  value={newAccName}
                  onChange={(e) => setNewAccName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600 font-medium"
                  required
                />
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">
                  {isEn ? 'Account Type' : 'অ্যাকাউন্টের ধরণ'}
                </label>
                <select
                  value={newAccKind}
                  onChange={(e) => setNewAccKind(e.target.value as AccountKind)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-medium focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  <option value="cash">{isEn ? 'Cash' : 'নগদ ক্যাশ'}</option>
                  <option value="bank">{isEn ? 'Bank Account' : 'ব্যাংক হিসাব'}</option>
                  <option value="bkash">{isEn ? 'bKash' : 'বিকাশ'}</option>
                  <option value="nagad">{isEn ? 'Nagad' : 'নগদ'}</option>
                  <option value="rocket">{isEn ? 'Rocket' : 'রকেট'}</option>
                  <option value="other">{isEn ? 'Other' : 'অন্যান্য'}</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">
                  {isEn ? 'Assign to Account Group (Optional)' : 'অ্যাকাউন্ট গ্রুপ নির্ধারণ (ঐচ্ছিক)'}
                </label>
                <select
                  value={newAccGroupId}
                  onChange={(e) => setNewAccGroupId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-medium focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  <option value="">{isEn ? 'No Group (Standalone)' : 'কোনো গ্রুপ নেই (একক)'}</option>
                  {accountGroups
                    .filter((g) => !g.archivedAt)
                    .map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">
                  {isEn ? 'Opening Balance (Optional)' : 'প্রারম্ভিক ব্যালেন্স (ঐচ্ছিক)'}
                </label>
                <input
                  type="text"
                  placeholder="0.00"
                  value={newAccOpeningBalance}
                  onChange={(e) => setNewAccOpeningBalance(normalizeNumericAmountInput(e.target.value))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600 font-mono tabular-nums"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">
                  {isEn ? 'Account Number (Optional)' : 'হিসাব নম্বর / শেষ ৪ ডিজিট (ঐচ্ছিক)'}
                </label>
                <input
                  type="text"
                  placeholder={isEn ? 'e.g. ****4567' : 'যেমন: ****4567'}
                  value={newAccAccountNumber}
                  onChange={(e) => setNewAccAccountNumber(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold shadow-xs transition-colors min-h-[44px]"
                >
                  {isEn ? 'Save Account' : 'সংরক্ষণ করুন'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddAccountModal(false)}
                  className="px-4 py-2.5 text-slate-600 hover:bg-slate-100 rounded-xl font-semibold min-h-[44px]"
                >
                  {isEn ? 'Cancel' : 'বাতিল'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Account Modal (FEAT-002) */}
      {editingAccount && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-2xl border border-slate-200 animate-in zoom-in-95">
            <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-900">
                {isEn ? 'Edit Account' : 'অ্যাকাউন্ট সম্পাদনা'}
              </h3>
              <button
                type="button"
                onClick={() => setEditingAccount(null)}
                className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEditAccount} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-slate-700 font-semibold mb-1">
                  {isEn ? 'Account Name *' : 'অ্যাকাউন্টের নাম *'}
                </label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600 font-medium"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">
                  {isEn ? 'Account Type' : 'অ্যাকাউন্টের ধরণ'}
                </label>
                <select
                  value={editKind}
                  onChange={(e) => setEditKind(e.target.value as AccountKind)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-medium focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  <option value="cash">{isEn ? 'Cash' : 'নগদ ক্যাশ'}</option>
                  <option value="bank">{isEn ? 'Bank Account' : 'ব্যাংক হিসাব'}</option>
                  <option value="bkash">{isEn ? 'bKash' : 'বিকাশ'}</option>
                  <option value="nagad">{isEn ? 'Nagad' : 'নগদ'}</option>
                  <option value="rocket">{isEn ? 'Rocket' : 'রকেট'}</option>
                  <option value="other">{isEn ? 'Other' : 'অন্যান্য'}</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">
                  {isEn ? 'Account Group' : 'অ্যাকাউন্ট গ্রুপ'}
                </label>
                <select
                  value={editGroupId}
                  onChange={(e) => setEditGroupId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-medium focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  <option value="">{isEn ? 'None (Standalone Account)' : 'কোনো গ্রুপ নেই (একক)'}</option>
                  {accountGroups
                    .filter((g) => !g.archivedAt)
                    .map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">
                  {isEn ? 'Account Number / Masked' : 'হিসাব নম্বর / মাস্কড'}
                </label>
                <input
                  type="text"
                  value={editAccountNumber}
                  onChange={(e) => setEditAccountNumber(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-blue-700 hover:bg-blue-800 text-white rounded-xl font-bold shadow-xs transition-colors min-h-[44px]"
                >
                  {isEn ? 'Save Changes' : 'পরিবর্তন সংরক্ষণ'}
                </button>
                <button
                  type="button"
                  onClick={() => setEditingAccount(null)}
                  className="px-4 py-2.5 text-slate-600 hover:bg-slate-100 rounded-xl font-semibold min-h-[44px]"
                >
                  {isEn ? 'Cancel' : 'বাতিল'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Controlled Safe Deletion Modal with exact DELET confirmation (FEAT-002) */}
      {deletingAccount && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-2xl border border-rose-200 animate-in zoom-in-95 space-y-4">
            <div className="flex items-center gap-2.5 text-rose-600">
              <div className="w-9 h-9 rounded-xl bg-rose-50 flex items-center justify-center shrink-0">
                <ShieldAlert className="w-5 h-5 text-rose-600" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  {isEn ? 'Delete Financial Account' : 'অ্যাকাউন্ট মুছে ফেলুন'}
                </h3>
                <span className="text-[11px] text-rose-600 font-semibold">{deletingAccount.name}</span>
              </div>
            </div>

            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-[11px] text-amber-900 leading-relaxed">
              <strong>{isEn ? 'Double-Entry Accounting Rule:' : 'হিসাব বিজ্ঞানের নিয়ম:'}</strong>{' '}
              {isEn
                ? 'To preserve double-entry balance and audit trail, accounts with historical transactions cannot have their ledger entries destroyed. Instead, the account will be safely archived.'
                : 'দ্বৈত-এন্ট্রি হিসাবের অখণ্ডতা রক্ষায় লেনদেন থাকা অ্যাকাউন্ট পুরোপুরি মুছে ফেলা যাবে না, এটি নিরাপদে আর্কাইভ করা হবে।'}
            </div>

            {deleteFeedback && (
              <div className="p-3 bg-slate-100 rounded-xl text-xs font-medium text-slate-800 border border-slate-200 animate-in fade-in">
                {deleteFeedback}
              </div>
            )}

            <form onSubmit={handleExecuteDeleteAccount} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-800 font-bold mb-1.5">
                  {isEn ? (
                    <>
                      To confirm, type <span className="text-rose-600 font-mono">DELET</span> below:
                    </>
                  ) : (
                    <>
                      নিশ্চিত করতে নিচে হুবহু <span className="text-rose-600 font-mono">DELET</span> লিখুন:
                    </>
                  )}
                </label>
                <input
                  type="text"
                  required
                  value={deleteConfirmationInput}
                  onChange={(e) => setDeleteConfirmationInput(e.target.value)}
                  placeholder="DELET"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-mono text-center tracking-widest text-sm focus:outline-none focus:ring-2 focus:ring-rose-600"
                  autoFocus
                />
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  type="submit"
                  disabled={deleteConfirmationInput !== 'DELET'}
                  className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-30 disabled:cursor-not-allowed text-white rounded-xl font-bold transition-colors min-h-[44px]"
                >
                  {isEn ? 'Confirm Deletion' : 'মুছে ফেলা নিশ্চিত করুন'}
                </button>
                <button
                  type="button"
                  onClick={() => setDeletingAccount(null)}
                  className="px-4 py-2.5 text-slate-600 hover:bg-slate-100 rounded-xl font-semibold min-h-[44px]"
                >
                  {isEn ? 'Cancel' : 'বাতিল'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* New / Edit Account Group Modal (FEAT-001) */}
      {showAddGroupModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-2xl border border-slate-200 animate-in zoom-in-95">
            <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-900">
                {editingGroup
                  ? isEn
                    ? 'Edit Account Group'
                    : 'গ্রুপ সম্পাদনা'
                  : isEn
                  ? 'Create Account Group'
                  : 'নতুন অ্যাকাউন্ট গ্রুপ'}
              </h3>
              <button
                type="button"
                onClick={() => setShowAddGroupModal(false)}
                className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateOrUpdateGroup} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-slate-700 font-semibold mb-1">
                  {isEn ? 'Group Name *' : 'গ্রুপের নাম *'}
                </label>
                <input
                  type="text"
                  required
                  placeholder={isEn ? 'e.g. PestGurd Business Group' : 'যেমন: পেস্টগার্ড বিজনেস গ্রুপ'}
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600 font-medium"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">
                  {isEn ? 'Description (Optional)' : 'বিবরণ (ঐচ্ছিক)'}
                </label>
                <textarea
                  rows={2}
                  placeholder={isEn ? 'Purpose or accounts in this group' : 'গ্রুপের বিবরণ বা উদ্দেশ্য'}
                  value={groupDescription}
                  onChange={(e) => setGroupDescription(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600 font-medium"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-blue-700 hover:bg-blue-800 text-white rounded-xl font-bold shadow-xs transition-colors min-h-[44px]"
                >
                  {editingGroup
                    ? isEn
                      ? 'Save Group'
                      : 'সংরক্ষণ করুন'
                    : isEn
                    ? 'Create Group'
                    : 'গ্রুপ তৈরি করুন'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddGroupModal(false)}
                  className="px-4 py-2.5 text-slate-600 hover:bg-slate-100 rounded-xl font-semibold min-h-[44px]"
                >
                  {isEn ? 'Cancel' : 'বাতিল'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
