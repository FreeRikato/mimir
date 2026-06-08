/**
 * Characterization test for bug 1.23: KEYBOARD_COMMAND listener in
 * SidePanelApp called handleExtract() etc. directly. If the user
 * double-tapped the keyboard shortcut, two extractions started in
 * parallel; the first one's AbortController was silently overwritten by
 * the second, so it could no longer be cancelled.
 *
 * The fix uses a single-flight guard so a second trigger during an
 * in-flight extraction is dropped (or reported back to the user).
 */
import { describe, expect, it } from "vitest";
import { createSingleFlight } from "./singleFlight";

describe("createSingleFlight (bug 1.23: drop concurrent extractions)", () => {
	it("starts not busy", () => {
		const sf = createSingleFlight();
		expect(sf.isBusy()).toBe(false);
	});

	it("tryStart returns true on first call, false on the second", () => {
		const sf = createSingleFlight();
		expect(sf.tryStart()).toBe(true);
		expect(sf.isBusy()).toBe(true);
		expect(sf.tryStart()).toBe(false);
	});

	it("finish() releases the slot so a subsequent tryStart succeeds", () => {
		const sf = createSingleFlight();
		expect(sf.tryStart()).toBe(true);
		sf.finish();
		expect(sf.isBusy()).toBe(false);
		expect(sf.tryStart()).toBe(true);
	});

	it("simulates a double-tap keyboard shortcut: only the first is allowed in", () => {
		const sf = createSingleFlight();
		const allowed: number[] = [];
		const taps = [0, 1, 2];
		for (const t of taps) {
			if (sf.tryStart()) allowed.push(t);
		}
		// Only the first tap should have entered the critical section.
		expect(allowed).toEqual([0]);
		// When the first extraction finishes, a later tap is allowed.
		sf.finish();
		expect(sf.tryStart()).toBe(true);
	});
});
