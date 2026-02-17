import { AlertCircle, X } from "lucide-react";
import type { ExtractionErrorInfo } from "../types";

interface ExtractionErrorAlertProps {
	errors: ExtractionErrorInfo[];
	onDismiss: () => void;
}

export function ExtractionErrorAlert({ errors, onDismiss }: ExtractionErrorAlertProps) {
	if (errors.length === 0) return null;

	const isYouTubeError = (error: ExtractionErrorInfo): boolean =>
		error.url.includes("youtube.com") || error.url.includes("youtu.be");
	const hasYouTubeNoTranscriptErrors = errors.some((e) => isYouTubeError(e) && e.errorCode === "NO_SUBTITLES");
	const hasYouTubeBackendErrors = errors.some(
		(e) => isYouTubeError(e) && (e.errorCode === "NETWORK_ERROR" || e.errorCode === "SERVER_ERROR"),
	);
	const hasPdfAccessErrors = errors.some((e) => e.errorCode === "PDF_ACCESS_DENIED");
	const hasPdfUnsupportedErrors = errors.some((e) => e.errorCode === "PDF_UNSUPPORTED");
	const hasPdfTooLargeErrors = errors.some((e) => e.errorCode === "PDF_TOO_LARGE");
	const hasPdfOcrErrors = errors.some((e) => e.errorCode === "OCR_UNAVAILABLE");

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

			{hasYouTubeNoTranscriptErrors && (
				<p className="text-xs text-glass-muted mb-2">
					No transcript found for the requested language for one or more YouTube videos.
				</p>
			)}

			{hasYouTubeBackendErrors && (
				<p className="text-xs text-glass-muted mb-2">
					Backend server may be down. Ensure the subtitle service is configured correctly.
				</p>
			)}

			{hasPdfAccessErrors && (
				<p className="text-xs text-glass-muted mb-2">
					Local PDF access failed. Enable "Allow access to file URLs" for this extension in chrome://extensions.
				</p>
			)}

			{hasPdfUnsupportedErrors && (
				<p className="text-xs text-glass-muted mb-2">
					One or more PDFs could not be parsed by the backend extraction pipeline.
				</p>
			)}

			{hasPdfTooLargeErrors && (
				<p className="text-xs text-glass-muted mb-2">
					One or more PDFs exceeded the configured backend size/page limits.
				</p>
			)}

			{hasPdfOcrErrors && (
				<p className="text-xs text-glass-muted mb-2">
					OCR fallback is currently unavailable. Try again after backend OCR service recovery.
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
