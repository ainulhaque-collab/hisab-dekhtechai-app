import React, { useState, useRef } from 'react';
import { useApp } from '../context/AppContext';
import {
  User,
  Camera,
  Trash2,
  X,
  Check,
  Mail,
  Phone,
  MapPin,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ProfileModal: React.FC<ProfileModalProps> = ({ isOpen, onClose }) => {
  const { userProfile } = useApp();
  if (!isOpen) return null;
  // Reset drafts/photo when the profile is cleared, and on every fresh opening.
  return <ProfileEditor key={userProfile?.subjectHash || 'device'} isOpen={isOpen} onClose={onClose} />;
};

const accountAuthEnabled=import.meta.env.VITE_SUPABASE_AUTH_ENABLED==='true';
const ProfileEditor: React.FC<ProfileModalProps> = ({ onClose }) => {
  const { userProfile, updateUserProfile, language, isLiveGoogleAuth } = useApp();

  const [displayName, setDisplayName] = useState(userProfile?.displayName || '');
  const [phone, setPhone] = useState(userProfile?.phone || '');
  const [address, setAddress] = useState(userProfile?.address || '');
  const [photoUrl, setPhotoUrl] = useState<string | undefined>(userProfile?.photoUrl);
  const [isEditing, setIsEditing] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      alert(language === 'bn' ? 'ছবির আকার ২ মেগাবাইটের কম হতে হবে।' : 'Image size must be less than 2MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setPhotoUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleRemovePhoto = () => {
    setPhotoUrl(undefined);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    updateUserProfile({
      displayName: displayName.trim() || 'Hisab User',
      photoUrl,
      phone: phone.trim() || undefined,
      address: address.trim() || undefined,
    });
    setIsEditing(false);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2500);
  };

  const handleCancel = () => {
    setDisplayName(userProfile?.displayName || '');
    setPhone(userProfile?.phone || '');
    setAddress(userProfile?.address || '');
    setPhotoUrl(userProfile?.photoUrl);
    setIsEditing(false);
  };

  // Get user initials for default avatar
  const getInitials = (name?: string) => {
    if (!name) return 'HD';
    const parts = name.trim().split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs animate-in fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-modal-title"
    >
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden border border-slate-200">
        {/* Header */}
        <div className="bg-slate-900 px-6 py-4 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white">
              <User className="w-4 h-4" />
            </div>
            <div>
              <h2 id="profile-modal-title" className="text-base font-bold tracking-tight">
                {accountAuthEnabled?(language==='bn'?'ডিভাইস প্রোফাইল':'Device profile'):(language === 'bn' ? 'আমার প্রোফাইল' : 'My Profile')}
              </h2>
              <p className="text-xs text-slate-400">
                {accountAuthEnabled?(language==='bn'?'এই ডিভাইসে সংরক্ষিত ব্যক্তিগত তথ্য':'Personal details saved on this device'):(language === 'bn' ? 'ব্যক্তিগত তথ্য ও হিসাব পরিচয়' : 'Personal info & profile settings')}
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
        <div className="p-6 space-y-6 max-h-[80vh] overflow-y-auto">
          {saveSuccess && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-2 text-xs text-emerald-800 font-medium animate-in fade-in">
              <Check className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{language === 'bn' ? 'প্রোফাইল সফলভাবে সংরক্ষিত হয়েছে!' : 'Profile updated successfully!'}</span>
            </div>
          )}

          {/* Avatar Section */}
          <div className="flex flex-col items-center gap-3">
            <div className="relative">
              <div className="w-24 h-24 rounded-full border-4 border-slate-100 bg-slate-200 shadow-md overflow-hidden flex items-center justify-center">
                {photoUrl ? (
                  <img
                    src={photoUrl}
                    alt={displayName || 'User'}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-2xl font-bold text-slate-600 tracking-wider">
                    {getInitials(displayName || userProfile?.displayName)}
                  </span>
                )}
              </div>

              {isEditing && (
                <div className="absolute bottom-0 right-0 flex gap-1">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="p-2 bg-blue-600 text-white rounded-full shadow-md hover:bg-blue-700 transition-colors"
                    title={language === 'bn' ? 'ছবি পরিবর্তন করুন' : 'Change Photo'}
                    aria-label="Upload photo"
                  >
                    <Camera className="w-3.5 h-3.5" />
                  </button>
                  {photoUrl && (
                    <button
                      type="button"
                      onClick={handleRemovePhoto}
                      className="p-2 bg-rose-600 text-white rounded-full shadow-md hover:bg-rose-700 transition-colors"
                      title={language === 'bn' ? 'ছবি মুছুন' : 'Remove Photo'}
                      aria-label="Remove photo"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handlePhotoUpload}
              />
            </div>

            <div className="text-center">
              <h3 className="text-lg font-bold text-slate-900">
                {userProfile?.displayName || (language === 'bn' ? 'হিসাব ব্যবহারকারী' : 'Hisab User')}
              </h3>
              <p className="text-xs text-slate-500 flex items-center justify-center gap-1 mt-0.5">
                {!accountAuthEnabled&&<Mail className="w-3 h-3 text-slate-400" />}
                <span>{accountAuthEnabled?(language==='bn'?'লগইনের তথ্য অ্যাকাউন্ট ও লগইন-এ দেখুন':'View sign-in details in Account & sign-in'):(userProfile?.email || (language === 'bn' ? 'গুগল সংযুক্ত নেই' : 'No Google account'))}</span>
              </p>
            </div>
          </div>

          {/* Form or Info View */}
          {isEditing ? (
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {language === 'bn' ? 'নাম *' : 'Display Name *'}
                </label>
                <input
                  type="text"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600"
                  placeholder={language === 'bn' ? 'আপনার নাম' : 'Your full name'}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {language === 'bn' ? 'যোগাযোগের নম্বর (ঐচ্ছিক)' : 'Contact number (optional)'}
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600"
                  placeholder="+880 1..."
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {language === 'bn' ? 'ঠিকানা (ঐচ্ছিক)' : 'Address (Optional)'}
                </label>
                <textarea
                  rows={2}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600"
                  placeholder={language === 'bn' ? 'আপনার ঠিকানা বা শহর' : 'Street or city'}
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleCancel}
                  className="flex-1 py-2.5 px-4 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 min-h-[44px]"
                >
                  {language === 'bn' ? 'বাতিল' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 px-4 rounded-xl bg-blue-700 text-white text-xs font-semibold hover:bg-blue-800 shadow-xs min-h-[44px]"
                >
                  {language === 'bn' ? 'সংরক্ষণ করুন' : 'Save Changes'}
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-3">
              <div className="p-3 bg-slate-50 rounded-xl space-y-2 border border-slate-200/70 text-xs">
                <div className="flex items-center justify-between text-slate-600 py-1 border-b border-slate-200/50">
                  <span className="flex items-center gap-1.5 font-medium">
                    <User className="w-3.5 h-3.5 text-slate-400" />
                    {language === 'bn' ? 'নাম' : 'Name'}
                  </span>
                  <span className="font-semibold text-slate-900">{userProfile?.displayName || '—'}</span>
                </div>

                <div className="flex items-center justify-between text-slate-600 py-1 border-b border-slate-200/50">
                  <span className="flex items-center gap-1.5 font-medium">
                    <Phone className="w-3.5 h-3.5 text-slate-400" />
                    {language === 'bn' ? 'ফোন' : 'Phone'}
                  </span>
                  <span className="font-semibold text-slate-900">{userProfile?.phone || '—'}</span>
                </div>

                <div className="flex items-center justify-between text-slate-600 py-1 border-b border-slate-200/50">
                  <span className="flex items-center gap-1.5 font-medium">
                    <MapPin className="w-3.5 h-3.5 text-slate-400" />
                    {language === 'bn' ? 'ঠিকানা' : 'Address'}
                  </span>
                  <span className="font-semibold text-slate-900">{userProfile?.address || '—'}</span>
                </div>

                {!accountAuthEnabled&&<div className="flex items-center justify-between text-slate-600 py-1">
                  <span className="flex items-center gap-1.5 font-medium">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                    {language === 'bn' ? 'গুগল পরিচয় স্থিতি' : 'Google Identity'}
                  </span>
                  <span className="font-semibold text-emerald-700">
                    {isLiveGoogleAuth
                      ? (language === 'bn' ? 'যাচাইকৃত ড্রাইভ ওনার' : 'Verified Drive Owner')
                      : (language === 'bn' ? 'স্থানীয় মোড' : 'Local Mode')}
                  </span>
                </div>}
              </div>

              {!accountAuthEnabled&&userProfile?.subjectHash && (
                <div className="px-3 py-2 bg-slate-100 rounded-lg text-[10px] text-slate-500 font-mono truncate">
                  <span className="font-semibold text-slate-600">ID Hash: </span>
                  {userProfile.subjectHash.slice(0, 20)}...
                </div>
              )}

              <button
                type="button"
                onClick={() => setIsEditing(true)}
                className="w-full py-2.5 px-4 bg-slate-900 text-white rounded-xl text-xs font-semibold hover:bg-slate-800 shadow-xs min-h-[44px] flex items-center justify-center gap-2"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{language === 'bn' ? 'প্রোফাইল পরিবর্তন করুন' : 'Edit Profile'}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
