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
