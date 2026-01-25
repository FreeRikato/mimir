import { ChevronRight, Clock, X } from "lucide-react";
import { useEffect } from "react";
import type { SubtitleFormat } from "../utils/settings";
import { SubtitleFormatSelector } from "./SubtitleFormatSelector";

interface ToggleProps {
	enabled: boolean;
	onChange: () => void;
	label: string;
}

function Toggle({ enabled, onChange, label }: ToggleProps) {
	return (
		<button
			onClick={onChange}
			className="flex items-center justify-between w-full p-3 rounded-xl glass-medium border border-white/5 hover:bg-white/5 transition-all"
		>
			<span className="text-glass-secondary">{label}</span>
			<div
				className={`
					w-11 h-6 rounded-full relative transition-colors duration-200
					${enabled ? "bg-teal-500/50" : "bg-white/10"}
				`}
			>
				<div
					className={`
						w-5 h-5 rounded-full bg-white shadow-sm absolute top-0.5 transition-transform duration-200
						${enabled ? "translate-x-5" : "translate-x-0.5"}
					`}
				/>
			</div>
		</button>
	);
}

interface SettingsModalProps {
	isOpen: boolean;
	onClose: () => void;
	subtitleFormat: SubtitleFormat;
	onFormatChange: (format: SubtitleFormat) => void;
	closeTabsEnabled: boolean;
	onToggleCloseTabs: () => void;
	onOpenHistory: () => void;
}

export function SettingsModal({
	isOpen,
	onClose,
	subtitleFormat,
	onFormatChange,
	closeTabsEnabled,
	onToggleCloseTabs,
	onOpenHistory,
}: SettingsModalProps) {
	// Handle escape key
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape" && isOpen) {
				onClose();
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [isOpen, onClose]);

	if (!isOpen) return null;

	return (
		<div className="fixed inset-0 z-50 flex">
			{/* Backdrop */}
			<div className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity" onClick={onClose} />

			{/* Panel */}
			<div
				className="relative w-full max-w-md h-full glass-heavy border-l border-white/10 shadow-2xl
                   flex flex-col animate-in slide-in-from-right-4 duration-300"
				onClick={(e) => e.stopPropagation()}
			>
				{/* Header */}
				<div className="flex items-center justify-between p-4 border-b border-white/10 shrink-0">
					<h2 className="text-lg font-semibold text-glass-primary">Settings</h2>
					<button
						onClick={onClose}
						className="p-2 rounded-lg glass-hover text-glass-secondary hover:text-glass-primary transition-colors"
						aria-label="Close"
					>
						<X className="w-5 h-5" />
					</button>
				</div>

				{/* Content */}
				<div className="flex-1 overflow-y-auto p-4 space-y-6">
					{/* Subtitle Format Section */}
					<SubtitleFormatSelector format={subtitleFormat} onChange={onFormatChange} />

					{/* Divider */}
					<div className="border-t border-white/10" />

					{/* Extraction History Section */}
					<div>
						<button
							onClick={() => {
								onClose();
								onOpenHistory();
							}}
							className="flex items-center justify-between w-full p-3 rounded-xl glass-medium border border-white/5 hover:bg-white/5 transition-all group"
						>
							<div className="flex items-center gap-3">
								<Clock className="w-5 h-5 text-glass-muted" />
								<span className="text-glass-secondary">Extraction History</span>
							</div>
							<ChevronRight className="w-5 h-5 text-glass-muted group-hover:text-glass-secondary transition-colors" />
						</button>
					</div>

					{/* Divider */}
					<div className="border-t border-white/10" />

					{/* Close Tabs Toggle Section */}
					<div>
						<Toggle enabled={closeTabsEnabled} onChange={onToggleCloseTabs} label="Close tabs after extraction" />
						<p className="text-xs text-glass-muted mt-2 ml-1">
							Automatically close tabs after successfully extracting their content
						</p>
					</div>
				</div>
			</div>
		</div>
	);
}
