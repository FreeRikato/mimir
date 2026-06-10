import { describe, expect, it, vi } from "vitest";
import { createAbortControllerRegistry } from "./abortControllerRegistry";

describe("createAbortControllerRegistry (RC-7: AbortController re-creation in concurrent handler)", () => {
	it("current() is null initially", () => {
		const r = createAbortControllerRegistry();
		expect(r.current()).toBeNull();
	});

	it("begin() installs a fresh controller and returns it", () => {
		const r = createAbortControllerRegistry();
		const c = r.begin();
		expect(c).toBeInstanceOf(AbortController);
		expect(r.current()).toBe(c);
	});

	it("begin() aborts the previous controller so a stale run cannot continue", () => {
		const r = createAbortControllerRegistry();
		const first = r.begin();
		const onAbort = vi.fn();
		first.signal.addEventListener("abort", onAbort);
		const second = r.begin();
		expect(first.signal.aborted).toBe(true);
		expect(onAbort).toHaveBeenCalledTimes(1);
		expect(r.current()).toBe(second);
	});

	it("abort() aborts the current controller and leaves the slot populated", () => {
		const r = createAbortControllerRegistry();
		const c = r.begin();
		r.abort();
		expect(c.signal.aborted).toBe(true);
		// The cancel-button binding still sees the controller (so
		// the "Cancelled" UI can read isCancelled off its progress).
		// clear() is what removes it.
		expect(r.current()).toBe(c);
	});

	it("clear() removes the current controller; current() is null", () => {
		const r = createAbortControllerRegistry();
		r.begin();
		r.clear();
		expect(r.current()).toBeNull();
	});

	it("begin() after clear() installs a fresh, non-aborted controller", () => {
		const r = createAbortControllerRegistry();
		const c1 = r.begin();
		c1.abort();
		r.clear();
		const c2 = r.begin();
		expect(c2.signal.aborted).toBe(false);
	});

	it("abort() with no current controller is a safe no-op", () => {
		const r = createAbortControllerRegistry();
		expect(() => r.abort()).not.toThrow();
	});

	it("simulates the reported scenario: extract right -> cancel -> extract highlighted kills the right run", () => {
		const r = createAbortControllerRegistry();
		const extractRight = r.begin();
		// User hits cancel (in real life this is the button click).
		r.abort();
		// Now user starts extract highlighted.
		const extractHighlighted = r.begin();
		// The right run was aborted by begin() and remains aborted.
		expect(extractRight.signal.aborted).toBe(true);
		// The highlighted run is the current one and is not aborted.
		expect(extractHighlighted.signal.aborted).toBe(false);
		expect(r.current()).toBe(extractHighlighted);
	});
});
