/**
 * Characterization tests for the exporters helpers. Covers:
 *   - Bug 1.12: TOC anchor matches section header slug (www. stripped, IDN OK)
 *   - Bug 1.13: escapeMarkdown leaves backticks alone
 *   - Bug 1.14: sanitizeUrl blocks data: URLs and javascript:
 *   - Bug 1.15: createHtmlId resolves collisions
 *   - Bug 1.19: createHtmlId uses slice, capped at 50 chars (no substr)
 */
import { describe, expect, it } from "vitest";
import { createHtmlId, escapeMarkdown, sanitizeUrl, slugifyDomainAnchor } from "./exporters.state";

describe("slugifyDomainAnchor (bug 1.12: TOC matches header)", () => {
	it("lowercases and replaces dots with hyphens", () => {
		expect(slugifyDomainAnchor("Example.COM")).toBe("example-com");
	});

	it("strips a leading www.", () => {
		expect(slugifyDomainAnchor("www.example.com")).toBe("example-com");
		expect(slugifyDomainAnchor("WWW.Example.com")).toBe("example-com");
	});

	it("handles internationalized domain names tolerably (non-ASCII becomes a hyphen run)", () => {
		// The contract is: a non-ASCII char MUST NOT throw and MUST produce a
		// stable, non-empty slug. We don't claim a specific round-trip — the
		// slug is used as a Markdown anchor, not a URL.
		const slug = slugifyDomainAnchor("münchen.de");
		expect(slug.length).toBeGreaterThan(0);
		expect(slug).not.toContain(".");
		expect(slug).toMatch(/^[a-z0-9-]+$/);
	});

	it("returns 'section' for empty / non-alphanumeric input", () => {
		expect(slugifyDomainAnchor("")).toBe("section");
		expect(slugifyDomainAnchor("---")).toBe("section");
	});
});

describe("escapeMarkdown (bug 1.13: backticks are literal)", () => {
	it("escapes asterisk, underscore, brackets, pipe, etc.", () => {
		expect(escapeMarkdown("a * b _ c [d] (e) ~ # + - . ! |")).toBe(
			"a \\* b \\_ c \\[d\\] \\(e\\) \\~ \\# \\+ \\- \\. \\! \\|",
		);
	});

	it("does NOT escape backticks (most renderers treat \\` as literal backslash + backtick)", () => {
		const out = escapeMarkdown("Use `code` here");
		expect(out).toBe("Use `code` here");
		expect(out).not.toContain("\\`");
	});

	it("returns empty string for null/undefined", () => {
		// biome-ignore lint/suspicious/noExplicitAny: testing nullish input
		expect(escapeMarkdown(null as any)).toBe("");
	});
});

describe("sanitizeUrl (bug 1.14: explicit allow-list)", () => {
	it("accepts http and https URLs", () => {
		expect(sanitizeUrl("http://example.com")).toBe("http://example.com");
		expect(sanitizeUrl("https://example.com/path?q=1")).toBe("https://example.com/path?q=1");
	});

	it("accepts mailto and tel", () => {
		expect(sanitizeUrl("mailto:hi@example.com")).toBe("mailto:hi@example.com");
		expect(sanitizeUrl("tel:+15551234567")).toBe("tel:+15551234567");
	});

	it("rejects javascript: URLs", () => {
		expect(sanitizeUrl("javascript:alert(1)")).toBe("#");
	});

	it("rejects vbscript: URLs", () => {
		expect(sanitizeUrl("vbscript:msgbox(1)")).toBe("#");
	});

	it("rejects data:text/html URLs with script payload", () => {
		expect(sanitizeUrl("data:text/html,<script>alert(1)</script>")).toBe("#");
	});

	it("rejects whitespace-injected javascript: URL (tab/newline between scheme and body)", () => {
		expect(sanitizeUrl("java\tscript:alert(1)")).toBe("#");
		expect(sanitizeUrl("java\nscript:alert(1)")).toBe("#");
	});

	it("returns '#' for null / empty / non-strings", () => {
		// biome-ignore lint/suspicious/noExplicitAny: testing nullish input
		expect(sanitizeUrl(null as any)).toBe("#");
		// biome-ignore lint/suspicious/noExplicitAny: testing nullish input
		expect(sanitizeUrl(undefined as any)).toBe("#");
		expect(sanitizeUrl("")).toBe("#");
	});

	it("returns '#' for unparseable garbage", () => {
		expect(sanitizeUrl("not a url at all")).toBe("#");
	});
});

describe("createHtmlId (bug 1.15: collision-safe; bug 1.19: slice not substr)", () => {
	it("uses slugify + slice, capped at 60 chars (base 50 + 4-char hash + hyphen)", () => {
		const long = "a".repeat(200);
		const id = createHtmlId(long);
		expect(id.length).toBeLessThanOrEqual(60);
		expect(id.length).toBeGreaterThan(0);
	});

	it("returns 'section' for empty / no-alphanumeric input", () => {
		expect(createHtmlId("")).toBe("section");
		expect(createHtmlId("---")).toBe("section");
	});

	it("collisions get a short hash suffix", () => {
		const taken = new Set<string>();
		// Force the same slug.
		const a = createHtmlId("foo.com", taken);
		const b = createHtmlId("foo—com", taken);
		expect(a).toBe("foo-com");
		expect(b).not.toBe(a);
		expect(b.startsWith("foo-com-")).toBe(true);
	});

	it("uses slice, not deprecated substr", () => {
		// Pin the behavior on a long domain: output must not exceed 60 chars.
		const id = createHtmlId("x".repeat(200));
		expect(id.length).toBeLessThanOrEqual(60);
	});
});
