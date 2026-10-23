import React, { useState } from 'react';
import { Lock, Delete, ShieldAlert } from 'lucide-react';
import { pinLock } from '../security/pinLock';
import { useApp } from '../context/AppContext';

interface PinLockScreenProps {
  onUnlocked: () => void;
}

export const PinLockScreen: React.FC<PinLockScreenProps> = ({ onUnlocked }) => {
  const { language } = useApp();
  const isEn = language === 'en';

  const [enteredPin, setEnteredPin] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);

  const handleDigitPress = async (digit: string) => {
    if (enteredPin.length >= 4) return;
    const nextPin = enteredPin + digit;
    setEnteredPin(nextPin);
    setErrorMessage(null);

    if (nextPin.length === 4) {
      setIsVerifying(true);
      const res = await pinLock.verifyPin(nextPin);
      setIsVerifying(false);
      if (res.success) {
        onUnlocked();
      } else {
        setErrorMessage(
          res.error || (isEn ? 'Incorrect PIN entered.' : 'ভুল পিন দেওয়া হয়েছে।')
        );
        setEnteredPin('');
      }
    }
  };

  const handleDelete = () => {
    setEnteredPin((prev) => prev.slice(0, -1));
    setErrorMessage(null);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900 text-white flex flex-col items-center justify-center p-6 select-none">
      <div className="max-w-xs w-full text-center space-y-6">
        <div className="w-14 h-14 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center mx-auto shadow-md">
          <Lock className="w-6 h-6 text-slate-300" />
        </div>

        <div>
          <h2 className="text-lg font-bold tracking-tight text-white">
            {isEn ? 'App Locked' : 'অ্যাপ লক করা আছে'}
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            {isEn ? 'Enter your 4-digit security PIN' : 'আপনার ৪-সংখ্যার পিন প্রবেশ করান'}
          </p>
        </div>

        {/* PIN 4-dot indicators */}
        <div className="flex justify-center items-center gap-4 py-2">
          {[0, 1, 2, 3].map((idx) => {
            const isFilled = enteredPin.length > idx;
            return (
              <div
                key={idx}
                className={`w-4 h-4 rounded-full transition-all duration-200 ${
                  isFilled
                    ? 'bg-white scale-110 shadow-sm shadow-white/40'
                    : 'bg-slate-700 border border-slate-600'
                }`}
              />
            );
          })}
        </div>

        {errorMessage && (
          <div className="p-2.5 rounded-xl bg-rose-950/80 border border-rose-800 text-rose-300 text-xs flex items-center justify-center gap-1.5 animate-in fade-in">
            <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Numeric keypad */}
        <div className="grid grid-cols-3 gap-3 pt-4">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
            <button
              key={digit}
              type="button"
              onClick={() => handleDigitPress(digit)}
              disabled={isVerifying}
              className="h-14 rounded-xl bg-slate-800/80 hover:bg-slate-700 active:scale-95 text-lg font-mono font-bold text-white transition-all border border-slate-700/60"
            >
              {digit}
            </button>
          ))}
          <div />
          <button
            type="button"
            onClick={() => handleDigitPress('0')}
            disabled={isVerifying}
            className="h-14 rounded-xl bg-slate-800/80 hover:bg-slate-700 active:scale-95 text-lg font-mono font-bold text-white transition-all border border-slate-700/60"
          >
            0
          </button>
          <button
            type="button"
            onClick={handleDelete}
            className="h-14 rounded-xl bg-slate-800/50 hover:bg-slate-700/80 active:scale-95 flex items-center justify-center text-slate-300 transition-all border border-slate-700/40"
            aria-label="Delete digit"
          >
            <Delete className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
};
