/**
 * Characterization test for bug 1.20: clearHealthCheckCache was exported
 * but never called. The ExtractionErrorAlert's "Retry backend" button
 * should call it for transient backend errors.
 */
import { describe, expect, it } from "vitest";
import type { ExtractionErrorInfo } from "../types";
import { shouldShowBackendRetry } from "./extractionErrorDisplay";

const error = (code: ExtractionErrorInfo["errorCode"]): ExtractionErrorInfo => ({
	tabId: 1,
	url: "https://x",
	title: "t",
	errorCode: code,
	userMessage: "u",
});

describe("shouldShowBackendRetry (bug 1.20: show retry for backend errors)", () => {
	it("shows the retry button for NETWORK_ERROR", () => {
		expect(shouldShowBackendRetry([error("NETWORK_ERROR")])).toBe(true);
	});

	it("shows the retry button for SERVER_ERROR", () => {
		expect(shouldShowBackendRetry([error("SERVER_ERROR")])).toBe(true);
	});

	it("shows the retry button for TIMEOUT", () => {
		expect(shouldShowBackendRetry([error("TIMEOUT")])).toBe(true);
	});

	it("does NOT show the retry button for NO_SUBTITLES or PDF errors", () => {
		expect(shouldShowBackendRetry([error("NO_SUBTITLES")])).toBe(false);
		expect(shouldShowBackendRetry([error("PDF_TOO_LARGE")])).toBe(false);
		expect(shouldShowBackendRetry([error("PARSE_ERROR")])).toBe(false);
	});

	it("hides the retry button when there are no errors", () => {
		expect(shouldShowBackendRetry([])).toBe(false);
	});

	it("returns true if any error in the list is retryable", () => {
		expect(shouldShowBackendRetry([error("NO_SUBTITLES"), error("TIMEOUT")])).toBe(true);
	});
});
