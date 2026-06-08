/**
 * Characterization test for bug 1.1: the catch-all branch in
 * `chrome.runtime.onMessage.addListener` was calling
 * `sendResponse({ status: "received" })` synchronously without `return true`.
 * In MV3 the message channel closes after the listener returns, so any
 * caller awaiting a response got nothing. Worse, future message types added
 * without `return true` would silently fail.
 *
 * Contract under test:
 *   - Known async types (FETCH_SUBTITLES, FETCH_PDF_BYTES, EXTRACT_PDF) keep
 *     returning `true` so the channel stays open for async sendResponse.
 *   - The catch-all for unknown types does NOT call sendResponse. It only
 *     logs. (No `return true` needed because no async work is pending.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MessageCallback = (
	message: { type: string; [k: string]: unknown },
	sender: unknown,
	sendResponse: (response?: unknown) => void,
) => boolean | undefined;

let registeredCallback: MessageCallback | null = null;

beforeEach(() => {
	registeredCallback = null;
	// Minimal chrome.runtime stub. The background module captures the
	// listener in module scope, so we install the stub BEFORE the import.
	(globalThis as unknown as { chrome: unknown }).chrome = {
		runtime: {
			onMessage: {
				addListener: (cb: MessageCallback) => {
					registeredCallback = cb;
				},
			},
			onInstalled: {
				addListener: vi.fn(),
			},
			sendMessage: vi.fn().mockResolvedValue(undefined),
			lastError: undefined,
		},
		sidePanel: {
			setPanelBehavior: vi.fn(),
		},
		commands: {
			onCommand: {
				addListener: vi.fn(),
			},
		},
	};
	// Reset module cache so the listener is re-registered against our stub.
	vi.resetModules();
});

afterEach(() => {
	(globalThis as unknown as { chrome?: unknown }).chrome = undefined;
});

describe("background message listener", () => {
	it("captures a listener on module load", async () => {
		await import("./index");
		expect(registeredCallback).not.toBeNull();
	});

	it("returns true for FETCH_SUBTITLES so the channel stays open for async sendResponse", async () => {
		await import("./index");
		const sendResponse = vi.fn();
		// Simulate the start of a fetch: returns true immediately and sends
		// the response later via .then. We only assert the return value.
		const ret = registeredCallback?.({ type: "FETCH_SUBTITLES", url: "http://x", format: "json" }, null, sendResponse);
		expect(ret).toBe(true);
	});

	it("returns true for FETCH_PDF_BYTES", async () => {
		await import("./index");
		const sendResponse = vi.fn();
		const ret = registeredCallback?.({ type: "FETCH_PDF_BYTES", url: "http://x" }, null, sendResponse);
		expect(ret).toBe(true);
	});

	it("returns true for EXTRACT_PDF", async () => {
		await import("./index");
		const sendResponse = vi.fn();
		const ret = registeredCallback?.(
			{ type: "EXTRACT_PDF", url: "http://x", apiUrl: "http://api/y" },
			null,
			sendResponse,
		);
		expect(ret).toBe(true);
	});

	it("does NOT call sendResponse synchronously for unknown message types", async () => {
		// Bug 1.1: the catch-all used to call sendResponse({ status: "received" })
		// without return true. That can race with the channel closing and
		// produces a misleading ack. The fix: log only, no sendResponse.
		await import("./index");
		const sendResponse = vi.fn();
		const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
		const ret = registeredCallback?.({ type: "SOMETHING_NEW_FROM_THE_FUTURE", payload: 1 }, null, sendResponse);
		expect(ret).toBeUndefined();
		expect(sendResponse).not.toHaveBeenCalled();
		expect(consoleLog).toHaveBeenCalled();
		consoleLog.mockRestore();
	});
});
