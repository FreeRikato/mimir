import { useRef, useEffect } from 'react';
import { Check, Minus } from 'lucide-react';

interface CheckboxProps {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  className?: string;
}

export function Checkbox({ checked, indeterminate = false, onChange, className = '' }: CheckboxProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  return (
    <div className={`relative inline-flex items-center justify-center ${className}`}>
      <input
        ref={inputRef}
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="sr-only peer"
      />
      <div
        onClick={onChange}
        className={`
          w-5 h-5 rounded border-2 cursor-pointer transition-all duration-150
          flex items-center justify-center
          ${checked || indeterminate 
            ? 'bg-blue-600 border-blue-600' 
            : 'bg-white border-gray-300 hover:border-gray-400'
          }
        `}
      >
        {checked && !indeterminate && (
          <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />
        )}
        {indeterminate && (
          <Minus className="w-3.5 h-3.5 text-white" strokeWidth={3} />
        )}
      </div>
    </div>
  );
}
