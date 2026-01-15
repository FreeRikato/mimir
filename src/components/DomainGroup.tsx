import { useState } from 'react';
import { ChevronDown, Globe } from 'lucide-react';
import type { DomainGroup as DomainGroupType } from '../types';
import type { SelectionState } from '../hooks/useSelection';
import { Checkbox } from './Checkbox';
import { TabItem } from './TabItem';

interface DomainGroupProps {
  group: DomainGroupType;
  selectionState: SelectionState;
  isTabSelected: (id: number) => boolean;
  onToggleDomain: () => void;
  onToggleTab: (id: number) => void;
}

export function DomainGroup({
  group,
  selectionState,
  isTabSelected,
  onToggleDomain,
  onToggleTab,
}: DomainGroupProps) {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <div className="select-none">
      {/* Domain Header */}
      <div
        className="
          flex items-center justify-between
          bg-white p-3 rounded-lg
          shadow-sm border border-gray-200
          cursor-pointer hover:bg-gray-50
          transition-colors duration-150
        "
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <ChevronDown 
            className={`
              w-4 h-4 text-gray-500 flex-shrink-0
              transition-transform duration-200
              ${isOpen ? '' : '-rotate-90'}
            `}
          />
          
          <div className="w-5 h-5 flex-shrink-0">
            {group.favicon ? (
              <img
                src={group.favicon}
                alt=""
                className="w-5 h-5 rounded-sm"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                  e.currentTarget.nextElementSibling?.classList.remove('hidden');
                }}
              />
            ) : null}
            <Globe 
              className={`w-5 h-5 text-gray-400 ${group.favicon ? 'hidden' : ''}`} 
            />
          </div>
          
          <span className="font-semibold text-gray-800 truncate">
            {group.domain}
          </span>
        </div>
        
        <div className="flex items-center gap-3 flex-shrink-0">
          <span className="
            text-xs font-medium text-gray-500
            bg-gray-100 px-2 py-0.5 rounded-full
          ">
            {group.tabs.length}
          </span>
          
          <div onClick={(e) => e.stopPropagation()}>
            <Checkbox
              checked={selectionState === true}
              indeterminate={selectionState === 'indeterminate'}
              onChange={onToggleDomain}
            />
          </div>
        </div>
      </div>

      {/* Tab List */}
      <div
        className={`
          overflow-hidden transition-all duration-200 ease-in-out
          ${isOpen ? 'max-h-[1000px] opacity-100 mt-1' : 'max-h-0 opacity-0'}
        `}
      >
        {group.tabs.map((tab) => (
          <TabItem
            key={tab.id}
            tab={tab}
            isSelected={isTabSelected(tab.id)}
            onToggle={() => onToggleTab(tab.id)}
          />
        ))}
      </div>
    </div>
  );
}
