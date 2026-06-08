import { describe, expect, it } from "vitest";
import { SubtitleError } from "../types";
import { buildTimeoutError, isRetryableError } from "./subtitles";

describe("isRetryableError (subtitles)", () => {
	it("retries TIMEOUT", () => {
		expect(isRetryableError(new SubtitleError("slow", "TIMEOUT"))).toBe(true);
	});

	it("retries NETWORK_ERROR", () => {
		expect(isRetryableError(new SubtitleError("net", "NETWORK_ERROR"))).toBe(true);
	});

	it("retries SERVER_ERROR", () => {
		expect(isRetryableError(new SubtitleError("server", "SERVER_ERROR"))).toBe(true);
	});

	it("retries API_ERROR when statusCode is 503 (the production failure case)", () => {
		// Bug 1.2: statusCode field was missing on SubtitleError, so this branch
		// was dead code. With the fix, a transient 5xx from the FastAPI backend
		// will retry instead of failing the first attempt.
		const err = new SubtitleError("backend down", "API_ERROR", undefined, "https://api.example.com", 503);
		expect(err.statusCode).toBe(503);
		expect(isRetryableError(err)).toBe(true);
	});

	it("retries API_ERROR when statusCode is 408 (Request Timeout, a transient 4xx)", () => {
		// 408 is a 4xx that the backend can recover from (e.g., transient connection reset).
		// The objective calls for 408 to be retried alongside 429 and 5xx.
		const err = new SubtitleError("request timeout", "API_ERROR", undefined, "https://api.example.com", 408);
		expect(isRetryableError(err)).toBe(true);
	});

	it("retries API_ERROR when statusCode is 429", () => {
		const err = new SubtitleError("rate limit", "API_ERROR", undefined, "https://api.example.com", 429);
		expect(isRetryableError(err)).toBe(true);
	});

	it("does NOT retry API_ERROR when statusCode is 4xx (other than 429)", () => {
		// 400/401/403/404 should NOT be retried — they won't fix themselves.
		const err = new SubtitleError("bad request", "API_ERROR", undefined, "https://api.example.com", 400);
		expect(isRetryableError(err)).toBe(false);
	});

	it("does NOT retry API_ERROR when statusCode is missing (legacy throws)", () => {
		// Old code path: API_ERROR thrown without statusCode should not be
		// retried blindly. Today's behavior must not regress for callers that
		// haven't been updated to pass statusCode.
		const err = new SubtitleError("unknown", "API_ERROR", undefined, "https://api.example.com");
		expect(isRetryableError(err)).toBe(false);
	});
});

describe("buildTimeoutError (bug 1.1: hardcoded 127.0.0.1:8000 in user message)", () => {
	it("uses the provided backend base URL in the user-facing message", () => {
		const err = buildTimeoutError("https://api.example.com/subtitles?videoId=abc", 30_000, "https://api.mimir.io");
		expect(err).toBeInstanceOf(SubtitleError);
		expect(err.code).toBe("TIMEOUT");
		// Must mention the *actual* configured base, not a hardcoded localhost.
		expect(err.message).toContain("api.mimir.io");
		expect(err.message).not.toContain("127.0.0.1");
	});

	it("falls back to a generic phrase when no base URL is configured", () => {
		const err = buildTimeoutError("https://api.example.com/x", 30_000, "");
		expect(err).toBeInstanceOf(SubtitleError);
		expect(err.code).toBe("TIMEOUT");
		// Should not invent a URL out of thin air.
		expect(err.message).not.toContain("127.0.0.1");
		expect(err.message).not.toContain("http://");
		// And the configured URL field is preserved for diagnostics.
		expect(err.url).toBe("https://api.example.com/x");
	});

	it("includes the timeout duration so the user knows how long we waited", () => {
		const err = buildTimeoutError("https://x", 12_345, "https://api.example.com");
		expect(err.message).toContain("12345");
	});

	it("preserves the original URL the request was targeting", () => {
		const err = buildTimeoutError("https://youtube.com/watch?v=xyz", 5000, "https://api.example.com");
		expect(err.url).toBe("https://youtube.com/watch?v=xyz");
	});
});
