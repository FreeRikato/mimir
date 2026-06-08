// Manual QA harness for bugs 1.2 (retry never fires) and 2.9 (URL drift).
// Single pass against a mock backend that fails twice with a status
// sequence (default: 408 then 503), then returns 200. The retry policy
// must fire for both 408 and 503, and the URL normalizer must build a
// well-formed /api/v1/subtitles?video_url=...&format=json URL.
//
// Uses the production isRetryableError predicate shape and the production
// fetchWithRetry policy shape (re-implemented inline so this file can run
// without the React deps in src/utils/subtitles.ts).

import { SubtitleError } from "../src/types/index.ts";

const PORT = Number(process.env.PORT ?? 8765);
const BASE_URL = process.env.SUBTITLES_BASE_URL ?? `http://127.0.0.1:${PORT}`;
const VIDEO_URL = "https://www.youtube.com/watch?v=abc123";

function normalizeBackendBaseUrl(baseUrl) {
	let normalized = baseUrl || "";
	if (!normalized) {
		throw new Error("VITE_SUBTITLES_BASE_URL environment variable not set");
	}
	if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
		normalized = `http://${normalized}`;
	}
	return normalized.replace("localhost", "127.0.0.1");
}

function isRetryableError(error) {
	if (error.code === "TIMEOUT") return true;
	if (error.code === "NETWORK_ERROR") return true;
	if (error.code === "SERVER_ERROR") return true;
	if (error.code === "API_ERROR") {
		// Mirrors src/utils/{subtitles,pdfExtraction}.ts isRetryableError.
		const statusCode = error.statusCode;
		if (statusCode === 408 || statusCode === 429) return true;
		if (statusCode !== undefined && statusCode >= 500) return true;
		return false;
	}
	return false;
}

async function fetchWithRetry(fetchFn, maxAttempts = 3) {
	let lastError;
	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		try {
			return await fetchFn();
		} catch (err) {
			const subtitleError =
				err instanceof SubtitleError
					? err
					: new SubtitleError(
							err instanceof Error ? err.message : "Unknown",
							"NETWORK_ERROR",
							err instanceof Error ? err : undefined,
						);
			lastError = subtitleError;
			if (attempt === maxAttempts - 1 || !isRetryableError(subtitleError)) {
				throw subtitleError;
			}
			const delay = 100 * 2 ** attempt;
			console.log(
				`  attempt ${attempt + 1} failed (${subtitleError.code}/${subtitleError.statusCode ?? "-"}), retrying in ${delay}ms`,
			);
			await new Promise((r) => setTimeout(r, delay));
		}
	}
	throw lastError;
}

const normalized = normalizeBackendBaseUrl(BASE_URL);
const apiUrl = `${normalized}/api/v1/subtitles?video_url=${encodeURIComponent(VIDEO_URL)}&format=json`;
console.log(`[scenario 1.2/2.9] baseUrl=${BASE_URL} -> normalized=${normalized}`);
console.log(`[scenario 1.2/2.9] apiUrl=${apiUrl}`);

const start = Date.now();
const result = await fetchWithRetry(async () => {
	const response = await fetch(apiUrl);
	if (!response.ok) {
		const status = response.status;
		let body = null;
		try {
			body = await response.json();
		} catch {
			/* ignore */
		}
		const message = body?.message || body?.detail || `HTTP ${status}`;
		// Map to the same SubtitleError codes the production code uses.
		if (status === 429) {
			throw new SubtitleError("Rate limit exceeded", "SERVER_ERROR", undefined, apiUrl, status);
		}
		if (status >= 500) {
			throw new SubtitleError(`Backend server error: ${status}`, "SERVER_ERROR", undefined, apiUrl, status);
		}
		if (status === 408) {
			throw new SubtitleError(`Backend timed out: ${status}`, "API_ERROR", undefined, apiUrl, status);
		}
		throw new SubtitleError(message, "API_ERROR", undefined, apiUrl, status);
	}
	return response.json();
}, 3);
const elapsed = Date.now() - start;
console.log(`[scenario 1.2/2.9] PASS — got ${result.subtitle_count} subtitle(s) after ${elapsed}ms`);
console.log(`[scenario 1.2/2.9] title="${result.metadata.title}"`);
