import { AppSelect } from './AppSelect';
import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { BusinessParty, PartyRole } from '../contracts/types';
import { formatBDT } from '../domain/money';
import {
  Users,
  UserPlus,
  Phone,
  Edit2,
  Trash2,
  X,
  Check,
  Briefcase,
  UserCheck,
  ShoppingBag,
  Truck,
  User,
  AlertCircle
} from 'lucide-react';

interface PartiesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PartiesModal: React.FC<PartiesModalProps> = ({ isOpen, onClose }) => {
  const { currentWorkspace, parties, createParty, editParty, deleteParty, db, language } = useApp();
  const isEn = language === 'en';

  const [isAdding, setIsAdding] = useState(false);
  const [editingPartyId, setEditingPartyId] = useState<string | null>(null);

  // Form states
  const [name, setName] = useState('');
  const [role, setRole] = useState<PartyRole>('partner');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const getRoleLabel = (r: PartyRole) => {
    switch (r) {
      case 'partner':
        return isEn ? 'Partner / Co-Owner' : 'অংশীদার / পার্টনার';
      case 'staff':
        return isEn ? 'Staff / Employee' : 'কর্মচারী / স্টাফ';
      case 'customer':
        return isEn ? 'Customer / Client' : 'গ্রাহক / কাস্টমার';
      case 'supplier':
        return isEn ? 'Supplier / Vendor' : 'সরবরাহকারী / মহাজন';
      default:
        return isEn ? 'Other Member' : 'অন্যান্য ব্যক্তি';
    }
  };

  const getRoleBadgeStyle = (r: PartyRole) => {
    switch (r) {
      case 'partner':
        return 'bg-indigo-50 text-indigo-700 border-indigo-200';
      case 'staff':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'customer':
        return 'bg-purple-50 text-purple-700 border-purple-200';
      case 'supplier':
        return 'bg-amber-50 text-amber-700 border-amber-200';
      default:
        return 'bg-slate-50 text-slate-700 border-slate-200';
    }
  };

  const getRoleIcon = (r: PartyRole) => {
    switch (r) {
      case 'partner':
        return <Briefcase className="w-3.5 h-3.5 text-indigo-600" />;
      case 'staff':
        return <UserCheck className="w-3.5 h-3.5 text-emerald-600" />;
      case 'customer':
        return <ShoppingBag className="w-3.5 h-3.5 text-purple-600" />;
      case 'supplier':
        return <Truck className="w-3.5 h-3.5 text-amber-600" />;
      default:
        return <User className="w-3.5 h-3.5 text-slate-600" />;
    }
  };

  const handleStartAdd = () => {
    setName('');
    setRole('partner');
    setPhone('');
    setNotes('');
    setError(null);
    setEditingPartyId(null);
    setIsAdding(true);
  };

  const handleStartEdit = (p: BusinessParty) => {
    setName(p.name);
    setRole(p.role);
    setPhone(p.phone || '');
    setNotes(p.notes || '');
    setError(null);
    setEditingPartyId(p.id);
    setIsAdding(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    try {
    e.preventDefault();
    if (!name.trim()) {
      setError(isEn ? 'Name is required' : 'নাম লেখা আবশ্যক');
      return;
    }

    if (editingPartyId) {
      await editParty(editingPartyId, {
        name: name.trim(),
        role,
        phone: phone.trim(),
        notes: notes.trim(),
      });
    } else {
      await createParty(name.trim(), role, phone.trim(), notes.trim());
    }

    setIsAdding(false);
    setEditingPartyId(null);
    } catch { setError(isEn?'Changes could not be saved. Retry.':'পরিবর্তন সংরক্ষণ হয়নি। আবার চেষ্টা করুন।'); }
  };

  const handleDelete = async (id: string, partyName: string) => {
    try {
    const confirmMsg = isEn
      ? `Remove "${partyName}" from this ledger?`
      : `আপনি কি "${partyName}"-কে এই খাতা থেকে বাদ দিতে চান?`;
    if (window.confirm(confirmMsg)) {
      await deleteParty(id);
    }
    } catch { setError(isEn?'Changes could not be saved. Retry.':'পরিবর্তন সংরক্ষণ হয়নি। আবার চেষ্টা করুন।'); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-lg w-full p-5 shadow-2xl border border-slate-200 animate-in zoom-in-95 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center">
              <Users className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-slate-800 text-sm">
                {isEn ? 'Business Persons & Members' : 'ব্যবসার সদস্য ও পক্ষগণ'}
              </h3>
              <p className="text-[11px] text-slate-500">
                {isEn
                  ? 'Manage multiple partners, staff, customers & suppliers in 1 ledger'
                  : '১ টি খাতায় একাধিক পার্টনার, কর্মচারী, কাস্টমার ও সাপ্লায়ারের হিসাব'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="overflow-y-auto py-3 space-y-3 flex-1 text-xs">
          {/* Add / Edit Form */}
          {isAdding ? (
            <form onSubmit={handleSave} className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
              <div className="font-bold text-slate-800 flex items-center justify-between">
                <span>
                  {editingPartyId
                    ? isEn
                      ? 'Edit Person / Member'
                      : 'তথ্য সংশোধন করুন'
                    : isEn
                    ? 'Add New Person to Business Ledger'
                    : 'খাতায় নতুন ব্যক্তি যোগ করুন'}
                </span>
                <button
                  type="button"
                  onClick={() => setIsAdding(false)}
                  className="text-slate-400 hover:text-slate-600 text-[11px]"
                >
                  {isEn ? 'Cancel' : 'বাতিল'}
                </button>
              </div>

              {error && (
                <div className="p-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 flex items-center gap-1.5 text-[11px]">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div>
                <label className="block text-slate-700 font-semibold mb-1">
                  {isEn ? 'Full Name *' : 'পূর্ণ নাম *'}
                </label>
                <input
                  type="text"
                  placeholder={isEn ? 'e.g., Rafiq Ahmed' : 'যেমন: মো: করিম সাহেব'}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600"
                  required
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">
                    {isEn ? 'Role / Relationship' : 'ভূমিকা / পদবি'}
                  </label>
                  <AppSelect aria-label={isEn ? 'Role / Relationship' : 'ভূমিকা / সম্পর্ক'}
                    value={role}
                    onChange={(e) => setRole(e.target.value as PartyRole)}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 font-medium"
                  >
                    <option value="partner">{isEn ? 'Partner / Co-Owner' : 'অংশীদার / পার্টনার'}</option>
                    <option value="staff">{isEn ? 'Staff / Employee' : 'কর্মচারী / স্টাফ'}</option>
                    <option value="customer">{isEn ? 'Customer / Client' : 'গ্রাহক / কাস্টমার'}</option>
                    <option value="supplier">{isEn ? 'Supplier / Vendor' : 'সরবরাহকারী / মহাজন'}</option>
                    <option value="other">{isEn ? 'Other Member' : 'অন্যান্য ব্যক্তি'}</option>
                  </AppSelect>
                </div>

                <div>
                  <label className="block text-slate-700 font-semibold mb-1">
                    {isEn ? 'Phone Number (Optional)' : 'মোবাইল নম্বর (ঐচ্ছিক)'}
                  </label>
                  <input
                    type="tel"
                    placeholder="017xxxxxxxx"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">
                  {isEn ? 'Note / Responsibilities (Optional)' : 'বিবরণ / দায়িত্ব (ঐচ্ছিক)'}
                </label>
                <input
                  type="text"
                  placeholder={isEn ? 'e.g., 40% Shareholder, Shop Manager' : 'যেমন: ৫০% শেয়ারহোল্ডার, ক্যাশিয়ার'}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  type="submit"
                  className="flex-1 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg font-medium flex items-center justify-center gap-1.5 shadow-2xs transition-colors"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>{editingPartyId ? (isEn ? 'Update' : 'আপডেট') : (isEn ? 'Save' : 'সংরক্ষণ')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsAdding(false)}
                  className="px-3 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium border border-slate-200"
                >
                  {isEn ? 'Cancel' : 'বাতিল'}
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={handleStartAdd}
              className="w-full py-2.5 px-3 border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-800 rounded-xl font-medium flex items-center justify-center gap-2 transition-colors"
            >
              <UserPlus className="w-4 h-4 text-slate-600" />
              <span>{isEn ? '+ Add Member' : '+ নতুন সদস্য যোগ'}</span>
            </button>
          )}

          {/* List of Parties */}
          <div className="space-y-2 pt-1">
            {parties.length === 0 ? (
              <div className="p-6 text-center text-slate-400 bg-slate-50 rounded-xl border border-slate-100">
                <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p>{isEn ? 'No persons added to this business ledger yet.' : 'এখনও কোনো ব্যক্তি বা সদস্য যোগ করা হয়নি।'}</p>
              </div>
            ) : (
              parties.map((p) => {
                const txs = db.getPartyTransactions(p.id);
                return (
                  <div
                    key={p.id}
                    className="p-3 bg-white border border-slate-200 rounded-xl hover:border-blue-300 transition-all shadow-2xs flex items-center justify-between gap-3"
                  >
                    <div className="flex items-start gap-2.5 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center shrink-0 mt-0.5">
                        {getRoleIcon(p.role)}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-bold text-slate-800 text-xs truncate">{p.name}</span>
                          <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold border ${getRoleBadgeStyle(p.role)}`}>
                            {getRoleLabel(p.role)}
                          </span>
                        </div>
                        {p.phone && (
                          <a
                            href={`tel:${p.phone}`}
                            className="text-[11px] text-blue-700 hover:underline flex items-center gap-1 mt-0.5"
                          >
                            <Phone className="w-3 h-3" />
                            <span>{p.phone}</span>
                          </a>
                        )}
                        {p.notes && (
                          <div className="text-[10px] text-slate-500 mt-0.5 line-clamp-1">{p.notes}</div>
                        )}
                        <div className="text-[10px] text-slate-400 mt-1">
                          {isEn ? `${txs.length} transactions recorded` : `${txs.length}টি লেনদেন সংযুক্ত`}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleStartEdit(p)}
                        className="p-1.5 text-slate-400 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors"
                        title={isEn ? 'Edit person' : 'সম্পাদনা'}
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(p.id, p.name)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                        title={isEn ? 'Delete person' : 'মুছে ফেলুন'}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="pt-3 border-t border-slate-100 flex justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs"
          >
            {isEn ? 'Close' : 'বন্ধ করুন'}
          </button>
        </div>
      </div>
    </div>
  );
};
