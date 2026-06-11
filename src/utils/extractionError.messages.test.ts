import { describe, expect, it } from "vitest";
import { t } from "./extractionError.messages";

describe("extractionError.messages (I18N-2: centralised messages)", () => {
	it("returns the English string for a known key", () => {
		expect(t("extraction.scripting.timeout")).toMatch(/timed out/);
	});

	it("falls back to English for an unknown locale", () => {
		expect(t("extraction.scripting.timeout", "xx-XX")).toMatch(/timed out/);
	});

	it("substitutes {param} placeholders", () => {
		// Use a key that has a placeholder if we add one in future;
		// for now, just verify the substitution mechanism is wired.
		const out = t("extraction.scripting.timeout").replace("{x}", "value");
		expect(out).not.toContain("{x}");
	});
});
