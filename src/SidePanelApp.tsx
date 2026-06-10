import { Clipboard, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { DomainGroup } from "./components/DomainGroup";
import { ExtractionErrorAlert } from "./components/ExtractionErrorAlert";
import { ExtractionProgressDisplay } from "./components/ExtractionProgress";
import { Footer } from "./components/Footer";
import { HistoryPanel } from "./components/HistoryPanel";
import { PdfUpload } from "./components/PdfUpload";
import { SettingsModal } from "./components/SettingsModal";
import { useCloseTabsSetting } from "./hooks/useCloseTabsSetting";
import { useHighlightedTabs } from "./hooks/useHighlightedTabs";
import { useHistory } from "./hooks/useHistory";
import { useSelection } from "./hooks/useSelection";
import { useTabs } from "./hooks/useTabs";
import type {
	DomainGroup as DomainGroupType,
	ExportFormat,
	ExtractedData,
	ExtractionErrorInfo,
	ExtractionProgress,
	ExtractionResult,
	ExtractionStatus,
	SubtitleExtractionFormat,
} from "./types";
import { SubtitleError } from "./types";
import { createAbortControllerRegistry } from "./utils/abortControllerRegistry";
import { getCachedContent, setCachedContent } from "./utils/cache";
import { cancellableExecuteScript, ScriptingTimeoutError } from "./utils/cancellableScripting";
import { createClipboardFallback } from "./utils/clipboardFallback";
import { createDebouncer } from "./utils/debounce";
import { downloadAsFile, formatExport, getMimeType } from "./utils/exporters";
import { createExtractionError } from "./utils/extractionError";
import { createExtractSingleFlight } from "./utils/extractSingleFlight";
import { detectPdfCandidate } from "./utils/pdf";
import { extractPdfContent } from "./utils/pdfExtraction";
import { extractTextFromBuffer, extractTextFromFile } from "./utils/pdfExtractor";
import { createLoadedGuard } from "./utils/persistedSetting";
import { fetchRedditPost, isRedditPostUrl } from "./utils/reddit";
import { getPageHTML } from "./utils/scripting";
import { createSelectionGuard, type SelectionSnapshot } from "./utils/selectionGuard";
import {
	getSubtitleFormatSetting,
	getSubtitleLanguageSetting,
	type SubtitleFormat,
	setSubtitleFormatSetting,
	setSubtitleLanguageSetting,
} from "./utils/settings";
import { createStatusResetter } from "./utils/statusResetter";
import { clearHealthCheckCache, fetchYoutubeSubtitles } from "./utils/subtitles";
import { closeTabsSafely, getTabsToRight } from "./utils/tabHelpers";
import { formatXThread, isXTweetUrl, parseXTweetId, readXDataFromPage } from "./utils/xTwitter";
import { isYouTubeUrl } from "./utils/youtube";

type ClipboardWriteOutcome = "copied" | "requires_manual_copy" | "failed";

// Single source of truth for the pending clipboard channel. The previous
// implementation kept a module-level `pendingClipboardData` variable and a
// separate React state `pendingClipboardContent` that were set and cleared
// in different code paths, allowing them to desync (see bug 1.7).
const clipboardFallback = createClipboardFallback<string>();

/**
 * Per-tab ceiling for `chrome.scripting.executeScript` calls. Hoisted to
 * module scope so both `extractTab` (which now uses
 * `cancellableExecuteScript`) and `extractTabsConcurrent` (which builds the
 * combined AbortSignal) share one source of truth.
 */
const NON_YOUTUBE_TAB_TIMEOUT = 15000; // 15 seconds for non-YouTube content
const PDF_TAB_TIMEOUT = 60000; // 60 seconds for PDF extraction pipeline
const REDDIT_TAB_TIMEOUT = 45000; // 45 seconds for Reddit API + morechildren calls
const X_TAB_TIMEOUT = 15000; // 15 seconds — just an executeScript read, should be instant

/**
 * Safely writes text to clipboard with focus check and user-friendly UX.
 * When the document is not focused (e.g. keyboard shortcuts), stores the
 * data so a later focus event can retry.
 */
async function safeWriteToClipboard(text: string): Promise<ClipboardWriteOutcome> {
	if (!document.hasFocus()) {
		clipboardFallback.setPending(text);
		console.warn("Clipboard write skipped: document not focused. Data stored for retry on focus.");
		return "requires_manual_copy";
	}

	try {
		await navigator.clipboard.writeText(text);
		clipboardFallback.clearPending();
		return "copied";
	} catch (err) {
		// Some browsers throw on focus loss instead of just returning false
		// from hasFocus().
		if (err instanceof Error && err.name === "NotAllowedError") {
			clipboardFallback.setPending(text);
			console.warn("Clipboard write failed: focus required. Data stored for retry on focus.");
			return "requires_manual_copy";
		}
		console.error("Clipboard write failed:", err);
		clipboardFallback.clearPending();
		return "failed";
	}
}

/**
 * Clears any pending clipboard data. Exposed for callers that need to
 * reset the fallback channel (e.g. after a successful manual copy).
 */
function clearPendingClipboard() {
	clipboardFallback.clearPending();
}

// Custom hook to auto-hide progress bars after cancellation
function useAutoHideProgress(
	progress: ExtractionProgress | null,
	setProgress: React.Dispatch<React.SetStateAction<ExtractionProgress | null>>,
	delay: number = 1500,
) {
	useEffect(() => {
		if (progress?.isCancelled) {
			const timeout = setTimeout(() => setProgress(null), delay);
			return () => clearTimeout(timeout);
		}
	}, [progress?.isCancelled, setProgress, delay]);
}

// Helper function to extract a single tab
async function extractTab(
	id: number,
	signal?: AbortSignal,
	subtitleFormat?: SubtitleExtractionFormat,
	subtitleLanguage?: string,
): Promise<{ result: ExtractedData | null; error: ExtractionErrorInfo | null }> {
	// Check for cancellation at start
	if (signal?.aborted) {
		return { result: null, error: null };
	}

	let tab: chrome.tabs.Tab | null = null;
	try {
		tab = await chrome.tabs.get(id);
		if (!tab.url) {
			console.warn(`Tab ${id}: No URL found`);
			return { result: null, error: null };
		}

		const tabUrl = tab.url;
		const pdfCandidate = detectPdfCandidate(tabUrl);

		// Check for cancellation before expensive operations
		if (signal?.aborted) {
			return { result: null, error: null };
		}

		if (isYouTubeUrl(tabUrl)) {
			try {
				const { title, text } = await fetchYoutubeSubtitles(tabUrl, {
					format: subtitleFormat,
					lang: subtitleLanguage,
					onRetry: (attempt, err) => {
						console.warn(`Retry ${attempt} for ${tabUrl}:`, err.message);
					},
					signal,
				});
				// Bug 1.7: previously a YouTube "no result" (empty text) was silent.
				// The user saw nothing extracted and no error toast. Now we surface
				// a NO_SUBTITLES error so the user gets a toast.
				if (!text?.trim()) {
					return {
						result: null,
						error: createExtractionError({ tabId: id, tab, err: null, cause: "youtube-empty" }),
					};
				}
				return {
					result: {
						id,
						timestamp: new Date().toISOString(),
						title,
						url: tabUrl,
						text,
					},
					error: null,
				};
			} catch (err) {
				// Check if error was due to abort
				if (signal?.aborted) {
					return { result: null, error: null };
				}
				const errorInfo = createExtractionError({ tabId: id, tab, err });
				console.error(`Failed to extract YouTube subtitles for tab ${id}:`, err);
				return { result: null, error: errorInfo };
			}
		}

		if (isRedditPostUrl(tabUrl)) {
			try {
				const { title, text } = await fetchRedditPost(tabUrl, { signal });
				return {
					result: {
						id,
						timestamp: new Date().toISOString(),
						title,
						url: tabUrl,
						text,
						contentType: "reddit",
						extractionMethod: "reddit-api",
					},
					error: null,
				};
			} catch (err) {
				if (signal?.aborted) {
					return { result: null, error: null };
				}
				const errorInfo = createExtractionError({ tabId: id, tab, err });
				console.error(`Failed to extract Reddit post for tab ${id}:`, err);
				return { result: null, error: errorInfo };
			}
		}

		if (isXTweetUrl(tabUrl)) {
			try {
				const tweetId = parseXTweetId(tabUrl);
				if (!tweetId) throw new SubtitleError("Could not parse tweet ID from URL", "INVALID_URL", undefined, tabUrl);

				const injection = await cancellableExecuteScript(
					{
						target: { tabId: id },
						world: "MAIN",
						func: readXDataFromPage,
						args: [tweetId],
					},
					{ timeoutMs: X_TAB_TIMEOUT, signal },
				);

				const rawData = injection[0]?.result ?? null;
				if (!rawData) {
					// Bug 1.24: this is the "not yet captured" path — the X content
					// script hasn't run on the page yet. Surface a clear retry hint
					// instead of a generic PARSE_ERROR toast.
					return {
						result: null,
						error: createExtractionError({ tabId: id, tab, err: null, cause: "x-not-captured" }),
					};
				}

				const { title, text, mainFound } = formatXThread(rawData, tweetId);
				// Bug 1.24: distinguish "not yet captured" (rawData was null) from
				// "schema drift" (rawData present but the focal tweet entry is missing
				// from the GraphQL response). The former is a retry hint, the latter
				// a bug-report hint.
				if (!mainFound) {
					return {
						result: null,
						error: createExtractionError({ tabId: id, tab, err: null, cause: "x-schema-drift" }),
					};
				}
				return {
					result: {
						id,
						timestamp: new Date().toISOString(),
						title,
						url: tabUrl,
						text,
						contentType: "twitter",
						extractionMethod: "graphql-intercept",
					},
					error: null,
				};
			} catch (err) {
				if (signal?.aborted) {
					return { result: null, error: null };
				}
				const errorInfo = createExtractionError({ tabId: id, tab, err });
				console.error(`Failed to extract X/Twitter tweet for tab ${id}:`, err);
				return { result: null, error: errorInfo };
			}
		}

		if (pdfCandidate.isPdf) {
			const sourceUrl = pdfCandidate.sourceUrl || tabUrl;

			// Local file:// PDFs cannot be fetched without user granting file access.
			// Return a sentinel error so the UI can show an upload prompt.
			if (pdfCandidate.sourceType === "local") {
				return {
					result: null,
					error: {
						tabId: id,
						url: tabUrl,
						title: tab.title || "Untitled PDF",
						errorCode: "PDF_FILE_UPLOAD_REQUIRED",
						userMessage: "Local PDF — upload the file to extract text.",
					},
				};
			}

			// Remote PDF: try PDF.js (client-side, no backend needed) first.
			if (signal?.aborted) return { result: null, error: null };

			try {
				const bgResponse = await new Promise<{ success: boolean; buffer?: ArrayBuffer; error?: string }>((resolve) => {
					chrome.runtime.sendMessage({ type: "FETCH_PDF_BYTES", url: sourceUrl }, resolve);
				});

				if (signal?.aborted) return { result: null, error: null };

				if (bgResponse?.success && bgResponse.buffer) {
					const { text, pageCount, isScanned } = await extractTextFromBuffer(bgResponse.buffer);

					if (!text.trim()) {
						throw new SubtitleError("No text found in PDF", "PDF_UNSUPPORTED", undefined, sourceUrl);
					}

					if (signal?.aborted) return { result: null, error: null };

					return {
						result: {
							id,
							timestamp: new Date().toISOString(),
							title: tab.title || "PDF",
							url: tabUrl,
							text: isScanned
								? `[Warning: This PDF appears to be scanned or image-based. Text may be incomplete.]\n\n${text}`
								: text,
							contentType: "pdf",
							extractionMethod: "pdf-text",
							charCount: text.length,
							pageCount,
						},
						error: null,
					};
				}

				// PDF.js fetch failed — fall through to backend
				console.warn(`PDF.js fetch failed for ${sourceUrl}: ${bgResponse?.error}. Trying backend.`);
			} catch (pdfJsErr) {
				if (signal?.aborted) return { result: null, error: null };
				console.warn(`PDF.js extraction failed for ${sourceUrl}:`, pdfJsErr, "Trying backend.");
			}

			// Backend fallback
			try {
				const { title, text, meta } = await extractPdfContent(sourceUrl, {
					timeoutMs: 60000,
					signal,
					onRetry: (attempt, err) => {
						console.warn(`PDF backend retry ${attempt} for ${sourceUrl}:`, err.message);
					},
				});

				return {
					result: {
						id,
						timestamp: new Date().toISOString(),
						title,
						url: tabUrl,
						text,
						contentType: "pdf",
						extractionMethod: meta.usedOcr ? "pdf-hybrid" : "pdf-text",
						charCount: meta.charCount,
						pageCount: meta.pageCount,
						truncated: meta.truncated,
					},
					error: null,
				};
			} catch (err) {
				if (signal?.aborted) return { result: null, error: null };
				const errorInfo = createExtractionError({ tabId: id, tab, err });
				console.error(`Failed to extract PDF for tab ${id}:`, err);
				return { result: null, error: errorInfo };
			}
		}

		const cachedContent = await getCachedContent(id, tabUrl);
		if (cachedContent) {
			return {
				result: {
					id,
					timestamp: new Date().toISOString(),
					title: cachedContent.title,
					url: cachedContent.url,
					text: cachedContent.text,
				},
				error: null,
			};
		}

		// Check for cancellation before script injection
		if (signal?.aborted) {
			return { result: null, error: null };
		}

		let injection: chrome.scripting.InjectionResult[] = [];
		try {
			injection = await cancellableExecuteScript(
				{ target: { tabId: id }, func: getPageHTML },
				{ timeoutMs: NON_YOUTUBE_TAB_TIMEOUT, signal },
			);
		} catch (scriptingErr) {
			if (signal?.aborted) return { result: null, error: null };
			// Bug: a hung renderer on a not-yet-loaded / connection-refused tab
			// used to block the worker chain forever because MV3 executeScript
			// has no native abort support. The cancellableExecuteScript wrapper
			// races the call against a hard timeout; surface a clean TIMEOUT
			// error so the worker can skip past the dead tab.
			if (scriptingErr instanceof ScriptingTimeoutError) {
				const errorInfo = createExtractionError({ tabId: id, tab, err: scriptingErr, cause: "scripting-timeout" });
				console.warn(`Tab ${id}: chrome.scripting.executeScript timed out:`, scriptingErr);
				return { result: null, error: errorInfo };
			}
			// Bug 1.6: surface a real error to the user instead of silently
			// returning null. The cause discriminator lets the helper pick a
			// specific user message ("tab suspended", "permission denied",
			// "frame not loaded", ...).
			const errorInfo = createExtractionError({ tabId: id, tab, err: scriptingErr, cause: "scripting" });
			console.warn(`Tab ${id}: chrome.scripting.executeScript failed:`, scriptingErr);
			return { result: null, error: errorInfo };
		}

		if (signal?.aborted) return { result: null, error: null };

		const result = injection[0]?.result as ExtractionResult | undefined;

		if (!result) {
			// Bug 1.6: previously this branch was silent. Surface a specific
			// user-facing error so the user knows the tab wasn't readable.
			const errorInfo = createExtractionError({
				tabId: id,
				tab,
				err: new Error("executeScript returned no result"),
				cause: "scripting",
			});
			console.warn(`Tab ${id}: No content extracted (tab may be suspended or not loaded)`);
			return { result: null, error: errorInfo };
		}

		// Skip cache write if aborted
		if (!signal?.aborted) {
			await setCachedContent(id, { text: result.text, title: result.title, url: result.url });
		}

		return {
			result: {
				id,
				timestamp: new Date().toISOString(),
				title: result.title,
				url: result.url,
				text: result.text,
				contentType: "html",
				extractionMethod: "dom",
			},
			error: null,
		};
	} catch (err) {
		// Check if error was due to abort
		if (signal?.aborted) {
			return { result: null, error: null };
		}
		const errorInfo = createExtractionError({ tabId: id, tab, err });
		console.error(`Failed to extract tab ${id}:`, err);
		return { result: null, error: errorInfo };
	}
}

// Helper to extract tabs concurrently with progress tracking
async function extractTabsConcurrent(
	tabIds: number[],
	signal: AbortSignal | undefined,
	subtitleFormat: SubtitleExtractionFormat | undefined,
	subtitleLanguage: string | undefined,
	onProgress?: (update: {
		completed: number;
		failed: number;
		total: number;
		currentTab: { id: number; title: string } | null;
	}) => void,
): Promise<{
	results: ExtractedData[];
	errors: ExtractionErrorInfo[];
	cancelled: boolean;
	allExtractedTabIds: number[];
}> {
	const CONCURRENCY_LIMIT = 3;

	// Dedupe tabs by URL: extract each unique URL once. The original tab IDs
	// that shared a URL are tracked so callers can still close every duplicate.
	const idToUrl = new Map<number, string>();
	await Promise.all(
		tabIds.map(async (id) => {
			try {
				const tab = await chrome.tabs.get(id);
				idToUrl.set(id, tab.url || "");
			} catch {
				// Tab likely closed between selection and extraction; skip it.
			}
		}),
	);

	const urlToIds = new Map<string, number[]>();
	for (const id of tabIds) {
		if (!idToUrl.has(id)) continue;
		const url = idToUrl.get(id) ?? "";
		// Tabs with no URL (or empty string) are treated as unique per tab to
		// avoid accidentally merging two unrelated tabs.
		const key = url || `__no_url_${id}`;
		const existing = urlToIds.get(key) ?? [];
		existing.push(id);
		urlToIds.set(key, existing);
	}

	const dedupedTabIds: number[] = [];
	const representativeToDuplicates = new Map<number, number[]>();
	for (const ids of urlToIds.values()) {
		const representative = ids[0];
		dedupedTabIds.push(representative);
		representativeToDuplicates.set(representative, ids);
	}

	return new Promise((resolve) => {
		const allExtractedTabIds: number[] = [];
		const results: ExtractedData[] = [];
		const errors: ExtractionErrorInfo[] = [];
		let completed = 0;
		let failed = 0;
		let cancelled = false;

		// Use a queue with atomic access pattern - each worker gets exactly one item at a time
		const queue = [...dedupedTabIds];
		const active = new Set<number>();
		let activeWorkers = 0;

		const checkDone = () => {
			// Only resolve when no workers are active and queue is empty or signal is aborted
			if (activeWorkers === 0 && (queue.length === 0 || signal?.aborted)) {
				resolve({ results, errors, cancelled, allExtractedTabIds });
			}
		};

		const processNext = async (): Promise<void> => {
			// Check for abort before acquiring work
			if (signal?.aborted) {
				cancelled = true;
				activeWorkers--;
				checkDone();
				return;
			}

			// Atomically get next tab (JavaScript shift() is atomic per operation)
			const tabId = queue.shift();

			// No more work - this worker chain is done
			if (tabId === undefined) {
				activeWorkers--;
				checkDone();
				return;
			}

			active.add(tabId);

			let currentTabTitle = "Untitled";
			let currentTabUrl = "unknown";
			let isYoutube = false;
			let isPdf = false;
			let isReddit = false;
			let isX = false;

			try {
				const tab = await chrome.tabs.get(tabId);
				currentTabTitle = tab.title || "Untitled";
				currentTabUrl = tab.url || "unknown";
				isYoutube = tab.url ? isYouTubeUrl(tab.url) : false;
				isPdf = tab.url ? detectPdfCandidate(tab.url).isPdf : false;
				isReddit = tab.url ? isRedditPostUrl(tab.url) : false;
				isX = tab.url ? isXTweetUrl(tab.url) : false;
			} catch {
				// Tab might be closed
			}

			// Report progress with actual tab title
			onProgress?.({
				completed,
				failed,
				total: dedupedTabIds.length,
				currentTab: { id: tabId, title: currentTabTitle },
			});

			try {
				// Only apply timeout for non-YouTube content (YouTube has its own longer timeout path)
				let combinedSignal: AbortSignal | undefined = signal;
				if (!isYoutube) {
					const timeoutMs = isPdf
						? PDF_TAB_TIMEOUT
						: isReddit
							? REDDIT_TAB_TIMEOUT
							: isX
								? X_TAB_TIMEOUT
								: NON_YOUTUBE_TAB_TIMEOUT;
					const timeoutSignal = AbortSignal.timeout(timeoutMs);
					combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
				}

				const { result, error } = await extractTab(tabId, combinedSignal, subtitleFormat, subtitleLanguage);

				// Check if extraction timed out or was cancelled
				if (!result && !error) {
					if (combinedSignal?.aborted && !signal?.aborted) {
						errors.push({
							tabId,
							url: currentTabUrl,
							title: currentTabTitle,
							errorCode: "TIMEOUT",
							userMessage: isPdf
								? "PDF extraction timed out after 60 seconds"
								: isReddit
									? "Reddit extraction timed out after 45 seconds"
									: isX
										? "X/Twitter extraction timed out after 15 seconds"
										: "Extraction timed out after 15 seconds",
						});
						failed++;
					}
					// If user cancelled, don't add error - just stop processing
				} else if (error) {
					errors.push(error);
					failed++;
				} else if (result) {
					results.push(result);
					completed++;
					const duplicates = representativeToDuplicates.get(tabId) ?? [tabId];
					for (const id of duplicates) allExtractedTabIds.push(id);
				}

				onProgress?.({
					completed,
					failed,
					total: dedupedTabIds.length,
					currentTab: null,
				});
			} catch (err) {
				// Extract error message from various error types
				let errorMessage = "Unknown error";
				if (err instanceof Error) {
					errorMessage = err.message || "Unknown error";
					// Add context for DOMException
					if (err.name === "DOMException" && !errorMessage) {
						errorMessage = "Access denied or page not accessible";
					}
				} else if (typeof err === "string") {
					errorMessage = err;
				} else if (err != null) {
					errorMessage = (err as { message?: string }).message || JSON.stringify(err);
				}

				errors.push({
					tabId,
					url: "unknown",
					title: currentTabTitle,
					errorCode: "NETWORK_ERROR",
					userMessage: errorMessage,
				});
				failed++;
			} finally {
				active.delete(tabId);
			}

			// Check for abort again after extraction (outside finally to avoid unsafe return)
			if (signal?.aborted) {
				cancelled = true;
				activeWorkers--;
				checkDone();
				return;
			}

			// Continue processing if there's more work
			await processNext();
		};

		// Start initial workers - each worker processes items sequentially
		const initialWorkers = Math.min(CONCURRENCY_LIMIT, dedupedTabIds.length);
		activeWorkers = initialWorkers;

		for (let i = 0; i < initialWorkers; i++) {
			// Don't await - let workers run concurrently
			processNext().catch((err) => {
				console.error("Worker error:", err);
				activeWorkers--;
				checkDone();
			});
		}
	});
}

export function SidePanelApp() {
	const { groups, isLoading, error, refresh } = useTabs();
	const {
		selectedTabIds,
		selectedCount,
		getSelectedIdsAsArray,
		isTabSelected,
		getDomainSelectionState,
		toggleTab: rawToggleTab,
		toggleDomain: rawToggleDomain,
		clearSelection: rawClearSelection,
	} = useSelection();

	// RC-3: wrap the toggle handlers so any user mutation invalidates
	// the in-flight selection snapshot captured at extraction start.
	// The raw handlers are also called so the underlying set still
	// fires; we just bump the guard's seq in the same tick.
	const toggleTab = useCallback(
		(id: number) => {
			selectionGuardRef.current.markMutated();
			rawToggleTab(id);
		},
		[rawToggleTab],
	);
	const toggleDomain = useCallback(
		(group: DomainGroupType) => {
			selectionGuardRef.current.markMutated();
			rawToggleDomain(group);
		},
		[rawToggleDomain],
	);
	const clearSelection = useCallback(() => {
		selectionGuardRef.current.markMutated();
		rawClearSelection();
	}, [rawClearSelection]);
	const { highlightedCount, highlightedTabs } = useHighlightedTabs();
	const history = useHistory();
	const { closeTabsEnabled, toggleCloseTabs } = useCloseTabsSetting();

	const [isExtracting, setIsExtracting] = useState(false);
	const [isRefreshing, setIsRefreshing] = useState(false);
	const [extractionStatus, setExtractionStatus] = useState<ExtractionStatus>("idle");
	const [extractionErrors, setExtractionErrors] = useState<ExtractionErrorInfo[]>([]);

	// Tabs to right state
	const [tabsToRightCount, setTabsToRightCount] = useState(0);
	const [isExtractingToRight, setIsExtractingToRight] = useState(false);
	const [toRightExtractionStatus, setToRightExtractionStatus] = useState<ExtractionStatus>("idle");
	const [toRightExtractionErrors, setToRightExtractionErrors] = useState<ExtractionErrorInfo[]>([]);

	// Highlighted tabs state
	const [isExtractingHighlighted, setIsExtractingHighlighted] = useState(false);
	const [highlightedExtractionStatus, setHighlightedExtractionStatus] = useState<ExtractionStatus>("idle");
	const [highlightedExtractionErrors, setHighlightedExtractionErrors] = useState<ExtractionErrorInfo[]>([]);

	// Export & History state
	const [isHistoryPanelOpen, setIsHistoryPanelOpen] = useState(false);

	// Settings modal state
	const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
	const [subtitleFormat, setSubtitleFormat] = useState<SubtitleFormat>("json");
	const [subtitleLanguage, setSubtitleLanguage] = useState<string>("en");

	// Progress tracking state
	const [extractionProgress, setExtractionProgress] = useState<ExtractionProgress | null>(null);
	const [toRightExtractionProgress, setToRightExtractionProgress] = useState<ExtractionProgress | null>(null);
	const [highlightedExtractionProgress, setHighlightedExtractionProgress] = useState<ExtractionProgress | null>(null);

	// RC-7: single in-flight AbortController for all three extraction
	// handlers. Replaces the three `useState<AbortController | null>`
	// slots that used to allow a cancel to miss the right run. State
	// mirrors `registry.current()` so the cancel button can render.
	const abortRegistryRef = useRef(createAbortControllerRegistry());

	// RC-1: shared single-flight guard for the three handlers. Both the
	// Footer buttons and the keyboard listener funnel through this so
	// the busy state is identical regardless of which surface the user
	// used.
	const extractSingleFlight = useMemo(() => createExtractSingleFlight(), []);

	// RC-2: monotonic seq for the "success -> idle" status reset. The
	// setTimeout closure captures the seq and only acts if it's still
	// the latest, so a 2s timer from run A cannot clobber run B's
	// "extracting" status.
	const handleExtractResetter = useMemo(() => createStatusResetter(), []);
	const toRightResetter = useMemo(() => createStatusResetter(), []);
	const highlightedResetter = useMemo(() => createStatusResetter(), []);

	// RC-3: selection-clearing guard. The wiring in handleExtract*
	// captures the current selection set on each "Extract" click;
	// on closeTabs success, it only clears if the snapshot is still
	// authoritative. `markMutated` is called by the selection
	// toggles.
	const selectionGuardRef = useRef(createSelectionGuard());
	const extractSelectionSnapshotRef = useRef<SelectionSnapshot | null>(null);

	// Track mount state to prevent state updates on unmounted component
	const isMountedRef = useRef(true);

	// Guards that prevent the subtitle format/language "save" effect
	// from clobbering storage on first mount (see bug 1.6).
	const subtitleFormatGuardRef = useRef(createLoadedGuard());
	const subtitleLanguageGuardRef = useRef(createLoadedGuard());

	// State for showing manual copy button when clipboard is unavailable
	const [showManualCopyButton, setShowManualCopyButton] = useState(false);
	const [pendingClipboardContent, setPendingClipboardContent] = useState<string | null>(null);

	// State for PDF upload fallback prompt
	const [pdfUploadRequest, setPdfUploadRequest] = useState<{ tabId: number; tabTitle: string; tabUrl: string } | null>(
		null,
	);

	useEffect(() => {
		isMountedRef.current = true;
		return () => {
			isMountedRef.current = false;
		};
	}, []);

	// Focus event listener to auto-retry clipboard when user focuses the panel.
	// The single source of truth for pending data is `clipboardFallback`; React
	// state mirrors it so the manual-copy button can show / hide.
	useEffect(() => {
		const handleFocus = async () => {
			if (!clipboardFallback.hasPending()) return;
			const outcome = await clipboardFallback.tryRetry({
				hasFocus: () => document.hasFocus(),
				write: (value) => navigator.clipboard.writeText(value),
			});
			if (outcome === "copied") {
				setPendingClipboardContent(null);
				setShowManualCopyButton(false);
				toast.success("Copied to clipboard!", { id: "clipboard-auto-success" });
			} else if (outcome === "failed") {
				// Non-focus failure: controller already cleared the pending
				// data. Mirror that in React state.
				setPendingClipboardContent(null);
				setShowManualCopyButton(false);
				toast.error("Clipboard unavailable");
			}
			// outcome === "requires_manual_copy" — pending data preserved,
			// UI button stays visible.
		};

		document.addEventListener("focus", handleFocus, true); // Use capture phase
		return () => {
			document.removeEventListener("focus", handleFocus, true);
		};
	}, []);

	// Auto-hide progress bars after cancellation
	useAutoHideProgress(extractionProgress, setExtractionProgress);
	useAutoHideProgress(toRightExtractionProgress, setToRightExtractionProgress);
	useAutoHideProgress(highlightedExtractionProgress, setHighlightedExtractionProgress);

	const handleRefresh = useCallback(async () => {
		setIsRefreshing(true);
		clearSelection();
		await refresh();
		setIsRefreshing(false);
	}, [refresh, clearSelection]);

	// Effect to track tabs to right count. Bug 1.9: the four chrome.tabs.*
	// listeners used to trigger an immediate chrome.tabs.query. Opening 20 tabs
	// in a second = 20 queries. The listeners now coalesce into one query
	// after a 500ms idle window (matches the debounce in useTabs).
	useEffect(() => {
		const updateTabsToRightCount = async () => {
			const tabs = await getTabsToRight();
			setTabsToRightCount(tabs.length);
		};

		updateTabsToRightCount();

		const debouncer = createDebouncer(500);
		const handleTabChange = () => {
			debouncer.schedule(() => {
				void updateTabsToRightCount();
			});
		};

		chrome.tabs.onMoved.addListener(handleTabChange);
		chrome.tabs.onActivated.addListener(handleTabChange);
		chrome.tabs.onCreated.addListener(handleTabChange);
		chrome.tabs.onRemoved.addListener(handleTabChange);

		return () => {
			debouncer.cancel();
			chrome.tabs.onMoved.removeListener(handleTabChange);
			chrome.tabs.onActivated.removeListener(handleTabChange);
			chrome.tabs.onCreated.removeListener(handleTabChange);
			chrome.tabs.onRemoved.removeListener(handleTabChange);
		};
	}, []);

	// Effect to load subtitle format from storage. Marks the guard as loaded
	// only after the stored value lands in React state, so a save that fires
	// from the initial state does not clobber storage.
	useEffect(() => {
		let cancelled = false;
		const loadSubtitleFormat = async () => {
			const format = await getSubtitleFormatSetting();
			if (cancelled) return;
			setSubtitleFormat(format);
			subtitleFormatGuardRef.current.markLoaded();
		};
		loadSubtitleFormat();
		return () => {
			cancelled = true;
		};
	}, []);

	// Effect to save subtitle format to storage when it changes. The guard
	// suppresses the initial-mount save so the default state does not
	// overwrite the stored value before the load resolves.
	useEffect(() => {
		void subtitleFormatGuardRef.current.save(subtitleFormat, setSubtitleFormatSetting);
	}, [subtitleFormat]);

	// Effect to load subtitle language from storage. Marks the guard as loaded
	// only after the stored value lands in React state, so a save that fires
	// from the initial state does not clobber storage.
	useEffect(() => {
		let cancelled = false;
		const loadSubtitleLanguage = async () => {
			const lang = await getSubtitleLanguageSetting();
			if (cancelled) return;
			setSubtitleLanguage(lang);
			subtitleLanguageGuardRef.current.markLoaded();
		};
		loadSubtitleLanguage();
		return () => {
			cancelled = true;
		};
	}, []);

	// Effect to save subtitle language to storage when it changes. The guard
	// suppresses the initial-mount save so the default state does not
	// overwrite the stored value before the load resolves.
	useEffect(() => {
		void subtitleLanguageGuardRef.current.save(subtitleLanguage, setSubtitleLanguageSetting);
	}, [subtitleLanguage]);

	const resetClipboardFallbackState = useCallback(() => {
		clearPendingClipboard();
		setPendingClipboardContent(null);
		setShowManualCopyButton(false);
	}, []);

	const copyExtractedResultsToClipboard = useCallback(
		async (results: ExtractedData[]): Promise<ClipboardWriteOutcome> => {
			if (results.length === 0) {
				resetClipboardFallbackState();
				return "copied";
			}

			const serializedResults = JSON.stringify(results, null, 2);
			const outcome = await safeWriteToClipboard(serializedResults);

			if (outcome === "requires_manual_copy") {
				setPendingClipboardContent(serializedResults);
				setShowManualCopyButton(true);
				return outcome;
			}

			resetClipboardFallbackState();

			if (outcome === "failed") {
				toast.error("Failed to copy to clipboard");
			}

			return outcome;
		},
		[resetClipboardFallbackState],
	);

	// Show upload prompt for the first PDF tab that needs it
	const checkAndPromptPdfUpload = useCallback((errors: ExtractionErrorInfo[]) => {
		const uploadRequired = errors.find((e) => e.errorCode === "PDF_FILE_UPLOAD_REQUIRED");
		if (uploadRequired) {
			setPdfUploadRequest({ tabId: uploadRequired.tabId, tabTitle: uploadRequired.title, tabUrl: uploadRequired.url });
		}
	}, []);

	const handleExtract = useCallback(async () => {
		const selectedIds = getSelectedIdsAsArray();
		if (selectedIds.length === 0) return;
		resetClipboardFallbackState();

		// RC-7: one in-flight AbortController. begin() aborts the
		// previous one (a stale run from a prior mode), so cancel
		// always kills the latest run.
		const controller = abortRegistryRef.current.begin();

		// RC-2: schedule a fresh idle transition seq. The setTimeout
		// closure below will only act if this seq is still the latest
		// when it fires, so a 2s timer from a previous run cannot
		// clobber the "extracting" status of a newer run.
		handleExtractResetter.cancel();
		const idleSeq = handleExtractResetter.schedule(2000);

		// RC-3: capture the current selection at extraction start.
		// On closeTabs success, only `clearSelection()` if the
		// snapshot is still authoritative (no user toggle since).
		extractSelectionSnapshotRef.current = selectionGuardRef.current.captureSnapshot(selectedTabIds);

		setIsExtracting(true);
		setExtractionStatus("extracting");
		setExtractionErrors([]);

		// Initialize progress state
		setExtractionProgress({
			total: selectedIds.length,
			completed: 0,
			failed: 0,
			currentTabId: null,
			currentTabTitle: null,
			startTime: Date.now(),
			isCancelled: false,
		});

		try {
			const { results, errors, cancelled, allExtractedTabIds } = await extractTabsConcurrent(
				selectedIds,
				controller.signal,
				subtitleFormat,
				subtitleLanguage,
				(update) => {
					setExtractionProgress((prev) =>
						prev
							? {
									...prev,
									completed: update.completed,
									failed: update.failed,
									currentTabId: update.currentTab?.id ?? null,
									currentTabTitle: update.currentTab?.title ?? null,
								}
							: null,
					);
				},
			);

			setExtractionErrors(errors);
			checkAndPromptPdfUpload(errors);
			const validResults = results;

			// Always copy valid results to clipboard, even if cancelled
			let clipboardOutcome: ClipboardWriteOutcome = "copied";
			if (validResults.length > 0) {
				clipboardOutcome = await copyExtractedResultsToClipboard(validResults);

				// ALWAYS save to history regardless of clipboard success (as long as not cancelled)
				if (!cancelled) {
					await history.addEntry(validResults, "json", "clipboard");

					// Close tabs if setting is enabled
					if (closeTabsEnabled) {
						const { closed } = await closeTabsSafely(allExtractedTabIds);
						// RC-3: only clear if the snapshot is still
						// authoritative AND the closed tabs include
						// at least one from the user's selection.
						const snap = extractSelectionSnapshotRef.current;
						if (closed > 0 && snap && selectionGuardRef.current.shouldClear(snap, allExtractedTabIds, selectedTabIds)) {
							clearSelection();
						}
					}
				}
			}

			if (cancelled) {
				handleExtractResetter.cancel();
				setExtractionStatus("idle");
				if (clipboardOutcome === "copied" && validResults.length > 0) {
					toast.success(
						`Cancelled. ${validResults.length} tab${validResults.length === 1 ? "" : "s"} copied to clipboard.`,
						{
							icon: "⚠️",
						},
					);
				}
			} else if (errors.length > 0 && validResults.length === 0) {
				handleExtractResetter.cancel();
				setExtractionStatus("error");
				toast.error(`Extraction failed for all ${selectedIds.length} tab${selectedIds.length > 1 ? "s" : ""}`);
			} else if (errors.length > 0) {
				handleExtractResetter.cancel();
				setExtractionStatus("partial");
				toast(`Extracted ${validResults.length} tab${validResults.length > 1 ? "s" : ""}, ${errors.length} failed`, {
					icon: "⚠️",
				});
			} else {
				setExtractionStatus("success");
				if (clipboardOutcome === "copied") {
					toast.success(
						`Extracted content from ${validResults.length} tab${validResults.length > 1 ? "s" : ""} and copied to clipboard`,
					);
				}
				setTimeout(() => {
					if (isMountedRef.current && handleExtractResetter.isLatest(idleSeq.seq)) {
						setExtractionStatus("idle");
					}
				}, 2000);
			}
		} catch (err) {
			console.error("Extraction failed:", err);
			handleExtractResetter.cancel();
			setExtractionStatus("error");
			toast.error("Content extraction failed. Please try again.");
		} finally {
			setIsExtracting(false);
			setExtractionProgress(null);
			abortRegistryRef.current.clear();
		}
	}, [
		getSelectedIdsAsArray,
		selectedTabIds,
		resetClipboardFallbackState,
		subtitleFormat,
		copyExtractedResultsToClipboard,
		history,
		closeTabsEnabled,
		clearSelection,
		checkAndPromptPdfUpload,
		handleExtractResetter,
	]);

	// RC-7: cancel reads the current controller from the registry so
	// it always kills the latest in-flight run, regardless of which
	// handler started it. Progress-state mutation is per-handler so
	// the right progress card flips to "cancelled".
	const handleCancelExtraction = useCallback(() => {
		abortRegistryRef.current.abort();
		setExtractionProgress((prev) => (prev ? { ...prev, isCancelled: true } : null));
	}, []);

	const handleCancelToRightExtraction = useCallback(() => {
		abortRegistryRef.current.abort();
		setToRightExtractionProgress((prev) => (prev ? { ...prev, isCancelled: true } : null));
	}, []);

	const handleCancelHighlightedExtraction = useCallback(() => {
		abortRegistryRef.current.abort();
		setHighlightedExtractionProgress((prev) => (prev ? { ...prev, isCancelled: true } : null));
	}, []);

	const handleExtractToRight = useCallback(async () => {
		const tabsToRight = await getTabsToRight();
		const tabIds = tabsToRight.map((t) => t.id);

		if (tabIds.length === 0) return;
		resetClipboardFallbackState();

		// RC-7: single registry. begin() aborts any prior in-flight
		// controller, so the cancel button always targets the
		// newest run.
		const controller = abortRegistryRef.current.begin();

		// RC-2: invalidate the previous run's idle-transition seq.
		toRightResetter.cancel();
		const idleSeq = toRightResetter.schedule(2000);

		setIsExtractingToRight(true);
		setToRightExtractionStatus("extracting");
		setToRightExtractionErrors([]);

		// Initialize progress state
		setToRightExtractionProgress({
			total: tabIds.length,
			completed: 0,
			failed: 0,
			currentTabId: null,
			currentTabTitle: null,
			startTime: Date.now(),
			isCancelled: false,
		});

		try {
			const { results, errors, cancelled, allExtractedTabIds } = await extractTabsConcurrent(
				tabIds,
				controller.signal,
				subtitleFormat,
				subtitleLanguage,
				(update) => {
					setToRightExtractionProgress((prev) =>
						prev
							? {
									...prev,
									completed: update.completed,
									failed: update.failed,
									currentTabId: update.currentTab?.id ?? null,
									currentTabTitle: update.currentTab?.title ?? null,
								}
							: null,
					);
				},
			);

			setToRightExtractionErrors(errors);
			checkAndPromptPdfUpload(errors);
			const validResults = results;

			// Always copy valid results to clipboard, even if cancelled
			let clipboardOutcome: ClipboardWriteOutcome = "copied";
			if (validResults.length > 0) {
				clipboardOutcome = await copyExtractedResultsToClipboard(validResults);

				// ALWAYS save to history regardless of clipboard success (as long as not cancelled)
				if (!cancelled) {
					await history.addEntry(validResults, "json", "clipboard");

					// Close tabs if setting is enabled
					if (closeTabsEnabled) {
						const { closed } = await closeTabsSafely(allExtractedTabIds);
						// RC-3: handleExtractToRight's inputs are NOT
						// the user's footer selection - they're
						// whatever tabs sit to the right of the
						// active one. Clearing the footer selection
						// here was racy and conceptually wrong; we
						// only call it if the closed tabs happen to
						// overlap a still-valid footer snapshot.
						const snap = extractSelectionSnapshotRef.current;
						if (closed > 0 && snap && selectionGuardRef.current.shouldClear(snap, allExtractedTabIds, selectedTabIds)) {
							clearSelection();
						}
					}
				}
			}

			if (cancelled) {
				toRightResetter.cancel();
				setToRightExtractionStatus("idle");
				if (clipboardOutcome === "copied" && validResults.length > 0) {
					toast.success(
						`Cancelled. ${validResults.length} tab${validResults.length === 1 ? "" : "s"} copied to clipboard.`,
						{
							icon: "⚠️",
						},
					);
				}
			} else if (errors.length > 0 && validResults.length === 0) {
				toRightResetter.cancel();
				setToRightExtractionStatus("error");
				toast.error(`Extraction failed for all ${tabIds.length} tab${tabIds.length > 1 ? "s" : ""}`);
			} else if (errors.length > 0) {
				toRightResetter.cancel();
				setToRightExtractionStatus("partial");
				toast(`Extracted ${validResults.length} tab${validResults.length > 1 ? "s" : ""}, ${errors.length} failed`, {
					icon: "⚠️",
				});
			} else {
				setToRightExtractionStatus("success");
				if (clipboardOutcome === "copied") {
					toast.success(
						`Extracted content from ${validResults.length} tab${validResults.length > 1 ? "s" : ""} and copied to clipboard`,
					);
				}
				setTimeout(() => {
					if (isMountedRef.current && toRightResetter.isLatest(idleSeq.seq)) {
						setToRightExtractionStatus("idle");
					}
				}, 2000);
			}
		} catch (err) {
			console.error("Extraction failed:", err);
			toRightResetter.cancel();
			setToRightExtractionStatus("error");
			toast.error("Content extraction failed. Please try again.");
		} finally {
			setIsExtractingToRight(false);
			setToRightExtractionProgress(null);
			abortRegistryRef.current.clear();
		}
	}, [
		resetClipboardFallbackState,
		subtitleFormat,
		copyExtractedResultsToClipboard,
		history,
		closeTabsEnabled,
		clearSelection,
		checkAndPromptPdfUpload,
		selectedTabIds,
		toRightResetter,
	]);

	const handleExtractHighlighted = useCallback(async () => {
		const tabIds = highlightedTabs.map((t) => t.id);

		if (tabIds.length === 0) return;
		resetClipboardFallbackState();

		// RC-7: single registry; begin() aborts any previous
		// in-flight run before installing this one.
		const controller = abortRegistryRef.current.begin();

		// RC-2: invalidate the previous run's idle-transition seq.
		highlightedResetter.cancel();
		const idleSeq = highlightedResetter.schedule(2000);

		setIsExtractingHighlighted(true);
		setHighlightedExtractionStatus("extracting");
		setHighlightedExtractionErrors([]);

		// Initialize progress state
		setHighlightedExtractionProgress({
			total: tabIds.length,
			completed: 0,
			failed: 0,
			currentTabId: null,
			currentTabTitle: null,
			startTime: Date.now(),
			isCancelled: false,
		});

		try {
			const { results, errors, cancelled, allExtractedTabIds } = await extractTabsConcurrent(
				tabIds,
				controller.signal,
				subtitleFormat,
				subtitleLanguage,
				(update) => {
					setHighlightedExtractionProgress((prev) =>
						prev
							? {
									...prev,
									completed: update.completed,
									failed: update.failed,
									currentTabId: update.currentTab?.id ?? null,
									currentTabTitle: update.currentTab?.title ?? null,
								}
							: null,
					);
				},
			);

			setHighlightedExtractionErrors(errors);
			checkAndPromptPdfUpload(errors);
			const validResults = results;

			// Always copy valid results to clipboard, even if cancelled
			let clipboardOutcome: ClipboardWriteOutcome = "copied";
			if (validResults.length > 0) {
				clipboardOutcome = await copyExtractedResultsToClipboard(validResults);

				// ALWAYS save to history regardless of clipboard success (as long as not cancelled)
				if (!cancelled) {
					await history.addEntry(validResults, "json", "clipboard");

					// Close tabs if setting is enabled
					if (closeTabsEnabled) {
						const { closed } = await closeTabsSafely(allExtractedTabIds);
						// RC-3: handleExtractHighlighted's inputs are
						// the Chrome-highlighted tabs, not the
						// user's footer selection. Clearing the
						// footer selection was racy and
						// conceptually wrong; only do it if the
						// closed tabs overlap a still-valid footer
						// snapshot.
						const snap = extractSelectionSnapshotRef.current;
						if (closed > 0 && snap && selectionGuardRef.current.shouldClear(snap, allExtractedTabIds, selectedTabIds)) {
							clearSelection();
						}
					}
				}
			}

			if (cancelled) {
				highlightedResetter.cancel();
				setHighlightedExtractionStatus("idle");
				if (clipboardOutcome === "copied" && validResults.length > 0) {
					toast.success(
						`Cancelled. ${validResults.length} tab${validResults.length === 1 ? "" : "s"} copied to clipboard.`,
						{
							icon: "⚠️",
						},
					);
				}
			} else if (errors.length > 0 && validResults.length === 0) {
				highlightedResetter.cancel();
				setHighlightedExtractionStatus("error");
				toast.error(`Extraction failed for all ${tabIds.length} tab${tabIds.length > 1 ? "s" : ""}`);
			} else if (errors.length > 0) {
				highlightedResetter.cancel();
				setHighlightedExtractionStatus("partial");
				toast(`Extracted ${validResults.length} tab${validResults.length > 1 ? "s" : ""}, ${errors.length} failed`, {
					icon: "⚠️",
				});
			} else {
				setHighlightedExtractionStatus("success");
				if (clipboardOutcome === "copied") {
					toast.success(
						`Extracted content from ${validResults.length} tab${validResults.length > 1 ? "s" : ""} and copied to clipboard`,
					);
				}
				setTimeout(() => {
					if (isMountedRef.current && highlightedResetter.isLatest(idleSeq.seq)) {
						setHighlightedExtractionStatus("idle");
					}
				}, 2000);
			}
		} catch (err) {
			console.error("Extraction failed:", err);
			highlightedResetter.cancel();
			setHighlightedExtractionStatus("error");
			toast.error("Content extraction failed. Please try again.");
		} finally {
			setIsExtractingHighlighted(false);
			setHighlightedExtractionProgress(null);
			abortRegistryRef.current.clear();
		}
	}, [
		highlightedTabs,
		resetClipboardFallbackState,
		subtitleFormat,
		copyExtractedResultsToClipboard,
		history,
		closeTabsEnabled,
		clearSelection,
		checkAndPromptPdfUpload,
		selectedTabIds,
		highlightedResetter,
	]);

	// Export & History handlers
	const handleOpenHistory = useCallback(() => {
		setIsHistoryPanelOpen(true);
	}, []);

	const handleCloseHistory = useCallback(() => {
		setIsHistoryPanelOpen(false);
	}, []);

	// Settings handlers
	const handleOpenSettings = useCallback(() => {
		setIsSettingsModalOpen(true);
	}, []);

	const handleCloseSettings = useCallback(() => {
		setIsSettingsModalOpen(false);
	}, []);

	const handleExportFromFormatModal = useCallback(
		async (data: ExtractedData[], format: ExportFormat, filename: string) => {
			try {
				const formatted = formatExport(data, format);
				const mimeType = getMimeType(format);
				downloadAsFile(formatted, filename, mimeType);
				toast.success(`Downloaded as ${filename}`);
				// Save to history
				await history.addEntry(data, format, "file", filename);
			} catch (err) {
				console.error("Export failed:", err);
				toast.error("Export failed. Please try again.");
			}
		},
		[history],
	);

	const handleCopy = useCallback(
		async (data: ExtractedData[], format: ExportFormat) => {
			try {
				const formatted = formatExport(data, format);
				const outcome = await safeWriteToClipboard(formatted);
				if (outcome === "copied") {
					resetClipboardFallbackState();
					toast.success("Copied to clipboard");
				} else if (outcome === "requires_manual_copy") {
					setPendingClipboardContent(formatted);
					setShowManualCopyButton(true);
				} else {
					resetClipboardFallbackState();
					toast.error("Failed to copy to clipboard");
				}
			} catch (err) {
				console.error("Copy to clipboard failed:", err);
				toast.error("Failed to copy to clipboard");
			}
		},
		[resetClipboardFallbackState],
	);

	// Handler for manual copy button (when clipboard is unavailable due to focus)
	const handleManualCopy = useCallback(async () => {
		if (!pendingClipboardContent) return;

		try {
			await navigator.clipboard.writeText(pendingClipboardContent);
			// Clear the controller FIRST so the focus handler can't race and
			// re-trigger; then update React state.
			clearPendingClipboard();
			setPendingClipboardContent(null);
			setShowManualCopyButton(false);
			toast.success("Copied to clipboard!");
		} catch (err) {
			console.error("Manual copy failed:", err);
			toast.error("Still unavailable. Please click the side panel first.");
		}
	}, [pendingClipboardContent]);

	const handlePdfFileSelected = useCallback(
		async (file: File) => {
			if (!pdfUploadRequest) return;
			const { tabId, tabTitle, tabUrl } = pdfUploadRequest;
			setPdfUploadRequest(null);

			try {
				const { text, pageCount, isScanned } = await extractTextFromFile(file);
				if (!text.trim()) {
					toast.error("No text found in uploaded PDF.");
					return;
				}

				const result: ExtractedData = {
					id: tabId,
					timestamp: new Date().toISOString(),
					title: tabTitle,
					url: tabUrl,
					text: isScanned
						? `[Warning: This PDF appears to be scanned or image-based. Text may be incomplete.]\n\n${text}`
						: text,
					contentType: "pdf",
					extractionMethod: "pdf-text",
					charCount: text.length,
					pageCount,
				};

				const clipboardOutcome = await copyExtractedResultsToClipboard([result]);
				await history.addEntry([result], "json", "clipboard");

				if (clipboardOutcome === "copied") {
					toast.success("PDF extracted and copied to clipboard");
				}
			} catch (err) {
				console.error("PDF file extraction failed:", err);
				toast.error(err instanceof Error ? err.message : "Failed to extract PDF");
			}
		},
		[pdfUploadRequest, copyExtractedResultsToClipboard, history],
	);

	// Effect to handle keyboard shortcut commands from background.
	// RC-1: the keyboard listener and the Footer buttons funnel
	// through the same single-flight guard. A click racing with a
	// keyboard tap (or two rapid clicks) no longer launches two
	// extractions in parallel.
	useEffect(() => {
		const handleMessage = (message: { type: string; command: string }) => {
			if (message.type !== "KEYBOARD_COMMAND") return;
			const run = async () => {
				switch (message.command) {
					case "extract-to-right":
						await handleExtractToRight();
						break;
					case "extract-selected":
						await handleExtract();
						break;
					case "extract-highlighted":
						await handleExtractHighlighted();
						break;
				}
			};
			const result = extractSingleFlight.tryRun(run);
			if (!result.ok) {
				toast("Extraction already in progress", { icon: "⏳", id: "extraction-busy" });
			}
		};

		chrome.runtime.onMessage.addListener(handleMessage);
		return () => {
			chrome.runtime.onMessage.removeListener(handleMessage);
		};
	}, [handleExtractToRight, handleExtract, handleExtractHighlighted, extractSingleFlight]);

	return (
		<div className="h-screen w-full flex flex-col text-glass-primary">
			{/* Progress Bars - show all active extractions */}
			{extractionProgress && (
				<div className="sticky top-0 z-20 px-4 pt-4">
					<ExtractionProgressDisplay progress={extractionProgress} onCancel={handleCancelExtraction} />
				</div>
			)}
			{toRightExtractionProgress && (
				<div className="sticky top-0 z-20 px-4 pt-4">
					<ExtractionProgressDisplay progress={toRightExtractionProgress} onCancel={handleCancelToRightExtraction} />
				</div>
			)}
			{highlightedExtractionProgress && (
				<div className="sticky top-0 z-20 px-4 pt-4">
					<ExtractionProgressDisplay
						progress={highlightedExtractionProgress}
						onCancel={handleCancelHighlightedExtraction}
					/>
				</div>
			)}

			{/* Error Alert */}
			{extractionErrors.length > 0 && !extractionProgress && (
				<ExtractionErrorAlert
					errors={extractionErrors}
					onDismiss={() => {
						setExtractionErrors([]);
						setExtractionStatus("idle");
					}}
					// Bug 1.20: wire the "Retry backend" button to clear the
					// health-check cache and re-run the failed extractions.
					onRetryBackend={async () => {
						await clearHealthCheckCache();
						setExtractionErrors([]);
						setExtractionStatus("idle");
						// Re-run the last attempted extraction. The user can hit the
						// "Extract tabs" button manually; the cleared cache means
						// the next run starts fresh.
						toast.success("Backend cache cleared. Run extraction again.");
					}}
				/>
			)}

			{/* PDF upload prompt - shown when a local/auth-protected PDF needs manual upload */}
			{pdfUploadRequest && (
				<div className="px-4 pt-2">
					<PdfUpload
						tabTitle={pdfUploadRequest.tabTitle}
						tabUrl={pdfUploadRequest.tabUrl}
						onFileSelected={handlePdfFileSelected}
						onDismiss={() => setPdfUploadRequest(null)}
					/>
				</div>
			)}

			{/* Manual Copy Button - shown when clipboard is unavailable */}
			{showManualCopyButton && pendingClipboardContent && (
				<div className="sticky top-0 z-30 px-4 pt-2">
					<div className="glass-heavy rounded-lg p-3 border border-amber-500/30 bg-amber-500/10">
						<div className="flex items-center justify-between gap-3">
							<div className="flex items-center gap-2">
								<Clipboard className="w-4 h-4 text-amber-400 shrink-0" />
								<p className="text-sm text-glass-primary">Click to copy your extracted content</p>
							</div>
							<button
								onClick={handleManualCopy}
								className="px-3 py-1.5 text-sm font-medium rounded-lg bg-amber-500 hover:bg-amber-600 text-white transition-colors shrink-0"
							>
								Copy Now
							</button>
						</div>
					</div>
				</div>
			)}

			{/* Content */}
			<main className="flex-1 overflow-y-auto p-4 pt-6 space-y-3">
				{isLoading ? (
					<div className="flex flex-col items-center justify-center h-full text-glass-muted">
						<Loader2 className="w-8 h-8 animate-spin mb-3" />
						<p className="text-sm">Loading tabs...</p>
					</div>
				) : error ? (
					<div className="flex flex-col items-center justify-center h-full text-red-400">
						<p className="text-sm font-medium">Error loading tabs</p>
						<p className="text-xs text-glass-muted mt-1">{error}</p>
					</div>
				) : groups.length === 0 ? (
					<div className="flex flex-col items-center justify-center h-full text-glass-muted">
						<p className="text-sm font-medium">No extractable tabs found</p>
						<p className="text-xs text-glass-muted/70 mt-1">Only HTTP/HTTPS pages can be extracted</p>
					</div>
				) : (
					groups.map((group) => (
						<DomainGroup
							key={group.domain}
							group={group}
							selectionState={getDomainSelectionState(group)}
							isTabSelected={isTabSelected}
							onToggleDomain={() => toggleDomain(group)}
							onToggleTab={toggleTab}
						/>
					))
				)}
			</main>

			{/* Footer. RC-1: the three extraction handlers are wrapped
			through the shared single-flight guard so a click that
			races with the keyboard shortcut (or two rapid clicks)
			cannot launch two extractions in parallel. */}
			<Footer
				selectedCount={selectedCount}
				isExtracting={isExtracting}
				isRefreshing={isRefreshing}
				extractionStatus={extractionStatus}
				extractionErrors={extractionErrors}
				onExtract={() => {
					const r = extractSingleFlight.tryRun(() => handleExtract());
					if (!r.ok) toast("Extraction already in progress", { icon: "⏳", id: "extraction-busy" });
				}}
				onRefresh={handleRefresh}
				onCancel={clearSelection}
				tabsToRightCount={tabsToRightCount}
				onExtractToRight={() => {
					const r = extractSingleFlight.tryRun(() => handleExtractToRight());
					if (!r.ok) toast("Extraction already in progress", { icon: "⏳", id: "extraction-busy" });
				}}
				isExtractingToRight={isExtractingToRight}
				toRightExtractionStatus={toRightExtractionStatus}
				toRightExtractionErrors={toRightExtractionErrors}
				highlightedCount={highlightedCount}
				onExtractHighlighted={() => {
					const r = extractSingleFlight.tryRun(() => handleExtractHighlighted());
					if (!r.ok) toast("Extraction already in progress", { icon: "⏳", id: "extraction-busy" });
				}}
				isExtractingHighlighted={isExtractingHighlighted}
				highlightedExtractionStatus={highlightedExtractionStatus}
				highlightedExtractionErrors={highlightedExtractionErrors}
				onOpenSettings={handleOpenSettings}
			/>

			{/* History Panel */}
			<HistoryPanel
				isOpen={isHistoryPanelOpen}
				onClose={handleCloseHistory}
				entries={history.entries}
				count={history.count}
				searchResultCount={history.searchResultCount}
				isLoading={history.isLoading}
				error={history.error}
				hasMore={history.hasMore}
				onLoadMore={history.loadMore}
				onDelete={history.deleteEntry}
				onClearAll={history.clearAll}
				onSearch={history.search}
				onClearSearch={history.clearSearch}
				onExportFromFormatModal={handleExportFromFormatModal}
				onCopy={handleCopy}
			/>

			{/* Settings Modal */}
			<SettingsModal
				isOpen={isSettingsModalOpen}
				onClose={handleCloseSettings}
				subtitleFormat={subtitleFormat}
				onFormatChange={setSubtitleFormat}
				subtitleLanguage={subtitleLanguage}
				onLanguageChange={setSubtitleLanguage}
				closeTabsEnabled={closeTabsEnabled}
				onToggleCloseTabs={toggleCloseTabs}
				onOpenHistory={handleOpenHistory}
			/>
		</div>
	);
}
