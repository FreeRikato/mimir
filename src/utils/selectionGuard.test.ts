import { describe, expect, it } from "vitest";
import { createSelectionGuard } from "./selectionGuard";

describe("createSelectionGuard (RC-3: clearSelection racy against highlight extraction)", () => {
	it("a fresh snapshot clears iff the closed tabs overlap and selection is unchanged", () => {
		const g = createSelectionGuard();
		const sel = new Set([1, 2, 3]);
		const snap = g.captureSnapshot(sel);
		expect(g.shouldClear(snap, [1, 2], sel)).toBe(true);
	});

	it("returns false when no closed tab is in the captured selection", () => {
		const g = createSelectionGuard();
		const sel = new Set([1, 2, 3]);
		const snap = g.captureSnapshot(sel);
		// SW closed tabs that the user did NOT select.
		expect(g.shouldClear(snap, [99, 100], sel)).toBe(false);
	});

	it("returns false after markMutated() bumps the seq", () => {
		const g = createSelectionGuard();
		const sel = new Set([1, 2, 3]);
		const snap = g.captureSnapshot(sel);
		g.markMutated();
		expect(g.shouldClear(snap, [1], sel)).toBe(false);
	});

	it("returns false if the user's current selection diverges from the snapshot", () => {
		const g = createSelectionGuard();
		const sel = new Set([1, 2, 3]);
		const snap = g.captureSnapshot(sel);
		// The user toggled a tab.
		const newSel = new Set([1, 2, 3, 4]);
		expect(g.shouldClear(snap, [1], newSel)).toBe(false);
	});

	it("multiple in-flight snapshots: only the latest one stays valid", () => {
		const g = createSelectionGuard();
		const selA = new Set([1]);
		const a = g.captureSnapshot(selA);
		const selB = new Set([2]);
		const b = g.captureSnapshot(selB);
		expect(g.shouldClear(a, [1], selA)).toBe(false);
		expect(g.shouldClear(b, [2], selB)).toBe(true);
	});

	it("a snapshot captured AFTER markMutated is fresh again", () => {
		const g = createSelectionGuard();
		const selA = new Set([1]);
		const a = g.captureSnapshot(selA);
		g.markMutated();
		const selB = new Set([2]);
		const b = g.captureSnapshot(selB);
		expect(g.shouldClear(a, [1], selA)).toBe(false);
		expect(g.shouldClear(b, [2], selB)).toBe(true);
	});

	it("currentSeq() reports the current generation", () => {
		const g = createSelectionGuard();
		const before = g.currentSeq();
		const snap = g.captureSnapshot(new Set([1]));
		expect(g.currentSeq()).toBe(snap.seq);
		expect(g.currentSeq()).toBeGreaterThan(before);
	});
});
