/**
 * Race-free status resetter for the three extraction handlers in
 * `SidePanelApp`.
 *
 * Bug: each handler schedules `setTimeout(() => setStatus("idle"), 2000)`
 * in the success branch. The closure only checked `isMountedRef`, not
 * whether a NEW extraction had started. A user who finishes one run
 * and starts another within 2s sees the second run's status
 * ("extracting") flipped to "idle" mid-run.
 *
 * Fix: this helper hands the caller a monotonically incrementing seq.
 * The caller captures the seq in the schedule() call and again in the
 * delayed callback. The callback only acts (sets idle) if the captured
 * seq still matches the latest seq returned by schedule().
 *
 *   const resetter = createStatusResetter();
 *   const result = resetter.schedule(2000);
 *   setTimeout(() => {
 *     if (resetter.isLatest(result.seq)) {
 *       setExtractionStatus("idle");
 *     }
 *   }, 2000);
 *
 * `cancel()` discards any pending transition (e.g. on error or
 * partial-result branches where the success-branch timer should not
 * fire).
 */
export interface ScheduleResult {
	readonly seq: number;
}

export interface StatusResetter {
	/**
	 * Schedule a delayed transition. Returns a `{ seq }` token the
	 * caller captures in the timeout closure and compares against
	 * `isLatest()`.
	 */
	schedule(delayMs: number): ScheduleResult;
	/**
	 * Returns true if `seq` matches the most recent `schedule()` call.
	 * The delayed callback uses this to suppress stale transitions.
	 */
	isLatest(seq: number): boolean;
	/**
	 * Discard any pending transition. The current seq is bumped, so
	 * any in-flight `setTimeout` whose closure still holds the
	 * old seq will see `isLatest(old) === false` and bail.
	 */
	cancel(): void;
	/**
	 * Most recent seq. Useful for tests and for advanced callers that
	 * want to invalidate without a fresh `schedule()`.
	 */
	latestSeq(): number;
}

export function createStatusResetter(): StatusResetter {
	let seq = 0;
	return {
		schedule: (_delayMs: number) => {
			seq += 1;
			return { seq };
		},
		isLatest: (s: number) => s === seq,
		cancel: () => {
			seq += 1;
		},
		latestSeq: () => seq,
	};
}
