import React from 'react';
import { Home, Landmark, PlusCircle, History, BarChart3 } from 'lucide-react';
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
      label: language === 'bn' ? 'অ্যাকাউন্ট' : 'Accounts',
      icon: Landmark,
    },
    {
      id: 'add',
      label: language === 'bn' ? 'যোগ করুন' : 'Add',
      icon: PlusCircle,
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
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 pb-safe shadow-lg shadow-slate-900/5">
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
                className="flex flex-col items-center justify-center -mt-5 group"
                aria-label="Add transaction"
              >
                <div className="w-13 h-13 rounded-full bg-blue-700 text-white flex items-center justify-center shadow-lg shadow-blue-700/30 group-hover:bg-blue-800 group-active:scale-95 transition-all">
                  <PlusCircle className="w-7 h-7" strokeWidth={2.2} />
                </div>
                <span className="text-[10px] font-semibold text-blue-700 mt-1">
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
              className={`flex-1 py-2 flex flex-col items-center justify-center gap-1 transition-colors ${
                isActive ? 'text-blue-700 font-semibold' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Icon className="w-5 h-5" strokeWidth={isActive ? 2.2 : 1.75} />
              <span className="text-[11px] leading-tight">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
