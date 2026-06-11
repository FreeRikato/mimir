console.log("Tab HTML Extractor background service worker loaded");

// COR-13: in-memory record of cancel intents from the side panel. Cleared
// on tab close (chrome.tabs.onRemoved).
const pendingCancellations = new Map<number, number>();
chrome.tabs?.onRemoved?.addListener((tabId) => {
	pendingCancellations.delete(tabId);
});

// Open side panel when extension icon is clicked
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Handle keyboard shortcuts
chrome.commands.onCommand.addListener((command) => {
	console.log("Background: Received command:", command);
	try {
		switch (command) {
			case "extract-to-right":
			case "extract-selected":
			case "extract-highlighted": {
				// Send message to side panel to trigger extraction
				// Use sendMessage with catch to handle case when side panel isn't open yet
				chrome.runtime.sendMessage({ type: "KEYBOARD_COMMAND", command }).catch((err) => {
					// If side panel isn't open, this will fail - that's okay
					console.debug("Background: Could not send message to side panel (may not be open yet):", err);
				});
				break;
			}
		}
	} catch (error) {
		console.error("Background: Failed to handle command:", command, error);
	}
});

chrome.runtime.onInstalled.addListener(() => {
	console.log("Tab HTML Extractor extension installed");
});

// Handle subtitle fetch requests from side panel
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	if (message.type === "FETCH_SUBTITLES") {
		console.log("Background: Received FETCH_SUBTITLES request for URL:", message.url, "format:", message.format);

		const FETCH_TIMEOUT_MS = 120000; // 2 minutes - higher than client-side timeout
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};
		fetch(message.url, {
			signal: controller.signal,
			headers,
		})
			.then(async (response) => {
				clearTimeout(timeoutId);
				console.log("Background: Fetch response status:", response.status);

				// For VTT format, return raw text instead of JSON
				if (message.format === "vtt") {
					const text = await response.text();
					console.log("Background: VTT response received, length:", text.length);
					if (!response.ok) {
						let errorData: unknown = text;
						if (text) {
							try {
								errorData = JSON.parse(text);
							} catch {
								// Keep raw text when payload is not JSON
							}
						}
						const errorMsg =
							errorData && typeof errorData === "object"
								? (errorData as { message?: string; detail?: string }).message ||
									(errorData as { message?: string; detail?: string }).detail ||
									text ||
									`HTTP ${response.status}`
								: text || `HTTP ${response.status}`;
						sendResponse({
							success: false,
							status: response.status,
							statusText: response.statusText,
							error: errorMsg,
							data: errorData,
						});
					} else {
						sendResponse({ success: true, data: text });
					}
				} else {
					// JSON and text formats return JSON - handle parsing errors
					let data: unknown;
					try {
						data = await response.json();
					} catch (jsonErr) {
						console.error("Background: Failed to parse JSON response:", jsonErr);
						sendResponse({
							success: false,
							status: response.status,
							statusText: response.statusText,
							error: "Invalid JSON response from server",
						});
						return;
					}
					console.log("Background: Response data received, success:", response.ok);
					if (!response.ok) {
						const errorMsg =
							data && typeof data === "object"
								? (data as { message?: string; detail?: string }).message ||
									(data as { message?: string; detail?: string }).detail ||
									`HTTP ${response.status}`
								: `HTTP ${response.status}`;
						sendResponse({
							success: false,
							status: response.status,
							statusText: response.statusText,
							error: errorMsg,
							data,
						});
					} else {
						sendResponse({ success: true, data });
					}
				}
			})
			.catch((err) => {
				clearTimeout(timeoutId);
				console.error("Background: Fetch error:", err);
				if (err.name === "AbortError") {
					sendResponse({ success: false, error: `Request timed out after ${FETCH_TIMEOUT_MS / 1000} seconds` });
				} else {
					sendResponse({ success: false, error: err.message || "Network error" });
				}
			});
		return true; // Keep channel open for async response
	}

	if (message.type === "FETCH_PDF_BYTES") {
		const pdfUrl = typeof message.url === "string" ? message.url : "";
		if (!pdfUrl) {
			sendResponse({ success: false, error: "Missing URL" });
			return true;
		}

		const FETCH_TIMEOUT_MS = 60000;
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

		fetch(pdfUrl, { signal: controller.signal })
			.then(async (response) => {
				clearTimeout(timeoutId);
				if (!response.ok) {
					sendResponse({ success: false, status: response.status, error: `HTTP ${response.status}` });
					return;
				}
				const buffer = await response.arrayBuffer();
				sendResponse({ success: true, buffer });
			})
			.catch((err) => {
				clearTimeout(timeoutId);
				if (err instanceof Error && err.name === "AbortError") {
					sendResponse({ success: false, error: "Request timed out" });
				} else {
					sendResponse({ success: false, error: err instanceof Error ? err.message : "Fetch failed" });
				}
			});
		return true;
	}

	if (message.type === "EXTRACT_PDF") {
		const pdfUrl = typeof message.url === "string" ? message.url : "";
		const apiUrl = typeof message.apiUrl === "string" ? message.apiUrl : "";

		if (!pdfUrl || !apiUrl) {
			sendResponse({
				success: false,
				status: 400,
				error: "Invalid PDF extraction request",
			});
			return true;
		}

		const FETCH_TIMEOUT_MS = 75000;
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

		const headers: Record<string, string> = {
			Accept: "application/json",
		};

		const postRemotePdf = () => {
			return fetch(apiUrl, {
				method: "POST",
				signal: controller.signal,
				headers: {
					...headers,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ url: pdfUrl }),
			});
		};

		const postLocalPdf = async () => {
			let localResponse: Response;
			try {
				localResponse = await fetch(pdfUrl, { signal: controller.signal });
			} catch (err) {
				const message =
					err instanceof Error
						? err.message
						: "Unable to access local PDF. Enable extension file URL access in chrome://extensions.";
				sendResponse({
					success: false,
					status: 423,
					error: message,
				});
				return null;
			}

			if (!localResponse.ok) {
				sendResponse({
					success: false,
					status: localResponse.status,
					error: "Unable to read local PDF. Enable extension file URL access in chrome://extensions and retry.",
				});
				return null;
			}

			const blob = await localResponse.blob();
			const form = new FormData();
			form.append("file", blob, "document.pdf");
			form.append("source_url", pdfUrl);

			return fetch(apiUrl, {
				method: "POST",
				signal: controller.signal,
				headers,
				body: form,
			});
		};

		const isLocalFile = pdfUrl.startsWith("file://");
		const requestPromise = isLocalFile ? postLocalPdf() : postRemotePdf();

		Promise.resolve(requestPromise)
			.then(async (response) => {
				clearTimeout(timeoutId);
				if (!response) {
					return;
				}

				const textPayload = await response.text();
				let data: unknown;
				if (textPayload) {
					try {
						data = JSON.parse(textPayload);
					} catch {
						data = { text: textPayload };
					}
				}

				if (!response.ok) {
					const errorMsg =
						data && typeof data === "object"
							? (data as { message?: string; detail?: string }).message ||
								(data as { message?: string; detail?: string }).detail ||
								`HTTP ${response.status}`
							: `HTTP ${response.status}`;

					sendResponse({
						success: false,
						status: response.status,
						statusText: response.statusText,
						error: errorMsg,
						data,
					});
					return;
				}

				sendResponse({
					success: true,
					status: response.status,
					statusText: response.statusText,
					data,
				});
			})
			.catch((err) => {
				clearTimeout(timeoutId);
				if (err instanceof Error && err.name === "AbortError") {
					sendResponse({
						success: false,
						status: 408,
						error: `Request timed out after ${FETCH_TIMEOUT_MS / 1000} seconds`,
					});
					return;
				}

				sendResponse({
					success: false,
					status: 500,
					error: err instanceof Error ? err.message : "PDF extraction request failed",
				});
			});

		return true;
	}

	// COR-13: best-effort cancel signal from the side panel. The MV3
	// chrome.scripting.executeScript call itself is un-cancellable; this
	// handler records the intent and (when the caller supplies
	// `discardTab: true`) tears down the tab to break the SW queue at
	// the cost of reloading the tab on next focus. Side panel should
	// send `{ type: "CANCEL_EXTRACTION", tabId, discardTab? }`.
	if (message.type === "CANCEL_EXTRACTION") {
		const tabId = typeof message.tabId === "number" ? message.tabId : undefined;
		if (tabId !== undefined) {
			pendingCancellations.set(tabId, Date.now());
			if (message.discardTab) {
				chrome.tabs.discard(tabId).catch((err) => {
					console.warn(`[mimir-sw] chrome.tabs.discard failed for ${tabId}:`, err);
				});
			}
		}
		sendResponse({ success: true, tabId });
		return true;
	}

	// Bug 1.1: previously this catch-all called `sendResponse({ status: "received" })`
	// synchronously without `return true`. In MV3 the message channel can close
	// before the response is delivered, so callers waiting for a reply would see
	// nothing. Logging is enough; future message types that need an async response
	// MUST `return true` from their branch (see the handlers above).
	console.log("Background: Received message:", message);
});

// ERR-6: top-level error handlers for the service worker. An unhandled
// `error` or `unhandledrejection` used to take the MV3 worker offline
// for several minutes (Chrome terminates and only re-spawns on a
// message). The handlers below log the failure and re-arm themselves
// so the worker stays responsive. Use `console.warn` (not `error`) to
// avoid alarming the user; the structured data is what matters.
// Node test environments (vitest) do not expose `self`. Guard with
// `typeof self !== "undefined"` so the production worker installs the
// listeners and the test environment skips them.
if (typeof self !== "undefined") {
	self.addEventListener("error", (event) => {
		console.warn("[mimir-sw] uncaught error:", event.message, event.error);
	});
	self.addEventListener("unhandledrejection", (event) => {
		console.warn("[mimir-sw] unhandled promise rejection:", event.reason);
	});
}
