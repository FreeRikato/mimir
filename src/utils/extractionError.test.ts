/**
 * Characterization tests for the extraction error helper. Covers:
 *   - Bug 1.2: unknown errors (TypeError, RangeError, plain string) map to
 *     UNKNOWN_ERROR with the error name surfaced.
 *   - Bug 1.6: chrome.scripting.executeScript failures produce a real
 *     ExtractionErrorInfo with a specific user message.
 *   - Bug 1.7: YouTube "no result" (empty payload) returns a NO_SUBTITLES
 *     error so the user sees a toast.
 *   - Bug 1.24: X/Twitter distinguishes "not yet captured" (retry hint)
 *     from "schema drift" (bug-report hint).
 */
import { describe, expect, it } from "vitest";
import { SubtitleError } from "../types";
import { createExtractionError } from "./extractionError";

const fakeTab = { id: 42, url: "https://example.com/post", title: "Example Post" };

describe("createExtractionError (bug 1.2: UNKNOWN_ERROR for non-network errors)", () => {
	it("maps a TypeError to UNKNOWN_ERROR and surfaces the error name in the message", () => {
		const err = new TypeError("Cannot read property 'x' of undefined");
		const info = createExtractionError({ tabId: 1, tab: fakeTab, err });
		expect(info.errorCode).toBe("UNKNOWN_ERROR");
		expect(info.userMessage).toContain("Cannot read property 'x' of undefined");
	});

	it("maps a RangeError to UNKNOWN_ERROR (not NETWORK_ERROR)", () => {
		const err = new RangeError("Maximum call stack");
		const info = createExtractionError({ tabId: 1, tab: fakeTab, err });
		expect(info.errorCode).toBe("UNKNOWN_ERROR");
		expect(info.userMessage).toContain("RangeError");
	});

	it("maps a string error to UNKNOWN_ERROR with the string in the message", () => {
		const info = createExtractionError({ tabId: 1, tab: fakeTab, err: "boom" });
		expect(info.errorCode).toBe("UNKNOWN_ERROR");
		expect(info.userMessage).toBe("boom");
	});

	it("preserves SubtitleError code and message", () => {
		const sub = new SubtitleError("no captions", "NO_SUBTITLES", undefined, "https://x");
		const info = createExtractionError({ tabId: 1, tab: fakeTab, err: sub });
		expect(info.errorCode).toBe("NO_SUBTITLES");
		expect(info.userMessage).toBe("no captions");
	});

	it("keeps NETWORK_ERROR for DOMException (network/protocol failures)", () => {
		const domErr = new DOMException("NetworkError when attempting to fetch resource.", "NetworkError");
		const info = createExtractionError({ tabId: 1, tab: fakeTab, err: domErr });
		expect(info.errorCode).toBe("NETWORK_ERROR");
	});
});

describe("createExtractionError (bug 1.6: chrome.scripting failure feedback)", () => {
	it("surfaces a user message when the tab is suspended", () => {
		const err = new Error("Tab is suspended");
		const info = createExtractionError({ tabId: 1, tab: fakeTab, err, cause: "scripting" });
		expect(info.userMessage.toLowerCase()).toContain("suspended");
		expect(info.errorCode).toBe("NETWORK_ERROR");
	});

	it("surfaces a user message on permission denied", () => {
		const err = new Error("Permission denied for this page");
		const info = createExtractionError({ tabId: 1, tab: fakeTab, err, cause: "scripting" });
		expect(info.userMessage.toLowerCase()).toContain("permission");
	});

	it("surfaces a user message when the frame is not loaded", () => {
		const err = new Error("Frame not loaded yet");
		const info = createExtractionError({ tabId: 1, tab: fakeTab, err, cause: "scripting" });
		expect(info.userMessage.toLowerCase()).toContain("loading");
	});

	it("falls back to a generic message for unknown scripting errors", () => {
		const err = new Error("Some weird thing");
		const info = createExtractionError({ tabId: 1, tab: fakeTab, err, cause: "scripting" });
		expect(info.userMessage.length).toBeGreaterThan(10);
	});
});

describe("createExtractionError (bug 1.7: YouTube no-result is no longer silent)", () => {
	it("returns a NO_SUBTITLES error when the YouTube branch yields an empty payload", () => {
		const info = createExtractionError({ tabId: 1, tab: fakeTab, err: null, cause: "youtube-empty" });
		expect(info.errorCode).toBe("NO_SUBTITLES");
		expect(info.userMessage.toLowerCase()).toContain("no subtitles");
	});
});

describe("createExtractionError (bug 1.24: X/Twitter not-captured vs schema-drift)", () => {
	it("'not-captured' is a retry hint, not a bug-report hint", () => {
		const info = createExtractionError({ tabId: 1, tab: fakeTab, err: null, cause: "x-not-captured" });
		expect(info.errorCode).toBe("PARSE_ERROR");
		expect(info.userMessage.toLowerCase()).toMatch(/retry|scroll|fully loaded/);
	});

	it("'schema-drift' tells the user to file a bug", () => {
		const info = createExtractionError({ tabId: 1, tab: fakeTab, err: null, cause: "x-schema-drift" });
		expect(info.errorCode).toBe("PARSE_ERROR");
		expect(info.userMessage.toLowerCase()).toMatch(/file a bug|schema/);
	});
});
