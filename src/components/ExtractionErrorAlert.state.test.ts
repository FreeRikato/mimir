/**
 * Characterization test for bug 1.5: ExtractionErrorAlert truncates to 3
 * visible errors with "and N more" but provides no way to inspect the rest.
 *
 * The fix introduces an expand/collapse toggle. The pure logic lives in
 * `computeErrorAlertRenderModel`; this test pins its behavior.
 */
import { describe, expect, it } from "vitest";
import type { ExtractionErrorInfo } from "../types";
import { computeErrorAlertRenderModel } from "./ExtractionErrorAlert.state";

const sampleErrors: ExtractionErrorInfo[] = Array.from({ length: 7 }, (_, i) => ({
	tabId: i + 1,
	url: `https://example.com/${i}`,
	title: `Title ${i}`,
	errorCode: "NETWORK_ERROR",
	userMessage: `msg ${i}`,
}));

describe("computeErrorAlertRenderModel (bug 1.5: expand/collapse)", () => {
	it("shows all errors when there are 3 or fewer, and no expand button", () => {
		const m = computeErrorAlertRenderModel(sampleErrors.slice(0, 3), false);
		expect(m.visible.length).toBe(3);
		expect(m.hiddenCount).toBe(0);
		expect(m.canExpand).toBe(false);
	});

	it("truncates to 3 with hidden count when collapsed and there are > 3 errors", () => {
		const m = computeErrorAlertRenderModel(sampleErrors, false);
		expect(m.visible.length).toBe(3);
		expect(m.hiddenCount).toBe(4);
		expect(m.canExpand).toBe(true);
	});

	it("shows all errors when expanded", () => {
		const m = computeErrorAlertRenderModel(sampleErrors, true);
		expect(m.visible.length).toBe(7);
		expect(m.hiddenCount).toBe(0);
		expect(m.canExpand).toBe(false);
	});

	it("returns an empty list for empty input", () => {
		const m = computeErrorAlertRenderModel([], false);
		expect(m.visible).toEqual([]);
		expect(m.hiddenCount).toBe(0);
		expect(m.canExpand).toBe(false);
	});
});
