/**
 * Characterization test for bug 1.9: the four chrome.tabs.* listeners
 * (onMoved, onActivated, onCreated, onRemoved) each triggered an immediate
 * chrome.tabs.query. Opening 20 tabs in a second = 20 queries. The fix
 * adds a debouncer so the listeners coalesce into a single query.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDebouncer } from "./debounce";

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("createDebouncer (bug 1.9: coalesce tab events)", () => {
	it("runs the callback once after the delay even when scheduled 5 times", () => {
		const deb = createDebouncer(500);
		const fn = vi.fn();
		deb.schedule(fn);
		deb.schedule(fn);
		deb.schedule(fn);
		deb.schedule(fn);
		deb.schedule(fn);
		vi.advanceTimersByTime(499);
		expect(fn).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("cancel() drops the pending callback", () => {
		const deb = createDebouncer(500);
		const fn = vi.fn();
		deb.schedule(fn);
		deb.cancel();
		vi.advanceTimersByTime(1000);
		expect(fn).not.toHaveBeenCalled();
	});

	it("flush() runs the pending callback immediately", () => {
		const deb = createDebouncer(500);
		const fn = vi.fn();
		deb.schedule(fn);
		deb.flush();
		expect(fn).toHaveBeenCalledTimes(1);
		// After flush, no pending timer.
		vi.advanceTimersByTime(1000);
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("uses the LAST scheduled function when called multiple times before delay elapses", () => {
		const deb = createDebouncer(100);
		const a = vi.fn();
		const b = vi.fn();
		deb.schedule(a);
		deb.schedule(b);
		vi.advanceTimersByTime(100);
		expect(a).not.toHaveBeenCalled();
		expect(b).toHaveBeenCalledTimes(1);
	});
});
