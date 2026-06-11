import type { ExtractionErrorInfo } from "../types";
import { SubtitleError, type SubtitleErrorCode } from "../types";

/**
 * Normalize an unknown error thrown during extraction into the
 * `ExtractionErrorInfo` shape the UI consumes.
 *
 * Bug 1.2 (createExtractionError defaults unknown errors to NETWORK_ERROR):
 *   A programming bug (TypeError, RangeError, an unhandled rejection) used
 *   to surface as a misleading "Network error" toast. The fix introduces
 *   an explicit `UNKNOWN_ERROR` code path and surfaces the underlying error
 *   name so users (and devs reading the console) can tell the difference.
 *
 * Bug 1.6 (chrome.scripting.executeScript failure gives no user feedback):
 *   When `chrome.scripting.executeScript` rejects — frame not loaded, tab
 *   suspended, permission denied, etc. — callers can now pass a discriminated
 *   `cause: "scripting"` and we surface a specific error code + user message.
 *
 * Bug 1.7 (YouTube tab "no result" is silent):
 *   The YouTube branch used to return `result: null` with no error info when
 *   `fetchYoutubeSubtitles` succeeded but produced an empty payload. With
 *   `cause: "youtube-empty"` the helper produces a `NO_SUBTITLES`-style
 *   error so the user sees a toast.
 *
 * Bug 1.24 (X/Twitter doesn't distinguish "not yet captured" vs schema drift):
 *   When the GraphQL response does not contain the focal tweet, callers pass
 *   `cause: "x-not-captured"` (retry hint) or `cause: "x-schema-drift"`
 *   (bug-report hint). Each maps to a distinct user-facing message and code.
 */

export type ExtractionErrorCause =
	| "default"
	| "scripting"
	| "scripting-timeout"
	| "youtube-empty"
	| "x-not-captured"
	| "x-schema-drift";

export interface TabLike {
	id?: number;
	url?: string;
	title?: string;
}

export interface CreateExtractionErrorInput {
	tabId: number;
	tab: TabLike | chrome.tabs.Tab | null | undefined;
	err: unknown;
	cause?: ExtractionErrorCause;
}

type ScriptingReason = "tab_suspended" | "permission_denied" | "frame_not_loaded" | "default";

const SCRIPTING_MESSAGE_BY_REASON: Record<ScriptingReason, { code: SubtitleErrorCode; userMessage: string }> = {
	tab_suspended: {
		code: "NETWORK_ERROR",
		userMessage: "Tab is suspended. Activate the tab and try again.",
	},
	permission_denied: {
		code: "API_ERROR",
		userMessage: "Permission denied. Mimir cannot read this page.",
	},
	frame_not_loaded: {
		code: "NETWORK_ERROR",
		userMessage: "The page has not finished loading. Wait a moment and try again.",
	},
	default: {
		code: "NETWORK_ERROR",
		userMessage: "Could not read this page. The tab may be suspended or restricted.",
	},
};

function pickReason(err: unknown): ScriptingReason {
	const message = err instanceof Error ? err.message : String(err ?? "");
	const lower = message.toLowerCase();
	if (lower.includes("permission") || lower.includes("denied")) return "permission_denied";
	if (lower.includes("suspend")) return "tab_suspended";
	if (lower.includes("frame") || lower.includes("not loaded") || lower.includes("not connected")) {
		return "frame_not_loaded";
	}
	return "default";
}

function describeScriptingError(err: unknown): { code: SubtitleErrorCode; userMessage: string } {
	return SCRIPTING_MESSAGE_BY_REASON[pickReason(err)];
}

function isNetworkShapedError(err: Error): boolean {
	if (err.name === "DOMException") return true;
	if (err.name === "NetworkError") return true;
	if (err.name === "AbortError") return true;
	return false;
}

export function createExtractionError(input: CreateExtractionErrorInput): ExtractionErrorInfo {
	const { tabId, tab, err, cause = "default" } = input;

	if (cause === "scripting-timeout") {
		return {
			tabId,
			url: tab?.url || "unknown",
			title: tab?.title || "Unknown",
			errorCode: "TIMEOUT",
			userMessage: "Extraction timed out. The page may be suspended or still loading. Try again in a moment.",
		};
	}

	if (cause === "scripting") {
		const reason = describeScriptingError(err);
		return {
			tabId,
			url: tab?.url || "unknown",
			title: tab?.title || "Unknown",
			errorCode: reason.code,
			userMessage: reason.userMessage,
		};
	}

	if (cause === "youtube-empty") {
		return {
			tabId,
			url: tab?.url || "unknown",
			title: tab?.title || "Unknown",
			errorCode: "NO_SUBTITLES",
			userMessage: "YouTube returned no subtitles for this video. Try another language or a different video.",
		};
	}

	if (cause === "x-not-captured") {
		return {
			tabId,
			url: tab?.url || "unknown",
			title: tab?.title || "Unknown",
			errorCode: "PARSE_ERROR",
			userMessage:
				"Tweet data not captured yet. Scroll the thread to capture it, then click Retry. The page must be fully loaded.",
		};
	}

	if (cause === "x-schema-drift") {
		return {
			tabId,
			url: tab?.url || "unknown",
			title: tab?.title || "Unknown",
			errorCode: "PARSE_ERROR",
			userMessage:
				"X/Twitter response shape changed (schema drift). Please file a bug with the URL so Mimir can be updated.",
		};
	}

	// Default path: map the unknown error.
	let code: SubtitleErrorCode = "UNKNOWN_ERROR";
	let userMessage = "Extraction failed";

	let originalStack: string | undefined;

	if (err instanceof SubtitleError) {
		code = err.code;
		userMessage = err.message;
		originalStack = err.originalError?.stack ?? err.stack;
	} else if (err instanceof Error) {
		const name = err.name || "Error";
		const message = err.message || "";
		originalStack = err.stack;
		// ERR-7: a chrome.scripting TabSuspendedError is a DOMException but it
		// is NOT a network failure. The scripting path already handles it
		// explicitly via `cause: "scripting"`; the default path should not
		// misclassify it as NETWORK_ERROR, otherwise the user sees a
		// misleading "Network error" instead of the real cause. The check
		// sits ahead of `isNetworkShapedError` so the DOMException-name
		// branch below does not steal this case.
		if (name === "TabSuspendedError") {
			code = "UNKNOWN_ERROR";
		} else if (isNetworkShapedError(err)) {
			// For DOMException / NetworkError / AbortError, keep NETWORK_ERROR
			// because the underlying cause is most often a network/protocol failure.
			code = "NETWORK_ERROR";
		}
		if (message) {
			// Surface the error name so the user can tell a TypeError from a RangeError.
			userMessage = message.toLowerCase().includes(name.toLowerCase()) ? message : `${name}: ${message}`;
		} else {
			userMessage = `Unhandled ${name}`;
		}
	} else if (typeof err === "string") {
		userMessage = err;
	} else if (err != null) {
		userMessage = (err as { message?: string }).message || `Unhandled error: ${JSON.stringify(err).slice(0, 200)}`;
	}

	// ERR-5: surface the original stack. In dev builds we also log a single
	// warning so the developer console has the trace; production behavior
	// is unchanged.
	if (originalStack) {
		if (import.meta.env?.DEV) {
			console.warn(`[mimir] extraction error on tab ${tabId}: ${userMessage}`, originalStack);
		}
	}

	return {
		tabId,
		url: tab?.url || "unknown",
		title: tab?.title || "Unknown",
		errorCode: code,
		userMessage,
		originalStack,
	};
}
