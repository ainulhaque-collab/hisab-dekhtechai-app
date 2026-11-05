import React from 'react';
import { Home, Landmark, Plus, History, BarChart3 } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { mobileUiEnabled } from '../appearance/mobileAppearance';

export type TabType = 'home' | 'accounts' | 'add' | 'history' | 'reports';

interface BottomNavProps {
  activeTab: TabType;
  onChangeTab: (tab: TabType) => void;
}

export const BottomNav: React.FC<BottomNavProps> = ({ activeTab, onChangeTab }) => {
  const { language } = useApp();

  const tabs: Array<{
    id: TabType;
    label: string;
    icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
    isAddButton?: boolean;
  }> = [
    {
      id: 'home',
      label: language === 'bn' ? 'হোম' : 'Home',
      icon: Home,
    },
    {
      id: 'accounts',
      label: language === 'bn' ? 'হিসাব' : 'Accounts',
      icon: Landmark,
    },
    {
      id: 'add',
      label: language === 'bn' ? 'যোগ' : 'Add',
      icon: Plus,
      isAddButton: true,
    },
    {
      id: 'history',
      label: language === 'bn' ? 'ইতিহাস' : 'History',
      icon: History,
    },
    {
      id: 'reports',
      label: language === 'bn' ? 'রিপোর্ট' : 'Reports',
      icon: BarChart3,
    },
  ];

  if (mobileUiEnabled) return <nav aria-label={language === 'bn' ? 'প্রধান নেভিগেশন' : 'Main navigation'} className="app-mobile-nav fixed inset-x-0 bottom-0 z-40 border-t pb-safe">
    <div className="mx-auto grid max-w-lg grid-cols-5 items-center px-2 py-2">{tabs.map(tab => {
      const Icon = tab.icon, active = activeTab === tab.id;
      return <button key={tab.id} type="button" onClick={() => onChangeTab(tab.id)} aria-current={active ? 'page' : undefined}
        aria-label={tab.isAddButton ? (language === 'bn' ? 'নতুন লেনদেন যোগ করুন' : 'Add transaction') : tab.label}
        className="app-mobile-nav-item flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[11px] font-semibold focus-visible:outline-2">
        <span className={`${tab.isAddButton ? 'app-mobile-add h-10 w-12 rounded-2xl text-white' : 'app-nav-icon h-8 w-12 rounded-xl'} flex items-center justify-center transition-colors`}><Icon className="h-5 w-5" strokeWidth={active ? 2.2 : 1.8} aria-hidden="true" /></span>
        <span>{tab.isAddButton ? (language === 'bn' ? 'এন্ট্রি' : 'Add') : tab.label}</span>
      </button>;
    })}</div>
  </nav>;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200/80 pb-safe shadow-sm">
      <div className="max-w-md mx-auto px-4 flex items-center justify-between">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          if (tab.isAddButton) {
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onChangeTab(tab.id)}
                className="flex flex-col items-center justify-center -mt-4 group"
                aria-label="Add transaction"
              >
                <div className="w-11 h-11 rounded-full bg-slate-900 text-white flex items-center justify-center shadow-md shadow-slate-900/25 group-hover:bg-slate-800 group-active:scale-95 transition-all">
                  <Plus className="w-5 h-5" strokeWidth={2.5} />
                </div>
                <span className="text-[10px] font-medium text-slate-800 mt-0.5">
                  {tab.label}
                </span>
              </button>
            );
          }

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChangeTab(tab.id)}
              className={`flex-1 py-2 flex flex-col items-center justify-center gap-0.5 transition-colors ${
                isActive ? 'text-slate-900 font-semibold' : 'text-slate-400 hover:text-slate-700'
              }`}
            >
              <Icon className="w-4 h-4" strokeWidth={isActive ? 2.2 : 1.75} />
              <span className="text-[10px] tracking-tight">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
