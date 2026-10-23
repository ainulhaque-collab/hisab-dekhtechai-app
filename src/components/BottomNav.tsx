import React from 'react';
import { Home, Landmark, Plus, History, BarChart3 } from 'lucide-react';
import { useApp } from '../context/AppContext';

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
