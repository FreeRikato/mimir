import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStatusResetter } from "./statusResetter";

describe("createStatusResetter (RC-2: stale 2s status reset clobbers new extraction)", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("schedule returns a fresh seq each call, monotonically increasing", () => {
		const r = createStatusResetter();
		const a = r.schedule(2000);
		const b = r.schedule(2000);
		expect(a.seq).toBeLessThan(b.seq);
	});

	it("isLatest() returns true for the just-scheduled seq, false for older", () => {
		const r = createStatusResetter();
		const a = r.schedule(2000);
		const b = r.schedule(2000);
		expect(r.isLatest(a.seq)).toBe(false);
		expect(r.isLatest(b.seq)).toBe(true);
	});

	it("stale timer from run A is suppressed when run B schedules a new one", () => {
		const r = createStatusResetter();
		const a = r.schedule(2000);
		// 500ms later, run B starts.
		vi.advanceTimersByTime(500);
		const b = r.schedule(2000);
		expect(r.isLatest(a.seq)).toBe(false);
		expect(r.isLatest(b.seq)).toBe(true);
		// Advance past run A's nominal 2000ms. A's closure calls
		// isLatest(a.seq) which is now false, so the run-B
		// "extracting" status is preserved.
		vi.advanceTimersByTime(1500);
	});

	it("cancel() invalidates the pending seq so an in-flight timer bails", () => {
		const r = createStatusResetter();
		const a = r.schedule(2000);
		expect(r.isLatest(a.seq)).toBe(true);
		r.cancel();
		expect(r.isLatest(a.seq)).toBe(false);
		// A subsequent schedule returns a higher seq.
		const b = r.schedule(2000);
		expect(b.seq).toBeGreaterThan(a.seq);
	});

	it("does not throw when cancel() is called with no pending schedule", () => {
		const r = createStatusResetter();
		expect(() => r.cancel()).not.toThrow();
	});

	it("latestSeq() reports the most recent seq", () => {
		const r = createStatusResetter();
		expect(r.latestSeq()).toBe(0);
		const a = r.schedule(2000);
		expect(r.latestSeq()).toBe(a.seq);
		r.cancel();
		expect(r.latestSeq()).toBeGreaterThan(a.seq);
	});
});
