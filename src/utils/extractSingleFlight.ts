/**
 * Shared single-flight guard for the three extraction handlers in
 * `SidePanelApp` (handleExtract / handleExtractToRight /
 * handleExtractHighlighted).
 *
 * Bug 1.23 wired `createSingleFlight()` only into the KEYBOARD_COMMAND
 * listener. The three Footer buttons called the handlers directly, so a
 * click that raced with a keyboard tap (or two rapid clicks) launched two
 * extractions in parallel, with the second one's AbortController
 * overwriting the first.
 *
 * This helper is the single source of truth. Both the Footer and the
 * keyboard listener funnel their click/command through it, so the bus
 * state is identical regardless of which surface the user used.
 *
 * `tryRun` invokes the handler synchronously (so the caller can rely on
 * `isBusy()` returning true right after) and releases the slot once the
 * returned promise settles, including on rejection. The caller can use
 * the `{ok,reason}` return to surface a "busy" toast without awaiting.
 */
export interface ExtractSingleFlight {
	/**
	 * Try to start an extraction. If another extraction is already in
	 * flight, returns `{ ok: false, reason: "busy" }` and does NOT call
	 * `handler`. The caller can use `reason` to surface a toast.
	 */
	tryRun(handler: () => Promise<void>): { ok: true } | { ok: false; reason: "busy" };
	/**
	 * True while a handler is in flight (between `tryRun` returning
	 * `{ok:true}` and the handler settling).
	 */
	isBusy(): boolean;
}

export function createExtractSingleFlight(): ExtractSingleFlight {
	let busy = false;
	return {
		tryRun: (handler) => {
			if (busy) {
				return { ok: false, reason: "busy" };
			}
			busy = true;
			// Invoke the handler synchronously so callers that check
			// isBusy() right after tryRun see the busy state. Release
			// the slot on settle, swallowing rejections - the handler
			// is responsible for surfacing its own errors via the SW
			// response (and any unhandled rejection there would
			// crash the SW regardless).
			try {
				const promise = handler();
				if (promise && typeof (promise as Promise<void>).then === "function") {
					promise
						.catch(() => {})
						.finally(() => {
							busy = false;
						});
				} else {
					busy = false;
				}
			} catch {
				busy = false;
			}
			return { ok: true };
		},
		isBusy: () => busy,
	};
}
