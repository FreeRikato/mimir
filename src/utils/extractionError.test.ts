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

// ERR-5: the original stack of the underlying Error should be preserved
// in the ExtractionErrorInfo so a developer reading the console can
// correlate the user-facing message to the source.
describe("createExtractionError (ERR-5: original stack is preserved)", () => {
	it("populates originalStack from a plain Error", () => {
		const err = new TypeError("boom");
		const info = createExtractionError({ tabId: 1, tab: fakeTab, err });
		expect(info.originalStack).toBeDefined();
		expect(info.originalStack).toContain("TypeError");
	});

	it("populates originalStack from a SubtitleError's originalError when present", () => {
		const original = new RangeError("nope");
		const sub = new SubtitleError("wrapped", "UNKNOWN_ERROR", original, "https://x");
		const info = createExtractionError({ tabId: 1, tab: fakeTab, err: sub });
		expect(info.originalStack).toContain("RangeError");
	});

	it("leaves originalStack undefined for non-Error inputs", () => {
		const info = createExtractionError({ tabId: 1, tab: fakeTab, err: "string error" });
		expect(info.originalStack).toBeUndefined();
	});
});

// ERR-7: a TabSuspendedError from chrome.scripting is a DOMException but
// it is NOT a network failure. The default path must not misclassify
// it as NETWORK_ERROR; otherwise the user sees a misleading "Network
// error" when the real cause is a suspended tab (already handled in
// `cause: "scripting"`, but the default path should also be correct).
describe("createExtractionError (ERR-7: TabSuspendedError classification)", () => {
	it("maps a TabSuspendedError to UNKNOWN_ERROR, not NETWORK_ERROR", () => {
		const err = new Error("tab is suspended");
		err.name = "TabSuspendedError";
		const info = createExtractionError({ tabId: 1, tab: fakeTab, err });
		expect(info.errorCode).toBe("UNKNOWN_ERROR");
		expect(info.userMessage.toLowerCase()).toContain("tab");
	});

	it("keeps NETWORK_ERROR for a regular DOMException with name 'NetworkError'", () => {
		const domErr = new DOMException("boom", "NetworkError");
		const info = createExtractionError({ tabId: 1, tab: fakeTab, err: domErr });
		expect(info.errorCode).toBe("NETWORK_ERROR");
	});
});

// UX-1: every cause-branched ExtractionErrorInfo must populate `cause`
// with the matching discriminator, so UI affordances (e.g. the
// x-not-captured banner) match on a stable field rather than substrings
// of the localized user message.
describe("createExtractionError (UX-1: cause discriminator is populated)", () => {
	it("sets cause='scripting-timeout' on the timeout branch", () => {
		const info = createExtractionError({ tabId: 1, tab: fakeTab, err: null, cause: "scripting-timeout" });
		expect(info.cause).toBe("scripting-timeout");
	});

	it("sets cause='scripting' on the scripting branch", () => {
		const info = createExtractionError({ tabId: 1, tab: fakeTab, err: new Error("x"), cause: "scripting" });
		expect(info.cause).toBe("scripting");
	});

	it("sets cause='youtube-empty' on the youtube-empty branch", () => {
		const info = createExtractionError({ tabId: 1, tab: fakeTab, err: null, cause: "youtube-empty" });
		expect(info.cause).toBe("youtube-empty");
	});

	it("sets cause='x-not-captured' on the x-not-captured branch", () => {
		const info = createExtractionError({ tabId: 1, tab: fakeTab, err: null, cause: "x-not-captured" });
		expect(info.cause).toBe("x-not-captured");
	});

	it("sets cause='x-schema-drift' on the x-schema-drift branch", () => {
		const info = createExtractionError({ tabId: 1, tab: fakeTab, err: null, cause: "x-schema-drift" });
		expect(info.cause).toBe("x-schema-drift");
	});

	it("leaves cause undefined on the default branch so callers can distinguish", () => {
		const info = createExtractionError({ tabId: 1, tab: fakeTab, err: new Error("plain") });
		expect(info.cause).toBeUndefined();
	});
});
