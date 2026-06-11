/**
 * Cancellable wrapper around `chrome.scripting.executeScript`.
 *
 * Bug: "extract tabs to the right" hangs when one of the tabs in the queue
 * fails to load (e.g. `ERR_CONNECTION_REFUSED` mid-render, a suspended
 * renderer, or a tab in a Chrome state where `executeScript` never resolves).
 *
 * Why this exists: Chrome's MV3 `chrome.scripting.executeScript` API does not
 * accept an `AbortSignal`. The worker in `extractTabsConcurrent` builds a
 * per-tab `AbortSignal.timeout(NON_YOUTUBE_TAB_TIMEOUT = 15000)`, but the
 * signal was never plumbed into the call. A hung `executeScript` therefore
 * blocked the worker chain (and the outer `extractTabsConcurrent` Promise)
 * indefinitely, even though all sibling tabs were already extracted.
 *
 * The fix: race the `executeScript` Promise against the caller's signal and
 * a hard timeout. On timeout we reject with `ScriptingTimeoutError` so the
 * caller can record a `TIMEOUT` extraction error and the worker chain can
 * continue with the next tab.
 *
 * MEM-1 — soft-kill via onTimeout:
 *   The `Promise.race` below stops the *caller* from waiting, but the
 *   underlying `chrome.scripting.executeScript` call is still in flight
 *   inside Chrome's renderer. It will eventually settle, and the SW
 *   queue still holds the entry. Cancelling 20 extractions in quick
 *   succession leaves up to 20 dangling `executeScript` calls in the SW.
 *
 *   The fix: the wrapper exposes an optional `onTimeout(tabId)` hook
 *   that fires the moment the hard timeout trips, BEFORE the wrapper
 *   rejects with `ScriptingTimeoutError`. The caller can use that hook
 *   to apply a soft-kill (e.g. `chrome.tabs.discard(tabId)` from a
 *   different MV3 surface) which forces the renderer to tear down and
 *   unblocks the SW queue. `extractTabsConcurrent` wires the hook to
 *   `chrome.tabs.discard` gated on a `discardOnTimeout` flag — the
 *   call is destructive (the user loses in-page state on that tab) so
 *   it is OFF by default.
 *
 *   The hook is fire-and-forget. A throw inside the hook is swallowed
 *   so the wrapper still rejects with `ScriptingTimeoutError` and the
 *   worker can continue.
 */

export class ScriptingTimeoutError extends Error {
	readonly name = "ScriptingTimeoutError";
	readonly code = "SCRIPTING_TIMEOUT" as const;
	readonly timeoutMs: number;
	readonly tabId: number | undefined;

	constructor(timeoutMs: number, tabId: number | undefined) {
		super(`chrome.scripting.executeScript timed out after ${timeoutMs}ms`);
		this.timeoutMs = timeoutMs;
		this.tabId = tabId;
	}
}

export interface CancellableScriptingOptions {
	/** Hard ceiling in milliseconds. The Promise rejects with `ScriptingTimeoutError` past this. */
	timeoutMs: number;
	/** External AbortSignal — when fired, the Promise rejects with an `AbortError`. */
	signal?: AbortSignal;
	/**
	 * MEM-1: soft-kill hook fired when the hard timeout trips. Receives
	 * the tabId hint derived from `injection.target` (or `undefined` if
	 * the target has no tabId). The hook is fire-and-forget; any throw
	 * is swallowed so the wrapper still rejects with
	 * `ScriptingTimeoutError`. Use this to apply
	 * `chrome.tabs.discard(tabId)` or similar destructive cleanup
	 * against a renderer that the MV3 executeScript is wedged on.
	 */
	onTimeout?: (tabId: number | undefined) => void | Promise<void>;
}

type ExecuteScriptInjection = chrome.scripting.InjectionResult;

function getTabIdFromInjection(injection: ExecuteScriptInjection): number | undefined {
	const target = (injection as { frameId?: number }).frameId;
	void target;
	return undefined;
}

function isInjectionWithTabId(value: unknown): value is { tabId: number } {
	if (typeof value !== "object" || value === null) return false;
	const tabId = (value as { tabId?: unknown }).tabId;
	return typeof tabId === "number";
}

function readTabIdFromArgs(args: unknown): number | undefined {
	if (!Array.isArray(args)) return undefined;
	for (const arg of args) {
		if (isInjectionWithTabId(arg)) return arg.tabId;
	}
	return undefined;
}

/**
 * Race `chrome.scripting.executeScript(injection, ...rest)` against the
 * caller's signal and a hard timeout.
 *
 * Behavior:
 *   - If the underlying call rejects, the rejection is propagated verbatim.
 *   - If the caller's `signal` is already aborted, rejects with `AbortError`
 *     immediately.
 *   - If `signal` aborts mid-call, rejects with `AbortError` (Chrome will
 *     eventually settle the underlying call; we drop its result).
 *   - If `timeoutMs` elapses, rejects with `ScriptingTimeoutError`.
 */
// Overload: with options.
// The wrapper is transport-only — it forwards the injection verbatim to
// `chrome.scripting.executeScript`, which validates the shape at runtime.
// We deliberately type the parameter loosely (any object with a `target`)
// rather than reusing Chrome's `ScriptInjection` union, because that union
// pins `func` to either `() => R` or `(...a: A) => R` and rejects perfectly
// valid callers like `func: (tweetId: string) => unknown` (a 1-arg function
// is not assignable to `(...a: unknown[]) => unknown` for variance reasons).
type ScriptInjectionLike = {
	target: chrome.scripting.InjectionTarget;
	func?: (...args: never[]) => unknown;
	args?: readonly unknown[];
	world?: string;
	files?: readonly string[];
	injectImmediately?: boolean;
};
export function cancellableExecuteScript(
	injection: ScriptInjectionLike,
	options: CancellableScriptingOptions,
	...rest: unknown[]
): Promise<ExecuteScriptInjection[]>;
// Overload: without options (defaults applied internally).
export function cancellableExecuteScript(
	injection: ScriptInjectionLike,
	...rest: unknown[]
): Promise<ExecuteScriptInjection[]>;
export function cancellableExecuteScript(
	injection: ScriptInjectionLike,
	...rest: unknown[]
): Promise<ExecuteScriptInjection[]> {
	const options: CancellableScriptingOptions = (rest[0] && typeof rest[0] === "object"
		? (rest[0] as CancellableScriptingOptions)
		: undefined) ?? {
		timeoutMs: 15000,
	};
	const restArgs = (rest[0] && typeof rest[0] === "object" ? rest.slice(1) : rest) as unknown[];

	const { timeoutMs, signal: externalSignal, onTimeout } = options;
	const tabIdHint = readTabIdFromArgs([injection.target, ...restArgs]);

	// Honor pre-aborted signal without spinning up the race.
	if (externalSignal?.aborted) {
		return Promise.reject(new DOMException("Aborted", "AbortError"));
	}

	// We have to pass `injection` to the underlying call but the MV3 typings
	// do not allow a stray `signal` option, so we call it positionally.
	const underlying = (
		chrome.scripting.executeScript as unknown as (
			i: ScriptInjectionLike,
			...a: unknown[]
		) => Promise<ExecuteScriptInjection[]>
	)(injection, ...restArgs);

	// Build a timeout signal that we control — separate from the caller's
	// signal so a caller-supplied AbortController doesn't accidentally short-
	// circuit a per-call timeout.
	const timeoutController = new AbortController();
	const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);

	// Tear down the timer + external listener on whichever settles first.
	const cleanup = () => {
		clearTimeout(timeoutId);
		if (externalSignal) {
			externalSignal.removeEventListener("abort", onExternalAbort);
		}
	};

	const onExternalAbort = () => {
		cleanup();
		// We can't actually cancel the MV3 executeScript call, but we can stop
		// waiting for it. The underlying Promise will eventually settle; we
		// ignore its resolution.
	};

	if (externalSignal) {
		externalSignal.addEventListener("abort", onExternalAbort, { once: true });
	}

	return new Promise<ExecuteScriptInjection[]>((resolve, reject) => {
		// External abort — only meaningful if the underlying call is still
		// pending. We can't cancel MV3's executeScript; we just race the
		// signal against it.
		const externalAbortPromise = externalSignal
			? new Promise<never>((_, rejectAbort) => {
					if (externalSignal.aborted) {
						rejectAbort(new DOMException("Aborted", "AbortError"));
						return;
					}
					externalSignal.addEventListener("abort", () => rejectAbort(new DOMException("Aborted", "AbortError")), {
						once: true,
					});
				})
			: new Promise<never>(() => {});

		const timeoutPromise = new Promise<never>((_, rejectTimeout) => {
			timeoutController.signal.addEventListener(
				"abort",
				() => {
					// MEM-1: fire the soft-kill hook before rejecting. The
					// hook is fire-and-forget; we don't await it so the
					// wrapper still rejects synchronously with the timeout
					// error. A throw from the hook is captured so it cannot
					// escape via the addEventListener handler.
					if (onTimeout) {
						try {
							const result = onTimeout(tabIdHint);
							if (result && typeof (result as Promise<void>).catch === "function") {
								(result as Promise<void>).catch(() => {});
							}
						} catch {
							// Swallow — soft-kill failures must not change the
							// rejection that the caller observes.
						}
					}
					rejectTimeout(new ScriptingTimeoutError(timeoutMs, tabIdHint));
				},
				{ once: true },
			);
		});

		Promise.race([underlying, externalAbortPromise, timeoutPromise])
			.then((value) => {
				cleanup();
				resolve(value as ExecuteScriptInjection[]);
			})
			.catch((err: unknown) => {
				cleanup();
				reject(err);
			});
	});
}

// Re-export the type of the injection for callers that want to spell it out.
export type ScriptInjection<TArgs extends unknown[], R = unknown> = chrome.scripting.ScriptInjection<TArgs, R>;

// Suppress the unused helper — kept for symmetry / future debugging.
void getTabIdFromInjection;
