import { Globe } from "lucide-react";
import { useCallback } from "react";
import type { ChromeTab } from "../types";
import { Checkbox } from "./Checkbox";

interface TabItemProps {
	tab: ChromeTab;
	isSelected: boolean;
	onToggle: () => void;
}

export function TabItem({ tab, isSelected, onToggle }: TabItemProps) {
	const handleTabClick = useCallback(() => {
		chrome.tabs.update(tab.id, { active: true });
		chrome.windows.update(tab.windowId, { focused: true });
	}, [tab.id, tab.windowId]);

	const handleCheckboxClick = useCallback(
		(e: React.MouseEvent) => {
			e.stopPropagation();
			onToggle();
		},
		[onToggle],
	);

	return (
		<div
			onClick={handleTabClick}
			className="
        glass-hover pl-8 pr-3 py-2.5 ml-3
        border-l border-white/10
        flex items-center gap-3 cursor-pointer
        rounded-r-lg transition-all duration-200
      "
		>
			<div onClick={handleCheckboxClick}>
				<Checkbox checked={isSelected} onChange={onToggle} />
			</div>

			<div className="w-4 h-4 flex-shrink-0">
				{tab.favIconUrl ? (
					<img
						src={tab.favIconUrl}
						alt=""
						className="w-4 h-4 rounded-sm filter brightness-125 contrast-110 saturate-120"
						onError={(e) => {
							const img = e.currentTarget;
							const fallback = img.nextElementSibling as HTMLElement;

							img.style.display = "none";
							if (fallback) {
								fallback.classList.remove("hidden");
								fallback.classList.add("text-white/90");
							}
						}}
					/>
				) : null}
				<Globe className={`w-4 h-4 ${tab.favIconUrl ? "hidden" : "text-white/90"} drop-shadow-sm`} />
			</div>

			<span
				className="text-sm text-glass-secondary truncate flex-1 hover:text-glass-primary transition-colors"
				title={tab.title}
			>
				{tab.title}
			</span>
		</div>
	);
}
