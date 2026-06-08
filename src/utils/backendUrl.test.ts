import { describe, expect, it } from "vitest";
import { normalizeBackendBaseUrl } from "./backendUrl";

describe("normalizeBackendBaseUrl", () => {
	it("throws when no URL is configured and not in dev", () => {
		expect(() => normalizeBackendBaseUrl("", false)).toThrow(/VITE_SUBTITLES_BASE_URL/);
	});

	it("falls back to 127.0.0.1:8000 in dev when empty", () => {
		expect(normalizeBackendBaseUrl("", true)).toBe("http://127.0.0.1:8000");
	});

	it("adds http:// when protocol is missing", () => {
		expect(normalizeBackendBaseUrl("api.example.com", false)).toBe("http://api.example.com");
	});

	it("preserves explicit https://", () => {
		expect(normalizeBackendBaseUrl("https://api.example.com", false)).toBe("https://api.example.com");
	});

	it("rewrites localhost to 127.0.0.1", () => {
		expect(normalizeBackendBaseUrl("http://localhost:9000", false)).toBe("http://127.0.0.1:9000");
	});

	it("uses substring replace for the localhost rewrite (current behavior)", () => {
		// The original code used `replace("localhost", "127.0.0.1")` which is a
		// substring replace, not a hostname compare. The shared helper preserves
		// that behavior. A future refactor can swap to URL-aware parsing without
		// changing the call sites.
		expect(normalizeBackendBaseUrl("http://notlocalhost.example", false)).toBe("http://not127.0.0.1.example");
	});
});
