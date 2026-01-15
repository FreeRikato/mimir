import type { ChromeTab, DomainGroup } from '../types';

/**
 * Extracts the domain from a URL, stripping 'www.' prefix
 */
export function extractDomain(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    return hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

/**
 * Groups an array of tabs by their domain
 * Returns an alphabetically sorted array of DomainGroup objects
 */
export function groupTabs(tabs: ChromeTab[]): DomainGroup[] {
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

  // Sort alphabetically by domain
  groups.sort((a, b) => a.domain.localeCompare(b.domain));

  return groups;
}
