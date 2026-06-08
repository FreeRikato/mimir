/**
 * Characterization test for bug 1.10: the IndexedDB history search used
 * `entry.domains` (set at write time) for the domain filter. If a history
 * entry was saved before a URL hostname change (e.g., a redirect), the
 * filter could miss matches. The new helper falls back to the URL
 * hostnames of each item in the entry.
 */
import { describe, expect, it } from "vitest";
import type { ExtractedData, HistoryEntry } from "../types";
import { entryMatchesDomains } from "./domainFilter";

function entry(urls: string[], entryDomains: string[] = []): HistoryEntry {
	const data: ExtractedData[] = urls.map((u, i) => ({
		id: i,
		title: `t${i}`,
		url: u,
		timestamp: "2024-01-01T00:00:00.000Z",
		text: "x",
	}));
	return {
		id: "e1",
		timestamp: 0,
		format: "json",
		exportType: "clipboard",
		tabCount: urls.length,
		domains: entryDomains,
		data,
		dataSize: 0,
	};
}

describe("entryMatchesDomains (bug 1.10: fall back to URL hostnames)", () => {
	it("matches when entry.domains already contains the query domain", () => {
		const e = entry(["https://example.com/a"], ["example.com"]);
		expect(entryMatchesDomains(e, ["example.com"])).toBe(true);
	});

	it("matches when the entry's stored domains are stale but item URLs are fresh", () => {
		// entry.domains is missing 'example.com' but the item URL is still that host.
		const e = entry(["https://example.com/a"], []);
		expect(entryMatchesDomains(e, ["example.com"])).toBe(true);
	});

	it("matches case-insensitively on both sides", () => {
		const e = entry(["https://Example.COM/a"], []);
		expect(entryMatchesDomains(e, ["example.com"])).toBe(true);
	});

	it("does not match when neither entry.domains nor item URLs contain the query", () => {
		const e = entry(["https://other.com/a"], ["other.com"]);
		expect(entryMatchesDomains(e, ["example.com"])).toBe(false);
	});

	it("treats an empty query as match-all", () => {
		const e = entry(["https://x.com/"], []);
		expect(entryMatchesDomains(e, [])).toBe(true);
	});

	it("skips invalid item URLs gracefully", () => {
		const e = entry(["not a url", "https://example.com/valid"], []);
		expect(entryMatchesDomains(e, ["example.com"])).toBe(true);
	});
});
