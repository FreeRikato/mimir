/**
 * Characterization test for bug 1.6: subtitle format / language "save" effect
 * clobbers storage on first mount because the save effect runs immediately
 * with the default state, racing the load effect.
 *
 * Contract under test:
 *   - `createLoadedGuard()` returns a guard whose `save()` is a no-op until
 *     `markLoaded()` has been called. This prevents the default state from
 *     being written to storage before the stored value is read.
 *   - Once `markLoaded()` is called, subsequent `save()` calls invoke the
 *     underlying writer.
 *   - The guard is independent per-instance (format and language don't
 *     interfere).
 */
import { describe, expect, it, vi } from "vitest";
import { createLoadedGuard } from "./persistedSetting";

describe("createLoadedGuard (bug 1.6: skip first-mount save)", () => {
	it("save() is a no-op before markLoaded()", async () => {
		const write = vi.fn().mockResolvedValue(undefined);
		const guard = createLoadedGuard();
		await guard.save("json", write);
		expect(write).not.toHaveBeenCalled();
	});

	it("save() invokes the writer after markLoaded()", async () => {
		const write = vi.fn().mockResolvedValue(undefined);
		const guard = createLoadedGuard();
		guard.markLoaded();
		await guard.save("vtt", write);
		expect(write).toHaveBeenCalledWith("vtt");
	});

	it("the first save after markLoaded is the loaded value (no extra writes before that)", async () => {
		const write = vi.fn().mockResolvedValue(undefined);
		const guard = createLoadedGuard();

		// Simulate React's first-render effect sequence:
		//   1. Save effect runs with default state.
		//   2. Load effect starts, reads "vtt", calls markLoaded.
		//   3. State change triggers save effect with "vtt".
		await guard.save("json", write); // (1) — should be skipped
		expect(write).not.toHaveBeenCalled();

		const loaded = "vtt";
		guard.markLoaded(); // (2)
		await guard.save(loaded, write); // (3) — should write
		expect(write).toHaveBeenCalledTimes(1);
		expect(write).toHaveBeenCalledWith("vtt");
	});

	it("guards are independent per-instance", async () => {
		const writeA = vi.fn().mockResolvedValue(undefined);
		const writeB = vi.fn().mockResolvedValue(undefined);
		const format = createLoadedGuard();
		const language = createLoadedGuard();

		format.markLoaded();
		// language NOT marked loaded
		await format.save("vtt", writeA);
		await language.save("en", writeB);
		expect(writeA).toHaveBeenCalledWith("vtt");
		expect(writeB).not.toHaveBeenCalled();
	});

	it("save() propagates errors from the writer after markLoaded", async () => {
		const err = new Error("storage full");
		const write = vi.fn().mockRejectedValue(err);
		const guard = createLoadedGuard();
		guard.markLoaded();
		await expect(guard.save("vtt", write)).rejects.toThrow("storage full");
	});
});
