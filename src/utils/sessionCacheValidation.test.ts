/**
 * Characterization test for bug 1.16: the useTabs hook's chrome.storage.session
 * listener was using `Date.now() - newValue.timestamp < CACHE_TTL` to decide
 * whether to replace the loaded groups. A corrupted payload with
 * `timestamp: Number.MAX_SAFE_INTEGER` and an empty `data` array would
 * silently clobber the UI.
 */
import { describe, expect, it } from "vitest";
import { CACHE_TTL_MS, isCachedTabsPayloadValid } from "./sessionCacheValidation";

const validPayload = {
	data: [{ domain: "example.com", tabs: [] }],
	timestamp: Date.now(),
};

describe("isCachedTabsPayloadValid (bug 1.16: payload validation)", () => {
	it("accepts a fresh, well-formed payload", () => {
		expect(isCachedTabsPayloadValid(validPayload)).toBe(true);
	});

	it("rejects null / non-object payloads", () => {
		// biome-ignore lint/suspicious/noExplicitAny: testing
		expect(isCachedTabsPayloadValid(null as any)).toBe(false);
		// biome-ignore lint/suspicious/noExplicitAny: testing
		expect(isCachedTabsPayloadValid("string" as any)).toBe(false);
		// biome-ignore lint/suspicious/noExplicitAny: testing
		expect(isCachedTabsPayloadValid(42 as any)).toBe(false);
	});

	it("rejects a missing or non-array data field", () => {
		expect(isCachedTabsPayloadValid({ data: "nope", timestamp: Date.now() })).toBe(false);
		expect(isCachedTabsPayloadValid({ timestamp: Date.now() })).toBe(false);
	});

	it("rejects a non-numeric timestamp", () => {
		expect(isCachedTabsPayloadValid({ data: [], timestamp: "now" })).toBe(false);
	});

	it("rejects Number.MAX_SAFE_INTEGER timestamp (the bug)", () => {
		// The old code only checked `Date.now() - newValue.timestamp < CACHE_TTL`.
		// With timestamp = MAX_SAFE_INTEGER, the diff is a huge negative number,
		// which is `< CACHE_TTL`, so the payload was accepted.
		const corrupted = { data: [], timestamp: Number.MAX_SAFE_INTEGER };
		expect(isCachedTabsPayloadValid(corrupted)).toBe(false);
	});

	it("rejects Infinity or NaN timestamps", () => {
		expect(isCachedTabsPayloadValid({ data: [], timestamp: Number.POSITIVE_INFINITY })).toBe(false);
		expect(isCachedTabsPayloadValid({ data: [], timestamp: Number.NaN })).toBe(false);
	});

	it("rejects a payload older than CACHE_TTL", () => {
		const old = { data: [], timestamp: Date.now() - (CACHE_TTL_MS + 1) };
		expect(isCachedTabsPayloadValid(old)).toBe(false);
	});

	it("rejects groups missing the domain string or tabs array", () => {
		const bad = { data: [{ tabs: [] }], timestamp: Date.now() };
		expect(isCachedTabsPayloadValid(bad)).toBe(false);
		const bad2 = { data: [{ domain: "x" }], timestamp: Date.now() };
		expect(isCachedTabsPayloadValid(bad2)).toBe(false);
	});
});

// DI-4: filterValidGroups drops corrupt group elements (and tabs) but
// keeps the rest. The previous shape check only validated the root
// array; a payload like `[{ domain: "x", tabs: [null, valid] }]` would
// be applied as-is and crash downstream consumers.
describe("filterValidGroups (DI-4: element shape validation)", () => {
	it("drops a corrupt group element but keeps the rest", async () => {
		const { filterValidGroups } = await import("./sessionCacheValidation");
		const groups = filterValidGroups([
			null,
			{ domain: "x.com", tabs: [] },
			{ domain: "y.com", tabs: [{ id: 1, url: "u", title: "t" }] },
			{ domain: 42, tabs: [] }, // domain is not a string
		]);
		expect(groups).toHaveLength(2);
		expect(groups[0].domain).toBe("x.com");
		expect(groups[1].domain).toBe("y.com");
	});

	it("drops corrupt tabs from an otherwise-valid group", async () => {
		const { filterValidGroups } = await import("./sessionCacheValidation");
		const groups = filterValidGroups([
			{
				domain: "x.com",
				tabs: [
					null,
					{ id: 1, url: "https://x.com/a", title: "A" },
					{ id: "1", url: "https://x.com/b" }, // missing title, id is string
				],
			},
		]);
		expect(groups).toHaveLength(1);
		expect(groups[0].tabs).toHaveLength(1);
		expect(groups[0].tabs[0].title).toBe("A");
	});
});
