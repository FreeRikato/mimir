import { describe, expect, it } from "vitest";
import { SubtitleError } from "../types";
import { isRetryableError } from "./pdfExtraction";

describe("isRetryableError (pdfExtraction)", () => {
	it("retries TIMEOUT", () => {
		expect(isRetryableError(new SubtitleError("slow", "TIMEOUT"))).toBe(true);
	});

	it("retries NETWORK_ERROR", () => {
		expect(isRetryableError(new SubtitleError("net", "NETWORK_ERROR"))).toBe(true);
	});

	it("retries SERVER_ERROR", () => {
		expect(isRetryableError(new SubtitleError("server", "SERVER_ERROR"))).toBe(true);
	});

	it("retries OCR_UNAVAILABLE", () => {
		expect(isRetryableError(new SubtitleError("ocr", "OCR_UNAVAILABLE"))).toBe(true);
	});

	it("does NOT retry PDF_UNSUPPORTED", () => {
		expect(isRetryableError(new SubtitleError("unsupported", "PDF_UNSUPPORTED"))).toBe(false);
	});

	it("does NOT retry PDF_TOO_LARGE", () => {
		expect(isRetryableError(new SubtitleError("big", "PDF_TOO_LARGE"))).toBe(false);
	});

	it("does NOT retry PDF_ACCESS_DENIED", () => {
		expect(isRetryableError(new SubtitleError("denied", "PDF_ACCESS_DENIED"))).toBe(false);
	});

	describe("isRetryableError (pdfExtraction) with API_ERROR + statusCode", () => {
		it("retries 408 (Request Timeout)", () => {
			const err = new SubtitleError("request timeout", "API_ERROR", undefined, "https://api.example.com", 408);
			expect(isRetryableError(err)).toBe(true);
		});

		it("retries 429 (rate limit)", () => {
			const err = new SubtitleError("rate limit", "API_ERROR", undefined, "https://api.example.com", 429);
			expect(isRetryableError(err)).toBe(true);
		});

		it("retries 5xx (e.g. 503)", () => {
			const err = new SubtitleError("ocr", "API_ERROR", undefined, "https://api.example.com", 503);
			expect(isRetryableError(err)).toBe(true);
		});

		it("does NOT retry 4xx other than 408/429 (e.g. 400)", () => {
			const err = new SubtitleError("bad request", "API_ERROR", undefined, "https://api.example.com", 400);
			expect(isRetryableError(err)).toBe(false);
		});
	});
});
