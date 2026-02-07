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
						error: "Unauthorized: Please check your API key configuration (VITE_SUBTITLES_API_KEY)",
					});
					return;
				}
				if (response.status === 403) {
					sendResponse({
						success: false,
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
						// Try to extract error message from VTT/plain text response
						sendResponse({ success: false, error: text || `HTTP ${response.status}` });
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
						sendResponse({ success: false, error: "Invalid JSON response from server" });
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
						sendResponse({ success: false, error: errorMsg });
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

	console.log("Background: Received message:", message);
	sendResponse({ status: "received" });
});
