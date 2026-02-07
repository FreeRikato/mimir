console.log("Tab HTML Extractor background service worker loaded");

// API key for subtitle backend authentication (injected by Vite)
const SUBTITLES_API_KEY =
	typeof import.meta.env.VITE_SUBTITLES_API_KEY === "string" ? import.meta.env.VITE_SUBTITLES_API_KEY : "";

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

		// Prepare headers with API key authentication
		// Use API key from message (from side panel) or fall back to env var
		const apiKey = message.apiKey || SUBTITLES_API_KEY;
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};
		if (apiKey) {
			headers["X-API-Key"] = apiKey;
		}

		fetch(message.url, {
			signal: controller.signal,
			headers,
		})
			.then(async (response) => {
				clearTimeout(timeoutId);
				console.log("Background: Fetch response status:", response.status);

				// Handle authentication errors before parsing
				if (response.status === 401) {
					sendResponse({
						success: false,
						status: response.status,
						statusText: response.statusText,
						error: "Unauthorized: Please check your API key configuration (VITE_SUBTITLES_API_KEY)",
					});
					return;
				}
				if (response.status === 403) {
					sendResponse({
						success: false,
						status: response.status,
						statusText: response.statusText,
						error:
							"Access forbidden: Invalid or missing API key. Please configure VITE_SUBTITLES_API_KEY in your .env file.",
					});
					return;
				}

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

	if (message.type === "EXTRACT_PDF") {
		const pdfUrl = typeof message.url === "string" ? message.url : "";
		const apiUrl = typeof message.apiUrl === "string" ? message.apiUrl : "";
		const apiKey = message.apiKey || SUBTITLES_API_KEY;

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
		if (apiKey) {
			headers["X-API-Key"] = apiKey;
		}

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

	console.log("Background: Received message:", message);
	sendResponse({ status: "received" });
});
