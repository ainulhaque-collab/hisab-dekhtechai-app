import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { EmployeeRole, UUID } from '../contracts/types';
import { computeSha256 } from '../sync/canonical';
import {
  Users,
  UserPlus,
  Shield,
  Trash2,
  X,
  Check,
  AlertCircle,
  Lock,
  Info,
} from 'lucide-react';

interface TeamSharingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const TeamSharingModal: React.FC<TeamSharingModalProps> = ({ isOpen, onClose }) => {
  const {
    currentWorkspace,
    accounts,
    accountPermissions,
    grantAccountPermission,
    revokeAccountPermission,
    language,
    userProfile,
  } = useApp();

  const isEn = language === 'en';

  const [isGranting, setIsGranting] = useState(false);
  const [employeeEmail, setEmployeeEmail] = useState('');
  const [selectedRole, setSelectedRole] = useState<EmployeeRole>('editor');
  const [selectedAccountIds, setSelectedAccountIds] = useState<UUID[]>([]);
  const [grantError, setGrantError] = useState<string | null>(null);
  const [grantSuccess, setGrantSuccess] = useState<string | null>(null);

  if (!isOpen) return null;

  const isBusiness = currentWorkspace?.kind === 'business';

  const handleToggleAccount = (id: UUID) => {
    if (selectedAccountIds.includes(id)) {
      setSelectedAccountIds(selectedAccountIds.filter((accId) => accId !== id));
    } else {
      setSelectedAccountIds([...selectedAccountIds, id]);
    }
  };

  const handleSelectAllAccounts = () => {
    if (selectedAccountIds.length === accounts.length) {
      setSelectedAccountIds([]);
    } else {
      setSelectedAccountIds(accounts.map((a) => a.id));
    }
  };

  const handleGrantSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGrantError(null);
    setGrantSuccess(null);

    const email = employeeEmail.trim().toLowerCase();
    if (!email || !email.includes('@')) {
      setGrantError(isEn ? 'Please enter a valid email address.' : 'সঠিক ইমেইল এড্রেস লিখুন।');
      return;
    }

    if (selectedAccountIds.length === 0) {
      setGrantError(isEn ? 'Please select at least one account.' : 'কমপক্ষে একটি অ্যাকাউন্ট নির্বাচন করুন।');
      return;
    }

    try {
      const subjectHash = await computeSha256(`employee:${email}`);
      grantAccountPermission(email, subjectHash, selectedAccountIds, selectedRole);
      setGrantSuccess(isEn ? 'Permission granted successfully!' : 'অনুমতি সফলভাবে যুক্ত করা হয়েছে!');
      setEmployeeEmail('');
      setSelectedAccountIds([]);
      setIsGranting(false);
      setTimeout(() => setGrantSuccess(null), 3000);
    } catch (err: any) {
      setGrantError(err.message || 'Failed to grant permission');
    }
  };

  const handleRevoke = (grantId: UUID, email: string) => {
    const confirmPrompt = isEn
      ? `Revoke access for ${email}? Downloaded data will remain on their device, but subsequent syncs will be rejected.`
      : `${email}-এর অনুমতি বাতিল করবেন? ইতিমধ্যে ডাউনলোড করা ডাটা ডিভাইসে থাকবে, কিন্তু পরবর্তী কোনো সিঙ্ক গ্রহণ করা হবে না।`;
    if (window.confirm(confirmPrompt)) {
      revokeAccountPermission(grantId);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs animate-in fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="team-modal-title"
    >
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden border border-slate-200">
        {/* Header */}
        <div className="bg-slate-900 px-6 py-4 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white">
              <Users className="w-4 h-4" />
            </div>
            <div>
              <h2 id="team-modal-title" className="text-base font-bold tracking-tight">
                {isEn ? 'Team & Employee Sharing' : 'টিম ও কর্মী শেয়ারিং'}
              </h2>
              <p className="text-xs text-slate-400">
                {isEn ? 'Granular account permissions & access control' : 'অ্যাকাউন্টভিত্তিক অনুমতি ও কর্মী নিয়ন্ত্রণ'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 max-h-[80vh] overflow-y-auto text-xs">
          {!isBusiness ? (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 space-y-2">
              <div className="flex items-center gap-2 font-semibold">
                <Lock className="w-4 h-4 text-amber-600" />
                <span>{isEn ? 'Business Workspace Required' : 'ব্যবসার খাতা প্রয়োজন'}</span>
              </div>
              <p className="text-slate-600 leading-relaxed">
                {isEn
                  ? 'Employee access sharing is only available for Business workspaces. Personal workspaces remain completely private to you.'
                  : 'কর্মী শেয়ারিং কেবল ব্যবসায়ের খাতার জন্য প্রযোজ্য। ব্যক্তিগত খাতা শুধুমাত্র আপনার নিজস্ব ডিভাইসের জন্য সংরক্ষিত।'}
              </p>
            </div>
          ) : (
            <>
              {grantSuccess && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-2 text-emerald-800 font-medium">
                  <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{grantSuccess}</span>
                </div>
              )}

              {grantError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2 text-rose-800 font-medium">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{grantError}</span>
                </div>
              )}

              {/* Owner Info Banner */}
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between">
                <div>
                  <span className="font-semibold text-slate-900 block">
                    {userProfile?.displayName || 'Owner'}
                  </span>
                  <span className="text-slate-500 text-[11px]">{userProfile?.email || 'Owner'}</span>
                </div>
                <span className="px-2.5 py-1 bg-blue-100 text-blue-800 font-bold rounded-lg text-[10px] uppercase tracking-wider">
                  {isEn ? 'Workspace Owner' : 'প্রধান মালিক'}
                </span>
              </div>

              {/* ADR-001 Zero-cost / Feature flag security disclosure */}
              <div className="p-3 bg-blue-50/70 border border-blue-200/80 rounded-xl space-y-1.5 text-slate-700">
                <div className="flex items-center gap-1.5 font-semibold text-blue-950">
                  <Info className="w-3.5 h-3.5 text-blue-700 shrink-0" />
                  <span>{isEn ? 'ADR-001: Access Control Architecture' : 'এডিআর-০০১: এক্সেস কন্ট্রোল ডিজাইন'}</span>
                </div>
                <p className="text-[11px] leading-relaxed text-slate-600">
                  {isEn
                    ? 'Owner grants editor/viewer permissions at the local database layer. Employee multi-user sync is managed securely without paid cloud services, respecting owner Drive privacy.'
                    : 'ডাটাবেস লেয়ারে প্রতিটি অ্যাকাউন্টের এক্সেস কন্ট্রোল সংরক্ষিত। ওনারের অনুমতি ছাড়া কর্মী কোনো হিসাব দেখতে বা যোগ করতে পারবে না।'}
                </p>
              </div>

              {/* Active Grants List */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-slate-900 text-sm">
                    {isEn ? 'Authorized Staff & Permissions' : 'অনুমোদিত কর্মী ও ক্ষমতা'}
                  </h3>
                  {!isGranting && (
                    <button
                      type="button"
                      onClick={() => setIsGranting(true)}
                      className="px-3 py-1.5 bg-slate-900 text-white rounded-lg font-medium hover:bg-slate-800 flex items-center gap-1.5 transition-colors shadow-2xs"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      <span>{isEn ? 'Add Staff' : 'কর্মী যোগ করুন'}</span>
                    </button>
                  )}
                </div>

                {isGranting ? (
                  <form onSubmit={handleGrantSubmit} className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3.5">
                    <h4 className="font-semibold text-slate-900">
                      {isEn ? 'Grant Account Access' : 'অ্যাকাউন্ট অ্যাক্সেস অনুমতি দিন'}
                    </h4>

                    <div>
                      <label className="block text-slate-700 font-medium mb-1">
                        {isEn ? 'Employee Verified Google Email *' : 'কর্মীর গুগল ইমেইল *'}
                      </label>
                      <input
                        type="email"
                        required
                        value={employeeEmail}
                        onChange={(e) => setEmployeeEmail(e.target.value)}
                        placeholder="employee@gmail.com"
                        className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                    </div>

                    <div>
                      <label className="block text-slate-700 font-medium mb-1">
                        {isEn ? 'Permission Role *' : 'অনুমতির ধরন *'}
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <label
                          className={`p-2.5 rounded-lg border cursor-pointer flex flex-col gap-0.5 transition-colors ${
                            selectedRole === 'editor'
                              ? 'bg-blue-50 border-blue-600 text-blue-900'
                              : 'bg-white border-slate-200 text-slate-700'
                          }`}
                        >
                          <div className="flex items-center gap-1.5 font-bold">
                            <input
                              type="radio"
                              name="role"
                              checked={selectedRole === 'editor'}
                              onChange={() => setSelectedRole('editor')}
                            />
                            <span>{isEn ? 'Editor' : 'সম্পাদক (এডিটর)'}</span>
                          </div>
                          <span className="text-[10px] text-slate-500">
                            {isEn ? 'Add income/expense to permitted accounts' : 'অনুমোদিত অ্যাকাউন্টে আয়/ব্যয় যোগ করতে পারবে'}
                          </span>
                        </label>

                        <label
                          className={`p-2.5 rounded-lg border cursor-pointer flex flex-col gap-0.5 transition-colors ${
                            selectedRole === 'viewer'
                              ? 'bg-blue-50 border-blue-600 text-blue-900'
                              : 'bg-white border-slate-200 text-slate-700'
                          }`}
                        >
                          <div className="flex items-center gap-1.5 font-bold">
                            <input
                              type="radio"
                              name="role"
                              checked={selectedRole === 'viewer'}
                              onChange={() => setSelectedRole('viewer')}
                            />
                            <span>{isEn ? 'Viewer' : 'দর্শক (ভিউয়ার)'}</span>
                          </div>
                          <span className="text-[10px] text-slate-500">
                            {isEn ? 'Read-only access, cannot post changes' : 'শুধুমাত্র ব্যালেন্স ও ইতিহাস দেখতে পারবে'}
                          </span>
                        </label>
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-slate-700 font-medium">
                          {isEn ? 'Permitted Accounts *' : 'অনুমোদিত অ্যাকাউন্টসমূহ *'}
                        </label>
                        <button
                          type="button"
                          onClick={handleSelectAllAccounts}
                          className="text-[11px] text-blue-700 hover:underline font-semibold"
                        >
                          {selectedAccountIds.length === accounts.length
                            ? (isEn ? 'Deselect All' : 'সব বাতিল')
                            : (isEn ? 'Select All' : 'সব নির্বাচন')}
                        </button>
                      </div>
                      <div className="max-h-36 overflow-y-auto border border-slate-200 rounded-lg bg-white p-2 space-y-1">
                        {accounts.map((acc) => (
                          <label
                            key={acc.id}
                            className="flex items-center gap-2 p-1.5 hover:bg-slate-50 rounded cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={selectedAccountIds.includes(acc.id)}
                              onChange={() => handleToggleAccount(acc.id)}
                              className="w-4 h-4 rounded text-blue-600 focus:ring-blue-600"
                            />
                            <span className="text-slate-800 font-medium truncate">{acc.name}</span>
                            <span className="text-[10px] text-slate-400 capitalize">({acc.kind})</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    <div className="flex gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setIsGranting(false)}
                        className="flex-1 py-2 rounded-lg border border-slate-300 font-semibold text-slate-700 hover:bg-slate-100 min-h-[44px]"
                      >
                        {isEn ? 'Cancel' : 'বাতিল'}
                      </button>
                      <button
                        type="submit"
                        className="flex-1 py-2 rounded-lg bg-blue-700 text-white font-semibold hover:bg-blue-800 shadow-xs min-h-[44px]"
                      >
                        {isEn ? 'Save Permission' : 'অনুমতি সংরক্ষণ'}
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="space-y-2">
                    {accountPermissions.length === 0 ? (
                      <div className="text-center py-8 text-slate-400 border border-dashed border-slate-200 rounded-xl">
                        <Shield className="w-8 h-8 mx-auto mb-2 opacity-50" />
                        <p>{isEn ? 'No staff permissions granted yet.' : 'এখনো কোনো কর্মীর অনুমতি দেওয়া হয়নি।'}</p>
                      </div>
                    ) : (
                      accountPermissions.map((grant) => (
                        <div
                          key={grant.id}
                          className="p-3 bg-white border border-slate-200 rounded-xl flex items-center justify-between shadow-2xs"
                        >
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-slate-900">{grant.employeeEmail}</span>
                              <span
                                className={`text-[10px] font-bold px-2 py-0.5 rounded-md uppercase ${
                                  grant.role === 'editor'
                                    ? 'bg-blue-100 text-blue-800'
                                    : 'bg-slate-100 text-slate-700'
                                }`}
                              >
                                {grant.role}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {grant.accountIds.length}{' '}
                              {isEn ? 'accounts accessible' : 'টি অ্যাকাউন্টে অনুমতি'}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRevoke(grant.id, grant.employeeEmail)}
                            className="p-2 text-rose-600 hover:bg-rose-50 rounded-lg transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
                            title={isEn ? 'Revoke Permission' : 'অনুমতি বাতিল'}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
