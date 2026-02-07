import { SubtitleError } from "../types";

const SUBTITLES_BASE_URL = import.meta.env.VITE_SUBTITLES_BASE_URL ?? "";

const HEALTH_CHECK_TIMEOUT_MS = 2000;
const HEALTH_CHECK_CACHE_TTL = 30000; // 30 seconds

const HEALTH_CHECK_CACHE_KEY = "mimir_backend_health_check";

interface HealthCheckCacheEntry {
	healthy: boolean;
	timestamp: number;
}

/**
 * Gets the normalized backend base URL for health checks
 */
function getBackendBaseUrl(): string {
	let baseUrl = SUBTITLES_BASE_URL || (import.meta.env.DEV ? "127.0.0.1:8000" : "");
	if (!baseUrl) {
		throw new Error("SUBTITLES_BASE_URL environment variable not set");
	}
	// Add protocol if missing
	if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
		baseUrl = "http://" + baseUrl;
	}
	// Normalize localhost to 127.0.0.1
	baseUrl = baseUrl.replace("localhost", "127.0.0.1");
	return baseUrl;
}

/**
 * Gets the health check URL (tries /health first, falls back to /)
 */
function getHealthCheckUrl(): string {
	const baseUrl = getBackendBaseUrl();
	return `${baseUrl}/health`;
}

/**
 * Loads cached health check result from chrome.storage.local
 */
async function getCachedHealthCheck(): Promise<HealthCheckCacheEntry | null> {
	try {
		const cached = await chrome.storage.local.get([HEALTH_CHECK_CACHE_KEY]);
		const entry = cached[HEALTH_CHECK_CACHE_KEY] as HealthCheckCacheEntry | undefined;

		if (!entry) {
			return null;
		}

		// Check for expiration (30 second TTL)
		if (Date.now() - entry.timestamp > HEALTH_CHECK_CACHE_TTL) {
			await chrome.storage.local.remove([HEALTH_CHECK_CACHE_KEY]);
			return null;
		}

		return entry;
	} catch {
		return null;
	}
}

/**
 * Caches health check result in chrome.storage.local
 */
async function setCachedHealthCheck(healthy: boolean): Promise<void> {
	try {
		const entry: HealthCheckCacheEntry = {
			healthy,
			timestamp: Date.now(),
		};
		await chrome.storage.local.set({ [HEALTH_CHECK_CACHE_KEY]: entry });
	} catch (err) {
		console.warn("[Backend Health] Failed to cache health check result:", err);
	}
}

/**
 * Clears the cached health check result (useful for manual retries)
 */
export async function clearHealthCheckCache(): Promise<void> {
	try {
		await chrome.storage.local.remove([HEALTH_CHECK_CACHE_KEY]);
	} catch (err) {
		console.warn("[Backend Health] Failed to clear health check cache:", err);
	}
}

/**
 * Performs an actual health check request to the backend
 */
async function performHealthCheck(): Promise<boolean> {
	const url = getHealthCheckUrl();
	const controller = new AbortController();

	const timeoutId = setTimeout(() => {
		controller.abort();
	}, HEALTH_CHECK_TIMEOUT_MS);

	try {
		const response = await fetch(url, {
			method: "GET",
			signal: controller.signal,
			headers: {
				Accept: "application/json",
			},
		});

		clearTimeout(timeoutId);

		// Any 2xx response means the backend is healthy
		return response.ok;
	} catch (_err) {
		clearTimeout(timeoutId);

		// If the request fails, try the simple health endpoint as fallback
		try {
			const baseUrl = getBackendBaseUrl();
			const fallbackUrl = `${baseUrl}/`;
			const fallbackController = new AbortController();

			const fallbackTimeoutId = setTimeout(() => {
				fallbackController.abort();
			}, HEALTH_CHECK_TIMEOUT_MS);

			const fallbackResponse = await fetch(fallbackUrl, {
				method: "GET",
				signal: fallbackController.signal,
			});

			clearTimeout(fallbackTimeoutId);
			return fallbackResponse.ok;
		} catch {
			// Both endpoints failed
			return false;
		}
	}
}

/**
 * Checks if the subtitle backend is healthy.
 * Uses cached results for 30 seconds to avoid repeated checks.
 *
 * @returns {Promise<boolean>} true if backend is healthy, false otherwise
 */
export async function checkBackendHealth(): Promise<boolean> {
	// Check cache first
	const cached = await getCachedHealthCheck();
	if (cached !== null) {
		return cached.healthy;
	}

	// Perform actual health check
	const isHealthy = await performHealthCheck();

	// Cache the result
	await setCachedHealthCheck(isHealthy);

	return isHealthy;
}

/**
 * Checks backend health and throws a SubtitleError if unhealthy.
 * Use this before attempting to fetch subtitles.
 *
 * @throws {SubtitleError} if backend is unavailable
 */
export async function ensureBackendHealth(): Promise<void> {
	const isHealthy = await checkBackendHealth();

	if (!isHealthy) {
		throw new SubtitleError(
			"YouTube subtitle backend is unavailable. Subtitles will be skipped.",
			"NETWORK_ERROR",
			undefined,
			getBackendBaseUrl(),
		);
	}
}
