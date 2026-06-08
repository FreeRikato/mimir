import { describe, expect, it } from "vitest";
import { SubtitleError } from "../types";
import { isRetryableError } from "./subtitles";

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
