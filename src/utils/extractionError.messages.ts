/**
 * I18N-2: localised messages for the extraction error helper.
 *
 * Today the messages are English-only. Centralising them in this
 * module makes it trivial to wire a real i18n library later (just
 * switch the return-value of the lookup to `i18n.t(key, params)`).
 * Each entry is keyed by a stable string id; the lookup takes a
 * locale (default 'en') and returns the human-readable string.
 *
 * The keys mirror the `cause` discriminator in
 * `ExtractionErrorCause` plus the default UNKNOWN_ERROR fallbacks.
 */
export type ErrorMessageKey =
	| "extraction.scripting.timeout"
	| "extraction.scripting.tab_suspended"
	| "extraction.scripting.permission_denied"
	| "extraction.scripting.frame_not_loaded"
	| "extraction.scripting.default"
	| "extraction.youtube.empty"
	| "extraction.x.not_captured"
	| "extraction.x.schema_drift"
	| "extraction.unknown_error.fallback"
	| "extraction.unknown_error.unhandled"
	| "extraction.unknown_error.string"
	| "extraction.unknown_error.null";

const MESSAGES_EN: Record<ErrorMessageKey, string> = {
	"extraction.scripting.timeout":
		"Extraction timed out. The page may be suspended or still loading. Try again in a moment.",
	"extraction.scripting.tab_suspended": "Tab is suspended. Activate the tab and try again.",
	"extraction.scripting.permission_denied": "Permission denied. Mimir cannot read this page.",
	"extraction.scripting.frame_not_loaded": "The page has not finished loading. Wait a moment and try again.",
	"extraction.scripting.default": "Could not read this page. The tab may be suspended or restricted.",
	"extraction.youtube.empty":
		"YouTube returned no subtitles for this video. Try another language or a different video.",
	"extraction.x.not_captured":
		"Tweet data not captured yet. Scroll the thread to capture it, then click Retry. The page must be fully loaded.",
	"extraction.x.schema_drift":
		"X/Twitter response shape changed (schema drift). Please file a bug with the URL so Mimir can be updated.",
	"extraction.unknown_error.fallback": "Extraction failed",
	"extraction.unknown_error.unhandled": "Unhandled error",
	"extraction.unknown_error.string": "Unknown error",
	"extraction.unknown_error.null": "Unknown error",
};

const MESSAGES: Record<string, Record<ErrorMessageKey, string>> = {
	en: MESSAGES_EN,
};

export function t(key: ErrorMessageKey, locale: string = "en", params?: Record<string, string | number>): string {
	const table = MESSAGES[locale] ?? MESSAGES_EN;
	let s = table[key] ?? MESSAGES_EN[key];
	if (params) {
		for (const [k, v] of Object.entries(params)) {
			s = s.replace(`{${k}}`, String(v));
		}
	}
	return s;
}
