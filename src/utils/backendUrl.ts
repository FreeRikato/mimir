/**
 * Shared backend base-URL normalization.
 *
 * Used by `subtitles.ts` and `pdfExtraction.ts` so the dev fallback
 * (127.0.0.1:8000), the protocol-prefix rule, and the localhost→127.0.0.1
 * rewrite stay in one place. See bug 2.9 in the project bug list.
 */

/**
 * Normalize a backend base URL:
 * - Empty string throws (caller must surface a clear error).
 * - In dev mode (`import.meta.env.DEV`) with no value, falls back to
 *   `127.0.0.1:8000` so the local FastAPI server "just works".
 * - Adds `http://` if no protocol is present.
 * - Rewrites `localhost` to `127.0.0.1` for more reliable connections.
 *
 * @throws {Error} if no base URL is configured outside dev.
 */
export function normalizeBackendBaseUrl(baseUrl: string, isDev: boolean): string {
	let normalized = baseUrl || (isDev ? "127.0.0.1:8000" : "");
	if (!normalized) {
		throw new Error("VITE_SUBTITLES_BASE_URL environment variable not set");
	}
	if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
		normalized = `http://${normalized}`;
	}
	return normalized.replace("localhost", "127.0.0.1");
}
