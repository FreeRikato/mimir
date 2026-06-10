import { describe, expect, it, vi } from "vitest";
import { createExtractSingleFlight } from "./extractSingleFlight";

describe("createExtractSingleFlight (RC-1: shared by Footer + keyboard)", () => {
	it("runs the first handler and reports busy while in flight", async () => {
		const sf = createExtractSingleFlight();
		const handler = vi.fn(async () => {});
		const result = sf.tryRun(handler);
		expect(result).toEqual({ ok: true });
		expect(handler).toHaveBeenCalledTimes(1);
		expect(sf.isBusy()).toBe(true);
		// Let the in-flight handler settle so we can call isBusy() safely.
		await Promise.resolve();
	});

	it("drops a second concurrent call while the first is in flight", async () => {
		const sf = createExtractSingleFlight();
		let resolveFirst!: () => void;
		const first = vi.fn(
			() =>
				new Promise<void>((r) => {
					resolveFirst = r;
				}),
		);
		const second = vi.fn(async () => {});

		expect(sf.tryRun(first)).toEqual({ ok: true });
		const secondResult = sf.tryRun(second);
		expect(secondResult).toEqual({ ok: false, reason: "busy" });
		expect(second).not.toHaveBeenCalled();
		expect(sf.isBusy()).toBe(true);

		resolveFirst();
		await Promise.resolve();
	});

	it("finishes the in-flight run automatically when the handler resolves", async () => {
		const sf = createExtractSingleFlight();
		(await sf.tryRun(async () => {})) as unknown; // cast: ok-true is fine
		// After the microtask queue drains, the run should be complete.
		await new Promise((r) => setTimeout(r, 0));
		expect(sf.isBusy()).toBe(false);
	});

	it("finishes even if the handler rejects", async () => {
		const sf = createExtractSingleFlight();
		const result = sf.tryRun(async () => {
			throw new Error("boom");
		});
		expect(result).toEqual({ ok: true });
		await new Promise((r) => setTimeout(r, 0));
		expect(sf.isBusy()).toBe(false);
	});

	it("allows a new run after the previous one finishes", async () => {
		const sf = createExtractSingleFlight();
		await sf.tryRun(async () => {});
		await new Promise((r) => setTimeout(r, 0));
		expect(sf.tryRun(async () => {})).toEqual({ ok: true });
	});
});
