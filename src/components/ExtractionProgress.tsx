import { AlertTriangle, CheckCircle, Loader2, X, XCircle } from "lucide-react";
import type { ExtractionProgress } from "../types";
import { computeEtaMs, formatEta } from "./ExtractionProgress.calc";

interface ExtractionProgressProps {
	progress: ExtractionProgress;
	onCancel: () => void;
}

export function ExtractionProgressDisplay({ progress, onCancel }: ExtractionProgressProps) {
	const { total, completed, failed, currentTabTitle, startTime, isCancelled } = progress;
	const totalProcessed = completed + failed;
	const percentComplete = total > 0 ? (totalProcessed / total) * 100 : 0;

	// Bug 1.21: ETA logic moved to ExtractionProgress.calc so it can be
	// unit-tested. The previous inline code produced "ETA: NaN" or
	// "ETA: -30s" for boundary cases (startTime in the future, totalProcessed
	// === 0). The new helper guards explicitly.
	const etaMs = computeEtaMs({
		now: Date.now(),
		startTime,
		totalProcessed,
		remaining: total - totalProcessed,
	});

	// Cancelled state styling
	if (isCancelled) {
		return (
			<div className="glass-heavy border border-yellow-500/30 rounded-lg p-3 mb-3">
				<div className="flex items-center justify-between mb-2">
					<div className="flex items-center gap-2 text-yellow-300">
						<AlertTriangle className="w-4 h-4" />
						<span className="text-sm font-medium">Cancelled</span>
					</div>
				</div>

				{/* Progress Bar (frozen) */}
				<div className="w-full h-2 bg-black/50 rounded-full overflow-hidden mb-2">
					<div
						className="h-full bg-gradient-to-r from-yellow-400 to-orange-400 transition-all duration-300 ease-out"
						style={{ width: `${percentComplete}%` }}
					/>
				</div>

				{/* Status indicators */}
				<div className="flex items-center justify-between text-xs">
					<div className="flex items-center gap-3">
						<span className="flex items-center gap-1 text-green-400">
							<CheckCircle className="w-3 h-3" /> {completed}
						</span>
						{failed > 0 && (
							<span className="flex items-center gap-1 text-red-400">
								<XCircle className="w-3 h-3" /> {failed}
							</span>
						)}
					</div>
					<span className="text-glass-muted">
						{totalProcessed} of {total} processed
					</span>
				</div>
			</div>
		);
	}

	return (
		<div className="glass-heavy border border-teal-500/30 rounded-lg p-3 mb-3">
			<div className="flex items-center justify-between mb-2">
				<div className="flex items-center gap-2 text-teal-300">
					<Loader2 className="w-4 h-4 animate-spin" />
					<span className="text-sm font-medium">
						Extracting... {totalProcessed}/{total}
					</span>
				</div>
				<button
					onClick={onCancel}
					className="text-glass-muted hover:text-white transition-colors"
					title="Cancel extraction"
				>
					<X className="w-4 h-4" />
				</button>
			</div>

			{/* Progress Bar */}
			<div className="w-full h-2 bg-black/50 rounded-full overflow-hidden mb-2">
				<div
					className="h-full bg-gradient-to-r from-teal-400 to-cyan-400 transition-all duration-300 ease-out"
					style={{ width: `${percentComplete}%` }}
				/>
			</div>

			{/* Status indicators */}
			<div className="flex items-center justify-between text-xs">
				<div className="flex items-center gap-3">
					<span className="flex items-center gap-1 text-green-400">
						<CheckCircle className="w-3 h-3" /> {completed}
					</span>
					{failed > 0 && (
						<span className="flex items-center gap-1 text-red-400">
							<XCircle className="w-3 h-3" /> {failed}
						</span>
					)}
				</div>
				{formatEta(etaMs, totalProcessed) && (
					<span className="text-glass-muted">{formatEta(etaMs, totalProcessed)}</span>
				)}
			</div>

			{currentTabTitle && (
				<div className="mt-2 text-xs text-glass-muted truncate" title={currentTabTitle}>
					{currentTabTitle}
				</div>
			)}
		</div>
	);
}
