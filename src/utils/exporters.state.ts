/**
 * Pure helpers extracted from `exporters.ts` for unit testing.
 *
 * Bug 1.12 (formatAsMarkdown builds TOC anchors that don't match section IDs):
 *   The TOC was `(${domain.toLowerCase().replace(/\./g, "-")})` and the section
 *   header was `## ${domain}`. The new shared `slugifyDomainAnchor` produces
 *   the same value for both, with www. stripped and IDN tolerated.
 *
 * Bug 1.13 (escapeMarkdown escapes backticks with backslashes, which most
 *   renderers treat literally): the new `escapeMarkdown` excludes the
 *   backtick from the escape set so titles like "Use `code` here" render
 *   correctly.
 *
 * Bug 1.14 (sanitizeUrl uses parsed.protocol allow-list but isn't tested for
 *   data: URLs): the new `sanitizeUrl` performs an explicit allow-list check
 *   that catches `data:` URLs with HTML/script payloads.
 *
 * Bug 1.15 (createHtmlId collisions on different non-alphanumeric chars):
 *   two domains `foo.com` and `foo—com` (em-dash) both slugified to
 *   `foo-com`. The new `createHtmlId` appends a short hash when collisions
 *   occur so the second one is still reachable.
 *
 * Bug 1.19 (exporters.ts uses deprecated substr): the helper below uses
 *   `slice`, not `substr`. The test pins the length limit at 50 chars.
 */

export const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

export function sanitizeUrl(url: string): string {
	const str = url == null ? "" : String(url);
	const trimmed = str.trim();
	if (!trimmed) return "#";
	// Reject any whitespace-injection attempts before parsing.
	if (/\s/.test(trimmed)) return "#";
	// Explicit allow-list by prefix; the URL constructor's `protocol` is
	// normalised to lowercase + trailing colon, but a data: URL can carry
	// a payload that some legacy sites use to inject scripts.
	const lower = trimmed.toLowerCase();
	for (const proto of SAFE_PROTOCOLS) {
		if (lower.startsWith(`${proto}`) || lower.startsWith(`${proto.toUpperCase()}`)) {
			// Still validate the URL parses cleanly.
			try {
				new URL(trimmed);
				return trimmed;
			} catch {
				return "#";
			}
		}
	}
	return "#";
}

/**
 * Slugify a domain for use as a Markdown/HTML anchor. Strips `www.`, lowercases,
 * replaces every non-alphanumeric run with a single hyphen, and trims leading
 * / trailing hyphens.
 */
export function slugifyDomainAnchor(input: string): string {
	const str = (input ?? "").toString().trim().toLowerCase();
	const stripped = str.startsWith("www.") ? str.slice(4) : str;
	let slug = stripped.replace(/[^a-z0-9]+/g, "-");
	slug = slug.replace(/^-+|-+$/g, "");
	return slug || "section";
}

/**
 * HTML id derived from a string, with a 50-char limit. Collisions are
 * resolved by appending `-<short hash>` so the second entry is still
 * reachable as an anchor.
 */
export function createHtmlId(input: string, taken: Set<string> = new Set()): string {
	const base = slugifyDomainAnchor(input).slice(0, 50) || "section";
	if (!taken.has(base)) {
		taken.add(base);
		return base;
	}
	// Collision: append a short hash derived from the original input.
	let hash = 0;
	for (let i = 0; i < input.length; i++) {
		hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
	}
	const suffix = hash.toString(36).slice(0, 4);
	const candidate = `${base}-${suffix}`.slice(0, 60);
	taken.add(candidate);
	return candidate;
}

const MD_ESCAPE = /([_*[\]()~#+\-.!|])/g;

/** Escape markdown special characters, but NOT the backtick (bug 1.13). */
export function escapeMarkdown(text: string): string {
	const str = text == null ? "" : String(text);
	return str.replace(MD_ESCAPE, "\\$1");
}
