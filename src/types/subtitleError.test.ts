import { describe, expect, it } from "vitest";
import { SubtitleError } from "./index";

describe("SubtitleError.statusCode", () => {
	it("carries the originating HTTP status so the retry layer can decide", () => {
		const err = new SubtitleError("backend down", "API_ERROR", undefined, "https://api.example.com/x", 503);
		expect(err.statusCode).toBe(503);
		expect(err.code).toBe("API_ERROR");
	});

	it("is undefined when constructed without an explicit status", () => {
		const err = new SubtitleError("boom", "NETWORK_ERROR");
		expect(err.statusCode).toBeUndefined();
	});
});
