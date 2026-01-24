import { AlertCircle, X } from "lucide-react";
import type { ExtractionErrorInfo } from "../types";

interface ExtractionErrorAlertProps {
	errors: ExtractionErrorInfo[];
	onDismiss: () => void;
}

export function ExtractionErrorAlert({ errors, onDismiss }: ExtractionErrorAlertProps) {
	if (errors.length === 0) return null;

	const hasYouTubeErrors = errors.some((e) => e.url.includes("youtube.com"));

	return (
		<div className="glass-heavy border border-red-500/30 rounded-lg p-3 mb-3">
			<div className="flex items-center justify-between mb-2">
				<div className="flex items-center gap-2 text-red-300">
					<AlertCircle className="w-4 h-4" />
					<span className="text-sm font-medium">
						{errors.length} extraction error{errors.length > 1 ? "s" : ""}
					</span>
				</div>
				<button onClick={onDismiss} className="text-glass-muted hover:text-white">
					<X className="w-4 h-4" />
				</button>
			</div>

			{hasYouTubeErrors && (
				<p className="text-xs text-glass-muted mb-2">
					Backend server may be down. Ensure the subtitle service is configured correctly.
				</p>
			)}

			<ul className="text-xs space-y-1 text-glass-muted">
				{errors.slice(0, 3).map((err, i) => (
					<li key={i} className="flex gap-2">
						<span className="opacity-50">{i + 1}.</span>
						<span className="truncate flex-1" title={err.title}>
							{err.title}
						</span>
						<span className="text-red-400">- {err.userMessage}</span>
					</li>
				))}
				{errors.length > 3 && <li className="text-glass-muted italic">And {errors.length - 3} more...</li>}
			</ul>
		</div>
	);
}
