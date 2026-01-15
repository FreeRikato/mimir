import { Globe } from 'lucide-react';
import type { ChromeTab } from '../types';
import { Checkbox } from './Checkbox';

interface TabItemProps {
  tab: ChromeTab;
  isSelected: boolean;
  onToggle: () => void;
}

export function TabItem({ tab, isSelected, onToggle }: TabItemProps) {
  return (
    <div
      className="
        pl-8 pr-3 py-2.5 ml-3
        border-l-2 border-gray-200
        flex items-center gap-3
        hover:bg-gray-100 rounded-r-md
        cursor-pointer transition-colors duration-150
      "
      onClick={onToggle}
    >
      <Checkbox 
        checked={isSelected} 
        onChange={onToggle}
      />
      
      <div className="w-4 h-4 flex-shrink-0">
        {tab.favIconUrl ? (
          <img
            src={tab.favIconUrl}
            alt=""
            className="w-4 h-4 rounded-sm"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
              e.currentTarget.nextElementSibling?.classList.remove('hidden');
            }}
          />
        ) : null}
        <Globe 
          className={`w-4 h-4 text-gray-400 ${tab.favIconUrl ? 'hidden' : ''}`} 
        />
      </div>
      
      <span 
        className="text-sm text-gray-600 truncate flex-1"
        title={tab.title}
      >
        {tab.title}
      </span>
    </div>
  );
}
