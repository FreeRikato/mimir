/**
 * Pure helper extracted from `indexeddb.ts`'s search domain filter.
 *
 * Bug 1.10 (indexeddb search does case-insensitive domain filter but only in
 * entry-level domains): the search filter compares query domains against
 * `entry.domains`, but those domains are computed from `item.url.hostname`
 * at write time. If a history entry was saved before a URL had a hostname
 * change (e.g. a redirect), the filter can miss matches.
 *
 * The fix also matches against each entry's data items' URL hostnames, so
 * stale or missing domain metadata is still recoverable from the URLs.
 */
import type { HistoryEntry } from "../types";

/** Lowercase the host of a URL or return null if the URL is invalid. */
export function hostFromUrl(url: string): string | null {
	try {
		return new URL(url).hostname.toLowerCase() || null;
	} catch {
		return null;
	}
}

/** Whether an entry matches the search domains. Matches entry.domains first,
 *  then falls back to item.url hostname. */
export function entryMatchesDomains(entry: HistoryEntry, queryDomains: string[]): boolean {
	if (queryDomains.length === 0) return true;
	const searchDomains = new Set(queryDomains.map((d) => d.toLowerCase()));
	if (entry.domains.some((d) => searchDomains.has(d.toLowerCase()))) return true;
	// Fallback: also match against each item's URL hostname so a stale
	// `entry.domains` doesn't cause a miss.
	for (const item of entry.data) {
		const host = hostFromUrl(item.url);
		if (host && searchDomains.has(host)) return true;
	}
	return false;
}
