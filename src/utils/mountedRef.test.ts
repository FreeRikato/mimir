import { describe, expect, it } from "vitest";
import { createMountedRef } from "./mountedRef";

describe("createMountedRef (RC-5: shared isMountedRef pattern for useHighlightedTabs)", () => {
	it("starts mounted", () => {
		const m = createMountedRef();
		expect(m.isMounted()).toBe(true);
	});

	it("markUnmounted() flips to false", () => {
		const m = createMountedRef();
		m.markUnmounted();
		expect(m.isMounted()).toBe(false);
	});

	it("markUnmounted() is idempotent", () => {
		const m = createMountedRef();
		m.markUnmounted();
		m.markUnmounted();
		expect(m.isMounted()).toBe(false);
	});

	it("markMounted() can re-arm (re-mount scenario)", () => {
		const m = createMountedRef();
		m.markUnmounted();
		m.markMounted();
		expect(m.isMounted()).toBe(true);
	});
});
