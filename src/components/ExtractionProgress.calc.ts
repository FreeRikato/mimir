/**
 * Pure ETA / format helpers extracted from `ExtractionProgress.tsx`.
 *
 * Bug 1.21 (formatETA may render negative or Infinity values):
 *   `formatETA(etaMs)` computed `avgTimePerTab = elapsed / totalProcessed`,
 *   which is `Infinity` when `totalProcessed === 0` and `negative` if the
 *   startTime is in the future (clock skew). The display would show
 *   "ETA: NaN" or "ETA: -30s". The new helper guards explicitly.
 */
export interface EtaInput {
	now: number;
	startTime: number;
	totalProcessed: number;
	remaining: number;
}

export function computeEtaMs(input: EtaInput): number {
	const { now, startTime, totalProcessed, remaining } = input;
	if (totalProcessed <= 0) return 0;
	const elapsed = now - startTime;
	if (elapsed <= 0) return 0;
	const avg = elapsed / totalProcessed;
	if (!Number.isFinite(avg) || avg < 0) return 0;
	return Math.max(0, avg * remaining);
}

const ONE_SECOND_MS = 1000;
const ONE_MINUTE_S = 60;

export function formatEta(etaMs: number, totalProcessed: number): string {
	if (totalProcessed < 2) return "";
	if (!Number.isFinite(etaMs) || etaMs < ONE_SECOND_MS) return "";
	const seconds = Math.ceil(etaMs / ONE_SECOND_MS);
	if (seconds < ONE_MINUTE_S) return `~${seconds}s remaining`;
	const minutes = Math.ceil(seconds / ONE_MINUTE_S);
	return `~${minutes}m remaining`;
}
