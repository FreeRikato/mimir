console.log("Tab HTML Extractor background service worker loaded");

// Open side panel when extension icon is clicked
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

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

		fetch(message.url, { signal: controller.signal })
			.then(async (response) => {
				clearTimeout(timeoutId);
				console.log("Background: Fetch response status:", response.status);

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
