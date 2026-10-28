import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppDateInput } from '../../src/components/AppDateInput';

function Probe() {
  const [value, setValue] = useState('2026-10-28');
  const [language, setLanguage] = useState<'en' | 'bn'>('en');
  useEffect(() => { document.documentElement.dataset.calendarProbeReady = 'true'; }, []);
  return <main className="p-4 text-slate-900">
    <p className="mb-5">Synthetic calendar test · no account or financial records</p>
    <AppDateInput id="probe-date" label={language === 'en' ? 'Probe target date' : 'পরীক্ষার লক্ষ্যের তারিখ'} language={language} value={value} onChange={setValue}
      className="w-full rounded-xl border border-slate-300 bg-white p-3" />
    <p id="probe-date-value">{value}</p>
    <button id="probe-language-bn" onClick={() => setLanguage('bn')}>বাংলা</button>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Probe />);
