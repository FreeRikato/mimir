/**
 * Creates a promise that rejects after a specified timeout
 */
function createTimeoutPromise(timeoutMs: number, errorMessage = "Operation timed out"): Promise<never> {
	return new Promise((_, reject) => {
		setTimeout(() => {
			reject(new Error(errorMessage));
		}, timeoutMs);
	});
}

/**
 * Wraps a promise with a timeout. If the promise doesn't resolve within
 * the specified time, it rejects with a timeout error.
 *
 * @param promise - The promise to wrap
 * @param timeoutMs - Timeout in milliseconds
 * @param errorMessage - Optional custom error message
 * @returns A promise that resolves with the original result or rejects on timeout
 */
export async function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	errorMessage = `Operation timed out after ${timeoutMs}ms`,
): Promise<T> {
	return Promise.race([promise, createTimeoutPromise(timeoutMs, errorMessage)]);
}

/**
 * Extracts data from multiple tabs with a global timeout.
 * Unlike Promise.all with a timeout wrapper, this preserves partial results
 * when the timeout is reached.
 *
 * @param tabIds - Array of tab IDs to extract
 * @param extractFn - Function to extract a single tab
 * @param timeoutMs - Global timeout in milliseconds
 * @param onTimeout - Callback when timeout occurs
 * @returns Results array and errors array
 */
export async function extractWithTimeout<T, E>(
	items: T[],
	extractFn: (item: T, index: number) => Promise<{ data: unknown; error?: E }>,
	timeoutMs: number,
	onTimeout?: (remaining: number) => void,
): Promise<{ results: unknown[]; errors: E[]; timedOut: boolean }> {
	const results: unknown[] = [];
	const errors: E[] = [];
	const startTime = Date.now();
	let timedOut = false;

	for (let i = 0; i < items.length; i++) {
		// Check timeout before each extraction
		if (Date.now() - startTime > timeoutMs) {
			timedOut = true;
			const remaining = items.length - i;
			onTimeout?.(remaining);
			break;
		}

		try {
			const result = await extractFn(items[i], i);
			if (result.error) {
				errors.push(result.error);
			} else {
				results.push(result.data);
			}
		} catch (err) {
			// Individual extraction failed, continue with next tab
			console.error(`Extraction failed for item at index ${i}:`, err);
		}
	}

	return { results, errors, timedOut };
}
