import {
	AlertCircle,
	AlertTriangle,
	ArrowRight,
	CheckCircle,
	Copy,
	Highlighter,
	Loader2,
	RefreshCw,
	Settings,
	X,
} from "lucide-react";
import { useState } from "react";
import type { ExtractionErrorInfo, ExtractionStatus } from "../types";

interface FooterProps {
	selectedCount: number;
	isExtracting: boolean;
	isRefreshing: boolean;
	extractionStatus: ExtractionStatus;
	extractionErrors: ExtractionErrorInfo[];
	onExtract: () => void;
	onRefresh: () => void;
	onCancel: () => void;
	// Tabs to right props
	tabsToRightCount: number;
	onExtractToRight: () => void;
	isExtractingToRight: boolean;
	toRightExtractionStatus: ExtractionStatus;
	toRightExtractionErrors: ExtractionErrorInfo[];
	// Highlighted tabs props
	highlightedCount: number;
	onExtractHighlighted: () => void;
	isExtractingHighlighted: boolean;
	highlightedExtractionStatus: ExtractionStatus;
	highlightedExtractionErrors: ExtractionErrorInfo[];
	// Settings props
	onOpenSettings: () => void;
}

export function Footer({
	selectedCount,
	isExtracting,
	isRefreshing,
	extractionStatus,
	extractionErrors: _extractionErrors,
	onExtract,
	onRefresh,
	onCancel,
	// Tabs to right props
	tabsToRightCount,
	onExtractToRight,
	isExtractingToRight,
	toRightExtractionStatus,
	toRightExtractionErrors: _toRightExtractionErrors,
	// Highlighted tabs props
	highlightedCount,
	onExtractHighlighted,
	isExtractingHighlighted,
	highlightedExtractionStatus,
	highlightedExtractionErrors: _highlightedExtractionErrors,
	// Settings props
	onOpenSettings,
}: FooterProps) {
	// UX-3: brief pressed highlight on click. Tracks which button was last
	// pressed; auto-clears after 50ms so a double-click still produces a
	// visible pulse.
	const [pressedButton, setPressedButton] = useState<"right" | "highlighted" | "copy" | null>(null);
	const flash = (key: "right" | "highlighted" | "copy") => {
		setPressedButton(key);
		setTimeout(() => setPressedButton((prev) => (prev === key ? null : prev)), 50);
	};

	const isExtractDisabled = selectedCount === 0 || isExtracting || isExtractingToRight || isExtractingHighlighted;
	const showCancel = selectedCount > 0 && !isExtracting && !isExtractingToRight && !isExtractingHighlighted;
	const isExtractToRightDisabled =
		tabsToRightCount === 0 || isExtracting || isExtractingToRight || isExtractingHighlighted;
	const isExtractHighlightedDisabled =
		highlightedCount === 0 || isExtracting || isExtractingToRight || isExtractingHighlighted;

	const getButtonClassName = (
		isDisabled: boolean,
		status: ExtractionStatus,
		colorVariant: "orange" | "purple" | "teal",
	) => `
    flex-shrink-0 w-11 h-11 rounded-lg glass-hover glass-focus
    flex items-center justify-center
    transition-all duration-300 transform
    ${
			isDisabled
				? "glass-heavy text-glass-muted cursor-not-allowed"
				: status === "success"
					? `glass-${colorVariant} text-${colorVariant}-300 border border-${colorVariant}-500/30`
					: status === "partial"
						? "glass-amber text-amber-300 border border-amber-500/30"
						: status === "error"
							? "glass-red text-red-300 border border-red-500/30"
							: "glass-heavy text-white border border-white/10 hover:scale-[1.02]"
		}
  `;

	return (
		<div className="sticky bottom-0 z-10 glass-heavy px-4 py-3 border-t border-white/8">
			<div className="flex items-center justify-center gap-2">
				{/* Refresh Button */}
				<button
					onClick={onRefresh}
					disabled={isRefreshing}
					className="flex-shrink-0 w-11 h-11 rounded-lg glass-hover glass-focus text-glass-secondary hover:text-glass-primary disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
					title="Refresh tabs"
				>
					<RefreshCw className={`w-5 h-5 ${isRefreshing ? "animate-spin" : ""}`} />
				</button>

				{/* Cancel Button (conditional) */}
				{showCancel && (
					<button
						onClick={onCancel}
						className="flex-shrink-0 w-11 h-11 rounded-lg glass-hover glass-focus text-red-400 hover:text-red-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
						title="Clear selection"
					>
						<X className="w-5 h-5" />
					</button>
				)}

				{/* Tabs to Right Button */}
				<div className="relative">
					{tabsToRightCount > 0 && (
						<span className="absolute -top-1 -right-1 min-w-[1.25rem] h-5 px-1 rounded-full glass-orange text-[10px] text-white border border-white/20 flex items-center justify-center">
							{tabsToRightCount}
						</span>
					)}
					<button
						onClick={onExtractToRight}
						disabled={isExtractToRightDisabled}
						className={`${getButtonClassName(isExtractToRightDisabled, toRightExtractionStatus, "orange")} ${pressedButton === "right" ? "ring-1 ring-white/30" : ""}`}
						title="Extract content from tabs to the right of current tab"
					>
						{isExtractingToRight ? (
							<Loader2 className="w-5 h-5 animate-spin" />
						) : toRightExtractionStatus === "success" ? (
							<CheckCircle className="w-5 h-5" />
						) : toRightExtractionStatus === "partial" ? (
							<AlertTriangle className="w-5 h-5" />
						) : toRightExtractionStatus === "error" ? (
							<AlertCircle className="w-5 h-5" />
						) : (
							<ArrowRight className="w-5 h-5" />
						)}
					</button>
				</div>

				{/* Highlighted Tabs Button */}
				<div className="relative">
					{highlightedCount > 0 && (
						<span className="absolute -top-1 -right-1 min-w-[1.25rem] h-5 px-1 rounded-full glass-pink text-[10px] text-white border border-white/20 flex items-center justify-center">
							{highlightedCount}
						</span>
					)}
					<button
						onClick={onExtractHighlighted}
						disabled={isExtractHighlightedDisabled}
						className={`${getButtonClassName(isExtractHighlightedDisabled, highlightedExtractionStatus, "purple")} ${pressedButton === "highlighted" ? "ring-1 ring-white/30" : ""}`}
						title="Extract content from tabs selected in Chrome's tab bar (Cmd+click / Shift+click)"
					>
						{isExtractingHighlighted ? (
							<Loader2 className="w-5 h-5 animate-spin" />
						) : highlightedExtractionStatus === "success" ? (
							<CheckCircle className="w-5 h-5" />
						) : highlightedExtractionStatus === "partial" ? (
							<AlertTriangle className="w-5 h-5" />
						) : highlightedExtractionStatus === "error" ? (
							<AlertCircle className="w-5 h-5" />
						) : (
							<Highlighter className="w-5 h-5" />
						)}
					</button>
				</div>

				{/* Copy Button */}
				<button
					onClick={() => {
						flash("copy");
						onExtract();
					}}
					disabled={isExtractDisabled}
					className={`${getButtonClassName(isExtractDisabled, extractionStatus, "teal")} ${pressedButton === "copy" ? "ring-1 ring-white/30" : ""}`}
					title={`Copy ${selectedCount} selected tab${selectedCount !== 1 ? "s" : ""} to clipboard`}
				>
					{isExtracting ? (
						<Loader2 className="w-5 h-5 animate-spin" />
					) : extractionStatus === "success" ? (
						<CheckCircle className="w-5 h-5" />
					) : extractionStatus === "partial" ? (
						<AlertTriangle className="w-5 h-5" />
					) : extractionStatus === "error" ? (
						<AlertCircle className="w-5 h-5" />
					) : (
						<Copy className="w-5 h-5" />
					)}
				</button>

				{/* Settings Button */}
				<button
					onClick={onOpenSettings}
					className="flex-shrink-0 w-11 h-11 rounded-lg glass-hover glass-focus text-glass-secondary hover:text-glass-primary flex items-center justify-center"
					title="Settings"
				>
					<Settings className="w-5 h-5" />
				</button>
			</div>
		</div>
	);
}
