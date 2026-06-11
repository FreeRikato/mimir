/**
 * Characterization test for: extract-tabs-to-right hangs on a tab whose
 * `chrome.scripting.executeScript` never resolves (e.g. a connection-refused
 * page that Chrome has not finished rendering, or a tab whose renderer is
 * stuck). The MV3 `chrome.scripting.executeScript` API does not honor an
 * AbortSignal directly, so the 15s `AbortSignal.timeout` built in
 * `extractTabsConcurrent` is a no-op. The worker chain blocks forever on the
 * `await executeScript(...)`.
 *
 * The fix: a `cancellableExecuteScript` helper that races the real
 * `executeScript` Promise against (a) the caller's AbortSignal and (b) a
 * hard timeout. On timeout, it rejects with a `ScriptingTimeoutError` so the
 * worker can record a TIMEOUT error and move on.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface ScriptingStub {
	scripting: {
		executeScript: ReturnType<typeof vi.fn>;
	};
}

const scriptingStub: ScriptingStub = {
	scripting: {
		executeScript: vi.fn(),
	},
};

beforeEach(() => {
	(globalThis as unknown as { chrome: ScriptingStub }).chrome = scriptingStub;
	vi.mocked(scriptingStub.scripting.executeScript).mockReset();
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});

async function loadModule() {
	vi.resetModules();
	const mod = await import("./cancellableScripting");
	return mod;
}

describe("cancellableExecuteScript", () => {
	it("resolves with the executeScript result when it returns in time", async () => {
		vi.mocked(scriptingStub.scripting.executeScript).mockResolvedValue([{ result: "hello" }]);
		const { cancellableExecuteScript } = await loadModule();
		const out = await cancellableExecuteScript({ target: { tabId: 1 }, func: () => "hi" }, { timeoutMs: 1000 });
		expect(out).toEqual([{ result: "hello" }]);
	});

	it("rejects with ScriptingTimeoutError when executeScript never resolves", async () => {
		// executeScript that never resolves — simulates a stuck renderer.
		vi.mocked(scriptingStub.scripting.executeScript).mockReturnValue(new Promise(() => {}));
		const { cancellableExecuteScript, ScriptingTimeoutError } = await loadModule();

		// 50ms ceiling — keep the test fast.
		await expect(
			cancellableExecuteScript({ target: { tabId: 1 }, func: () => "x" }, { timeoutMs: 50 }),
		).rejects.toBeInstanceOf(ScriptingTimeoutError);
	});

	it("propagates an AbortError immediately when the caller's signal is already aborted", async () => {
		vi.mocked(scriptingStub.scripting.executeScript).mockReturnValue(new Promise(() => {}));
		const { cancellableExecuteScript } = await loadModule();
		const controller = new AbortController();
		controller.abort();
		await expect(
			cancellableExecuteScript(
				{ target: { tabId: 1 }, func: () => "x" },
				{ timeoutMs: 5000, signal: controller.signal },
			),
		).rejects.toMatchObject({ name: "AbortError" });
	});

	it("aborts when the caller's signal fires after the call has started", async () => {
		vi.mocked(scriptingStub.scripting.executeScript).mockReturnValue(new Promise(() => {}));
		const { cancellableExecuteScript } = await loadModule();
		const controller = new AbortController();
		const promise = cancellableExecuteScript(
			{ target: { tabId: 1 }, func: () => "x" },
			{ timeoutMs: 5000, signal: controller.signal },
		);
		setTimeout(() => controller.abort(), 20);
		await expect(promise).rejects.toMatchObject({ name: "AbortError" });
	});

	it("propagates the underlying error when executeScript rejects", async () => {
		vi.mocked(scriptingStub.scripting.executeScript).mockRejectedValue(new Error("frame not loaded"));
		const { cancellableExecuteScript } = await loadModule();
		await expect(
			cancellableExecuteScript({ target: { tabId: 1 }, func: () => "x" }, { timeoutMs: 1000 }),
		).rejects.toThrow("frame not loaded");
	});
});

// MEM-1: when the hard timeout fires, the wrapper now invokes an optional
// onTimeout hook with the tabId hint so the caller can apply a soft-kill
// (e.g. chrome.tabs.discard) to clear the dangling MV3 executeScript from
// Chrome's internal queue. The hook is a fire-and-forget callback; the
// Promise still rejects with ScriptingTimeoutError.
describe("cancellableExecuteScript (MEM-1: onTimeout soft-kill hook)", () => {
	it("invokes onTimeout(tabId) when the timeout fires", async () => {
		vi.mocked(scriptingStub.scripting.executeScript).mockReturnValue(new Promise(() => {}));
		const { cancellableExecuteScript, ScriptingTimeoutError } = await loadModule();
		const onTimeout = vi.fn();
		const promise = cancellableExecuteScript({ target: { tabId: 42 }, func: () => "x" }, { timeoutMs: 30, onTimeout });
		await expect(promise).rejects.toBeInstanceOf(ScriptingTimeoutError);
		expect(onTimeout).toHaveBeenCalledTimes(1);
		expect(onTimeout).toHaveBeenCalledWith(42);
	});

	it("does not invoke onTimeout when the underlying call resolves in time", async () => {
		vi.mocked(scriptingStub.scripting.executeScript).mockResolvedValue([{ result: "ok" }]);
		const { cancellableExecuteScript } = await loadModule();
		const onTimeout = vi.fn();
		await cancellableExecuteScript({ target: { tabId: 1 }, func: () => "x" }, { timeoutMs: 1000, onTimeout });
		expect(onTimeout).not.toHaveBeenCalled();
	});

	it("does not invoke onTimeout when the caller's AbortSignal fires first", async () => {
		vi.mocked(scriptingStub.scripting.executeScript).mockReturnValue(new Promise(() => {}));
		const { cancellableExecuteScript } = await loadModule();
		const onTimeout = vi.fn();
		const controller = new AbortController();
		const promise = cancellableExecuteScript(
			{ target: { tabId: 1 }, func: () => "x" },
			{ timeoutMs: 5000, signal: controller.signal, onTimeout },
		);
		setTimeout(() => controller.abort(), 20);
		await expect(promise).rejects.toMatchObject({ name: "AbortError" });
		expect(onTimeout).not.toHaveBeenCalled();
	});

	it("swallows a rejection from onTimeout so the wrapper still rejects with ScriptingTimeoutError", async () => {
		vi.mocked(scriptingStub.scripting.executeScript).mockReturnValue(new Promise(() => {}));
		const { cancellableExecuteScript, ScriptingTimeoutError } = await loadModule();
		const onTimeout = vi.fn(() => {
			throw new Error("discard blew up");
		});
		const promise = cancellableExecuteScript({ target: { tabId: 7 }, func: () => "x" }, { timeoutMs: 30, onTimeout });
		await expect(promise).rejects.toBeInstanceOf(ScriptingTimeoutError);
		expect(onTimeout).toHaveBeenCalledTimes(1);
	});
});
