/**
 * Characterization test for bug 1.21: ExtractionProgress's formatETA
 * produced "ETA: NaN" or "ETA: -30s" for two boundary cases:
 *   - totalProcessed === 0 (start of extraction): `elapsed / 0 = Infinity`
 *   - clock skew: startTime is in the future, so `elapsed < 0`
 */
import { describe, expect, it } from "vitest";
import { computeEtaMs, formatEta } from "./ExtractionProgress.calc";

describe("computeEtaMs (bug 1.21: no NaN, no negatives)", () => {
	it("returns 0 when totalProcessed is 0 (Infinity guard)", () => {
		expect(computeEtaMs({ now: 1000, startTime: 0, totalProcessed: 0, remaining: 5 })).toBe(0);
	});

	it("returns 0 when startTime is in the future (clock skew)", () => {
		expect(computeEtaMs({ now: 1000, startTime: 5000, totalProcessed: 2, remaining: 3 })).toBe(0);
	});

	it("returns 0 when elapsed is zero (start of extraction)", () => {
		expect(computeEtaMs({ now: 1000, startTime: 1000, totalProcessed: 1, remaining: 5 })).toBe(0);
	});

	it("returns 0 when remaining is 0", () => {
		expect(computeEtaMs({ now: 2000, startTime: 0, totalProcessed: 5, remaining: 0 })).toBe(0);
	});

	it("computes the simple case", () => {
		// 2s elapsed, 2 processed, 4 remaining → 4s ETA.
		expect(computeEtaMs({ now: 2000, startTime: 0, totalProcessed: 2, remaining: 4 })).toBe(4000);
	});
});

describe("formatEta (bug 1.21: render guard)", () => {
	it("returns '' for totalProcessed < 2 (unstable estimate)", () => {
		expect(formatEta(5000, 1)).toBe("");
		expect(formatEta(5000, 0)).toBe("");
	});

	it("returns '' for etaMs below 1s", () => {
		expect(formatEta(500, 5)).toBe("");
	});

	it("returns '' for non-finite etaMs (Infinity/NaN)", () => {
		expect(formatEta(Number.POSITIVE_INFINITY, 5)).toBe("");
		expect(formatEta(Number.NaN, 5)).toBe("");
		expect(formatEta(-1000, 5)).toBe("");
	});

	it("formats seconds for etaMs < 60s", () => {
		expect(formatEta(5_000, 5)).toBe("~5s remaining");
		expect(formatEta(59_000, 5)).toBe("~59s remaining");
	});

	it("formats minutes for etaMs >= 60s", () => {
		expect(formatEta(60_000, 5)).toBe("~1m remaining");
		expect(formatEta(120_000, 5)).toBe("~2m remaining");
	});
});
