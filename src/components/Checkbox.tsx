import { Check, Minus } from "lucide-react";
import { useEffect, useRef } from "react";

interface CheckboxProps {
	checked: boolean;
	indeterminate?: boolean;
	onChange: () => void;
	className?: string;
}

export function Checkbox({ checked, indeterminate = false, onChange, className = "" }: CheckboxProps) {
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
				onChange={(e) => {
					e.stopPropagation();
					onChange();
				}}
				className="sr-only peer"
			/>
			<div
				onClick={(e) => {
					e.stopPropagation();
					onChange();
				}}
				className={`
          w-5 h-5 rounded-md border-2 cursor-pointer transition-all duration-200
          flex items-center justify-center glass-hover
          ${
						checked || indeterminate
							? "glass-medium border-white/30 shadow-lg"
							: "glass-heavy border-white/20 hover:border-white/30"
					}
        `}
			>
				{checked && !indeterminate && <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
				{indeterminate && <Minus className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
			</div>
		</div>
	);
}
