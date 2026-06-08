/**
 * Characterization tests for bug 1.3: when a tab navigates to a new URL but
 * keeps the same tabId, the cache entry's stored URL no longer matches the
 * live tab. The old behavior returned the stale text and title; the new
 * behavior must return invalid so callers re-extract.
 */
import { describe, expect, it } from "vitest";
import { CONTENT_CACHE_TTL_MS, type ContentCacheEntry, isContentCacheValid } from "./cacheContent";

const baseEntry: ContentCacheEntry = {
	text: "hello",
	title: "Example",
	url: "https://example.com/post-1",
	timestamp: Date.now(),
	size: 100,
	accessCount: 1,
	lastAccess: Date.now(),
};

describe("isContentCacheValid (bug 1.3: invalidate on URL change)", () => {
	it("returns true when the URL matches and TTL is fresh", () => {
		expect(isContentCacheValid(baseEntry, "https://example.com/post-1")).toBe(true);
	});

	it("returns false when the tab navigated to a different URL", () => {
		expect(isContentCacheValid(baseEntry, "https://example.com/post-2")).toBe(false);
	});

	it("returns false when the tab navigated to a different host", () => {
		expect(isContentCacheValid(baseEntry, "https://other.com/post-1")).toBe(false);
	});

	it("returns false when the cache entry is older than the TTL", () => {
		const stale: ContentCacheEntry = {
			...baseEntry,
			timestamp: Date.now() - (CONTENT_CACHE_TTL_MS + 1),
		};
		expect(isContentCacheValid(stale, "https://example.com/post-1")).toBe(false);
	});

	it("returns false when the current URL is empty (defensive default)", () => {
		expect(isContentCacheValid(baseEntry, "")).toBe(false);
	});
});
