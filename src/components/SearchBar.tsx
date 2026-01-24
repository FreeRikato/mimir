import { Search, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

interface SearchBarProps {
	onSearch: (query: { keywords?: string; dateFrom?: number; dateTo?: number }) => void;
	onClearSearch: () => void;
}

export function SearchBar({ onSearch, onClearSearch }: SearchBarProps) {
	const [keywords, setKeywords] = useState("");
	const [isActive, setIsActive] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Debounced search
	const debouncedSearch = useCallback(
		(searchKeywords: string) => {
			if (debounceRef.current) {
				clearTimeout(debounceRef.current);
			}

			debounceRef.current = setTimeout(() => {
				if (searchKeywords.trim()) {
					onSearch({ keywords: searchKeywords.trim() });
				} else {
					onClearSearch();
				}
			}, 300);
		},
		[onSearch, onClearSearch],
	);

	const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const value = e.target.value;
		setKeywords(value);
		setIsActive(value.length > 0);
		debouncedSearch(value);
	};

	const handleClear = () => {
		setKeywords("");
		setIsActive(false);
		onClearSearch();
		inputRef.current?.focus();
	};

	// Cleanup debounce on unmount
	useEffect(() => {
		return () => {
			if (debounceRef.current) {
				clearTimeout(debounceRef.current);
			}
		};
	}, []);

	return (
		<div className="relative">
			<div className="relative">
				<Search
					className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 transition-colors ${
						isActive ? "text-teal-400" : "text-glass-muted"
					}`}
				/>
				<input
					ref={inputRef}
					type="text"
					value={keywords}
					onChange={handleInputChange}
					placeholder="Search history..."
					className={`
            w-full pl-10 pr-10 py-2.5 rounded-lg bg-white/5 border text-sm text-glass-primary
            placeholder:text-glass-muted focus:outline-none transition-all
            ${
							isActive
								? "border-teal-400/50 focus:border-teal-400/50 focus:ring-1 focus:ring-teal-400/50"
								: "border-white/10 focus:border-white/20"
						}
          `}
				/>
				{isActive && (
					<button
						onClick={handleClear}
						className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded-full glass-hover
                     text-glass-muted hover:text-glass-primary transition-colors"
						aria-label="Clear search"
					>
						<X className="w-3.5 h-3.5" />
					</button>
				)}
			</div>
			{isActive && (
				<div className="mt-2 text-xs text-glass-muted flex items-center gap-2">
					<span>Searching in:</span>
					<span className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10">Titles</span>
					<span className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10">Content</span>
					<span className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10">URLs</span>
					<span className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10">Domains</span>
				</div>
			)}
		</div>
	);
}
