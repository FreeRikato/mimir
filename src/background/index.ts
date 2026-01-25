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

		fetch(message.url)
			.then(async (response) => {
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
					// JSON and text formats return JSON
					const data = await response.json();
					console.log("Background: Response data received, success:", response.ok);
					if (!response.ok) {
						sendResponse({ success: false, error: data.message || data.detail || `HTTP ${response.status}` });
					} else {
						sendResponse({ success: true, data });
					}
				}
			})
			.catch((err) => {
				console.error("Background: Fetch error:", err);
				sendResponse({ success: false, error: err.message });
			});
		return true; // Keep channel open for async response
	}

	console.log("Background: Received message:", message);
	sendResponse({ status: "received" });
});
