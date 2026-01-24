import { ChevronDown, Globe } from "lucide-react";
import { useState } from "react";
import type { SelectionState } from "../hooks/useSelection";
import type { DomainGroup as DomainGroupType } from "../types";
import { Checkbox } from "./Checkbox";
import { TabItem } from "./TabItem";

interface DomainGroupProps {
	group: DomainGroupType;
	selectionState: SelectionState;
	isTabSelected: (id: number) => boolean;
	onToggleDomain: () => void;
	onToggleTab: (id: number) => void;
}

export function DomainGroup({ group, selectionState, isTabSelected, onToggleDomain, onToggleTab }: DomainGroupProps) {
	const [isOpen, setIsOpen] = useState(true);

	return (
		<div className="select-none">
			{/* Domain Header */}
			<div
				className="
          glass-hover flex items-center justify-between
          glass-medium p-3 rounded-xl cursor-pointer
        "
				onClick={() => setIsOpen(!isOpen)}
			>
				<div className="flex items-center gap-3 min-w-0 flex-1">
					<ChevronDown
						className={`
              w-4 h-5 text-glass-secondary flex-shrink-0
              transition-transform duration-200
              ${isOpen ? "" : "-rotate-90"}
            `}
					/>

					<div className="w-5 h-5 flex-shrink-0">
						{group.favicon ? (
							<img
								src={group.favicon}
								alt=""
								className="w-5 h-5 rounded-sm"
								onError={(e) => {
									e.currentTarget.style.display = "none";
									e.currentTarget.nextElementSibling?.classList.remove("hidden");
								}}
							/>
						) : null}
						<Globe className={`w-5 h-5 text-glass-muted ${group.favicon ? "hidden" : ""}`} />
					</div>

					<span className="font-semibold text-glass-primary truncate">{group.domain}</span>
				</div>

				<div className="flex items-center gap-3 flex-shrink-0">
					<span
						className="
            text-xs font-medium text-glass-secondary
            glass-light px-2 py-0.5 rounded-full
          "
					>
						{group.tabs.length}
					</span>

					<div onClick={(e) => e.stopPropagation()}>
						<Checkbox
							checked={selectionState === true}
							indeterminate={selectionState === "indeterminate"}
							onChange={onToggleDomain}
						/>
					</div>
				</div>
			</div>

			{/* Tab List */}
			<div
				className={`
          overflow-hidden transition-all duration-200 ease-in-out
          ${isOpen ? "max-h-[1000px] opacity-100 mt-1" : "max-h-0 opacity-0"}
        `}
			>
				{group.tabs.map((tab) => (
					<TabItem key={tab.id} tab={tab} isSelected={isTabSelected(tab.id)} onToggle={() => onToggleTab(tab.id)} />
				))}
			</div>
		</div>
	);
}
