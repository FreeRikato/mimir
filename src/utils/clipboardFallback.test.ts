/**
 * Characterization test for bug 1.7: `safeWriteToClipboard` and the focus
 * event handler can desync. The module-level `pendingClipboardData` and
 * the React state `pendingClipboardContent` are set / cleared in different
 * code paths and on different timings, so a focus event that fires after
 * the panel is dismissed can clear one without clearing the other.
 *
 * Contract under test:
 *   - The fallback controller exposes a single `pending` channel: setting
 *     and clearing the pending data is symmetric.
 *   - On a successful retry, the pending data is cleared.
 *   - On a retry that fails because the document is not focused, the
 *     pending data is preserved (the user can still hit "Copy Now").
 *   - On a retry that fails for a non-focus reason, the pending data is
 *     cleared (silent failure must not leave stale data).
 *   - The controller is independent per-instance (multiple panels / mounts).
 */
import { describe, expect, it, vi } from "vitest";
import { createClipboardFallback } from "./clipboardFallback";

describe("createClipboardFallback (bug 1.7: focus desync)", () => {
	it("starts with no pending data", () => {
		const fb = createClipboardFallback<string>();
		expect(fb.peek()).toBeNull();
		expect(fb.hasPending()).toBe(false);
	});

	it("setPending and clearPending stay symmetric", () => {
		const fb = createClipboardFallback<string>();
		fb.setPending("hello");
		expect(fb.peek()).toBe("hello");
		expect(fb.hasPending()).toBe(true);
		fb.clearPending();
		expect(fb.peek()).toBeNull();
		expect(fb.hasPending()).toBe(false);
	});

	it("retry: clears pending on success", async () => {
		const fb = createClipboardFallback<string>();
		const write = vi.fn().mockResolvedValue(undefined);
		const hasFocus = vi.fn().mockReturnValue(true);
		fb.setPending("hello");
		const result = await fb.tryRetry({ hasFocus, write });
		expect(result).toBe("copied");
		expect(write).toHaveBeenCalledWith("hello");
		expect(fb.peek()).toBeNull();
	});

	it("retry: preserves pending when document is not focused", async () => {
		const fb = createClipboardFallback<string>();
		const write = vi.fn().mockResolvedValue(undefined);
		const hasFocus = vi.fn().mockReturnValue(false);
		fb.setPending("hello");
		const result = await fb.tryRetry({ hasFocus, write });
		expect(result).toBe("requires_manual_copy");
		expect(write).not.toHaveBeenCalled();
		expect(fb.peek()).toBe("hello");
	});

	it("retry: clears pending on a non-focus write error (no silent stale data)", async () => {
		const fb = createClipboardFallback<string>();
		const write = vi.fn().mockRejectedValue(new Error("clipboard backend gone"));
		const hasFocus = vi.fn().mockReturnValue(true);
		fb.setPending("hello");
		const result = await fb.tryRetry({ hasFocus, write });
		expect(result).toBe("failed");
		expect(fb.peek()).toBeNull();
	});

	it("retry: classifies focus error (NotAllowedError) as requires_manual_copy and preserves pending", async () => {
		const fb = createClipboardFallback<string>();
		const focusErr = Object.assign(new Error("Document is not focused"), { name: "NotAllowedError" });
		const write = vi.fn().mockRejectedValue(focusErr);
		const hasFocus = vi.fn().mockReturnValue(true); // chrome check passes but browser disagrees
		fb.setPending("hello");
		const result = await fb.tryRetry({ hasFocus, write });
		expect(result).toBe("requires_manual_copy");
		expect(fb.peek()).toBe("hello");
	});

	it("two instances are independent", () => {
		const a = createClipboardFallback<string>();
		const b = createClipboardFallback<string>();
		a.setPending("A");
		b.setPending("B");
		a.clearPending();
		expect(a.peek()).toBeNull();
		expect(b.peek()).toBe("B");
	});
});
