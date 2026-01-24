import type { ChromeTab, DomainGroup } from "../types";

const groupTabsCache = new Map<string, DomainGroup[]>();

/**
 * Extracts the domain from a URL, stripping 'www.' prefix
 */
export function extractDomain(url: string): string {
	try {
		const hostname = new URL(url).hostname;
		return hostname.replace(/^www\./, "");
	} catch {
		return "unknown";
	}
}

/**
 * Groups an array of tabs by their domain
 * Returns an alphabetically sorted array of DomainGroup objects
 */
export function groupTabs(tabs: ChromeTab[]): DomainGroup[] {
	const cacheKey = tabs
		.map((t) => `${t.id}:${t.url}`)
		.sort()
		.join("|");

	if (groupTabsCache.has(cacheKey)) {
		const cached = groupTabsCache.get(cacheKey);
		if (cached) return cached;
	}

	const domainMap = new Map<string, ChromeTab[]>();

	for (const tab of tabs) {
		const domain = extractDomain(tab.url);
		const existing = domainMap.get(domain) || [];
		existing.push(tab);
		domainMap.set(domain, existing);
	}

	const groups: DomainGroup[] = [];

	for (const [domain, domainTabs] of domainMap) {
		groups.push({
			domain,
			tabs: domainTabs,
			favicon: domainTabs[0]?.favIconUrl,
		});
	}

	groups.sort((a, b) => a.domain.localeCompare(b.domain));

	groupTabsCache.set(cacheKey, groups);

	return groups;
}

export function clearGroupTabsCache(): void {
	groupTabsCache.clear();
}
