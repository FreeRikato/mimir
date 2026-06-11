/**
 * Pure validation for cached tab-group data read from chrome.storage.session.
 *
 * Bug 1.16: the listener in useTabs was using
 *   `Date.now() - newValue.timestamp < CACHE_TTL`
 * to decide whether to replace the loaded groups. A corrupted payload with
 *   `timestamp: Number.MAX_SAFE_INTEGER` and an empty `data` array
 * would pass that check (`Date.now() - 9e15` is a huge negative number,
 * which is `< CACHE_TTL`) and silently clobber the UI.
 *
 * The new validator also rejects any timestamp that is non-finite, negative,
 * or in the future, and requires the payload shape to match `DomainGroup[]`.
 */
import type { DomainGroup } from "../types";

export const CACHE_TTL_MS = 30_000;

export interface CachedTabsPayload {
	data: DomainGroup[];
	timestamp: number;
}

export function isCachedTabsPayloadValid(value: unknown, now: number = Date.now()): value is CachedTabsPayload {
	if (!value || typeof value !== "object") return false;
	const v = value as { data?: unknown; timestamp?: unknown };
	if (!Array.isArray(v.data)) return false;
	if (typeof v.timestamp !== "number") return false;
	if (!Number.isFinite(v.timestamp)) return false;
	if (v.timestamp < 0) return false;
	if (v.timestamp > now) return false; // clock skew or attacker-controlled
	if (now - v.timestamp > CACHE_TTL_MS) return false;
	for (const g of v.data) {
		if (!g || typeof g !== "object") return false;
		const group = g as { domain?: unknown; tabs?: unknown };
		if (typeof group.domain !== "string") return false;
		if (!Array.isArray(group.tabs)) return false;
	}
	return true;
}

/**
 * DI-4: filter a DomainGroup array to drop entries that don't match the
 * expected element shape. A payload that has a valid root but a corrupt
 * element (e.g. `tabs: [null]`) used to be applied as-is and crashed
 * downstream consumers. The strict root validation in
 * `isCachedTabsPayloadValid` only catches malformed groups, not
 * individual tab entries inside an otherwise-valid group.
 */
export function isChromeTabShape(value: unknown): value is import("../types").ChromeTab {
	if (!value || typeof value !== "object") return false;
	const t = value as { id?: unknown; url?: unknown; title?: unknown };
	return typeof t.id === "number" && typeof t.url === "string" && typeof t.title === "string";
}

export function filterValidGroups(groups: readonly unknown[]): DomainGroup[] {
	const out: DomainGroup[] = [];
	for (const g of groups) {
		if (!g || typeof g !== "object") continue;
		const group = g as { domain?: unknown; tabs?: unknown };
		if (typeof group.domain !== "string") continue;
		if (!Array.isArray(group.tabs)) continue;
		const tabs = group.tabs.filter(isChromeTabShape);
		// Drop the group entirely if every tab is corrupt — empty groups
		// are still valid (a user with no matching tabs) so we keep them.
		out.push({ domain: group.domain, tabs });
	}
	return out;
}
