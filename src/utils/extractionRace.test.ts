/**
 * Integration test: simulates the SidePanelApp's three extraction
 * handlers sharing a single-flight guard, an abort registry, a
 * status-resetter seq, and a selection guard. Models the exact
 * scenario the user reported in RC-1 / RC-2 / RC-3 / RC-7.
 */
import { describe, expect, it, vi } from "vitest";
import { createAbortControllerRegistry } from "./abortControllerRegistry";
import { createExtractSingleFlight } from "./extractSingleFlight";
import { createSelectionGuard } from "./selectionGuard";
import { createStatusResetter } from "./statusResetter";

describe("extraction race integration (RC-1/2/3/7)", () => {
	it("Footer onClick racing with KEYBOARD_COMMAND: only one run executes", async () => {
		const sf = createExtractSingleFlight();
		const seen: string[] = [];
		const handler = async (label: string) => {
			seen.push(label);
		};
		const r1 = sf.tryRun(() => handler("click"));
		const r2 = sf.tryRun(() => handler("keyboard"));
		expect(r1).toEqual({ ok: true });
		expect(r2).toEqual({ ok: false, reason: "busy" });
		await new Promise((r) => setTimeout(r, 0));
		expect(seen).toEqual(["click"]);
	});

	it("status reset seq is monotonic; a stale seq from run A does not act in run B's timer", () => {
		const r = createStatusResetter();
		const a = r.schedule(2000);
		const b = r.schedule(2000);
		// Capture the seq at schedule time, then advance past the
		// delay. The stale timer would call isLatest(a.seq) - which
		// is now false - so it bails.
		expect(r.isLatest(a.seq)).toBe(false);
		expect(r.isLatest(b.seq)).toBe(true);
	});

	it("abort registry: a cancel issued during run A kills A and the next run is fresh", () => {
		const reg = createAbortControllerRegistry();
		const a = reg.begin();
		const onAbortA = vi.fn();
		a.signal.addEventListener("abort", onAbortA);
		reg.abort();
		expect(a.signal.aborted).toBe(true);
		expect(onAbortA).toHaveBeenCalledTimes(1);
		const b = reg.begin();
		// a was already aborted; b is fresh
		expect(b.signal.aborted).toBe(false);
		expect(reg.current()).toBe(b);
	});

	it("selection guard: toggling a tab mid-run invalidates the snapshot", () => {
		const g = createSelectionGuard();
		const sel = new Set([1, 2, 3]);
		const snap = g.captureSnapshot(sel);
		// User toggles a tab mid-run.
		g.markMutated();
		// SW finishes and asks whether to clear; the snapshot is
		// stale, so the answer is "no" - the user's new selection
		// is preserved.
		expect(g.shouldClear(snap, [1, 2, 3], sel)).toBe(false);
	});

	it("end-to-end: keyboard -> footer click races; the right run wins; the cancel is targeted", async () => {
		// Two extractions compete. extractSingleFlight drops the
		// loser. The registry's cancel then targets the winner.
		const sf = createExtractSingleFlight();
		const reg = createAbortControllerRegistry();

		// Keyboard starts the first run.
		const kbd = sf.tryRun(async () => {
			reg.begin();
			// Simulate a long async.
			await new Promise((r) => setTimeout(r, 50));
		});
		expect(kbd.ok).toBe(true);
		// Footer click is dropped while the keyboard run is in flight.
		const click = sf.tryRun(async () => {
			reg.begin();
		});
		expect(click.ok).toBe(false);

		// Cancel the keyboard run.
		const ctrl = reg.current();
		expect(ctrl).not.toBeNull();
		reg.abort();
		expect(ctrl?.signal.aborted).toBe(true);

		// Wait for the keyboard handler to settle.
		await new Promise((r) => setTimeout(r, 100));
		expect(sf.isBusy()).toBe(false);
	});
});
