/**
 * Display-side decision for the ExtractionErrorAlert retry button.
 *
 * Bug 1.20: clearHealthCheckCache was exported but unused. The "retry"
 * toast in ExtractionErrorAlert should call it for backend errors. This
 * helper decides when the retry button should be visible.
 */
import type { ExtractionErrorInfo } from "../types";

export function shouldShowBackendRetry(errors: ExtractionErrorInfo[]): boolean {
	return errors.some(
		(e) => e.errorCode === "NETWORK_ERROR" || e.errorCode === "SERVER_ERROR" || e.errorCode === "TIMEOUT",
	);
}
